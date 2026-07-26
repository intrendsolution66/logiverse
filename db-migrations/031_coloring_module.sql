-- 031_coloring_module.sql
--
-- 填色游戏 (Coloring) — a new game module. Same "painted mask, pixel-color
-- click detection" technique maze already uses (mask_image_url +
-- non-transparent = walkable), extended from a single boolean mask to a
-- MULTI-REGION mask: each region gets painted with its own distinct
-- marker color during design, and at play time a click's pixel color on
-- the (hidden) mask tells you which region got clicked.
--
-- Two rule types per region: 'specific' (must be filled with one exact
-- required color) or 'free' (any color counts). The required color for
-- 'specific' regions is the "answer" and follows the same hide-until-
-- checked principle as sudoku's digits — see getLevel's coloring branch.

BEGIN;

CREATE TABLE IF NOT EXISTS edu.coloring_configs (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  bg_image_url text NOT NULL,      -- outline artwork the student sees and colors
  region_mask_url text NOT NULL,   -- hidden PNG: each region painted with its own marker_color, transparent = not a region
  -- [{ marker_color: '#ff0000', rule: 'specific'|'free', target_color?: '#eb4444', label?: '苹果本体' }]
  -- marker_color identifies the region on region_mask_url (pixel-color
  -- click detection, same technique as maze's walkability check).
  -- target_color is the required fill color for 'specific' regions —
  -- never sent to the client via getLevel, only compared server-side.
  regions jsonb NOT NULL,
  timer_mode varchar(20) NOT NULL DEFAULT 'stopwatch',
  time_limit int,
  created_at timestamptz DEFAULT now()
);

-- Same classification system every other module uses (018).
INSERT INTO edu.exercise_categories (code, name_zh, name_en, prefix) VALUES
  ('coloring', '填色游戏', 'Coloring', 'CL')
ON CONFLICT (code) DO NOTHING;

UPDATE edu.exercise_categories SET subject_id = (
  SELECT s.id FROM edu.subjects s JOIN edu.programmes p ON p.id = s.programme_id
  WHERE p.code = 'early_math' AND s.code = 'logic_puzzles'
) WHERE code = 'coloring' AND subject_id IS NULL;

COMMIT;
