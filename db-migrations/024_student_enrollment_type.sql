-- 024_student_enrollment_type.sql
--
-- 学生报读类型 — 线上自由课 (online_casual) / 实体课 (offline) / 线上正规课
-- (online_formal). A per-student attribute, not a per-class one (a student
-- could reasonably be reclassified between types over time — e.g. starts
-- 线上自由课, later enrolls 实体课 — without their class/subscription
-- history changing shape).
--
-- Modeled as its own small edu.student_profiles table (1:1 with a STUDENT
-- user) rather than adding a column to the generic auth.user_profiles
-- table — auth.user_profiles is shared framework infrastructure (used by
-- every role, not just students), and enrollment_type is meaningless for
-- a TEACHER or PARENT row. Keeping education-specific student attributes
-- in their own edu-schema table avoids polluting the generic profile
-- table with a field 90% of its rows will never use.

BEGIN;

CREATE TABLE IF NOT EXISTS edu.student_profiles (
  student_id uuid PRIMARY KEY REFERENCES auth.users(id),
  enrollment_type varchar(20) NOT NULL DEFAULT 'online_casual', -- 'online_casual' | 'offline' | 'online_formal'
  updated_at timestamptz DEFAULT now()
);

COMMIT;
