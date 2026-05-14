const LEVELS: Record<string, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  WARNING: 30,
  ERROR: 40,
  CRITICAL: 50,
};

let currentLevel = LEVELS["INFO"]!;

export function configureLogging(level: string): void {
  currentLevel = LEVELS[level.toUpperCase()] ?? LEVELS["INFO"]!;
}

function shouldLog(level: string): boolean {
  return (LEVELS[level] ?? 0) >= currentLevel;
}

function format(level: string, args: unknown[]): unknown[] {
  return [new Date().toISOString(), level, ...args];
}

export const log = {
  debug(...args: unknown[]): void {
    if (shouldLog("DEBUG")) console.debug(...format("DEBUG", args));
  },
  info(...args: unknown[]): void {
    if (shouldLog("INFO")) console.log(...format("INFO", args));
  },
  warn(...args: unknown[]): void {
    if (shouldLog("WARN")) console.warn(...format("WARN", args));
  },
  error(...args: unknown[]): void {
    if (shouldLog("ERROR")) console.error(...format("ERROR", args));
  },
};
