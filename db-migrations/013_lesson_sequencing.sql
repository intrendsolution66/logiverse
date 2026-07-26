-- 013_lesson_sequencing.sql
--
-- 课程编排流程 — a new layer ABOVE course_levels, not a replacement for it.
-- Existing courses/levels keep working exactly as before (a course can
-- still have "loose" levels, same as today). This adds an ADDITIONAL way
-- to organize content: a 课时/教案 (lesson) is an ORDERED SEQUENCE of steps
-- — video, PPT, or a REFERENCE to an existing course_level — matching the
-- brief's example flow: 视频/PPT讲解 → 题库预设题 → 互动实验题 → 随机题.
--
-- The key design decision: lesson_steps.course_level_id REFERENCES an
-- existing edu.course_levels row rather than duplicating/copying it. This
-- is what makes "题库" real — a maze level authored once can be referenced
-- by many different lessons across many different courses, not copy-pasted
-- per use. course_levels themselves ARE the question bank; lessons are
-- assembled teaching plans that pull from it.

BEGIN;

CREATE TABLE IF NOT EXISTS edu.lessons (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  course_id uuid NOT NULL REFERENCES edu.courses(id) ON DELETE CASCADE,
  title_i18n jsonb NOT NULL,
  order_index int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.lesson_steps (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  lesson_id uuid NOT NULL REFERENCES edu.lessons(id) ON DELETE CASCADE,
  order_index int NOT NULL DEFAULT 0,
  step_type varchar(20) NOT NULL,  -- 'video' | 'ppt' | 'level'
  media_url text,                   -- for 'video' / 'ppt' steps
  media_title varchar(200),
  course_level_id uuid REFERENCES edu.course_levels(id),  -- for 'level' steps — the 题库 reference
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lessons_course ON edu.lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_lesson_steps_lesson ON edu.lesson_steps(lesson_id);

COMMIT;
