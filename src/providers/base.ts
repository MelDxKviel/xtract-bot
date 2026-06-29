export type MediaType = "photo" | "video" | "gif";

export class TweetProviderError extends Error {
  readonly code: string;

  constructor(message: string, options: { code?: string } = {}) {
    super(message);
    this.name = "TweetProviderError";
    this.code = options.code ?? "provider_error";
  }
}

export interface TweetMedia {
  type: MediaType;
  url: string;
  previewUrl: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface TweetPollOption {
  label: string;
  votes: number;
}

export interface TweetPoll {
  options: TweetPollOption[];
  totalVotes: number;
  closed: boolean;
}

export interface TweetData {
  tweetId: string;
  url: string;
  authorName: string;
  authorUsername: string;
  authorUrl: string;
  /** Author avatar image URL, when the provider supplies one. */
  authorAvatarUrl: string | null;
  text: string | null;
  createdAt: Date | null;
  media: TweetMedia[];
  quotedTweet: TweetData | null;
  repliedToTweet: TweetData | null;
  /** Parent status id when this tweet is a reply, used to unroll threads. */
  inReplyToTweetId: string | null;
  poll: TweetPoll | null;
  lang: string | null;
}

export interface TweetProvider {
  getTweet(tweetId: string, sourceUrl: string): Promise<TweetData>;
  health(): Promise<boolean>;
  close(): Promise<void>;
}

export function makeMedia(
  partial: Partial<TweetMedia> & Pick<TweetMedia, "type" | "url">,
): TweetMedia {
  return {
    type: partial.type,
    url: partial.url,
    previewUrl: partial.previewUrl ?? null,
    width: partial.width ?? null,
    height: partial.height ?? null,
    durationMs: partial.durationMs ?? null,
  };
}

export function makeTweet(
  partial: Partial<TweetData> &
    Pick<TweetData, "tweetId" | "url" | "authorName" | "authorUsername" | "authorUrl">,
): TweetData {
  return {
    tweetId: partial.tweetId,
    url: partial.url,
    authorName: partial.authorName,
    authorUsername: partial.authorUsername,
    authorUrl: partial.authorUrl,
    authorAvatarUrl: partial.authorAvatarUrl ?? null,
    text: partial.text ?? null,
    createdAt: partial.createdAt ?? null,
    media: partial.media ?? [],
    quotedTweet: partial.quotedTweet ?? null,
    repliedToTweet: partial.repliedToTweet ?? null,
    inReplyToTweetId: partial.inReplyToTweetId ?? null,
    poll: partial.poll ?? null,
    lang: partial.lang ?? null,
  };
}

export interface TweetMediaPayload {
  type: MediaType;
  url: string;
  preview_url: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
}

export interface TweetPollPayload {
  options: TweetPollOption[];
  total_votes: number;
  closed: boolean;
}

export interface TweetDataPayload {
  tweet_id: string;
  url: string;
  author_name: string;
  author_username: string;
  author_url: string;
  author_avatar_url: string | null;
  text: string | null;
  created_at: string | null;
  media: TweetMediaPayload[];
  quoted_tweet: TweetDataPayload | null;
  replied_to_tweet: TweetDataPayload | null;
  in_reply_to_tweet_id: string | null;
  poll: TweetPollPayload | null;
  lang: string | null;
}

export function mediaToPayload(media: TweetMedia): TweetMediaPayload {
  return {
    type: media.type,
    url: media.url,
    preview_url: media.previewUrl,
    width: media.width,
    height: media.height,
    duration_ms: media.durationMs,
  };
}

export function mediaFromPayload(payload: TweetMediaPayload): TweetMedia {
  const type = payload.type;
  if (type !== "photo" && type !== "video" && type !== "gif") {
    throw new Error(`unsupported media type: ${String(type)}`);
  }
  return {
    type,
    url: String(payload.url),
    previewUrl: payload.preview_url ?? null,
    width: payload.width ?? null,
    height: payload.height ?? null,
    durationMs: payload.duration_ms ?? null,
  };
}

export function tweetToPayload(tweet: TweetData): TweetDataPayload {
  return {
    tweet_id: tweet.tweetId,
    url: tweet.url,
    author_name: tweet.authorName,
    author_username: tweet.authorUsername,
    author_url: tweet.authorUrl,
    author_avatar_url: tweet.authorAvatarUrl,
    text: tweet.text,
    created_at: tweet.createdAt ? tweet.createdAt.toISOString() : null,
    media: tweet.media.map(mediaToPayload),
    quoted_tweet: tweet.quotedTweet ? tweetToPayload(tweet.quotedTweet) : null,
    replied_to_tweet: tweet.repliedToTweet ? tweetToPayload(tweet.repliedToTweet) : null,
    in_reply_to_tweet_id: tweet.inReplyToTweetId,
    poll: tweet.poll ? pollToPayload(tweet.poll) : null,
    lang: tweet.lang,
  };
}

export function tweetFromPayload(payload: TweetDataPayload): TweetData {
  return {
    tweetId: String(payload.tweet_id),
    url: String(payload.url),
    authorName: String(payload.author_name),
    authorUsername: String(payload.author_username),
    authorUrl: String(payload.author_url),
    authorAvatarUrl: payload.author_avatar_url ?? null,
    text: payload.text ?? null,
    createdAt: parseDatetime(payload.created_at),
    media: (payload.media ?? []).map(mediaFromPayload),
    quotedTweet: payload.quoted_tweet ? tweetFromPayload(payload.quoted_tweet) : null,
    repliedToTweet: payload.replied_to_tweet ? tweetFromPayload(payload.replied_to_tweet) : null,
    inReplyToTweetId: payload.in_reply_to_tweet_id ?? null,
    poll: payload.poll ? pollFromPayload(payload.poll) : null,
    lang: payload.lang ?? null,
  };
}

function pollToPayload(poll: TweetPoll): TweetPollPayload {
  return {
    options: poll.options.map((option) => ({ label: option.label, votes: option.votes })),
    total_votes: poll.totalVotes,
    closed: poll.closed,
  };
}

function pollFromPayload(payload: TweetPollPayload): TweetPoll {
  const options = (payload.options ?? []).map((option) => ({
    label: String(option.label ?? ""),
    votes: Number.isFinite(option.votes) ? Number(option.votes) : 0,
  }));
  return {
    options,
    totalVotes: Number.isFinite(payload.total_votes) ? Number(payload.total_votes) : 0,
    closed: Boolean(payload.closed),
  };
}

function parseDatetime(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
