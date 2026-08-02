// backend/src/modules/edu/discovery.controller.ts
//
// Discovery 模式 —— 顶部tabs是Programme（复用现有的 GET /programmes，
// 不需要新接口），选中一个Programme后：
//   1) listDiscoveryTopics  —— 该Programme下面的Topic卡片（跳过Subject
//      这一层，直接从Programme一次性拿到底下所有Subject的Topic）
//   2) listDiscoveryActivities —— 点进某个Topic卡片后的Activity表格
//      （游戏/视频/PPT讲义混在同一张表，不分类型；No/Activity ID/
//      Description/Status/Marks）
//
// 数据源是 edu.course_levels（不是素材库 edu.assets），复用
// courses.controller.ts#listAllActivities 已经建好的 Programme→Subject→
// Topic JOIN链路，只是加上"按学生订阅年级过滤"和"这个学生的完成状态/
// 分数"这两件事——这两点是学生视角特有的，管理端的 listAllActivities
// 不需要，所以另外写，不直接改那个函数。

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { ok, forbidden, serverError } from "../../utils/response.js";
import { getActiveSubscription } from "./subscriptionGate.js";

export async function listDiscoveryTopics(req: AuthRequest, res: Response): Promise<void> {
  try {
    const sub = await getActiveSubscription(req.user!.sub);
    if (!sub) { forbidden(res, "需要订阅才能使用 Discovery 模式"); return; }

    const programmeId = typeof req.query.programme_id === "string" ? req.query.programme_id : "";
    if (!programmeId) { forbidden(res, "programme_id is required"); return; }

    // 只显示至少有1个该学生能玩/能看的Activity的Topic —— 一个Topic底下
    // 如果全是别的年级的内容，对这个学生来说等于空的，不该出现在列表里
    // 让他点进去扑空。
    const { rows } = await query(
      `SELECT ec.id, ec.name_zh, ec.name_en, s.name_zh AS subject_name_zh,
              count(cl.id) FILTER (WHERE c.grade_tier_id IS NULL OR c.grade_tier_id = $2)::int AS activity_count
       FROM edu.exercise_categories ec
       JOIN edu.subjects s ON s.id = ec.subject_id
       LEFT JOIN edu.course_levels cl ON cl.category_id = ec.id
       LEFT JOIN edu.courses c ON c.id = cl.course_id
       WHERE s.programme_id = $1
       GROUP BY ec.id, ec.name_zh, ec.name_en, s.name_zh
       HAVING count(cl.id) FILTER (WHERE c.grade_tier_id IS NULL OR c.grade_tier_id = $2) > 0
       ORDER BY ec.name_zh`,
      [programmeId, sub.gradeTierId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function listDiscoveryActivities(req: AuthRequest, res: Response): Promise<void> {
  try {
    const sub = await getActiveSubscription(req.user!.sub);
    if (!sub) { forbidden(res, "需要订阅才能使用 Discovery 模式"); return; }

    const categoryId = typeof req.query.category_id === "string" ? req.query.category_id : "";
    if (!categoryId) { forbidden(res, "category_id is required"); return; }

    const { rows } = await query(
      `SELECT cl.id, cl.exercise_number, cl.title_i18n, cl.module_type, cl.difficulty, cl.duration_minutes,
              pr.completed, pr.score, pr.max_score, pr.played_at
       FROM edu.course_levels cl
       JOIN edu.courses c ON c.id = cl.course_id
       LEFT JOIN LATERAL (
         SELECT completed, score, max_score, played_at
         FROM edu.progress_records
         WHERE course_level_id = cl.id AND student_id = $2
         ORDER BY played_at DESC LIMIT 1
       ) pr ON true
       WHERE cl.category_id = $1 AND (c.grade_tier_id IS NULL OR c.grade_tier_id = $3)
       ORDER BY cl.exercise_number NULLS LAST, cl.created_at ASC`,
      [categoryId, req.user!.sub, sub.gradeTierId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}