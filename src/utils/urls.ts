// Apex domains we accept: X/Twitter itself plus the "fixer" mirrors that repair
// broken embeds by acting as drop-in replacements — same URL paths as x.com,
// only the host changes (fxtwitter.com, fixupx.com, …). Any subdomain of these
// (mobile.twitter.com, www.fxtwitter.com, g.fixupx.com, …) is accepted too,
// since they keep the same /<user>/status/<id> and /<handle> path layout.
const SUPPORTED_HOSTS = [
  "x.com",
  "twitter.com",
  // BetterTwitFix / vxTwitter family
  "vxtwitter.com",
  "fixvx.com",
  // FxEmbed / FxTwitter (FixupX) family
  "fxtwitter.com",
  "fixupx.com",
  "twittpr.com",
  "xfixup.com",
  "pxtwitter.com",
  // EmbedEZ
  "twitterez.com",
] as const;

// Escape every regex metacharacter (including backslashes) so a host is matched
// literally, even though the current allowlist only contains letters and dots.
const HOST_ALTERNATION = SUPPORTED_HOSTS.map((host) =>
  host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
).join("|");
// Optional scheme, optional subdomain labels, a supported apex host, then a path.
const URL_RE = new RegExp(
  String.raw`(?<![\w@.])(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[a-z0-9-]+\.)*(?:${HOST_ALTERNATION})\/[^\s<>()]+`,
  "gi",
);
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const TRAILING_PUNCTUATION = ".,;:!?)]}>'\"";

export interface ParsedTweetUrl {
  readonly tweetId: string;
  readonly sourceUrl: string;
  readonly normalizedUrl: string;
}

export interface ParsedProfileUrl {
  readonly username: string;
  readonly sourceUrl: string;
  readonly normalizedUrl: string;
}

// Handle is alphanumerics + underscore, up to 15 chars (Twitter's limit).
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

// First path segments that are routes/pages rather than user handles, so a URL
// like x.com/search or x.com/i/lists/… is never mistaken for a profile.
const RESERVED_HANDLES = new Set([
  "i",
  "intent",
  "share",
  "home",
  "explore",
  "search",
  "hashtag",
  "notifications",
  "messages",
  "compose",
  "settings",
  "login",
  "logout",
  "signup",
  "account",
  "about",
  "tos",
  "privacy",
  "help",
  "status",
  "statuses",
  "web",
  "lists",
  "bookmarks",
  "communities",
  "topics",
  "moments",
  "jobs",
  "download",
  "oauth",
  "widgets",
]);

// Profile sub-tabs that may follow the handle (x.com/jack/media, …) — anything
// else after the handle means it's not a plain profile link.
const PROFILE_SUBPAGES = new Set([
  "with_replies",
  "media",
  "likes",
  "following",
  "followers",
  "verified_followers",
  "photo",
  "header_photo",
  "highlights",
  "articles",
  "superfollows",
  "affiliates",
]);

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

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !isSupportedHost(parsed.hostname)
  ) {
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

export function extractFirstProfileUrl(text: string): ParsedProfileUrl | null {
  const regex = new RegExp(URL_RE.source, URL_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const parsed = parseProfileUrl(match[0]);
    if (parsed) return parsed;
  }
  return null;
}

export function parseProfileUrl(rawUrl: string): ParsedProfileUrl | null {
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

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !isSupportedHost(parsed.hostname)
  ) {
    return null;
  }

  const segments = parsed.pathname
    .split("/")
    .map(safeDecode)
    .filter((part) => part.length > 0);

  // A status link is a tweet, not a profile.
  if (segments.some((segment) => segment === "status" || segment === "statuses")) {
    return null;
  }

  const handle = segments[0];
  if (!handle || !HANDLE_RE.test(handle) || RESERVED_HANDLES.has(handle.toLowerCase())) {
    return null;
  }
  // Allow the bare handle or a known profile sub-tab; reject anything deeper.
  if (segments.length > 1 && !PROFILE_SUBPAGES.has(segments[1]!.toLowerCase())) {
    return null;
  }

  const username = handle.replace(/^@+/, "");
  return {
    username,
    sourceUrl,
    normalizedUrl: `https://x.com/${username}`,
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isSupportedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().split(":")[0]!;
  // Match a supported apex exactly, or any of its subdomains (mobile.*, www.*,
  // g.*, d.* …). The leading dot ensures "notx.com" never matches "x.com".
  return SUPPORTED_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
}
