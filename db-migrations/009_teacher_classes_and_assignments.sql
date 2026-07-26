-- 009_teacher_classes_and_assignments.sql
--
-- The teacher journey (老师排课→分配给学生→看班级进度), the third of the
-- three role-journeys alongside course-designer (Phase 1/2) and family
-- (Phase 1+1). Deliberately kept to the simplest viable shape:
--   - edu.classes: a teacher's roster group. Optionally tied to an
--     org.organizations row (a school/branch) but doesn't have to be.
--   - edu.class_students: who's in the class.
--   - edu.assignments: "this class should do this course_level" — no
--     per-student scheduling variation yet (see architecture doc 3.3 for
--     the fuller design with question_mode/pacing_mode; this is the
--     minimum slice that makes "assign work, see who did it" real).

BEGIN;

CREATE TABLE IF NOT EXISTS edu.classes (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  name varchar(100) NOT NULL,
  teacher_id uuid NOT NULL REFERENCES auth.users(id),
  organization_id uuid REFERENCES org.organizations(id),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.class_students (
  class_id uuid NOT NULL REFERENCES edu.classes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id),
  added_at timestamptz DEFAULT now(),
  PRIMARY KEY (class_id, student_id)
);

CREATE TABLE IF NOT EXISTS edu.assignments (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  course_level_id uuid NOT NULL REFERENCES edu.course_levels(id),
  class_id uuid NOT NULL REFERENCES edu.classes(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES auth.users(id),
  scheduled_date date,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_classes_teacher ON edu.classes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_assignments_class ON edu.assignments(class_id);

-- Permission: who can manage classes/assignments. Same pattern as
-- courses.manage — one permission code, granted to the roles that need it.
INSERT INTO rbac.permissions (code, name_en, name_zh, group_code)
VALUES ('classes.manage', 'Manage Classes', '管理班级', 'edu')
ON CONFLICT (code) DO NOTHING;

INSERT INTO rbac.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac.roles r
CROSS JOIN rbac.permissions p
WHERE r.code IN ('OPERATOR', 'TEACHER')
  AND p.code = 'classes.manage'
ON CONFLICT DO NOTHING;

COMMIT;
