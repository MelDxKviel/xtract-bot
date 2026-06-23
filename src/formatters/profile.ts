import {
  CAPTION_LIMIT,
  escapeAttr,
  escapeHtml,
  linkifyEntities,
  MESSAGE_LIMIT,
  pluralPosts,
  RICH_MESSAGE_LIMIT,
  type TelegramPost,
} from "@/formatters/telegram";
import type { ProfileData } from "@/providers/profileBase";
import type { TweetMedia } from "@/providers/base";

export const OPEN_PROFILE_LABEL = "👤 Открыть профиль";

// Twitter bios cap at 160 chars, but be defensive for other providers.
const BIO_LIMIT = 600;
const CAPTION_BIO_LIMIT = 280;

export function formatProfile(profile: ProfileData): TelegramPost {
  const linkHtml = openProfileLinkHtml(profile.url);
  const suffixLen = "\n\n".length + linkHtml.length;
  return {
    html: renderProfileHtml(profile, BIO_LIMIT, MESSAGE_LIMIT - suffixLen),
    richHtml: renderProfileHtml(profile, BIO_LIMIT, RICH_MESSAGE_LIMIT - suffixLen),
    captionHtml: renderProfileHtml(profile, CAPTION_BIO_LIMIT, CAPTION_LIMIT - suffixLen),
    linkHtml,
    media: profileMedia(profile),
    extraMediaCount: 0,
  };
}

export function openProfileLinkHtml(url: string): string {
  return `<a href="${escapeAttr(url)}">${OPEN_PROFILE_LABEL}</a>`;
}

// Show the avatar (the recognisable image, also used by the single-media inline
// fallback) followed by the banner when present.
function profileMedia(profile: ProfileData): TweetMedia[] {
  const media: TweetMedia[] = [];
  if (profile.avatarUrl) media.push(photo(profile.avatarUrl));
  if (profile.bannerUrl) media.push(photo(profile.bannerUrl));
  return media;
}

function photo(url: string): TweetMedia {
  return { type: "photo", url, previewUrl: null, width: null, height: null, durationMs: null };
}

function renderProfileHtml(profile: ProfileData, bioLimit: number, hardLimit: number): string {
  const verified = profile.verified ? " ✅" : "";
  const name = escapeHtml(profile.name);
  const header = `𝕏 <a href="${escapeAttr(profile.url)}"><b>${name}</b></a>${verified}`;
  const handle = `<a href="${escapeAttr(profile.url)}">@${escapeHtml(profile.username)}</a>`;

  const build = (bioLen: number): string => {
    const parts: string[] = [header, handle];
    const bio = profile.bio ? linkifyEntities(truncate(profile.bio, bioLen)) : null;
    if (bio) parts.push("", bio);

    const stats = statsLine(profile);
    if (stats) parts.push("", stats);

    const details = detailLines(profile);
    if (details.length > 0) {
      parts.push("");
      parts.push(...details);
    }
    return parts.join("\n");
  };

  let rendered = build(bioLimit);
  if (rendered.length <= hardLimit) return rendered;

  // Trim the bio until it fits (everything else is short and fixed).
  let bioLen = bioLimit;
  while (bioLen > 0 && rendered.length > hardLimit) {
    bioLen = Math.max(0, bioLen - Math.max(16, rendered.length - hardLimit));
    rendered = build(bioLen);
  }
  return rendered;
}

function statsLine(profile: ProfileData): string | null {
  const segments: string[] = [];
  if (profile.followersCount !== null) {
    segments.push(
      `<b>${formatCount(profile.followersCount)}</b> ${pluralFollowers(profile.followersCount)}`,
    );
  }
  if (profile.followingCount !== null) {
    segments.push(
      `<b>${formatCount(profile.followingCount)}</b> ${pluralFollowing(profile.followingCount)}`,
    );
  }
  if (profile.tweetCount !== null) {
    segments.push(`<b>${formatCount(profile.tweetCount)}</b> ${pluralPosts(profile.tweetCount)}`);
  }
  if (segments.length === 0) return null;
  return `👥 ${segments.join(" · ")}`;
}

function detailLines(profile: ProfileData): string[] {
  const lines: string[] = [];
  if (profile.location) {
    lines.push(`📍 ${escapeHtml(profile.location)}`);
  }
  if (profile.website) {
    const href = profile.website.startsWith("http")
      ? profile.website
      : `https://${profile.website}`;
    lines.push(`🔗 <a href="${escapeAttr(href)}">${escapeHtml(stripScheme(profile.website))}</a>`);
  }
  if (profile.joinedAt) {
    lines.push(`📅 На X с ${monthYear(profile.joinedAt)}`);
  }
  return lines;
}

function pluralFollowers(count: number): string {
  return pickPlural(count, "подписчик", "подписчика", "подписчиков");
}

function pluralFollowing(count: number): string {
  return pickPlural(count, "подписка", "подписки", "подписок");
}

function pickPlural(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function formatCount(value: number): string {
  return Math.round(Math.max(0, value))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

const RU_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function monthYear(date: Date): string {
  return `${RU_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function truncate(value: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return "...".slice(0, maxLength);
  return value.slice(0, maxLength - 3).replace(/\s+$/, "") + "...";
}
