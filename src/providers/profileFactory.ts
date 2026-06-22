import type { Settings } from "@/config";
import { FakeProfileProvider } from "@/providers/fakeProfile";
import type { ProfileProvider } from "@/providers/profileBase";
import { PublicEmbedProfileProvider } from "@/providers/publicEmbedProfile";

/**
 * Pick a profile provider. Only the `fake` provider has a dedicated mock; every
 * real provider reuses the public (FxTwitter) user endpoint, which needs no
 * credentials, so profile sharing works regardless of `TWEET_PROVIDER`.
 */
export function createProfileProvider(settings: Settings): ProfileProvider {
  if (settings.tweetProvider === "fake") {
    return new FakeProfileProvider();
  }
  return new PublicEmbedProfileProvider({
    timeoutSeconds: settings.tweetProviderTimeoutSeconds,
  });
}
