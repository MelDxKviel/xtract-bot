import {
  tweetFromPayload,
  TweetProviderError,
  type TweetData,
  type TweetDataPayload,
  type TweetProvider,
} from "@/providers/base";
import { buildUrl, getFetch, withTimeout, type FetchLike } from "@/providers/http";

export class ExternalHttpTweetProvider implements TweetProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(
    baseUrl: string,
    options: { apiKey?: string | null; timeoutSeconds?: number; fetch?: FetchLike } = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? null;
    this.timeoutMs = Math.round((options.timeoutSeconds ?? 10) * 1000);
    this.fetchImpl = getFetch(options.fetch);
  }

  async getTweet(tweetId: string, sourceUrl: string): Promise<TweetData> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    const url = buildUrl(this.baseUrl + "/", `tweets/${encodeURIComponent(tweetId)}`, {
      url: sourceUrl,
    });

    const { signal, clear } = withTimeout(this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers, signal });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new TweetProviderError("request timed out", { code: "provider_timeout" });
      }
      throw new TweetProviderError(String(error), { code: "provider_http_error" });
    } finally {
      clear();
    }

    if (response.status === 404) {
      throw new TweetProviderError("tweet not found", { code: "not_found" });
    }
    if (response.status === 401) {
      throw new TweetProviderError("provider authentication failed", { code: "provider_auth" });
    }
    if (response.status === 429) {
      throw new TweetProviderError("provider rate limit exceeded", {
        code: "provider_rate_limited",
      });
    }
    if (!response.ok) {
      throw new TweetProviderError(`provider HTTP ${response.status}`, {
        code: "provider_http_error",
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new TweetProviderError(String(error), { code: "provider_bad_response" });
    }
    const obj = payload as { tweet?: TweetDataPayload } & TweetDataPayload;
    const data: TweetDataPayload = (obj.tweet ?? obj) as TweetDataPayload;
    return tweetFromPayload(data);
  }

  async health(): Promise<boolean> {
    try {
      const { signal, clear } = withTimeout(this.timeoutMs);
      try {
        const response = await this.fetchImpl(this.baseUrl + "/health", { signal });
        return response.status < 500;
      } finally {
        clear();
      }
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    // no-op
  }
}
