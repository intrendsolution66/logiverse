// backend/src/modules/edu/parentPreview.controller.ts
//
// 家长订阅决策用的课程目录 —— 跟 Discovery / Self Guided Learning 不同,
// 这里完全不需要订阅/年级门控(这本来就是给"还没订阅"的家长看的),取而代
// 之的是两层 operator 手动开的闸门:
//   - edu.courses.show_in_parent_catalog  这门课要不要出现在目录里
//   - edu.assets.parent_preview_enabled   / edu.course_levels.parent_preview_enabled
//     这门课底下具体哪些素材/关卡可以被预览
//
// 素材那边的 parent_preview_enabled 是"总闸门"——即使某门课在
// preview_asset_ids 里引用了某个素材,只要素材自己这个开关是关的,就不会
// 出现在这里(见下面 listParentPreviewCourses 的过滤逻辑)。这样 operator
// 收回一个素材的预览权限时,不用去翻每一门引用过它的课程。

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { ok, notFound, badRequest, serverError } from "../../utils/response.js";

interface PreviewAssetRow {
  id: string;
  category: string;
  name: string | null;
  file_data: string;
  slide_urls: string[] | null;
  parent_preview_seconds: number | null;
}

// ── Topic 浏览 (Programme → Subject → Topic) ────────────────────────────────
// 跟 discovery.controller.ts#listDiscoveryTopics 是同一个思路，两处差别：
//   1. 门槛从"学生订阅"换成"这个Topic底下至少有1个 parent_preview_enabled
//      的Activity"——家长本来就还没订阅，不能用订阅去卡它。
//   2. Discovery 那边 programme_id 是必填（先选Programme再看Topic）；这
//      里 programme_id / subject_id / grade_tier_id 全部是可选筛选，家长
//      要能先看到"全部Topic"，再自己决定要不要缩小范围。
export async function listParentPreviewTopics(req: AuthRequest, res: Response): Promise<void> {
  try {
    const programmeId = typeof req.query.programme_id === "string" ? req.query.programme_id : "";
    const subjectId = typeof req.query.subject_id === "string" ? req.query.subject_id : "";
    const gradeTierId = typeof req.query.grade_tier_id === "string" ? req.query.grade_tier_id : "";

    const conditions: string[] = ["cl.parent_preview_enabled = true"];
    const params: unknown[] = [];
    if (programmeId) { params.push(programmeId); conditions.push(`p.id = $${params.length}`); }
    if (subjectId) { params.push(subjectId); conditions.push(`s.id = $${params.length}`); }
    if (gradeTierId) { params.push(gradeTierId); conditions.push(`c.grade_tier_id = $${params.length}`); }

    const { rows } = await query(
      `SELECT ec.id, ec.name_zh, ec.name_en,
              s.id AS subject_id, s.name_zh AS subject_name_zh,
              p.id AS programme_id, p.name_zh AS programme_name_zh,
              count(cl.id)::int AS activity_count
       FROM edu.exercise_categories ec
       JOIN edu.subjects s ON s.id = ec.subject_id
       JOIN edu.programmes p ON p.id = s.programme_id
       JOIN edu.course_levels cl ON cl.category_id = ec.id
       JOIN edu.courses c ON c.id = cl.course_id
       WHERE ${conditions.join(" AND ")}
       GROUP BY ec.id, ec.name_zh, ec.name_en, s.id, s.name_zh, p.id, p.name_zh
       ORDER BY p.name_zh, s.name_zh, ec.name_zh`,
      params
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// 点进某个Topic后看到的Activity列表——同样思路，parent_preview_enabled
// 代替订阅检查，grade_tier_id 变成可选筛选而不是硬性门槛。
export async function listParentPreviewActivities(req: AuthRequest, res: Response): Promise<void> {
  try {
    const categoryId = typeof req.query.category_id === "string" ? req.query.category_id : "";
    if (!categoryId) { badRequest(res, "category_id is required"); return; }
    const gradeTierId = typeof req.query.grade_tier_id === "string" ? req.query.grade_tier_id : "";

    const conditions: string[] = ["cl.category_id = $1", "cl.parent_preview_enabled = true"];
    const params: unknown[] = [categoryId];
    if (gradeTierId) { params.push(gradeTierId); conditions.push(`c.grade_tier_id = $${params.length}`); }

    const { rows } = await query(
      `SELECT cl.id, cl.exercise_number, cl.title_i18n, cl.module_type, cl.difficulty, cl.duration_minutes
       FROM edu.course_levels cl
       JOIN edu.courses c ON c.id = cl.course_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY cl.exercise_number NULLS LAST, cl.created_at ASC`,
      params
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// ── Topic 浏览到此为止；下面是上一版"按课程分组"留下的接口 ─────────────────────
// 现在的家长预览页面走的是上面 Topic 的路线，这两个先保留、没接前端路由——
// 之后如果要做一个按课程整体呈现的摘要页（比如订阅结算前的"你选的这几门课
// 都包含哪些内容"），这两个还是能直接用。

// 课程目录列表 —— 每门课带上它精选的预览素材(按 operator 排的顺序)和
// 可试玩的 Activity 概要(标题/类型，不含完整config——试玩时家长走
// GET /levels/:levelId，跟学生玩同一个接口，只是那边多一层
// parent_preview_enabled 检查，见 courses.controller.ts#getLevel)。
export async function listParentPreviewCourses(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows: courseRows } = await query(
      `SELECT c.id, c.title_i18n, c.description_i18n, c.age_group, c.grade_tier_id,
              gt.name_i18n AS grade_tier_name_i18n, c.preview_asset_ids
       FROM edu.courses c
       LEFT JOIN edu.grade_tiers gt ON gt.id = c.grade_tier_id
       WHERE c.show_in_parent_catalog = true
       ORDER BY gt.order_index ASC NULLS LAST, c.created_at DESC`
    );

    const courses = [];
    for (const c of courseRows as Array<Record<string, unknown>>) {
      const previewAssetIds = (c.preview_asset_ids as string[]) ?? [];

      let previewAssets: PreviewAssetRow[] = [];
      if (previewAssetIds.length > 0) {
        const { rows: assetRows } = await query(
          `SELECT id, category, name, file_data, slide_urls, parent_preview_seconds
           FROM edu.assets WHERE id = ANY($1) AND parent_preview_enabled = true`,
          [previewAssetIds]
        );
        // course.preview_asset_ids 的顺序是 operator 特意排的（比如"先放
        // 招牌demo视频，再放PPT"），ANY($1)不保证回传顺序，这里按原顺序重排。
        const byId = new Map((assetRows as PreviewAssetRow[]).map((r) => [r.id, r]));
        previewAssets = previewAssetIds.map((id) => byId.get(id)).filter((r): r is PreviewAssetRow => !!r);
      }

      const { rows: previewActivities } = await query(
        `SELECT id, title_i18n, module_type, difficulty
         FROM edu.course_levels
         WHERE course_id = $1 AND parent_preview_enabled = true
         ORDER BY order_index ASC`,
        [c.id]
      );

      courses.push({ ...c, preview_assets: previewAssets, preview_activities: previewActivities });
    }

    ok(res, courses);
  } catch (err) { serverError(res, err); }
}

// 单门课的详情——目录列表页点进去的详情页用，跟上面列表版的差别只是
// 单条查询 + 404 处理，逻辑完全一样，故意不合并成一个函数（列表接口对
// 每门课都要做这些JOIN，写成"列表版调用单条版N次"反而更难读，两个各自
// 独立、各自简单，比强行复用更清楚）。
export async function getParentPreviewCourse(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { courseId } = req.params;
    const { rows: courseRows } = await query(
      `SELECT c.id, c.title_i18n, c.description_i18n, c.age_group, c.grade_tier_id,
              gt.name_i18n AS grade_tier_name_i18n, c.preview_asset_ids
       FROM edu.courses c
       LEFT JOIN edu.grade_tiers gt ON gt.id = c.grade_tier_id
       WHERE c.id = $1 AND c.show_in_parent_catalog = true`,
      [courseId]
    );
    if (!courseRows.length) { notFound(res, "这门课不在家长预览目录里"); return; }
    const c = courseRows[0] as Record<string, unknown>;

    const previewAssetIds = (c.preview_asset_ids as string[]) ?? [];
    let previewAssets: PreviewAssetRow[] = [];
    if (previewAssetIds.length > 0) {
      const { rows: assetRows } = await query(
        `SELECT id, category, name, file_data, slide_urls, parent_preview_seconds
         FROM edu.assets WHERE id = ANY($1) AND parent_preview_enabled = true`,
        [previewAssetIds]
      );
      const byId = new Map((assetRows as PreviewAssetRow[]).map((r) => [r.id, r]));
      previewAssets = previewAssetIds.map((id) => byId.get(id)).filter((r): r is PreviewAssetRow => !!r);
    }

    const { rows: previewActivities } = await query(
      `SELECT id, title_i18n, module_type, difficulty
       FROM edu.course_levels
       WHERE course_id = $1 AND parent_preview_enabled = true
       ORDER BY order_index ASC`,
      [courseId]
    );

    ok(res, { ...c, preview_assets: previewAssets, preview_activities: previewActivities });
  } catch (err) { serverError(res, err); }
}