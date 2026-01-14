import { RealTimeDataClient } from "@polymarket/real-time-data-client";
import type { Trade } from "../api/polymarket";
import * as walletRepo from "../db/repositories/wallet.repo";
import { analyzeWallet } from "../tracker/analyzer";
import * as consoleUI from "../utils/console-ui";
import { logger } from "../utils/logger";
import { dispatchAlerts, generateTradeHash } from "./alert.service";
import * as paperService from "./paper.service";
import * as priceService from "./price.service";

// Track watched wallet addresses (refreshed periodically)
let watchedWallets = new Set<string>();
let client: RealTimeDataClient | null = null;
let isRunning = false;
let tradesReceived = 0;
let tradesMatched = 0;

// Recently processed trades (dedup)
const recentlyProcessed = new Set<string>();
const MAX_CACHE_SIZE = 5000;

interface RealTimeTradeMessage {
	topic: string;
	type: string;
	payload: {
		id: string;
		proxyWallet?: string;
		user?: string;
		conditionId: string;
		assetId: string;
		side: "BUY" | "SELL";
		size: string;
		price: string;
		timestamp: number;
		transactionHash: string;
		title?: string;
		slug?: string;
		outcome?: string;
		outcomeIndex?: number;
		eventSlug?: string;
		marketSlug?: string;
	};
}

/**
 * Start real-time WebSocket monitoring
 */
export async function startRealtimeMonitor(): Promise<void> {
	if (isRunning) {
		logger.warn("Realtime monitor already running");
		return;
	}

	isRunning = true;
	logger.info("Starting real-time WebSocket monitor...");

	// Initial load of watched wallets
	await refreshWatchedWallets();

	// Show console header
	consoleUI.displayHeader(watchedWallets.size);
	consoleUI.resetStats();

	// Start periodic wallet refresh (every 30 seconds)
	const walletRefreshInterval = setInterval(async () => {
		if (isRunning) {
			await refreshWatchedWallets();
		}
	}, 30000);

	// Connect to WebSocket
	const onMessage = (
		_client: RealTimeDataClient,
		message: RealTimeTradeMessage,
	) => {
		if (message.topic === "activity" && message.type === "trades") {
			handleTradeMessage(message.payload).catch((err) => {
				logger.error("Error handling trade message", err);
			});
		}
	};

	const onConnect = (connectedClient: RealTimeDataClient) => {
		logger.info("Connected to Polymarket real-time WebSocket");
		consoleUI.displayConnectionStatus("connected");

		// Subscribe to all trades
		connectedClient.subscribe({
			subscriptions: [
				{
					topic: "activity",
					type: "trades",
				},
			],
		});

		logger.info("Subscribed to real-time trades feed");
	};

	const onStatusChange = (status: string) => {
		logger.info(`WebSocket status: ${status}`);
		if (status === "disconnected" && isRunning) {
			consoleUI.displayConnectionStatus("disconnected");
			logger.warn("WebSocket disconnected, auto-reconnect should handle it");
		} else if (status === "connected") {
			consoleUI.displayConnectionStatus("connected");
		}
	};

	try {
		client = new RealTimeDataClient({
			onMessage: onMessage as any,
			onConnect,
			onStatusChange,
			autoReconnect: true,
		});

		client.connect();
	} catch (error) {
		logger.error("Failed to connect to WebSocket", error);
		isRunning = false;
		clearInterval(walletRefreshInterval);
	}
}

/**
 * Stop real-time monitoring
 */
export function stopRealtimeMonitor(): void {
	isRunning = false;
	if (client) {
		client.disconnect();
		client = null;
	}

	// Show final stats
	consoleUI.displayStats();
	consoleUI.displayConnectionStatus("disconnected");

	logger.info("Real-time monitor stopped");
}

/**
 * Refresh the list of watched wallet addresses
 */
async function refreshWatchedWallets(): Promise<void> {
	try {
		const addresses = await walletRepo.getAllTrackedWalletAddresses();
		watchedWallets = new Set(addresses.map((a) => a.toLowerCase()));
		// logger.debug(`Watching ${watchedWallets.size} wallets for real-time trades`);
	} catch (error) {
		logger.error("Failed to refresh watched wallets", error);
	}
}

/**
 * Handle incoming trade message
 */
