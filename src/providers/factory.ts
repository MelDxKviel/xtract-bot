import type { Settings } from "@/config";
import type { TweetProvider } from "@/providers/base";
import { ExternalHttpTweetProvider } from "@/providers/externalHttp";
import { FakeTweetProvider } from "@/providers/fake";
import { PublicEmbedTweetProvider } from "@/providers/publicEmbed";
import { XApiTweetProvider } from "@/providers/xApi";

export function createTweetProvider(settings: Settings): TweetProvider {
  switch (settings.tweetProvider) {
    case "fake":
      return new FakeTweetProvider();
    case "public_embed":
      return new PublicEmbedTweetProvider({
        timeoutSeconds: settings.tweetProviderTimeoutSeconds,
      });
    case "external_http": {
      if (!settings.tweetProviderBaseUrl) {
        throw new Error("TWEET_PROVIDER_BASE_URL is required for external_http provider");
      }
      return new ExternalHttpTweetProvider(settings.tweetProviderBaseUrl, {
        apiKey: settings.tweetProviderApiKey,
        timeoutSeconds: settings.tweetProviderTimeoutSeconds,
      });
    }
    case "x_api": {
      if (!settings.xBearerToken) {
        throw new Error("X_BEARER_TOKEN is required for x_api provider");
      }
      return new XApiTweetProvider(settings.xBearerToken, {
        timeoutSeconds: settings.tweetProviderTimeoutSeconds,
      });
    }
  }
}
