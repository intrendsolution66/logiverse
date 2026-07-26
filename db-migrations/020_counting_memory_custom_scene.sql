-- 020_counting_memory_custom_scene.sql
--
-- Fills in the two "custom mode" gaps flagged directly: 点点数数 and
-- Memory配对 both had SOME custom-mode plumbing already (counting already
-- had bg_image_url + custom_icon_url; memory already had custom_icons) but
-- were each missing one piece needed to actually finish the feature —
-- counting had no way to record WHERE each object goes (positions), and
-- memory had no backdrop image column at all.
--
-- counting's "custom_scene" mode is a fixed AUTHORED puzzle (background +
-- exact object positions, one correct count), same "authored, not
-- generated" principle as maze/spot_diff — existing 'mode' semantics stay
-- 'random' by default so nothing about the existing random-generation
-- counting levels changes.

BEGIN;

ALTER TABLE edu.counting_configs ADD COLUMN IF NOT EXISTS mode varchar(20) NOT NULL DEFAULT 'random'; -- 'random' | 'custom_scene'
ALTER TABLE edu.counting_configs ADD COLUMN IF NOT EXISTS positions jsonb; -- [{x,y}], only used when mode='custom_scene'

ALTER TABLE edu.memory_configs ADD COLUMN IF NOT EXISTS bg_image_url text;

COMMIT;
