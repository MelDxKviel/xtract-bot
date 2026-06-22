-- Profile sharing: cache fetched X/Twitter profiles like tweets. Positive
-- entries hold a JSONB payload; negative entries (deleted/not-found handles)
-- have a NULL payload and a non-NULL error_code so providers aren't re-hit.
CREATE TABLE IF NOT EXISTS profile_cache (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  payload JSONB,
  error_code TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
