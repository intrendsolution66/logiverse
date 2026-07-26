-- 028_education_taxonomy.sql
--
-- LogiVerse Education Taxonomy v1.0 — Programme → Subject → Topic → Activity.
-- This is an ADDITIVE layer on top of the existing structure, not a
-- rebuild: 27 migrations of working, FK-linked data (numbering system,
-- asset classification, student groups, etc.) all depend on the current
-- shape of edu.exercise_categories / edu.course_levels. Renaming those
-- tables (or worse, replacing them with new ones and migrating every FK
-- reference across course_levels/exercise_groups/exercise_number_counters/
-- assets) is a large, high-risk operation for the return it'd give right
-- now — same reasoning as why 关卡→习题 was a UI wording change, not a
-- table rename.
--
-- So: edu.exercise_categories BECOMES "Topic" conceptually (gets a
-- subject_id pointing into the new hierarchy above it), edu.course_levels
-- BECOMES "Activity" conceptually (gets the new Activity metadata columns
-- below). Existing data, existing numbering, existing FKs: all untouched,
-- all still work exactly as before. New capability is layered on, not
-- swapped in.
--
-- edu.courses (a designer's saved course = a curated SEQUENCE of
-- Activities) and edu.lessons (a lesson plan sequencing steps within a
-- course) are a DIFFERENT axis entirely — "how activities get organized
-- into a teaching sequence for a class" — and stay exactly as they are.
-- The new taxonomy classifies WHAT an activity teaches; courses/lessons
-- organize HOW activities get delivered. Two different questions, not
-- competing hierarchies.

BEGIN;

-- ── Programme (课程体系) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.programmes (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  code varchar(30) UNIQUE NOT NULL,
  name_zh varchar(100) NOT NULL,
  name_en varchar(100),
  description text,
  created_at timestamptz DEFAULT now()
);

-- ── Subject (学习领域) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.subjects (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  programme_id uuid NOT NULL REFERENCES edu.programmes(id),
  code varchar(30) NOT NULL,
  name_zh varchar(100) NOT NULL,
  name_en varchar(100),
  created_at timestamptz DEFAULT now(),
  UNIQUE (programme_id, code)
);

-- ── Topic (学习主题) — edu.exercise_categories, extended ─────────────────────────
ALTER TABLE edu.exercise_categories ADD COLUMN IF NOT EXISTS subject_id uuid REFERENCES edu.subjects(id);

-- ── Activity (学习活动) metadata — edu.course_levels, extended ───────────────────
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS activity_type varchar(20) NOT NULL DEFAULT 'game';
  -- 'interactive' | 'game' | 'exercise' | 'worksheet' | 'assessment' | 'simulation'
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS teaching_modes jsonb NOT NULL DEFAULT '[]';
  -- array of: 'classroom' | 'self_guided' | 'discovery' | 'homework' | 'assessment' | 'revision'
  -- — a multi-select, not a single category (an activity can suit several modes at once);
  -- explicitly metadata per the taxonomy doc ("Teaching Mode is metadata, not a category")
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS difficulty varchar(20);
  -- 'starter' | 'easy' | 'medium' | 'hard' | 'expert' — nullable: not every activity
  -- has been leveled yet, and this is a NEW field separate from sudoku_configs.difficulty
  -- (which predates this and stays as-is for backward compat — this general field is
  -- module-agnostic, sudoku's is module-specific; some duplication for sudoku specifically
  -- is an acceptable tradeoff against a riskier migration merging the two)
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS age_group_min int;
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS age_group_max int;
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS duration_minutes int;
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS learning_outcomes text;
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS skills_developed jsonb NOT NULL DEFAULT '[]'; -- array of free-text skill tags
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS language varchar(10) NOT NULL DEFAULT 'universal'; -- same convention as edu.assets.language
ALTER TABLE edu.course_levels ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'; -- same convention as edu.assets.tags (max 3, enforced in the controller)

CREATE INDEX IF NOT EXISTS idx_course_levels_tags ON edu.course_levels USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_course_levels_difficulty ON edu.course_levels(difficulty);
CREATE INDEX IF NOT EXISTS idx_exercise_categories_subject ON edu.exercise_categories(subject_id);

-- ── Seed a default Programme/Subject so existing Topics (exercise_categories)
-- have somewhere to attach without breaking — this is a starting point,
-- fully editable afterward through the management UI, not a fixed taxonomy.
INSERT INTO edu.programmes (code, name_zh, name_en, description) VALUES
  ('early_math', '幼儿数学启蒙', 'Early Mathematics', '学龄前到小学低年级的数学逻辑启蒙')
ON CONFLICT (code) DO NOTHING;

INSERT INTO edu.subjects (programme_id, code, name_zh, name_en)
SELECT id, 'logic_puzzles', '逻辑思维', 'Logic & Puzzles' FROM edu.programmes WHERE code = 'early_math'
ON CONFLICT (programme_id, code) DO NOTHING;

UPDATE edu.exercise_categories SET subject_id = (
  SELECT s.id FROM edu.subjects s JOIN edu.programmes p ON p.id = s.programme_id
  WHERE p.code = 'early_math' AND s.code = 'logic_puzzles'
) WHERE subject_id IS NULL;

COMMIT;
