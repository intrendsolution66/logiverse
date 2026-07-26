// backend/src/modules/edu/teacher.controller.ts
//
// The teacher journey: create a class, add students to its roster (by IC —
// same lookup convention as everywhere else), assign a course_level to the
// whole class, and see a grid of who's done what. Scoped to "one teacher's
// own classes" throughout — a teacher only ever sees/manages classes where
// classes.teacher_id = themselves, checked in every handler below, same
// spirit as the guardian_relationships check in family.controller.ts.

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { validateIC } from "../../utils/ic.js";
import { ok, created, badRequest, notFound, forbidden, conflict, serverError } from "../../utils/response.js";
import { queryStudyTime } from "./family.controller.js";

async function assertOwnsClass(teacherId: string, classId: string): Promise<boolean> {
  const { rows } = await query(`SELECT 1 FROM edu.classes WHERE id = $1 AND teacher_id = $2`, [classId, teacherId]);
  return rows.length > 0;
}

// ── Classes ──────────────────────────────────────────────────────────────────
export async function listMyClasses(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT c.id, c.name, c.organization_id, c.created_at,
              (SELECT count(*)::int FROM edu.class_students cs WHERE cs.class_id = c.id) AS student_count
       FROM edu.classes c
       WHERE c.teacher_id = $1
       ORDER BY c.created_at DESC`,
      [req.user!.sub]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function createClass(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { name, organization_id } = req.body as Record<string, string>;
    if (!name) { badRequest(res, "name is required"); return; }
    const { rows } = await query(
      `INSERT INTO edu.classes (name, teacher_id, organization_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, organization_id, created_at`,
      [name, req.user!.sub, organization_id ?? null]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

// ── Roster ───────────────────────────────────────────────────────────────────
export async function listClassStudents(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { classId } = req.params;
    if (!(await assertOwnsClass(req.user!.sub, classId))) { forbidden(res, "Not your class"); return; }

    const { rows } = await query(
      `SELECT u.id AS student_id, u.username, p.full_name_zh, p.full_name_en, cs.added_at
       FROM edu.class_students cs
       JOIN auth.users u ON u.id = cs.student_id
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       WHERE cs.class_id = $1
       ORDER BY cs.added_at ASC`,
      [classId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// Adds an EXISTING student (by IC) to the roster — this does not create new
// accounts (that's family.controller.ts#addChild for parents, or
// auth.controller.ts#createManagedUser for operators). A teacher just links
// an already-existing student to their class.
export async function addStudentToClass(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { classId } = req.params;
    const { ic_number } = req.body as Record<string, string>;
    if (!(await assertOwnsClass(req.user!.sub, classId))) { forbidden(res, "Not your class"); return; }
    if (!ic_number) { badRequest(res, "ic_number is required"); return; }

    const icResult = validateIC(ic_number);
    if (!icResult.valid) { badRequest(res, icResult.error ?? "Invalid IC/birth-certificate number"); return; }

    const { rows: userRows } = await query(
      `SELECT id FROM auth.users WHERE username = $1 LIMIT 1`, [icResult.normalized]
    );
    if (!userRows.length) { notFound(res, "No student account found with this IC — ask an operator/parent to create it first"); return; }
    const studentId = userRows[0].id;

    const { rows: exists } = await query(
      `SELECT 1 FROM edu.class_students WHERE class_id = $1 AND student_id = $2`, [classId, studentId]
    );
    if (exists.length) { conflict(res, "This student is already in the class"); return; }

    await query(`INSERT INTO edu.class_students (class_id, student_id) VALUES ($1, $2)`, [classId, studentId]);
    created(res, { class_id: classId, student_id: studentId });
  } catch (err) { serverError(res, err); }
}

export async function removeStudentFromClass(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { classId, studentId } = req.params;
    if (!(await assertOwnsClass(req.user!.sub, classId))) { forbidden(res, "Not your class"); return; }
    await query(`DELETE FROM edu.class_students WHERE class_id = $1 AND student_id = $2`, [classId, studentId]);
    ok(res, null, "Removed");
  } catch (err) { serverError(res, err); }
}

// ── Assignments ──────────────────────────────────────────────────────────────
export async function listClassAssignments(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { classId } = req.params;
    if (!(await assertOwnsClass(req.user!.sub, classId))) { forbidden(res, "Not your class"); return; }

    const { rows } = await query(
      `SELECT a.id, a.course_level_id, a.scheduled_date, a.created_at,
              cl.title_i18n AS level_title_i18n, cl.module_type
       FROM edu.assignments a
       JOIN edu.course_levels cl ON cl.id = a.course_level_id
       WHERE a.class_id = $1
       ORDER BY a.created_at DESC`,
      [classId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function createAssignment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { classId } = req.params;
    const { course_level_id, scheduled_date } = req.body as Record<string, string>;
    if (!(await assertOwnsClass(req.user!.sub, classId))) { forbidden(res, "Not your class"); return; }
    if (!course_level_id) { badRequest(res, "course_level_id is required"); return; }

    const { rows } = await query(
      `INSERT INTO edu.assignments (course_level_id, class_id, assigned_by, scheduled_date)
       VALUES ($1, $2, $3, $4)
       RETURNING id, course_level_id, scheduled_date, created_at`,
      [course_level_id, classId, req.user!.sub, scheduled_date ?? null]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

// ── Class progress dashboard ──────────────────────────────────────────────────
// One row per (student × assignment): best score, whether completed, when.
// NULL best_score means that student hasn't attempted that assignment yet —
// this is deliberately a LEFT JOIN so "hasn't done it" is visible, not just
// omitted, since "who HASN'T done the homework" is exactly what a teacher
// dashboard needs to surface.
export async function getClassProgress(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { classId } = req.params;
    if (!(await assertOwnsClass(req.user!.sub, classId))) { forbidden(res, "Not your class"); return; }

    const { rows } = await query(
      `SELECT
         u.id AS student_id, u.username, p.full_name_zh, p.full_name_en,
         a.id AS assignment_id, cl.title_i18n AS level_title_i18n, cl.module_type,
         best.score AS best_score, best.max_score, best.completed, best.played_at, best.attempts
       FROM edu.class_students cs
       JOIN auth.users u ON u.id = cs.student_id
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       CROSS JOIN edu.assignments a
       JOIN edu.course_levels cl ON cl.id = a.course_level_id
       LEFT JOIN LATERAL (
         SELECT max(score) AS score, max(max_score) AS max_score,
                bool_or(completed) AS completed, max(played_at) AS played_at, count(*)::int AS attempts
         FROM edu.progress_records
         WHERE student_id = u.id AND course_level_id = a.course_level_id
       ) best ON true
       WHERE cs.class_id = $1 AND a.class_id = $1
       ORDER BY u.username, a.created_at`,
      [classId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// ── Class study-time summary (登入/登出时长统计, class-wide view) ──────────────
// Each student's total study time (from the same session-chain
// reconstruction family.controller.ts#queryStudyTime uses) plus their
// recent daily breakdown — same underlying analytics, just rolled up per
// class instead of per single child, for the teacher's "who's actually
// spending time on this" view.
export async function getClassStudyTime(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { classId } = req.params;
    if (!(await assertOwnsClass(req.user!.sub, classId))) { forbidden(res, "Not your class"); return; }

    const { rows: students } = await query(
      `SELECT u.id AS student_id, u.username, p.full_name_zh, p.full_name_en
       FROM edu.class_students cs
       JOIN auth.users u ON u.id = cs.student_id
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       WHERE cs.class_id = $1`,
      [classId]
    );

    const results = await Promise.all((students as Array<{ student_id: string; username: string; full_name_zh?: string; full_name_en?: string }>).map(async (s) => {
      const { daily } = await queryStudyTime(s.student_id);
      const totalSeconds = (daily as Array<{ total_seconds: number }>).reduce((sum, d) => sum + d.total_seconds, 0);
      return { ...s, total_seconds_last_14_days: totalSeconds, daily };
    }));

    ok(res, results);
  } catch (err) { serverError(res, err); }
}

// ── Polymorphic assignments (student / class / group) + calendar view ────────
// Matches the CHECK constraint added in 019: exactly one of
// class_id/student_id/group_id is set, matching target_type.
async function assertOwnsGroupForAssignment(teacherId: string, groupId: string): Promise<boolean> {
  const { rows } = await query(`SELECT 1 FROM edu.student_groups WHERE id = $1 AND teacher_id = $2`, [groupId, teacherId]);
  return rows.length > 0;
}

// A teacher can only individually-assign work to a student who's already
// in one of THEIR classes or groups — not an arbitrary IC. This keeps
// "assign to a student" from being a way to reach into any account; it has
// to be a student the teacher already has a real relationship with.
async function teacherHasRelationshipWithStudent(teacherId: string, studentId: string): Promise<boolean> {
  const { rows } = await query(
    `SELECT 1 FROM edu.class_students cs JOIN edu.classes c ON c.id = cs.class_id
     WHERE c.teacher_id = $1 AND cs.student_id = $2
     UNION
     SELECT 1 FROM edu.student_group_members m JOIN edu.student_groups g ON g.id = m.group_id
     WHERE g.teacher_id = $1 AND m.student_id = $2`,
    [teacherId, studentId]
  );
  return rows.length > 0;
}

export async function createPolymorphicAssignment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { target_type, target_id, course_level_id, scheduled_date } = req.body as Record<string, string>;
    if (!["student", "class", "group"].includes(target_type)) { badRequest(res, "target_type must be 'student', 'class', or 'group'"); return; }
    if (!target_id) { badRequest(res, "target_id is required"); return; }
    if (!course_level_id) { badRequest(res, "course_level_id is required"); return; }

    if (target_type === "class" && !(await assertOwnsClass(req.user!.sub, target_id))) { forbidden(res, "Not your class"); return; }
    if (target_type === "group" && !(await assertOwnsGroupForAssignment(req.user!.sub, target_id))) { forbidden(res, "Not your group"); return; }
    if (target_type === "student" && !(await teacherHasRelationshipWithStudent(req.user!.sub, target_id))) {
      forbidden(res, "This student isn't in any of your classes or groups"); return;
    }

    const { rows } = await query(
      `INSERT INTO edu.assignments (course_level_id, assigned_by, scheduled_date, target_type, class_id, student_id, group_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, course_level_id, scheduled_date, target_type, class_id, student_id, group_id, created_at`,
      [
        course_level_id, req.user!.sub, scheduled_date ?? null, target_type,
        target_type === "class" ? target_id : null,
        target_type === "student" ? target_id : null,
        target_type === "group" ? target_id : null,
      ]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

// Calendar view: every assignment this teacher created (any target type)
// within a date range, with the target's display name resolved so the
// calendar doesn't need N follow-up requests to show "who is this for".
export async function listMyAssignmentsInRange(req: AuthRequest, res: Response): Promise<void> {
  try {
    const from = typeof req.query.from === "string" ? req.query.from : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;
    if (!from || !to) { badRequest(res, "from and to query params are required (YYYY-MM-DD)"); return; }

    const { rows } = await query(
      `SELECT a.id, a.scheduled_date, a.target_type, a.class_id, a.student_id, a.group_id,
              a.course_level_id, cl.title_i18n AS level_title_i18n, cl.module_type,
              COALESCE(c.name, sp.full_name_zh, sp.full_name_en, su.username, g.name) AS target_name
       FROM edu.assignments a
       JOIN edu.course_levels cl ON cl.id = a.course_level_id
       LEFT JOIN edu.classes c ON c.id = a.class_id
       LEFT JOIN edu.student_groups g ON g.id = a.group_id
       LEFT JOIN auth.users su ON su.id = a.student_id
       LEFT JOIN auth.user_profiles sp ON sp.user_id = a.student_id
       WHERE a.assigned_by = $1 AND a.scheduled_date BETWEEN $2 AND $3
       ORDER BY a.scheduled_date ASC`,
      [req.user!.sub, from, to]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}
