-- 019_student_groups_and_polymorphic_assignments.sql
--
-- 学生小组 (student groups) — a third assignment target alongside individual
-- students and classes. A teacher can now schedule an 习题 for one student,
-- a whole class, OR an ad-hoc group (e.g. "这几个孩子进度快，给他们加练").
--
-- edu.assignments becomes polymorphic: class_id is now NULLABLE, and a new
-- target_type + student_id + group_id carry the other two target kinds. A
-- CHECK constraint enforces exactly one target matches target_type — can't
-- accidentally create an assignment with two targets set or none at all.
-- Existing rows (all class-targeted, from before this migration) satisfy
-- the constraint automatically: target_type defaults to 'class', they
-- already have class_id set and student_id/group_id NULL.

BEGIN;

CREATE TABLE IF NOT EXISTS edu.student_groups (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  name varchar(100) NOT NULL,
  teacher_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.student_group_members (
  group_id uuid NOT NULL REFERENCES edu.student_groups(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id),
  added_at timestamptz DEFAULT now(),
  PRIMARY KEY (group_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_student_groups_teacher ON edu.student_groups(teacher_id);

ALTER TABLE edu.assignments ALTER COLUMN class_id DROP NOT NULL;
ALTER TABLE edu.assignments ADD COLUMN IF NOT EXISTS target_type varchar(20) NOT NULL DEFAULT 'class';
ALTER TABLE edu.assignments ADD COLUMN IF NOT EXISTS student_id uuid REFERENCES auth.users(id);
ALTER TABLE edu.assignments ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES edu.student_groups(id);

ALTER TABLE edu.assignments DROP CONSTRAINT IF EXISTS assignments_target_check;
ALTER TABLE edu.assignments ADD CONSTRAINT assignments_target_check CHECK (
  (target_type = 'class'   AND class_id IS NOT NULL   AND student_id IS NULL AND group_id IS NULL) OR
  (target_type = 'student' AND student_id IS NOT NULL AND class_id IS NULL  AND group_id IS NULL) OR
  (target_type = 'group'   AND group_id IS NOT NULL   AND class_id IS NULL  AND student_id IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_assignments_group ON edu.assignments(group_id);
CREATE INDEX IF NOT EXISTS idx_assignments_student ON edu.assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_assignments_scheduled_date ON edu.assignments(scheduled_date);

COMMIT;
