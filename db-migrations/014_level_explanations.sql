-- 014_level_explanations.sql
--
-- 答案演示功能 — every level (regardless of module_type) can carry an
-- optional explanation: text + an optional image (picked from 素材库,
-- naturally — e.g. a worked-out diagram). This is deliberately attached to
-- the LEVEL, not to individual questions — most modules (counting, pattern,
-- word_problem...) generate a fresh set of questions every play session, so
-- an authored explanation makes sense as "here's how to think about this
-- type of problem", not "here's the answer to this exact random number".
-- Authored modules (spot_diff, maze) can still use it for something more
-- specific to their one fixed puzzle if the designer wants.

BEGIN;

ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS explanation_text text;
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS explanation_image_url text;

COMMIT;
