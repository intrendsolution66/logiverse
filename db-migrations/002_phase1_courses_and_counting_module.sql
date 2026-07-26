-- 002_phase1_courses_and_counting_module.sql
--
-- Phase 1 pilot: the vertical slice for 点点数数 (counting module). Adds the
-- generic course/course_level scaffolding (used by every module going
-- forward) plus counting_configs — the ONE module-specific table this phase
-- needs. Every other module (maze, word problems, etc.) gets its own config
-- table exactly like this one when its turn comes, per the "each module's
-- config table is independent" principle (3.2 in the architecture doc).

BEGIN;

CREATE SCHEMA IF NOT EXISTS edu;

-- ── Courses & Levels (generic, every module_type uses these) ────────────────
CREATE TABLE IF NOT EXISTS edu.courses (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  organization_id uuid REFERENCES org.organizations(id),
  title_i18n jsonb NOT NULL,
  description_i18n jsonb,
  age_group varchar(50),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.course_levels (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  course_id uuid REFERENCES edu.courses(id) ON DELETE CASCADE,
  order_index int NOT NULL DEFAULT 0,
  module_type varchar(50) NOT NULL,   -- 'counting' in Phase 1; more values added as modules land
  module_config_id uuid NOT NULL,     -- points into the module-specific config table (no FK — target table varies by module_type)
  title_i18n jsonb,
  video_url_i18n jsonb,
  ppt_url_i18n jsonb,
  illustration_url text,
  points_reward int DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_levels_course ON edu.course_levels(course_id, order_index);

-- ── 点点数数 (counting) module config — Phase 1's one module-specific table ──
CREATE TABLE IF NOT EXISTS edu.counting_configs (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  theme varchar(30) DEFAULT 'apple',   -- 'apple' | 'star' | 'fish' | 'balloon' | 'candy' | 'custom'
  custom_icon_url text,
  bg_image_url text,
  min_val int NOT NULL DEFAULT 1,
  max_val int NOT NULL DEFAULT 10,
  quiz_mode varchar(20) NOT NULL DEFAULT 'select',  -- 'select' | 'tap'
  num_choices int NOT NULL DEFAULT 3,
  total_questions int NOT NULL DEFAULT 5,
  timer_mode varchar(20) DEFAULT 'stopwatch',        -- 'stopwatch' | 'countdown'
  time_limit int,
  created_at timestamptz DEFAULT now()
);

-- ── Progress records (generic, every module writes here after a play session) ──
CREATE TABLE IF NOT EXISTS edu.progress_records (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  student_id uuid REFERENCES auth.users(id),
  course_level_id uuid REFERENCES edu.course_levels(id),
  module_type varchar(50),
  score int,
  max_score int,
  time_spent_seconds numeric,
  mistakes int DEFAULT 0,
  completed boolean DEFAULT false,
  attempt_number int DEFAULT 1,
  played_at timestamptz DEFAULT now(),
  extra_data jsonb
);

CREATE INDEX IF NOT EXISTS idx_progress_student ON edu.progress_records(student_id, course_level_id);

-- ── Permission: who can manage courses/levels ────────────────────────────────
INSERT INTO rbac.permissions (code, name_en, name_zh, group_code)
VALUES ('courses.manage', 'Manage Courses', '管理课程', 'edu')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac.roles r
CROSS JOIN rbac.permissions p
WHERE r.code IN ('OPERATOR', 'COURSE_DESIGNER')
  AND p.code = 'courses.manage'
ON CONFLICT DO NOTHING;

COMMIT;
