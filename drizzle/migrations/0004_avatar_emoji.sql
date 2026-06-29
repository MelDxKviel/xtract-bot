-- Avatar custom emoji: turn an X/Twitter avatar into a Telegram custom emoji so
-- it can be shown inline in a shared message. One row per X user (handle),
-- holding the current avatar URL and the sticker created from it. When the
-- user's avatar changes, the sticker is replaced in place and this row updated,
-- so a given user always maps to a single, current emoji.
CREATE TABLE IF NOT EXISTS avatar_emoji (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  avatar_url TEXT NOT NULL,
  custom_emoji_id TEXT NOT NULL,
  sticker_file_id TEXT NOT NULL,
  set_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The bot-owned custom-emoji sets avatars are pooled into. Telegram caps a set
-- at 200 emoji, so `sticker_count` tracks fill: the service picks a set with
-- room left and rolls over to a new one (set_index + 1) when the current fills.
CREATE TABLE IF NOT EXISTS emoji_sticker_sets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  set_index INTEGER NOT NULL,
  sticker_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
