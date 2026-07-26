-- 004_phase2_grade_tiers.sql
--
-- Before any course can be tagged with a level/grade, the SYSTEM needs to
-- define what grades exist in the first place — this is a controlled
-- vocabulary (like config.countries or config.languages), not free text.
--
-- Named `grade_tiers` (not `course_levels`) deliberately — `course_levels`
-- already means something else in this schema (the individual game-module
-- levels inside one course, see 002). This is a different concept: the
-- overall age/grade band a whole COURSE targets, defined once system-wide
-- and then referenced by every course.

BEGIN;

CREATE TABLE IF NOT EXISTS edu.grade_tiers (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  code varchar(30) UNIQUE NOT NULL,
  name_i18n jsonb NOT NULL,
  age_min int,
  age_max int,
  order_index int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Seed a reasonable starting set — operators can rename/reorder/add more
-- via the 等级管理 page; this is just so the system isn't empty on day one.
INSERT INTO edu.grade_tiers (code, name_i18n, age_min, age_max, order_index) VALUES
  ('L1', '{"zh":"启蒙级 (4-5岁)","en":"Starter (4-5)"}',   4, 5, 1),
  ('L2', '{"zh":"初级 (6-7岁)","en":"Beginner (6-7)"}',    6, 7, 2),
  ('L3', '{"zh":"中级 (8-9岁)","en":"Intermediate (8-9)"}', 8, 9, 3),
  ('L4', '{"zh":"高级 (10-12岁)","en":"Advanced (10-12)"}', 10, 12, 4)
ON CONFLICT (code) DO NOTHING;

-- Courses now reference a grade tier instead of a free-text age_group.
-- age_group is kept (nullable) as an optional supplementary note — e.g.
-- "适合有基础的孩子" — not the primary classification anymore.
ALTER TABLE edu.courses ADD COLUMN IF NOT EXISTS grade_tier_id uuid REFERENCES edu.grade_tiers(id);

COMMIT;
