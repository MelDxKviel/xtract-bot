-- Rework `avatar_emoji` from one row per avatar URL to one row per X user.
-- The new shape keys by `username`, and adds `sticker_file_id` (needed to
-- replace the sticker in place when a user's avatar changes) and `updated_at`.
--
-- The feature is opt-in (AVATAR_EMOJI_ENABLED) and was never enabled in
-- production, so there is nothing to preserve — drop the old table and recreate
-- it. `emoji_sticker_sets` is unchanged and intentionally left alone.
DROP TABLE IF EXISTS avatar_emoji;

CREATE TABLE avatar_emoji (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  avatar_url TEXT NOT NULL,
  custom_emoji_id TEXT NOT NULL,
  sticker_file_id TEXT NOT NULL,
  set_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
