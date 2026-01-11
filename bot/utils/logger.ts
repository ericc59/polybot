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
};
