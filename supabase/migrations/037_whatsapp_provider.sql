-- Adds multi-provider support to whatsapp_config.
-- Existing rows default to 'meta' (the Meta Cloud API that was the
-- only option until now). UAZAPI fields are nullable — only populated
-- when provider = 'uazapi'.

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'uazapi'));

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS uazapi_base_url TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_instance_token TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_instance_id TEXT;

-- Make Meta-specific columns nullable so UAZAPI rows don't need them.
-- phone_number_id already has a NOT NULL constraint from the initial
-- schema; relax it since UAZAPI doesn't have a Meta phone_number_id.
ALTER TABLE whatsapp_config
  ALTER COLUMN phone_number_id DROP NOT NULL,
  ALTER COLUMN access_token DROP NOT NULL;
