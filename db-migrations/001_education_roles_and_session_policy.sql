-- 001_education_roles_and_session_policy.sql
--
-- Adds the 5 education-platform roles on top of LifeVerse's existing RBAC
-- schema, wires up permission to create managed (IC-based) accounts, adds
-- the single-active-session policy flag, and creates a guardian_relationships
-- table scoped to the education platform (kept separate from
-- lifeverse.family_members, which is the personal "family tree" social
-- feature — parent/student access-control linkage is a different concern
-- and shouldn't be tangled up with that).
--
-- Run this against a database that already has LifeVerse's base schema
-- (auth, rbac, org, lifeverse schemas) applied.

BEGIN;

-- ── 1. Single-active-session policy flag ────────────────────────────────────
-- Default true (strict) for every role unless explicitly relaxed below.
ALTER TABLE rbac.roles
  ADD COLUMN IF NOT EXISTS enforce_single_session boolean NOT NULL DEFAULT true;

-- ── 2. New education-platform roles ─────────────────────────────────────────
-- `level` follows the existing convention in this table (lower = more
-- privileged; SUPER_ADMIN=0, ADMIN=10, MODERATOR=20, MEMBER=50, GUEST=90).
INSERT INTO rbac.roles (code, name_en, name_zh, role_type, level, is_system, enforce_single_session)
VALUES
  ('OPERATOR',        'Operator',            '业者',     'admin',  15, true, false),
  ('COURSE_DESIGNER',  'Course Designer',    '课程设计者', 'admin',  25, true, false),
  ('TEACHER',          'Teacher',            '老师',      'admin',  30, true, false),
  ('PARENT',           'Parent',             '家长',      'member', 60, true, true),
  ('STUDENT',          'Student',            '学生',      'member', 70, true, true)
ON CONFLICT (code) DO NOTHING;

-- ── 3. Let OPERATOR and TEACHER create managed accounts ─────────────────────
-- `users.create` already exists as a system permission in your seed data;
-- we just need to grant it to the two roles that are allowed to create
-- student/parent accounts on this platform.
INSERT INTO rbac.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM rbac.roles r
CROSS JOIN rbac.permissions p
WHERE r.code IN ('OPERATOR', 'TEACHER')
  AND p.code = 'users.create'
ON CONFLICT DO NOTHING;

-- ── 4. Guardian relationships (parent ↔ student, for access control) ────────
-- Deliberately separate from lifeverse.family_members (that's the personal
-- "family tree" memory-book feature and isn't meant to gate data access).
CREATE SCHEMA IF NOT EXISTS edu;

CREATE TABLE IF NOT EXISTS edu.guardian_relationships (
  id               uuid DEFAULT gen_uuid_v7() PRIMARY KEY,
  parent_user_id   uuid NOT NULL REFERENCES auth.users(id),
  student_user_id  uuid NOT NULL REFERENCES auth.users(id),
  relation_code    character varying(30), -- '父亲' | '母亲' | '监护人' | ...
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (parent_user_id, student_user_id)
);

COMMIT;

-- ── Rollback (for reference — run manually if needed) ───────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS edu.guardian_relationships;
-- DELETE FROM rbac.role_permissions WHERE role_id IN (SELECT id FROM rbac.roles WHERE code IN ('OPERATOR','TEACHER')) AND permission_id IN (SELECT id FROM rbac.permissions WHERE code = 'users.create');
-- DELETE FROM rbac.roles WHERE code IN ('OPERATOR','COURSE_DESIGNER','TEACHER','PARENT','STUDENT');
-- ALTER TABLE rbac.roles DROP COLUMN IF EXISTS enforce_single_session;
-- COMMIT;
