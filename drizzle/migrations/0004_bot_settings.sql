-- Persist admin runtime toggles (/whitelist, /translate, panel) across
-- restarts and deploys. Env vars remain bootstrap defaults only when a key
-- is missing; surviving Postgres volumes keep the last toggled values.
CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value_bool BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
