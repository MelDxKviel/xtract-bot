-- Negative caching: store "deleted/not found" results so repeated shares of a
-- known-bad tweet short-circuit instead of hitting providers again. Negative
-- entries have a NULL payload and a non-NULL error_code.
ALTER TABLE tweet_cache ALTER COLUMN payload DROP NOT NULL;
ALTER TABLE tweet_cache ADD COLUMN IF NOT EXISTS error_code TEXT;
