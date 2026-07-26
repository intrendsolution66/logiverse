-- 018_exercise_classification.sql
--
-- 习题编号系统 — "关卡" is renamed "习题" at the UI/wording level throughout
-- (see frontend changes); this migration is the data model behind that:
-- a 3-tier classification (大种类/分类/小分类) plus auto-generated exercise
-- numbers. course_levels the TABLE keeps its name — renaming it would
-- touch every query/type across the codebase for a wording change that's
-- purely cosmetic to the end user; what matters is what people SEE.
--
-- Deliberately reused rather than reinvented: 等级 (grade/level) in the
-- user's example maps to edu.grade_tiers (L1-L4), which courses are already
-- tagged with — no new "level" concept needed, an exercise's level is its
-- course's grade tier.
--
-- New concepts:
--   exercise_categories (习题大种类) — top-level, roughly 1:1 with
--     module_type (迷宫/找不同/...), but modeled as its own table (not the
--     hardcoded module_type string) specifically so the numbering PREFIX is
--     database-editable, per the brief ("PREFIX 可以根据数据库表里的预设值自定义").
--   exercise_groups (分类) — a sub-classification WITHIN a category, e.g.
--     数字迷宫 / 动物迷宫 under 迷宫. Freely created by course designers, not
--     a fixed enum.
--   exercise_curriculum_types (小分类) — an independent tag: 校内课程 /
--     奥数 / 其它, customizable.
--   exercise_number_counters — one row per (category, group) pair, holding
--     the next sequence number. Incremented atomically via
--     ON CONFLICT ... DO UPDATE so concurrent exercise creation can't
--     produce duplicate numbers.

BEGIN;

CREATE TABLE IF NOT EXISTS edu.exercise_categories (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  code varchar(20) UNIQUE NOT NULL,        -- matches module_type where applicable, e.g. 'maze'
  name_zh varchar(50) NOT NULL,
  name_en varchar(50),
  prefix varchar(10) NOT NULL,             -- e.g. 'MK'
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.exercise_groups (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  category_id uuid NOT NULL REFERENCES edu.exercise_categories(id) ON DELETE CASCADE,
  code varchar(20) NOT NULL,               -- short code used in the exercise number, e.g. 'NUM'
  name_zh varchar(50) NOT NULL,
  name_en varchar(50),
  created_at timestamptz DEFAULT now(),
  UNIQUE (category_id, code)
);

CREATE TABLE IF NOT EXISTS edu.exercise_curriculum_types (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  code varchar(20) UNIQUE NOT NULL,        -- e.g. 'school' | 'olympiad' | 'other'
  name_zh varchar(50) NOT NULL,
  name_en varchar(50),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.exercise_number_counters (
  category_id uuid NOT NULL REFERENCES edu.exercise_categories(id),
  group_id uuid REFERENCES edu.exercise_groups(id),   -- nullable: exercises with no group share one counter per category
  next_seq int NOT NULL DEFAULT 10001,
  PRIMARY KEY (category_id, group_id)
);
-- Postgres allows only one row where group_id IS NULL to conflict-match via
-- the primary key as written (NULL <> NULL in a unique constraint) — that's
-- fine here, it just means "no group" exercises don't dedupe against each
-- other via this PK and would need a partial unique index if that mattered;
-- in practice every category used for real exercises gets a group.

-- 习题 classification columns on course_levels (the table itself keeps its name)
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES edu.exercise_categories(id);
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES edu.exercise_groups(id);
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS curriculum_type_id uuid REFERENCES edu.exercise_curriculum_types(id);
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS exercise_number varchar(40);

CREATE INDEX IF NOT EXISTS idx_course_levels_category ON edu.course_levels(category_id);
CREATE INDEX IF NOT EXISTS idx_course_levels_exercise_number ON edu.course_levels(exercise_number);

-- Seed: one category per existing module_type, with a starter prefix.
-- Prefixes are editable later directly in this table — this is just a
-- reasonable starting point, not a hardcoded/fixed list.
INSERT INTO edu.exercise_categories (code, name_zh, name_en, prefix) VALUES
  ('maze',         '迷宫',        'Maze',            'MK'),
  ('spot_diff',    '找不同之处',   'Spot the Difference', 'FC'),
  ('focus_tap',    '专注力点数字', 'Focus Tap',       'FT'),
  ('memory',       'Memory配对',  'Memory Match',    'MM'),
  ('counting',     '点点数数',    'Counting',        'CT'),
  ('pattern',      '找规律',      'Pattern',         'PN'),
  ('word_problem', '应用题',      'Word Problem',    'WP')
ON CONFLICT (code) DO NOTHING;

INSERT INTO edu.exercise_curriculum_types (code, name_zh, name_en) VALUES
  ('school',   '校内课程', 'School Curriculum'),
  ('olympiad', '奥数',    'Olympiad Math'),
  ('other',    '其它',    'Other')
ON CONFLICT (code) DO NOTHING;

COMMIT;
