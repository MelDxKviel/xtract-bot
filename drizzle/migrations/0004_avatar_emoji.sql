-- Avatar custom emoji: turn an X/Twitter avatar into a Telegram custom emoji so
-- it can be shown inline in a shared message. `avatar_emoji` maps a unique
-- source avatar URL to the `custom_emoji_id` of the sticker we created for it
-- (keyed by URL, so a new avatar image naturally gets a fresh emoji).
CREATE TABLE IF NOT EXISTS avatar_emoji (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  avatar_url TEXT NOT NULL UNIQUE,
  custom_emoji_id TEXT NOT NULL,
  set_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
