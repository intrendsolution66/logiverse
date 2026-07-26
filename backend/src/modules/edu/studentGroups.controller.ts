// backend/src/modules/edu/studentGroups.controller.ts
//
// 学生小组 — a teacher's ad-hoc grouping of students (not tied to a class
// roster), e.g. "these three kids are ahead, give them extra practice".
// Same ownership-check pattern as teacher.controller.ts's classes: every
// handler confirms group.teacher_id === the caller before doing anything.

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { validateIC } from "../../utils/ic.js";
import { ok, created, badRequest, notFound, forbidden, conflict, serverError } from "../../utils/response.js";

async function assertOwnsGroup(teacherId: string, groupId: string): Promise<boolean> {
  const { rows } = await query(`SELECT 1 FROM edu.student_groups WHERE id = $1 AND teacher_id = $2`, [groupId, teacherId]);
  return rows.length > 0;
}

export async function listMyGroups(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT g.id, g.name, g.created_at,
              (SELECT count(*)::int FROM edu.student_group_members m WHERE m.group_id = g.id) AS member_count
       FROM edu.student_groups g
       WHERE g.teacher_id = $1
       ORDER BY g.created_at DESC`,
      [req.user!.sub]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function createGroup(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { name } = req.body as Record<string, string>;
    if (!name) { badRequest(res, "name is required"); return; }
    const { rows } = await query(
      `INSERT INTO edu.student_groups (name, teacher_id) VALUES ($1, $2) RETURNING id, name, created_at`,
      [name, req.user!.sub]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function listGroupMembers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { groupId } = req.params;
    if (!(await assertOwnsGroup(req.user!.sub, groupId))) { forbidden(res, "Not your group"); return; }
    const { rows } = await query(
      `SELECT u.id AS student_id, u.username, p.full_name_zh, p.full_name_en, m.added_at
       FROM edu.student_group_members m
       JOIN auth.users u ON u.id = m.student_id
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       WHERE m.group_id = $1
       ORDER BY m.added_at ASC`,
      [groupId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// Adds an EXISTING student (by IC) — same convention as classes: a group
// links already-existing accounts, it doesn't create new ones.
export async function addGroupMember(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { groupId } = req.params;
    const { ic_number } = req.body as Record<string, string>;
    if (!(await assertOwnsGroup(req.user!.sub, groupId))) { forbidden(res, "Not your group"); return; }
    if (!ic_number) { badRequest(res, "ic_number is required"); return; }

    const icResult = validateIC(ic_number);
    if (!icResult.valid) { badRequest(res, icResult.error ?? "Invalid IC/birth-certificate number"); return; }

    const { rows: userRows } = await query(`SELECT id FROM auth.users WHERE username = $1 LIMIT 1`, [icResult.normalized]);
    if (!userRows.length) { notFound(res, "No student account found with this IC"); return; }
    const studentId = userRows[0].id;

    const { rows: exists } = await query(
      `SELECT 1 FROM edu.student_group_members WHERE group_id = $1 AND student_id = $2`, [groupId, studentId]
    );
    if (exists.length) { conflict(res, "This student is already in the group"); return; }

    await query(`INSERT INTO edu.student_group_members (group_id, student_id) VALUES ($1, $2)`, [groupId, studentId]);
    created(res, { group_id: groupId, student_id: studentId });
  } catch (err) { serverError(res, err); }
}

export async function removeGroupMember(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { groupId, studentId } = req.params;
    if (!(await assertOwnsGroup(req.user!.sub, groupId))) { forbidden(res, "Not your group"); return; }
    await query(`DELETE FROM edu.student_group_members WHERE group_id = $1 AND student_id = $2`, [groupId, studentId]);
    ok(res, null, "Removed");
  } catch (err) { serverError(res, err); }
}