async function handleTradeMessage(
	trade: RealTimeTradeMessage["payload"],
): Promise<void> {
	tradesReceived++;

	// Get wallet address from trade
	const walletAddress = (trade.proxyWallet || trade.user || "").toLowerCase();

	if (!walletAddress) {
		return;
	}

	// Update price cache for this specific asset (outcome)
	// Use assetId, not conditionId - each market has Yes/No with different assetIds
	if (trade.assetId) {
		priceService.updatePrice(
			trade.assetId,
			parseFloat(trade.price),
			trade.title || trade.marketSlug,
			trade.outcome,
		);
	}

	// Check if this wallet is being watched
	const isMatched = watchedWallets.has(walletAddress);

	// Generate trade hash for dedup (check BEFORE display/logging)
	const tradeHash = `${trade.transactionHash}-${trade.id}`;
	const isDuplicate = recentlyProcessed.has(tradeHash);

	// Display trade in console (but not duplicates for matched wallets)
	if (!isDuplicate || !isMatched) {
		const tradeSize = parseFloat(trade.size) * parseFloat(trade.price);
		consoleUI.displayTrade({
			side: trade.side,
			wallet: walletAddress,
			market: trade.title || trade.marketSlug || "Unknown Market",
			outcome: trade.outcome,
			size: tradeSize,
			price: parseFloat(trade.price),
			isMatched,
		});
	}

	// Show stats periodically (every 60 seconds)
	maybeDisplayPortfolioStats(60);

	if (!isMatched) {
		return;
	}

	// Skip duplicate matched trades
	if (isDuplicate) {
		return;
	}
	recentlyProcessed.add(tradeHash);

	// Clean cache if too large
	if (recentlyProcessed.size > MAX_CACHE_SIZE) {
		const toRemove = recentlyProcessed.size - MAX_CACHE_SIZE / 2;
		const iterator = recentlyProcessed.values();
		for (let i = 0; i < toRemove; i++) {
			const next = iterator.next();
			if (next.done) break;
			recentlyProcessed.delete(next.value);
		}
	}

	tradesMatched++;
	logger.info(
		`Real-time trade detected from watched wallet ${walletAddress.slice(0, 10)}...`,
	);

	// Get wallet stats from cache or analyze
	let walletStats = await walletRepo.getWalletFromCache(walletAddress);

	if (!walletStats || (await walletRepo.isCacheStale(walletAddress, 60))) {
		const freshStats = await analyzeWallet(walletAddress, 3);
		if (freshStats) {
			await walletRepo.updateWalletCache(walletAddress, freshStats);
			walletStats = await walletRepo.getWalletFromCache(walletAddress);
		}
	}

	if (!walletStats) {
		logger.warn(
			`No stats available for wallet ${walletAddress.slice(0, 10)}...`,
		);
		return;
	}

	// Convert to Trade format
	const tradeData: Trade = {
		id: trade.id,
		taker: walletAddress,
		maker: "",
		side: trade.side,
		asset: trade.assetId,
		conditionId: trade.conditionId,
		size: trade.size,
		price: trade.price,
		timestamp: trade.timestamp,
		transactionHash: trade.transactionHash,
		title: trade.title || "",
		slug: trade.slug || trade.marketSlug || trade.eventSlug || "",
		outcome: trade.outcome || "",
		outcomeIndex: trade.outcomeIndex || 0,
	};

	// Dispatch alerts
	await dispatchAlerts({
		walletAddress,
		trade: tradeData,
		walletStats: {
			address: walletStats.address,
			totalPnl: walletStats.total_pnl,
			realizedPnl: 0,
			unrealizedPnl: 0,
			winRate: walletStats.win_rate,
			totalTrades: walletStats.total_trades,
			winningTrades: 0,
			losingTrades: 0,
			avgTradeSize: walletStats.avg_trade_size,
			lastTradeAt: walletStats.last_trade_at,
			daysSinceLastTrade: 0,
			pnlPerTrade: walletStats.pnl_per_trade,
			tradeFrequency: walletStats.trade_frequency,
			whaleType: walletStats.whale_type as "active" | "dormant" | "sniper",
			takerRatio: 0,
			takerVolume: 0,
			makerVolume: 0,
			categoryBreakdown: [],
		},
	});
}

/**
 * Get real-time monitor status
 */
export function getRealtimeStatus(): {
	isRunning: boolean;
	watchedWallets: number;
	tradesReceived: number;
	tradesMatched: number;
	cacheSize: number;
} {
	return {
		isRunning,
		watchedWallets: watchedWallets.size,
		tradesReceived,
		tradesMatched,
		cacheSize: recentlyProcessed.size,
	};
}

/**
 * Display portfolio stats periodically
 */
let lastPortfolioDisplay = 0;
function maybeDisplayPortfolioStats(intervalSeconds: number): void {
	const now = Date.now();
	if (now - lastPortfolioDisplay < intervalSeconds * 1000) {
		return;
	}
	lastPortfolioDisplay = now;

	// Show trade stats
	consoleUI.displayStats();

	// Get all active portfolios
	const portfolios = paperService.getAllActivePortfolios();

	if (portfolios.length > 0) {
		// Get history for each portfolio
		const historyMap = new Map<number, paperService.PortfolioSnapshot[]>();
		for (const p of portfolios) {
			const history = paperService.getPortfolioHistory(p.portfolioId, 30);
			if (history.length > 0) {
				historyMap.set(p.portfolioId, history);
			}
		}

		// Get positions for each portfolio
		const positionsMap = new Map<number, paperService.PaperPosition[]>();
		for (const p of portfolios) {
			const positions = paperService.getPortfolioPositions(p.portfolioId);
			if (positions.length > 0) {
				positionsMap.set(p.portfolioId, positions);
			}
		}

		// Display all portfolios with their graphs and positions
		consoleUI.displayAllPortfolios(portfolios, historyMap, positionsMap);
	}
}
