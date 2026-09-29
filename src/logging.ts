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

/**
 * Return diagnostics that are safe to write to production logs.
 *
 * Error messages and stacks can contain request URLs, authorization headers,
 * database connection strings, or Telegram tokens.  Callers should log this
 * deliberately small summary instead of serialising an arbitrary exception.
 */
export function safeError(error: unknown): Readonly<Record<string, string>> {
  if (!(error instanceof Error)) return { type: "UnknownError" };

  const result: Record<string, string> = { type: error.name || "Error" };
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(code)) {
    result.code = code;
  }
  return result;
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
