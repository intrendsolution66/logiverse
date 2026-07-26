-- 027_word_problem_custom_scene.sql
--
-- 应用题自定义模式 — unlike counting's custom_scene (where "how many
-- objects" IS the question), a word problem is fundamentally a TEXT
-- problem with a computed numeric answer — the scene here is
-- illustrative/decorative, not something the game counts. So instead of
-- deriving the answer from how many objects exist, the designer writes
-- the problem text, the question, AND the correct answer directly —
-- same "authored, not generated" principle as maze/sudoku, just applied
-- to a word problem's shape instead of a puzzle-image's shape.
--
-- objects/texts reuse the exact same per-item shape SceneEditor's
-- structured mode already produces for counting (image_url/x/y/w/h/
-- rotation for objects; text/x/y/fontSize/color/fontFamily/rotation for
-- texts) — same editor, same data shape, just used for illustration here
-- instead of being counted.

BEGIN;

ALTER TABLE edu.word_problem_configs ADD COLUMN IF NOT EXISTS mode varchar(20) NOT NULL DEFAULT 'random'; -- 'random' | 'custom_scene'
ALTER TABLE edu.word_problem_configs ADD COLUMN IF NOT EXISTS bg_image_url text;
ALTER TABLE edu.word_problem_configs ADD COLUMN IF NOT EXISTS objects jsonb;
ALTER TABLE edu.word_problem_configs ADD COLUMN IF NOT EXISTS texts jsonb;
ALTER TABLE edu.word_problem_configs ADD COLUMN IF NOT EXISTS problem_text text;
ALTER TABLE edu.word_problem_configs ADD COLUMN IF NOT EXISTS question_text text;
ALTER TABLE edu.word_problem_configs ADD COLUMN IF NOT EXISTS custom_answer numeric;
ALTER TABLE edu.word_problem_configs ADD COLUMN IF NOT EXISTS unit varchar(20);

COMMIT;
