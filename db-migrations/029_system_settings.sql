-- 029_system_settings.sql
--
-- 系统设置 — a small generic key-value table for admin-editable settings
-- that need to take effect WITHOUT a server restart. The first (and so
-- far only) setting is asset_base_url — previously this only lived in
-- backend/.env (ASSET_BASE_URL), read once at process start via a plain
-- JS const, meaning changing it required editing a file on the server AND
-- restarting the whole backend. That's fine for a developer, not fine for
-- an operator who just wants to point uploads at a different domain (e.g.
-- switching from a dev URL to the real production domain, or later to a
-- remote storage engine's public base URL) through the UI.
--
-- The .env value is kept as the FALLBACK default (see
-- utils/systemSettings.ts) — if nothing's been set here yet, behavior is
-- identical to before this migration. Setting a row here overrides it,
-- and takes effect on the very next request, no restart needed.

BEGIN;

CREATE TABLE IF NOT EXISTS edu.system_settings (
  key varchar(50) PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

COMMIT;
