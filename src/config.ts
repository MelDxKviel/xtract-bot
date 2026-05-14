export type TweetProviderName = "fake" | "public_embed" | "external_http" | "x_api";

export interface Settings {
  botToken: string;
  databaseUrl: string;
  adminIds: ReadonlySet<number>;
  accessWhitelistEnabled: boolean;
  tweetProvider: TweetProviderName;
  tweetCacheTtlSeconds: number;
  tweetProviderTimeoutSeconds: number;
  logLevel: string;
  webhookUrl: string | null;
  webhookSecret: string | null;
  pollingEnabled: boolean;
  tweetProviderBaseUrl: string | null;
  tweetProviderApiKey: string | null;
  xBearerToken: string | null;
}

const KNOWN_PROVIDERS = new Set<TweetProviderName>([
  "fake",
  "public_embed",
  "external_http",
  "x_api",
]);

export function loadSettings(env: Record<string, string | undefined> = process.env): Settings {
  const botToken = requireEnv(env, "BOT_TOKEN");
  const databaseUrl = requireEnv(env, "DATABASE_URL");
  const adminIds = parseIdList(env["ADMIN_IDS"] ?? "");
  const provider = (env["TWEET_PROVIDER"] ?? "fake") as TweetProviderName;
  if (!KNOWN_PROVIDERS.has(provider)) {
    throw new Error(`unsupported TWEET_PROVIDER: ${String(provider)}`);
  }
  return {
    botToken,
    databaseUrl,
    adminIds,
    accessWhitelistEnabled: parseBool(env["ACCESS_WHITELIST_ENABLED"], true),
    tweetProvider: provider,
    tweetCacheTtlSeconds: parseInt(env["TWEET_CACHE_TTL_SECONDS"], 86_400),
    tweetProviderTimeoutSeconds: parseFloat(env["TWEET_PROVIDER_TIMEOUT_SECONDS"], 10),
    logLevel: env["LOG_LEVEL"] ?? "INFO",
    webhookUrl: nonEmpty(env["WEBHOOK_URL"]),
    webhookSecret: nonEmpty(env["WEBHOOK_SECRET"]),
    pollingEnabled: parseBool(env["POLLING_ENABLED"], true),
    tweetProviderBaseUrl: nonEmpty(env["TWEET_PROVIDER_BASE_URL"]),
    tweetProviderApiKey: nonEmpty(env["TWEET_PROVIDER_API_KEY"]),
    xBearerToken: nonEmpty(env["X_BEARER_TOKEN"]),
  };
}

export function parseIdList(value: string): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const raw of value.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed)) {
      throw new Error(`invalid admin id: ${trimmed}`);
    }
    ids.add(parsed);
  }
  return ids;
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const lower = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(lower)) return true;
  if (["0", "false", "no", "n", "off", ""].includes(lower)) return false;
  return fallback;
}

function parseInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function parseFloat(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
