type LogLevel = "info" | "warn" | "error" | "debug" | "success";

const colors = {
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
  debug: "\x1b[90m", // gray
  success: "\x1b[32m", // green
  reset: "\x1b[0m",
};

function timestamp(): string {
  const parts = new Date().toISOString().split("T");
  return (parts[1] || "00:00:00").slice(0, 8);
}

function log(level: LogLevel, message: string, data?: unknown) {
  const color = colors[level];
  const prefix = `${colors.debug}[${timestamp()}]${colors.reset} ${color}[${level.toUpperCase()}]${colors.reset}`;

  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

export const logger = {
  info: (msg: string, data?: unknown) => log("info", msg, data),
  warn: (msg: string, data?: unknown) => log("warn", msg, data),
  error: (msg: string, data?: unknown) => log("error", msg, data),
  debug: (msg: string, data?: unknown) => log("debug", msg, data),
  success: (msg: string, data?: unknown) => log("success", msg, data),

  alert: (wallet: string, market: string, side: string, size: number) => {
    console.log(
      `${colors.success}[ALERT]${colors.reset} ${wallet.slice(0, 10)}... ${side} $${size.toFixed(0)} on "${market.slice(0, 50)}..."`
    );
  },

  walletFound: (address: string, pnl: number, winRate: number) => {
    console.log(
      `${colors.info}[WALLET]${colors.reset} ${address.slice(0, 10)}... | PnL: $${pnl.toFixed(0)} | Win: ${(winRate * 100).toFixed(1)}%`
    );
  },

  poll: (tracked: number, newTrades: number) => {
    console.log(
      `${colors.debug}[POLL]${colors.reset} Tracking ${tracked} wallets | ${newTrades} new trades`
    );
  },

  edge: (outcome: string, edge: number, minEdge: number) => {
    const edgePct = (edge * 100).toFixed(2);
    const isValue = edge >= minEdge;
    const isPositive = edge > 0;

    let color: string;
    let symbol: string;

    if (isValue) {
      color = colors.success; // green for value bets
      symbol = "✓";
    } else if (isPositive) {
      color = colors.warn; // yellow for positive but below threshold
      symbol = "○";
    } else {
      color = colors.error; // red for negative edge
      symbol = "✗";
    }

    const sign = edge >= 0 ? "+" : "";
    console.log(
      `${colors.debug}[${timestamp()}]${colors.reset} ${symbol} ${outcome}: ${color}${sign}${edgePct}%${colors.reset}`
    );
  },

  // Display edges sorted by game time
  edgesSorted: (edges: Array<{
    outcome: string;
    edge: number;
    minEdge: number;
    commenceTime: string;
    homeTeam: string;
    awayTeam: string;
  }>) => {
    if (edges.length === 0) return;

    const now = Date.now();

    // Sort by commence time (soonest first)
    const sorted = [...edges].sort((a, b) => {
      const timeA = new Date(a.commenceTime).getTime();
      const timeB = new Date(b.commenceTime).getTime();
      return timeA - timeB;
    });

    console.log(`${colors.debug}[${timestamp()}]${colors.reset} --- Edge Report (${sorted.length} outcomes) ---`);

    for (const e of sorted) {
      const edgePct = (e.edge * 100).toFixed(2);
      const isValue = e.edge >= e.minEdge;
      const isPositive = e.edge > 0;

      let color: string;
      let symbol: string;

      if (isValue) {
        color = colors.success;
        symbol = "✓";
      } else if (isPositive) {
        color = colors.warn;
        symbol = "○";
      } else {
        color = colors.error;
        symbol = "✗";
      }

      const sign = e.edge >= 0 ? "+" : "";

      // Calculate time until/since start
      const commenceMs = new Date(e.commenceTime).getTime();
      const diffMs = commenceMs - now;
      const diffMins = Math.abs(diffMs) / 60000;

      let timeStr: string;
      if (diffMs > 0) {
        // Game hasn't started
        if (diffMins >= 60) {
          const hours = Math.floor(diffMins / 60);
          const mins = Math.round(diffMins % 60);
          timeStr = `${colors.info}in ${hours}h${mins}m${colors.reset}`;
        } else {
          timeStr = `${colors.warn}in ${Math.round(diffMins)}m${colors.reset}`;
        }
      } else {
        // Game started
        if (diffMins >= 60) {
          const hours = Math.floor(diffMins / 60);
          const mins = Math.round(diffMins % 60);
          timeStr = `${colors.success}LIVE ${hours}h${mins}m${colors.reset}`;
        } else {
          timeStr = `${colors.success}LIVE ${Math.round(diffMins)}m${colors.reset}`;
        }
      }

      const gameLabel = `${e.homeTeam} vs ${e.awayTeam}`.substring(0, 35).padEnd(35);
      console.log(
        `${colors.debug}[${timestamp()}]${colors.reset} ${symbol} ${timeStr.padEnd(20)} ${gameLabel} ${e.outcome.padEnd(25)} ${color}${sign}${edgePct}%${colors.reset}`
      );
    }
    console.log(`${colors.debug}[${timestamp()}]${colors.reset} --- End Edge Report ---`);
  },
};
