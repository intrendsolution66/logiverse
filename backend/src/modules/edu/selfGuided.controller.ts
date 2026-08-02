// backend/src/modules/edu/selfGuided.controller.ts
//
// Self Guided Learning — 学生登录后3个模式之一。跟 Discovery 不同，这里
// 是按预先编排好的顺序学习：Course → Lesson → 一系列步骤(视频/PPT/练习/
// 游戏/测验)。复用现有的 edu.courses / edu.lessons / edu.lesson_steps
// 表（课程设计师那边已经建好的同一套数据），只是从"设计师编辑"视角换成
// "学生只读+订阅年级过滤"视角，所以不能直接复用 lessons.controller.ts
// 里 courses.manage 权限那几个函数——这里换成 authenticate + 订阅检查。

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { ok, notFound, forbidden, serverError } from "../../utils/response.js";
import { getActiveSubscription } from "./subscriptionGate.js";

export async function listSelfGuidedCourses(req: AuthRequest, res: Response): Promise<void> {
  try {
    const sub = await getActiveSubscription(req.user!.sub);
    if (!sub) { forbidden(res, "需要订阅才能使用 Self Guided Learning"); return; }

    const { rows } = await query(
      `SELECT c.id, c.title_i18n, c.description_i18n, c.age_group,
              (SELECT count(*)::int FROM edu.lessons l WHERE l.course_id = c.id) AS lesson_count
       FROM edu.courses c
       WHERE c.grade_tier_id IS NULL OR c.grade_tier_id = $1
       ORDER BY c.created_at DESC`,
      [sub.gradeTierId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function listSelfGuidedLessons(req: AuthRequest, res: Response): Promise<void> {
  try {
    const sub = await getActiveSubscription(req.user!.sub);
    if (!sub) { forbidden(res, "需要订阅才能使用 Self Guided Learning"); return; }

    const { courseId } = req.params;
    // 确认这门课确实在该学生的订阅年级范围内——不能靠猜courseId绕过限制
    const { rows: courseRows } = await query(`SELECT grade_tier_id FROM edu.courses WHERE id = $1`, [courseId]);
    if (!courseRows.length) { notFound(res, "Course not found"); return; }
    if (courseRows[0].grade_tier_id && courseRows[0].grade_tier_id !== sub.gradeTierId) {
      forbidden(res, "这门课不在你的订阅年级范围内"); return;
    }

    const { rows } = await query(
      `SELECT l.id, l.title_i18n, l.order_index,
              (SELECT count(*)::int FROM edu.lesson_steps ls WHERE ls.lesson_id = l.id) AS step_count
       FROM edu.lessons l WHERE l.course_id = $1 ORDER BY l.order_index ASC`,
      [courseId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function getSelfGuidedLesson(req: AuthRequest, res: Response): Promise<void> {
  try {
    const sub = await getActiveSubscription(req.user!.sub);
    if (!sub) { forbidden(res, "需要订阅才能使用 Self Guided Learning"); return; }

    const { lessonId } = req.params;
    const { rows: lessonRows } = await query(
      `SELECT l.id, l.course_id, l.title_i18n, l.order_index, c.grade_tier_id
       FROM edu.lessons l JOIN edu.courses c ON c.id = l.course_id
       WHERE l.id = $1`,
      [lessonId]
    );
    if (!lessonRows.length) { notFound(res, "Lesson not found"); return; }
    if (lessonRows[0].grade_tier_id && lessonRows[0].grade_tier_id !== sub.gradeTierId) {
      forbidden(res, "这门课不在你的订阅年级范围内"); return;
    }

    const { rows: steps } = await query(
      `SELECT ls.id, ls.order_index, ls.step_type, ls.media_url, ls.media_title,
              ls.course_level_id, cl.title_i18n AS level_title_i18n, cl.module_type
       FROM edu.lesson_steps ls
       LEFT JOIN edu.course_levels cl ON cl.id = ls.course_level_id
       WHERE ls.lesson_id = $1 ORDER BY ls.order_index ASC`,
      [lessonId]
    );
    ok(res, { ...lessonRows[0], steps });
  } catch (err) { serverError(res, err); }
}