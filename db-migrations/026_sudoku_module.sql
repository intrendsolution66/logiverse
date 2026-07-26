-- 026_sudoku_module.sql
--
-- 数独 — the 8th game module, and the first one that's a real GRID game
-- rather than "count/tap/match things on a picture". Same "authored, not
-- generated" principle as maze/spot_diff: the course designer uploads a
-- picture of an actual sudoku puzzle (photographed, scanned, or a
-- generated graphic — doesn't matter which), marks which cells are BLANK
-- (need filling), and enters the correct digit for each blank cell. The
-- app never generates or validates a real sudoku's global constraints
-- (row/column/3x3-box uniqueness) — it just checks each filled cell
-- against the answer the designer entered, the same "click-to-mark,
-- authored answer" pattern as focus_tap's custom mode.
--
-- difficulty is a DESIGNER-SET LABEL for browsing/filtering purposes, not
-- something the app computes — since puzzles are authored (not
-- procedurally generated), there's no natural "difficulty score" to
-- derive; the designer who picked/made the puzzle image already knows how
-- hard it is.

BEGIN;

CREATE TABLE IF NOT EXISTS edu.sudoku_configs (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  bg_image_url text NOT NULL,
  cells jsonb NOT NULL, -- [{x, y, answer}] — normalized 0..1 position + correct digit (1-9) per blank cell
  difficulty varchar(20) NOT NULL DEFAULT 'medium', -- 'easy' | 'medium' | 'hard' | 'custom' — a label, not a generator input
  timer_mode varchar(20) NOT NULL DEFAULT 'stopwatch',
  time_limit int,
  created_at timestamptz DEFAULT now()
);

-- Same classification system every other module uses (018) — one more
-- category, one more prefix, nothing module-specific needed here.
INSERT INTO edu.exercise_categories (code, name_zh, name_en, prefix) VALUES
  ('sudoku', '数独', 'Sudoku', 'SD')
ON CONFLICT (code) DO NOTHING;

COMMIT;
