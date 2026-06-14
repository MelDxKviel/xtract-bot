import { describe, expect, it } from "vitest";

import { TweetProviderError } from "@/providers/base";
import type { FetchLike } from "@/providers/http";
import { ExternalHttpTweetProvider } from "@/providers/externalHttp";
import { XApiTweetProvider } from "@/providers/xApi";

function abortingFetch(): FetchLike {
  return async () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    throw error;
  };
}

function failingFetch(): FetchLike {
  return async () => {
    throw new Error("connection refused");
  };
}

async function captureError(promise: Promise<unknown>): Promise<TweetProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TweetProviderError);
    return error as TweetProviderError;
  }
  throw new Error("expected promise to reject");
}

describe("XApiTweetProvider error classification", () => {
  it("reports provider_timeout when the request is aborted", async () => {
    const provider = new XApiTweetProvider("token", { fetch: abortingFetch() });
    const error = await captureError(provider.getTweet("123", "https://x.com/user/status/123"));
    expect(error.code).toBe("provider_timeout");
  });

  it("reports provider_http_error for network failures", async () => {
    const provider = new XApiTweetProvider("token", { fetch: failingFetch() });
    const error = await captureError(provider.getTweet("123", "https://x.com/user/status/123"));
    expect(error.code).toBe("provider_http_error");
  });
});

describe("ExternalHttpTweetProvider error classification", () => {
  it("reports provider_timeout when the request is aborted", async () => {
    const provider = new ExternalHttpTweetProvider("https://api.example.com", {
      fetch: abortingFetch(),
    });
    const error = await captureError(provider.getTweet("123", "https://x.com/user/status/123"));
    expect(error.code).toBe("provider_timeout");
  });

  it("reports provider_http_error for network failures", async () => {
    const provider = new ExternalHttpTweetProvider("https://api.example.com", {
      fetch: failingFetch(),
    });
    const error = await captureError(provider.getTweet("123", "https://x.com/user/status/123"));
    expect(error.code).toBe("provider_http_error");
  });
});
