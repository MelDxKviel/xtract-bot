import { getFetch, withTimeout, type FetchLike } from "@/providers/http";
import type { TweetData } from "@/providers/base";

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";

export class TranslationError extends Error {
  readonly code: string;

  constructor(message: string, options: { code?: string } = {}) {
    super(message);
    this.name = "TranslationError";
    this.code = options.code ?? "translation_error";
  }
}

export interface TranslationResult {
  text: string;
  sourceLang: string | null;
}

export interface Translator {
  translate(text: string, targetLang?: string): Promise<TranslationResult>;
}

export interface CreateTranslatorOptions {
  timeoutSeconds?: number;
  fetch?: FetchLike;
}

export function createTranslator(options: CreateTranslatorOptions = {}): Translator {
  const timeoutMs = Math.round((options.timeoutSeconds ?? 8) * 1000);
  const fetchImpl = getFetch(options.fetch);

  return {
    async translate(text, targetLang = "ru"): Promise<TranslationResult> {
      if (!text.trim()) return { text: "", sourceLang: null };

      const url = new URL(ENDPOINT);
      url.searchParams.set("client", "gtx");
      url.searchParams.set("sl", "auto");
      url.searchParams.set("tl", targetLang);
      url.searchParams.set("dt", "t");
      url.searchParams.set("q", text);

      const { signal, clear } = withTimeout(timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url.toString(), {
          headers: { Accept: "application/json", "User-Agent": "xtract-bot/0.1" },
          signal,
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          throw new TranslationError("translation request timed out", { code: "timeout" });
        }
        throw new TranslationError(String(error), { code: "http_error" });
      } finally {
        clear();
      }

      if (response.status === 429) {
        throw new TranslationError("translation rate limited", { code: "rate_limited" });
      }
      if (response.status >= 400) {
        throw new TranslationError(`translation HTTP ${response.status}`, { code: "http_error" });
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new TranslationError("translation invalid JSON", { code: "bad_response" });
      }
      return parseTranslateResponse(payload);
    },
  };
}

function parseTranslateResponse(payload: unknown): TranslationResult {
  if (!Array.isArray(payload)) {
    throw new TranslationError("unexpected response", { code: "bad_response" });
  }
  const sentences = payload[0];
  if (!Array.isArray(sentences)) {
    throw new TranslationError("missing sentences", { code: "bad_response" });
  }
  let combined = "";
  for (const sentence of sentences) {
    if (Array.isArray(sentence) && typeof sentence[0] === "string") {
      combined += sentence[0];
    }
  }
  if (!combined.trim()) {
    throw new TranslationError("empty translation", { code: "bad_response" });
  }
  const sourceLang = typeof payload[2] === "string" ? payload[2] : null;
  return { text: combined, sourceLang };
}

export interface TweetTranslation {
  tweet: TweetData;
  sourceLang: string | null;
}

export async function translateTweet(
  tweet: TweetData,
  translator: Translator,
  targetLang = "ru",
): Promise<TweetTranslation> {
  type Key = "main" | "quoted" | "replied";
  const targets: Array<{ key: Key; text: string }> = [];
  if (tweet.text && tweet.text.trim()) targets.push({ key: "main", text: tweet.text });
  if (tweet.quotedTweet?.text && tweet.quotedTweet.text.trim()) {
    targets.push({ key: "quoted", text: tweet.quotedTweet.text });
  }
  if (tweet.repliedToTweet?.text && tweet.repliedToTweet.text.trim()) {
    targets.push({ key: "replied", text: tweet.repliedToTweet.text });
  }

  const results = await Promise.all(targets.map((t) => translator.translate(t.text, targetLang)));

  const translations = new Map<Key, TranslationResult>();
  for (let i = 0; i < targets.length; i += 1) {
    translations.set(targets[i]!.key, results[i]!);
  }

  const mainResult = translations.get("main");
  const quotedResult = translations.get("quoted");
  const repliedResult = translations.get("replied");

  const sourceLang = mainResult?.sourceLang ?? tweet.lang ?? null;

  return {
    sourceLang,
    tweet: {
      ...tweet,
      text: mainResult ? mainResult.text : tweet.text,
      quotedTweet:
        tweet.quotedTweet && quotedResult
          ? { ...tweet.quotedTweet, text: quotedResult.text }
          : tweet.quotedTweet,
      repliedToTweet:
        tweet.repliedToTweet && repliedResult
          ? { ...tweet.repliedToTweet, text: repliedResult.text }
          : tweet.repliedToTweet,
    },
  };
}

const LANGUAGE_NAMES: Record<string, string> = {
  ar: "арабский",
  az: "азербайджанский",
  be: "белорусский",
  bg: "болгарский",
  bn: "бенгальский",
  ca: "каталанский",
  cs: "чешский",
  da: "датский",
  de: "немецкий",
  el: "греческий",
  en: "английский",
  es: "испанский",
  et: "эстонский",
  fa: "персидский",
  fi: "финский",
  fr: "французский",
  he: "иврит",
  hi: "хинди",
  hr: "хорватский",
  hu: "венгерский",
  hy: "армянский",
  id: "индонезийский",
  is: "исландский",
  it: "итальянский",
  ja: "японский",
  ka: "грузинский",
  kk: "казахский",
  ko: "корейский",
  lt: "литовский",
  lv: "латышский",
  ms: "малайский",
  nl: "нидерландский",
  no: "норвежский",
  pl: "польский",
  pt: "португальский",
  ro: "румынский",
  ru: "русский",
  sk: "словацкий",
  sl: "словенский",
  sr: "сербский",
  sv: "шведский",
  th: "тайский",
  tr: "турецкий",
  uk: "украинский",
  ur: "урду",
  uz: "узбекский",
  vi: "вьетнамский",
  zh: "китайский",
};

export function languageNameInRussian(code: string | null | undefined): string {
  if (!code) return "не определён";
  const normalized = code.toLowerCase().split(/[-_]/)[0]!;
  return LANGUAGE_NAMES[normalized] ?? code;
}
