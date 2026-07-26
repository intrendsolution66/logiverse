-- 017_asset_classification.sql
--
-- 素材库分类扩展 — assets can now be tagged with which game module they're
-- designed for, which grade tier, and language (or "universal" for
-- language-agnostic art with no embedded text). All nullable/optional —
-- an asset with no tags just means "could be anything, filter it in
-- manually", not an error.

BEGIN;

ALTER TABLE edu.assets ADD COLUMN IF NOT EXISTS module_type varchar(30);
ALTER TABLE edu.assets ADD COLUMN IF NOT EXISTS grade_tier_id uuid REFERENCES edu.grade_tiers(id);
ALTER TABLE edu.assets ADD COLUMN IF NOT EXISTS language varchar(10) NOT NULL DEFAULT 'universal';

CREATE INDEX IF NOT EXISTS idx_assets_module_type ON edu.assets(module_type);

COMMIT;
