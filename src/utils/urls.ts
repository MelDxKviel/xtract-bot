const SUPPORTED_HOSTS = new Set(["x.com", "twitter.com", "mobile.twitter.com", "vxtwitter.com"]);
const URL_RE =
  /(?<![\w@.])(?:[a-z][a-z0-9+.-]*:\/\/)?(?:www\.)?(?:mobile\.twitter\.com|vxtwitter\.com|x\.com|twitter\.com)\/[^\s<>()]+/gi;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const TRAILING_PUNCTUATION = ".,;:!?)]}>'\"";

export interface ParsedTweetUrl {
  readonly tweetId: string;
  readonly sourceUrl: string;
  readonly normalizedUrl: string;
}

export function extractFirstTweetUrl(text: string): ParsedTweetUrl | null {
  const regex = new RegExp(URL_RE.source, URL_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const parsed = parseTweetUrl(match[0]);
    if (parsed) return parsed;
  }
  return null;
}

export function parseTweetUrl(rawUrl: string): ParsedTweetUrl | null {
  let sourceUrl = rawUrl.trim();
  while (sourceUrl.length > 0 && TRAILING_PUNCTUATION.includes(sourceUrl[sourceUrl.length - 1]!)) {
    sourceUrl = sourceUrl.slice(0, -1);
  }

  const candidate = SCHEME_RE.test(sourceUrl) ? sourceUrl : `https://${sourceUrl}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  const host = normalizeHost(parsed.hostname);
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !SUPPORTED_HOSTS.has(host)) {
    return null;
  }

  const segments = parsed.pathname
    .split("/")
    .map(safeDecode)
    .filter((part) => part.length > 0);

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment !== "status" && segment !== "statuses") continue;
    const next = segments[index + 1];
    if (!next || !/^\d+$/.test(next)) continue;
    const tweetId = next;
    const first = segments[0];
    const username = first && first !== "status" && first !== "statuses" ? first : "i";
    return {
      tweetId,
      sourceUrl,
      normalizedUrl: `https://x.com/${username}/status/${tweetId}`,
    };
  }
  return null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeHost(host: string): string {
  const lowered = host.toLowerCase().split(":")[0]!;
  return lowered.startsWith("www.") ? lowered.slice(4) : lowered;
}
