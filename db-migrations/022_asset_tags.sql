-- 022_asset_tags.sql
--
-- 素材库标签 — up to 3 free-text tags per asset, for finding things later
-- by a category-independent label (e.g. "森林", "生日", "冬天" — themes
-- that cut across background/object/icon and across module_type, which
-- the existing category/module_type/language columns don't capture).
--
-- Stored as a native Postgres text[] rather than a join table — the "max
-- 3, freely typed" shape doesn't need relational structure, and text[]
-- makes both "does this asset have tag X" and "search across all tags"
-- simple with GIN indexing.

BEGIN;

ALTER TABLE edu.assets ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_assets_tags ON edu.assets USING GIN (tags);

COMMIT;
