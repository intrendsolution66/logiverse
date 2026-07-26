// backend/src/modules/edu/exerciseClassification.controller.ts
//
// LogiVerse Education Taxonomy v1.0 — Programme (课程体系) → Subject
// (学习领域) → Topic (学习主题) → Activity (学习活动). Topic here IS
// edu.exercise_categories (see migration 028 for why that table wasn't
// renamed) — this file already managed categories/groups/curriculum-types
// for the numbering system (018); Programme/Subject CRUD extends the same
// file since they're the two new levels sitting ABOVE Topic in the same
// hierarchy, not a separate concern.

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { ok, created, badRequest, serverError } from "../../utils/response.js";

// ── Programme (课程体系) ────────────────────────────────────────────────────────
export async function listProgrammes(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(`SELECT id, code, name_zh, name_en, description FROM edu.programmes ORDER BY name_zh`);
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function createProgramme(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { code, name_zh, name_en, description } = req.body as Record<string, string>;
    if (!code || !name_zh) { badRequest(res, "code and name_zh are required"); return; }
    const { rows } = await query(
      `INSERT INTO edu.programmes (code, name_zh, name_en, description) VALUES ($1,$2,$3,$4)
       RETURNING id, code, name_zh, name_en, description`,
      [code.toLowerCase().trim(), name_zh, name_en ?? null, description ?? null]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function updateProgramme(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { programmeId } = req.params;
    const { name_zh, name_en, description } = req.body as Record<string, string>;
    const { rows } = await query(
      `UPDATE edu.programmes SET name_zh = COALESCE($2, name_zh), name_en = COALESCE($3, name_en), description = COALESCE($4, description)
       WHERE id = $1 RETURNING id, code, name_zh, name_en, description`,
      [programmeId, name_zh ?? null, name_en ?? null, description ?? null]
    );
    if (!rows.length) { badRequest(res, "Programme not found"); return; }
    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function deleteProgramme(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { programmeId } = req.params;
    await query(`DELETE FROM edu.programmes WHERE id = $1`, [programmeId]);
    ok(res, null, "Deleted");
  } catch (err) {
    const e = err as { code?: string };
    if (e?.code === "23503") { badRequest(res, "还有 Subject 挂在这个 Programme 底下，没办法删除——先把底下的 Subject 都删掉或转移到别的 Programme"); return; }
    serverError(res, err);
  }
}

// ── Subject (学习领域) ──────────────────────────────────────────────────────────
export async function listSubjects(req: AuthRequest, res: Response): Promise<void> {
  try {
    const programmeId = typeof req.query.programme_id === "string" ? req.query.programme_id : null;
    const { rows } = await query(
      programmeId
        ? `SELECT id, programme_id, code, name_zh, name_en FROM edu.subjects WHERE programme_id = $1 ORDER BY name_zh`
        : `SELECT id, programme_id, code, name_zh, name_en FROM edu.subjects ORDER BY name_zh`,
      programmeId ? [programmeId] : []
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function createSubject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { programme_id, code, name_zh, name_en } = req.body as Record<string, string>;
    if (!programme_id || !code || !name_zh) { badRequest(res, "programme_id, code, and name_zh are required"); return; }
    const { rows } = await query(
      `INSERT INTO edu.subjects (programme_id, code, name_zh, name_en) VALUES ($1,$2,$3,$4)
       ON CONFLICT (programme_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh
       RETURNING id, programme_id, code, name_zh, name_en`,
      [programme_id, code.toLowerCase().trim(), name_zh, name_en ?? null]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function updateSubject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { subjectId } = req.params;
    const { name_zh, name_en } = req.body as Record<string, string>;
    const { rows } = await query(
      `UPDATE edu.subjects SET name_zh = COALESCE($2, name_zh), name_en = COALESCE($3, name_en)
       WHERE id = $1 RETURNING id, programme_id, code, name_zh, name_en`,
      [subjectId, name_zh ?? null, name_en ?? null]
    );
    if (!rows.length) { badRequest(res, "Subject not found"); return; }
    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function deleteSubject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { subjectId } = req.params;
    await query(`DELETE FROM edu.subjects WHERE id = $1`, [subjectId]);
    ok(res, null, "Deleted");
  } catch (err) {
    const e = err as { code?: string };
    if (e?.code === "23503") { badRequest(res, "还有 Topic 挂在这个 Subject 底下，没办法删除——先把底下的 Topic 都删掉或转移到别的 Subject"); return; }
    serverError(res, err);
  }
}

// ── Topic (学习主题) = edu.exercise_categories ─────────────────────────────────
export async function listCategories(req: AuthRequest, res: Response): Promise<void> {
  try {
    const subjectId = typeof req.query.subject_id === "string" ? req.query.subject_id : null;
    const { rows } = await query(
      subjectId
        ? `SELECT id, code, name_zh, name_en, prefix, subject_id FROM edu.exercise_categories WHERE subject_id = $1 ORDER BY name_zh`
        : `SELECT id, code, name_zh, name_en, prefix, subject_id FROM edu.exercise_categories ORDER BY name_zh`,
      subjectId ? [subjectId] : []
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// New categories are rare (roughly 1:1 with module_type, so usually only
// needed ahead of a brand-new game module) but still exposed here rather
// than only seedable via migration — an operator shouldn't need a code
// change just to add one more classification bucket.
export async function createCategory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { code, name_zh, name_en, prefix, subject_id } = req.body as Record<string, string>;
    if (!code || !name_zh || !prefix) { badRequest(res, "code, name_zh, and prefix are required"); return; }
    const { rows } = await query(
      `INSERT INTO edu.exercise_categories (code, name_zh, name_en, prefix, subject_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name_zh, name_en, prefix, subject_id`,
      [code.toLowerCase().trim(), name_zh, name_en ?? null, prefix.toUpperCase().trim(), subject_id ?? null]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

// Editing the prefix here changes what NEW exercise numbers look like going
// forward — it does NOT rewrite exercise_number on existing course_levels
// rows (those stay whatever they were generated as). That's intentional:
// retroactively renumbering already-assigned exercise numbers would be
// more surprising than helpful — those numbers may already be printed on
// worksheets, referenced in a lesson plan, etc.
export async function updateCategory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { categoryId } = req.params;
    const { name_zh, name_en, prefix, subject_id } = req.body as Record<string, string>;
    if (!name_zh && !name_en && !prefix && !subject_id) { badRequest(res, "Nothing to update"); return; }
    const { rows } = await query(
      `UPDATE edu.exercise_categories
       SET name_zh = COALESCE($2, name_zh), name_en = COALESCE($3, name_en), prefix = COALESCE($4, prefix),
           subject_id = COALESCE($5, subject_id)
       WHERE id = $1
       RETURNING id, code, name_zh, name_en, prefix, subject_id`,
      [categoryId, name_zh ?? null, name_en ?? null, prefix ? prefix.toUpperCase().trim() : null, subject_id ?? null]
    );
    if (!rows.length) { badRequest(res, "Category not found"); return; }
    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function deleteCategory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { categoryId } = req.params;
    await query(`DELETE FROM edu.exercise_categories WHERE id = $1`, [categoryId]);
    ok(res, null, "Deleted");
  } catch (err) {
    const e = err as { code?: string };
    if (e?.code === "23503") { badRequest(res, "还有 Activity 或分类用着这个 Topic，没办法删除——先把那些 Activity 改成别的 Topic，或者留着这个 Topic 不要删"); return; }
    serverError(res, err);
  }
}

export async function listGroups(req: AuthRequest, res: Response): Promise<void> {
  try {
    const categoryId = typeof req.query.category_id === "string" ? req.query.category_id : null;
    const { rows } = await query(
      categoryId
        ? `SELECT id, category_id, code, name_zh, name_en FROM edu.exercise_groups WHERE category_id = $1 ORDER BY name_zh`
        : `SELECT id, category_id, code, name_zh, name_en FROM edu.exercise_groups ORDER BY name_zh`,
      categoryId ? [categoryId] : []
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// Course designers create groups ad-hoc (数字迷宫/动物迷宫 aren't a fixed
// enum — a designer adding a new theme within a category should be able to
// make a new group on the spot, not wait for someone to edit a migration).
export async function createGroup(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { category_id, code, name_zh, name_en } = req.body as Record<string, string>;
    if (!category_id || !code || !name_zh) { badRequest(res, "category_id, code, and name_zh are required"); return; }
    const { rows } = await query(
      `INSERT INTO edu.exercise_groups (category_id, code, name_zh, name_en)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (category_id, code) DO UPDATE SET name_zh = EXCLUDED.name_zh
       RETURNING id, category_id, code, name_zh, name_en`,
      [category_id, code.toUpperCase(), name_zh, name_en ?? null]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

// Same "don't retroactively renumber" reasoning as updateCategory — editing
// a group's code changes what NEW numbers look like, existing
// exercise_number values on already-created levels are untouched.
export async function updateGroup(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { groupId } = req.params;
    const { name_zh, name_en, code } = req.body as Record<string, string>;
    if (!name_zh && !name_en && !code) { badRequest(res, "Nothing to update"); return; }
    const { rows } = await query(
      `UPDATE edu.exercise_groups
       SET name_zh = COALESCE($2, name_zh), name_en = COALESCE($3, name_en), code = COALESCE($4, code)
       WHERE id = $1
       RETURNING id, category_id, code, name_zh, name_en`,
      [groupId, name_zh ?? null, name_en ?? null, code ? code.toUpperCase().trim() : null]
    );
    if (!rows.length) { badRequest(res, "Group not found"); return; }
    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

// Blocked by the FK on course_levels.group_id if any exercise already uses
// this group — that's Postgres doing the right thing on its own, not
// something this handler needs to check for itself; the error just needs
// to surface clearly instead of as a raw 500.
export async function deleteGroup(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { groupId } = req.params;
    await query(`DELETE FROM edu.exercise_groups WHERE id = $1`, [groupId]);
    ok(res, null, "Deleted");
  } catch (err) {
    const e = err as { code?: string };
    if (e?.code === "23503") { badRequest(res, "还有习题用着这个分类，没办法删除——先把那些习题改成别的分类，或者留着这个分类不要删"); return; }
    serverError(res, err);
  }
}

export async function listCurriculumTypes(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(`SELECT id, code, name_zh, name_en FROM edu.exercise_curriculum_types ORDER BY name_zh`);
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// The atomic "next number" step — called internally by courses.controller's
// createLevel, not exposed as its own route. Uses ON CONFLICT DO UPDATE so
// two designers creating exercises in the same category+group at the same
// moment can't collide on the same number (each gets a distinct increment,
// enforced by Postgres, not by application-level locking).
export async function nextExerciseNumber(categoryId: string, groupId: string | null): Promise<string> {
  const { rows: catRows } = await query(`SELECT prefix FROM edu.exercise_categories WHERE id = $1`, [categoryId]);
  if (!catRows.length) throw new Error("Invalid category_id for exercise numbering");
  const prefix = catRows[0].prefix as string;

  let groupCode = "";
  if (groupId) {
    const { rows: groupRows } = await query(`SELECT code FROM edu.exercise_groups WHERE id = $1`, [groupId]);
    groupCode = groupRows[0]?.code ?? "";
  }

  const { rows: seqRows } = await query(
    `INSERT INTO edu.exercise_number_counters (category_id, group_id, next_seq)
     VALUES ($1, $2, 10001)
     ON CONFLICT (category_id, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO UPDATE SET next_seq = edu.exercise_number_counters.next_seq + 1
     RETURNING next_seq`,
    [categoryId, groupId]
  );
  const seq = seqRows[0].next_seq as number;

  return groupCode ? `${prefix}-${groupCode}-${seq}` : `${prefix}-${seq}`;
}
