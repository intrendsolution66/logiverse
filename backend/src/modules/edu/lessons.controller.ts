// backend/src/modules/edu/lessons.controller.ts
//
// 课程编排流程 — a lesson is an ordered sequence of steps: video, PPT, or a
// REFERENCE to an existing course_level (any module_type — spot_diff, maze,
// counting, word_problem, whatever). Matches the brief's example: video/PPT
// explanation → curated question-bank steps → interactive practice →
// random-generation steps, all as one ordered lesson a teacher assembled.
//
// Gated by courses.manage, same permission as everything else in the
// course-authoring toolkit — building a lesson is course design, not a
// separate role.

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { ok, created, badRequest, notFound, serverError } from "../../utils/response.js";

const STEP_TYPES = ["video", "ppt", "level"];

export async function listLessons(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { courseId } = req.params;
    const { rows } = await query(
      `SELECT l.id, l.title_i18n, l.order_index, l.created_at,
              (SELECT count(*)::int FROM edu.lesson_steps ls WHERE ls.lesson_id = l.id) AS step_count
       FROM edu.lessons l
       WHERE l.course_id = $1
       ORDER BY l.order_index ASC, l.created_at ASC`,
      [courseId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function createLesson(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { courseId } = req.params;
    const { title_i18n, order_index } = req.body as { title_i18n?: object; order_index?: number };
    if (!title_i18n) { badRequest(res, "title_i18n is required"); return; }

    const { rows } = await query(
      `INSERT INTO edu.lessons (course_id, title_i18n, order_index, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title_i18n, order_index, created_at`,
      [courseId, JSON.stringify(title_i18n), order_index ?? 0, req.user!.sub]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

// Fetches a lesson with its steps fully assembled — for 'level' steps this
// joins course_levels to bring back title/module_type (NOT the full game
// config; the lesson player fetches that separately via the existing
// GET /levels/:levelId when the student actually reaches that step, same
// subscription/grade-tier gating as playing any level directly — a lesson
// doesn't bypass that check just because it's wrapped in a sequence).
export async function getLesson(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { lessonId } = req.params;
    const { rows: lessonRows } = await query(
      `SELECT id, course_id, title_i18n, order_index FROM edu.lessons WHERE id = $1`,
      [lessonId]
    );
    if (!lessonRows.length) { notFound(res, "Lesson not found"); return; }

    const { rows: steps } = await query(
      `SELECT ls.id, ls.order_index, ls.step_type, ls.media_url, ls.media_title,
              ls.course_level_id, cl.title_i18n AS level_title_i18n, cl.module_type
       FROM edu.lesson_steps ls
       LEFT JOIN edu.course_levels cl ON cl.id = ls.course_level_id
       WHERE ls.lesson_id = $1
       ORDER BY ls.order_index ASC`,
      [lessonId]
    );
    ok(res, { ...lessonRows[0], steps });
  } catch (err) { serverError(res, err); }
}

export async function createStep(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { lessonId } = req.params;
    const { step_type, media_url, media_title, course_level_id } = req.body as Record<string, string>;
    if (!step_type || !STEP_TYPES.includes(step_type as string)) {
      badRequest(res, `step_type must be one of: ${STEP_TYPES.join(", ")}`); return;
    }
    if ((step_type === "video" || step_type === "ppt") && !media_url) {
      badRequest(res, `media_url is required for ${step_type} steps`); return;
    }
    if (step_type === "level" && !course_level_id) {
      badRequest(res, "course_level_id is required for level steps"); return;
    }

    // Always append at the end — order_index is never taken from the
    // client, so "add a step" and "reorder steps" (moveStep, below) are the
    // only two ways order_index ever changes, and they can't conflict.
    const { rows: maxRows } = await query(
      `SELECT COALESCE(MAX(order_index), -1) + 1 AS next_index FROM edu.lesson_steps WHERE lesson_id = $1`,
      [lessonId]
    );
    const nextIndex = maxRows[0].next_index;

    const { rows } = await query(
      `INSERT INTO edu.lesson_steps (lesson_id, order_index, step_type, media_url, media_title, course_level_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, order_index, step_type, media_url, media_title, course_level_id`,
      [lessonId, nextIndex, step_type, media_url ?? null, media_title ?? null, course_level_id ?? null]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

// Swaps this step's order_index with its immediate neighbor in the given
// direction — the simplest reordering primitive that can't produce an
// inconsistent order_index sequence (no gaps, no duplicates), since it's
// always a swap between two existing values, never a fresh number.
export async function moveStep(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { stepId } = req.params;
    const { direction } = req.body as { direction?: "up" | "down" };
    if (direction !== "up" && direction !== "down") { badRequest(res, "direction must be 'up' or 'down'"); return; }

    const { rows: stepRows } = await query(
      `SELECT id, lesson_id, order_index FROM edu.lesson_steps WHERE id = $1`, [stepId]
    );
    if (!stepRows.length) { notFound(res, "Step not found"); return; }
    const step = stepRows[0];

    const { rows: neighborRows } = await query(
      direction === "up"
        ? `SELECT id, order_index FROM edu.lesson_steps WHERE lesson_id = $1 AND order_index < $2 ORDER BY order_index DESC LIMIT 1`
        : `SELECT id, order_index FROM edu.lesson_steps WHERE lesson_id = $1 AND order_index > $2 ORDER BY order_index ASC LIMIT 1`,
      [step.lesson_id, step.order_index]
    );
    if (!neighborRows.length) { ok(res, null, "Already at the edge — nothing to swap with"); return; }
    const neighbor = neighborRows[0];

    await query(`UPDATE edu.lesson_steps SET order_index = $1 WHERE id = $2`, [neighbor.order_index, step.id]);
    await query(`UPDATE edu.lesson_steps SET order_index = $1 WHERE id = $2`, [step.order_index, neighbor.id]);
    ok(res, null, "Reordered");
  } catch (err) { serverError(res, err); }
}

export async function deleteStep(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { stepId } = req.params;
    await query(`DELETE FROM edu.lesson_steps WHERE id = $1`, [stepId]);
    ok(res, null, "Deleted");
  } catch (err) { serverError(res, err); }
}
