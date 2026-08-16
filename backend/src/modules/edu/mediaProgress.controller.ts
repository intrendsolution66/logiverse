// backend/src/modules/edu/mediaProgress.controller.ts
//
// 服务两种场景：Self Guided Learning 里 lesson_steps 中 video/ppt 步骤的
// 进度，以及现在新增的 quiz 步骤(引用 exam_question_bank 题目)的作答
// 结果——这三种步骤都没有 course_level_id，挂不到现成的 progress_records
// 上。Discovery 模式的进度走的是 eduApi.submitProgress（现成的
// POST /levels/:levelId/progress），跟这里无关。

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { ok, badRequest, serverError } from "../../utils/response.js";

export async function submitMediaProgress(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      lesson_step_id, media_type,
      seconds_watched, duration_seconds, last_slide_index, total_slides, completed,
      is_correct, marks_earned, marks_total,
    } = req.body as Record<string, unknown>;

    if (!lesson_step_id || typeof lesson_step_id !== "string") { badRequest(res, "lesson_step_id is required"); return; }
    if (media_type !== "video" && media_type !== "ppt" && media_type !== "quiz") { badRequest(res, "media_type must be 'video', 'ppt', or 'quiz'"); return; }

    const { rows } = await query(
      `INSERT INTO edu.media_progress
         (student_id, lesson_step_id, media_type, seconds_watched, duration_seconds, last_slide_index, total_slides, completed, is_correct, marks_earned, marks_total, view_count, last_viewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, false), $9, $10, $11, 1, now())
       ON CONFLICT (student_id, lesson_step_id)
       DO UPDATE SET
         seconds_watched  = COALESCE(EXCLUDED.seconds_watched, edu.media_progress.seconds_watched),
         duration_seconds = COALESCE(EXCLUDED.duration_seconds, edu.media_progress.duration_seconds),
         last_slide_index = COALESCE(EXCLUDED.last_slide_index, edu.media_progress.last_slide_index),
         total_slides     = COALESCE(EXCLUDED.total_slides, edu.media_progress.total_slides),
         completed        = edu.media_progress.completed OR EXCLUDED.completed,
         is_correct       = COALESCE(EXCLUDED.is_correct, edu.media_progress.is_correct),
         marks_earned     = COALESCE(EXCLUDED.marks_earned, edu.media_progress.marks_earned),
         marks_total      = COALESCE(EXCLUDED.marks_total, edu.media_progress.marks_total),
         view_count       = edu.media_progress.view_count + 1,
         last_viewed_at   = now()
       RETURNING id, completed, seconds_watched, last_slide_index, is_correct, marks_earned, marks_total, view_count`,
      [
        req.user!.sub, lesson_step_id, media_type, seconds_watched ?? null, duration_seconds ?? null, last_slide_index ?? null, total_slides ?? null,
        completed ?? false, typeof is_correct === "boolean" ? is_correct : null, marks_earned ?? null, marks_total ?? null,
      ]
    );

    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function getMediaProgress(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { lessonStepId } = req.query as { lessonStepId?: string };
    if (!lessonStepId) { badRequest(res, "lessonStepId query param is required"); return; }

    const { rows } = await query(
      `SELECT * FROM edu.media_progress WHERE student_id = $1 AND lesson_step_id = $2`,
      [req.user!.sub, lessonStepId]
    );
    ok(res, rows[0] ?? null);
  } catch (err) { serverError(res, err); }
}