CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  is_allowed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_telegram_id_key UNIQUE (telegram_id)
);

CREATE INDEX IF NOT EXISTS ix_users_telegram_id ON users (telegram_id);

CREATE TABLE IF NOT EXISTS tweet_cache (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tweet_id TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS share_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  chat_id BIGINT,
  tweet_id TEXT,
  source_url TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_share_events_telegram_user_id ON share_events (telegram_user_id);
CREATE INDEX IF NOT EXISTS ix_share_events_tweet_id ON share_events (tweet_id);
CREATE INDEX IF NOT EXISTS ix_share_events_created_at ON share_events (created_at);

CREATE TABLE IF NOT EXISTS admin_actions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_telegram_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  target_telegram_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_admin_actions_admin_telegram_id ON admin_actions (admin_telegram_id);
