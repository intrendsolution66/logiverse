-- 030_line_match_module.sql
--
-- 连线配对 (Line Match) — a new game module: two columns of items (text or
-- image), student draws a line from each left item to its matching right
-- item. Same "authored, not generated" shape as maze/sudoku — every pair
-- IS the puzzle, there's no random-generation mode, so this table has no
-- mode/random-range columns the way counting/word_problem do.

BEGIN;

CREATE TABLE IF NOT EXISTS edu.line_match_configs (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  -- [{ left: {type:'text'|'image', content:string}, right: {type:'text'|'image', content:string} }]
  -- content is either the text itself, or an image_url (same asset-library
  -- URL convention every other module's image fields use). The pairing is
  -- implicit in array order — pairs[i].left matches pairs[i].right — the
  -- RIGHT column's on-screen order gets shuffled at render/play time
  -- (shuffle_right), not stored shuffled here.
  pairs jsonb NOT NULL,
  shuffle_right boolean NOT NULL DEFAULT true,
  timer_mode varchar(20) NOT NULL DEFAULT 'stopwatch',
  time_limit int,
  created_at timestamptz DEFAULT now()
);

-- Same classification system every other module uses (018) — one more
-- category, one more prefix. Backfilled with a subject_id the same way
-- migration 028 backfilled the original eight, so it isn't left dangling
-- outside the Programme→Subject→Topic hierarchy the taxonomy work
-- established.
INSERT INTO edu.exercise_categories (code, name_zh, name_en, prefix) VALUES
  ('line_match', '连线配对', 'Line Match', 'LM')
ON CONFLICT (code) DO NOTHING;

UPDATE edu.exercise_categories SET subject_id = (
  SELECT s.id FROM edu.subjects s JOIN edu.programmes p ON p.id = s.programme_id
  WHERE p.code = 'early_math' AND s.code = 'logic_puzzles'
) WHERE code = 'line_match' AND subject_id IS NULL;

COMMIT;
