// backend/src/modules/edu/courses.controller.ts
//
// Phase 1 pilot. Two concerns live here:
//   1. Course-designer side: create courses, add levels to them (a level
//      currently only supports module_type='counting' — more module types
//      get their own "add level" branch as their config tables land, same
//      pattern, not a rewrite).
//   2. Student side: fetch a level's full playable config, and submit a
//      progress record after finishing a play session.
//
// This intentionally does NOT implement assignments/scheduling yet (that's
// Phase 3 in the roadmap) — every course_level is visible to any
// authenticated student for now. Good enough to prove the vertical slice
// end-to-end; assignment-based visibility is a filter to add later, not a
// structural change.

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query, withTransaction } from "../../config/db.js";
import { ok, created, paginated, badRequest, notFound, forbidden, serverError } from "../../utils/response.js";
import { parsePagination } from "../../utils/pagination.js";
import { nextExerciseNumber } from "./exerciseClassification.controller.js";

// ── Grade tiers (system-wide taxonomy, defined once, referenced by every course) ──
export async function listGradeTiers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT id, code, name_i18n, age_min, age_max, order_index
       FROM edu.grade_tiers WHERE is_active = true ORDER BY order_index ASC`
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function createGradeTier(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { code, name_i18n, age_min, age_max, order_index } = req.body as Record<string, unknown>;
    if (!code || !name_i18n) { badRequest(res, "code and name_i18n are required"); return; }
    const { rows } = await query(
      `INSERT INTO edu.grade_tiers (code, name_i18n, age_min, age_max, order_index, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, code, name_i18n, age_min, age_max, order_index`,
      [code, JSON.stringify(name_i18n), age_min ?? null, age_max ?? null, order_index ?? 0, req.user!.sub]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function updateGradeTier(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { tierId } = req.params;
    const { name_i18n, age_min, age_max, order_index } = req.body as Record<string, unknown>;
    const { rows } = await query(
      `UPDATE edu.grade_tiers SET
         name_i18n = COALESCE($2, name_i18n), age_min = COALESCE($3, age_min),
         age_max = COALESCE($4, age_max), order_index = COALESCE($5, order_index)
       WHERE id = $1
       RETURNING id, code, name_i18n, age_min, age_max, order_index`,
      [tierId, name_i18n ? JSON.stringify(name_i18n) : null, age_min ?? null, age_max ?? null, order_index ?? null]
    );
    if (!rows.length) { badRequest(res, "Grade tier not found"); return; }
    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

// 软删除 (is_active = false)，不是真的从表里删掉——等级被课程、订阅、素材
// 这几张表都引用着，直接硬删除风险很高（会牵连一大串外键），而且
// listGradeTiers 本来就已经是 `WHERE is_active = true` 在过滤了，软删除
// 跟这个逻辑天然契合：删掉的等级就是"以后新建课程/素材看不到它"，不影响
// 已经在用这个等级的旧资料。
export async function deleteGradeTier(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { tierId } = req.params;
    await query(`UPDATE edu.grade_tiers SET is_active = false WHERE id = $1`, [tierId]);
    ok(res, null, "Deleted");
  } catch (err) { serverError(res, err); }
}

// ── Courses ──────────────────────────────────────────────────────────────────
// Supports search (?search=, matches title_i18n->>'zh' or ->>'en'), filter
// (?grade_tier_id=), sort (?sort=title|created_at, ?order=asc|desc), and
// pagination (?page=, ?limit=, via the shared parsePagination util).
const COURSE_SORT_COLUMNS: Record<string, string> = {
  title: "c.title_i18n->>'zh'",
  created_at: "c.created_at",
  grade_tier: "gt.order_index",
};

export async function listCourses(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req, 10);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const gradeTierId = typeof req.query.grade_tier_id === "string" ? req.query.grade_tier_id : "";
    const sortKey = typeof req.query.sort === "string" && COURSE_SORT_COLUMNS[req.query.sort] ? req.query.sort : "created_at";
    const order = req.query.order === "asc" ? "ASC" : "DESC";
    const sortColumn = COURSE_SORT_COLUMNS[sortKey];

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(c.title_i18n->>'zh' ILIKE $${params.length} OR c.title_i18n->>'en' ILIKE $${params.length})`);
    }
    if (gradeTierId) {
      params.push(gradeTierId);
      conditions.push(`c.grade_tier_id = $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows: countRows } = await query(
      `SELECT count(*)::int AS total FROM edu.courses c ${whereClause}`,
      params
    );
    const total = countRows[0]?.total ?? 0;

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT c.id, c.title_i18n, c.description_i18n, c.age_group, c.created_at,
              c.grade_tier_id, gt.code AS grade_tier_code, gt.name_i18n AS grade_tier_name_i18n,
              c.show_in_parent_catalog, c.preview_asset_ids
       FROM edu.courses c
       LEFT JOIN edu.grade_tiers gt ON gt.id = c.grade_tier_id
       ${whereClause}
       ORDER BY ${sortColumn} ${order} NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    paginated(res, rows, total, page, limit);
  } catch (err) { serverError(res, err); }
}

export async function createCourse(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { title_i18n, description_i18n, age_group, organization_id, grade_tier_id, show_in_parent_catalog, preview_asset_ids } = req.body as Record<string, unknown>;
    if (!title_i18n) { badRequest(res, "title_i18n is required"); return; }
    if (!grade_tier_id) { badRequest(res, "grade_tier_id is required — pick a grade tier (see /edu/grade-tiers) or create one first"); return; }
    const cleanPreviewAssetIds = Array.isArray(preview_asset_ids) ? preview_asset_ids.filter((id) => typeof id === "string") : [];

    const { rows } = await query(
      `INSERT INTO edu.courses (title_i18n, description_i18n, age_group, organization_id, grade_tier_id, created_by, show_in_parent_catalog, preview_asset_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title_i18n, description_i18n, age_group, grade_tier_id, created_at, show_in_parent_catalog, preview_asset_ids`,
      [JSON.stringify(title_i18n), description_i18n ? JSON.stringify(description_i18n) : null,
       age_group ?? null, organization_id ?? null, grade_tier_id, req.user!.sub,
       show_in_parent_catalog === true, cleanPreviewAssetIds]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function updateCourse(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { courseId } = req.params;
    const { title_i18n, description_i18n, age_group, grade_tier_id, show_in_parent_catalog, preview_asset_ids } = req.body as Record<string, unknown>;
    const cleanPreviewAssetIds = Array.isArray(preview_asset_ids) ? preview_asset_ids.filter((id) => typeof id === "string") : null;

    const { rows } = await query(
      `UPDATE edu.courses SET
         title_i18n = COALESCE($2, title_i18n),
         description_i18n = COALESCE($3, description_i18n),
         age_group = COALESCE($4, age_group),
         grade_tier_id = COALESCE($5, grade_tier_id),
         show_in_parent_catalog = COALESCE($6, show_in_parent_catalog),
         preview_asset_ids = COALESCE($7, preview_asset_ids),
         updated_at = now()
       WHERE id = $1
       RETURNING id, title_i18n, description_i18n, age_group, grade_tier_id, show_in_parent_catalog, preview_asset_ids`,
      [courseId, title_i18n ? JSON.stringify(title_i18n) : null, description_i18n ? JSON.stringify(description_i18n) : null, age_group ?? null, grade_tier_id ?? null,
       typeof show_in_parent_catalog === "boolean" ? show_in_parent_catalog : null, cleanPreviewAssetIds]
    );
    if (!rows.length) { notFound(res, "Course not found"); return; }
    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}
 
// 删除课程前先确认底下没有还在用的Activity或Lesson——不像Programme那样
// 靠数据库FK报错兜底，这里主动查一遍给出更明确的提示，因为课程被引用的
// 层级更深（Level、Lesson、Lesson step三层都可能挂着东西）。
export async function deleteCourse(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { courseId } = req.params;
    const force = req.query.force === "true" || (req.body as { force?: boolean } | undefined)?.force === true;

    const { rows: levelCountRows } = await query(`SELECT count(*)::int AS n FROM edu.course_levels WHERE course_id = $1`, [courseId]);
    const { rows: lessonCountRows } = await query(`SELECT count(*)::int AS n FROM edu.lessons WHERE course_id = $1`, [courseId]);

    if ((levelCountRows[0].n > 0 || lessonCountRows[0].n > 0) && !force) {
      badRequest(
        res,
        `这门课程底下还有 ${levelCountRows[0].n} 个Activity和 ${lessonCountRows[0].n} 个课时，请先清空或转移，才能删除课程`
      );
      return;
    }

    if (force) {
      // Activity 不删——只是解除跟这门课的关联。Activity 现在本来就不
      // 需要依附在某门课底下（course_id 已经是选填的），解除关联之后
      // 它还在，之后照样能被任何 Lesson 单独引用。
      await query(`UPDATE edu.course_levels SET course_id = NULL WHERE course_id = $1`, [courseId]);

      // Lesson 不一样——它是真的属于这门课的东西，脱离课程没有独立存在
      // 的意义，直接连同底下的步骤一起级联删掉。
      const { rows: lessonRows } = await query(`SELECT id FROM edu.lessons WHERE course_id = $1`, [courseId]);
      const lessonIds = (lessonRows as Array<{ id: string }>).map((r) => r.id);
      if (lessonIds.length) {
        await query(`DELETE FROM edu.lesson_steps WHERE lesson_id = ANY($1)`, [lessonIds]);
        await query(`DELETE FROM edu.lessons WHERE course_id = $1`, [courseId]);
      }
    }

    const { rowCount } = await query(`DELETE FROM edu.courses WHERE id = $1`, [courseId]);
    if (!rowCount) { notFound(res, "Course not found"); return; }
    ok(res, null, force ? "已删除（Activity 已保留、解除关联；课时已一起清空）" : "Deleted");
  } catch (err) { serverError(res, err); }
}


// ── Levels ───────────────────────────────────────────────────────────────────
export async function listLevels(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { courseId } = req.params;
    const { rows } = await query(
      `SELECT cl.id, cl.course_id, cl.order_index, cl.module_type, cl.module_config_id,
              cl.title_i18n, cl.video_url_i18n, cl.ppt_url_i18n, cl.illustration_url, cl.points_reward,
              cl.exercise_number, cl.category_id, cl.group_id, cl.curriculum_type_id,
              cl.activity_type, cl.difficulty, cl.tags, cl.parent_preview_enabled, cl.usage_contexts, cl.self_guided_programme_ids, cl.cover_image_url,
              ec.name_zh AS category_name_zh, eg.name_zh AS group_name_zh, ect.name_zh AS curriculum_type_name_zh,
              s.name_zh AS subject_name_zh, p.name_zh AS programme_name_zh
       FROM edu.course_levels cl
       LEFT JOIN edu.exercise_categories ec ON ec.id = cl.category_id
       LEFT JOIN edu.exercise_groups eg ON eg.id = cl.group_id
       LEFT JOIN edu.exercise_curriculum_types ect ON ect.id = cl.curriculum_type_id
       LEFT JOIN edu.subjects s ON s.id = ec.subject_id
       LEFT JOIN edu.programmes p ON p.id = s.programme_id
       WHERE cl.course_id = $1
       ORDER BY cl.order_index ASC`,
      [courseId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// Creates a level AND its module-specific config row in one transaction.
// Each module_type gets its own `if` branch here, inserting into that
// module's own config table — nothing about existing branches changes when
// a new one is added, per the "each module's config table is independent"
// principle (3.2 in the architecture doc).
// Same convention as assets.controller.ts's normalizeTags — max 3, deduped,
// short (a label, not a description). Kept as its own copy here rather
// than importing from assets.controller.ts to avoid an awkward
// cross-module dependency for four lines of logic.
function normalizeActivityTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const cleaned = input
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim().slice(0, 20));
  return Array.from(new Set(cleaned)).slice(0, 3);
}

// skills_developed is a genuinely open-ended list (an activity can build
// several skills at once — 数感、图形识别、精细动作 isn't unusual as a set)
// — no 3-item cap here, that limit belongs to "tags" specifically, not to
// this field. Still deduped and length-capped per entry for sanity.
function normalizeSkillsList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const cleaned = input
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim().slice(0, 30));
  return Array.from(new Set(cleaned)).slice(0, 10); // generous ceiling, just to stop an unbounded payload
}

// 跟 assets.controller.ts 里的 USAGE_CONTEXTS 白名单完全一致——两边概念
// 是同一个东西，这里没有单独重新定义一份不同的白名单。
const ACTIVITY_USAGE_CONTEXTS = ["in_person", "self_guided", "public_course"];
function normalizeUsageContexts(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const cleaned = input.filter((c): c is string => typeof c === "string" && ACTIVITY_USAGE_CONTEXTS.includes(c));
  return Array.from(new Set(cleaned));
}
// self_guided_programme_ids 只做"看起来像uuid"的粗略过滤，不在这里查
// Programme 是否真的存在——course_levels 没有对 programme 表设外键约束
// （数组栏位本来就没办法建外键），这个交给前端下拉选单本身保证只会传
// 真实存在的 id，后端这层只挡明显不是uuid格式的脏数据。
function normalizeProgrammeIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return Array.from(new Set(input.filter((id): id is string => typeof id === "string" && uuidPattern.test(id))));
}

export async function createLevel(req: AuthRequest, res: Response): Promise<void> {
  try {
    // courseId 现在是选填的——可以从路由参数来（POST /courses/:courseId/levels，
    // 老路由，建的时候就属于某门课），也可以从请求体来（POST /activities，
    // 新路由，压根不挂在任何 Course 下，course_id 存 NULL）。Activity 不该
    // 被强制绑在一门课底下，之后要用哪个 Lesson 引用它，靠 lesson_steps
    // 自己的记录，不靠这个栏位。
    const courseId: string | null = req.params.courseId || (req.body?.course_id as string | undefined) || null;
    const {
      module_type, order_index, title_i18n, config, explanation_text, explanation_image_url, explanation_video_url,
      category_id, category_ids, group_id, curriculum_type_id, hint_text, audio_url,
      activity_type, teaching_modes, difficulty, age_group_min, age_group_max, duration_minutes,
      learning_outcomes, skills_developed, language, tags, parent_preview_enabled,
      usage_contexts, self_guided_programme_ids, cover_image_url,
    } = req.body as {
      module_type: string; order_index?: number; title_i18n?: object; config: Record<string, unknown>;
      explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
      // category_id 是旧的单一栏位（向后兼容——还有旧前端代码可能只传
      // 这个）；category_ids 是新的多选（一个 Activity 可以同时挂好几个
      // Topic）。两个都传的话以 category_ids 为准；都没传就是"先不分类"。
      category_id?: string; category_ids?: string[]; group_id?: string; curriculum_type_id?: string;
      hint_text?: string; audio_url?: string;
      activity_type?: string; teaching_modes?: string[]; difficulty?: string;
      age_group_min?: number; age_group_max?: number; duration_minutes?: number;
      learning_outcomes?: string; skills_developed?: string[]; language?: string; tags?: string[];
      parent_preview_enabled?: boolean;
      // 使用场景——跟素材库 edu.assets.usage_contexts 同一个概念(实体课/
      // self_guided/公开课，可多选)，搬到 Activity 上。self_guided_
      // programme_ids 只有勾了 self_guided 才有意义，留空=不限制
      // Programme，填了具体id才收窄。
      usage_contexts?: string[]; self_guided_programme_ids?: string[];
      // Activity 设计管理列表卡片用的封面图，跟 explanation_image_url
      // (讲解图，给学生看)是两回事。
      cover_image_url?: string;
    };
    if (!module_type) { badRequest(res, "module_type is required"); return; }
    // Topic 新建时不强制要求——可以先建 Activity，之后再透过 updateLevel
    // 补上分类。一个 Activity 现在可以同时挂好几个 Topic（多对多，见
    // edu.activity_topic_links），下面统一转成数组处理。
    const categoryIds = Array.from(new Set((category_ids && category_ids.length ? category_ids : (category_id ? [category_id] : [])).filter(Boolean)));
    const primaryCategoryId = categoryIds[0] ?? null; // 旧栏位/编号生成还是要挑一个"主"分类，用第一个

    const SUPPORTED = ["counting", "spot_diff", "focus_tap", "memory", "pattern", "word_problem", "maze", "number_maze", "sudoku", "line_match", "coloring", "ppt_lecture", "video_lecture", "play_along", "sticker_game", "drag_drop", "cube_stack", "cube_layer_count", "cube_find_hidden", "cube_free_rotate", "cube_build", "cube_three_view", "shape_count", "clock", "latin_square", "number_find", "number_sequence", "number_bond", "number_compare", "number_addition", "chinese_stroke", "multiple_choice", "fill_blank"];
    if (!SUPPORTED.includes(module_type)) {
      badRequest(res, `Unsupported module_type: ${module_type} (supported: ${SUPPORTED.join(", ")})`);
      return;
    }

    // Auto-numbering is optional — a designer who hasn't classified this
    // exercise yet just gets exercise_number = null, not a blocked save.
    // This runs OUTSIDE the transaction below on purpose: the counter
    // increment should be durable even if something later in level
    // creation fails and rolls back (same "gaps are fine, duplicates
    // aren't" tradeoff every auto-increment sequence makes).
    const exerciseNumber = primaryCategoryId ? await nextExerciseNumber(primaryCategoryId, group_id ?? null) : null;

    const result = await withTransaction(async (client) => {
      const cfg = config ?? {};
      let configId: string;

      if (module_type === "counting") {
        // positions can now carry their OWN image_url + rotation per entry
        // (每个物件可以是不同图案) — custom_icon_url becomes an optional
        // fallback for any position that doesn't specify its own image,
        // which is exactly what OLD custom_scene exercises (built before
        // this) already look like: one shared icon, many bare {x,y}
        // positions. Both shapes coexist in the same jsonb column.
        if (cfg.mode === "custom_scene") {
          const positions = cfg.positions as Array<{ image_url?: string }> | undefined;
          const hasFallbackIcon = !!cfg.custom_icon_url;
          const everyPositionHasOwnImage = positions?.every((p) => !!p.image_url) ?? false;
          if (!cfg.bg_image_url || !positions?.length || !(hasFallbackIcon || everyPositionHasOwnImage)) {
            throw new Error("custom_scene 模式的点点数数需要背景图、至少1个物件，每个物件要有图片（自己的图片，或者一个共用的物件图片）");
          }
        }
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.counting_configs
             (theme, custom_icon_url, bg_image_url, min_val, max_val, quiz_mode, num_choices, total_questions, timer_mode, time_limit, mode, positions, texts, target_types, question_i18n)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           RETURNING id`,
          [
            cfg.theme ?? "apple", cfg.custom_icon_url ?? null, cfg.bg_image_url ?? null,
            cfg.min_val ?? 1, cfg.max_val ?? 10, cfg.quiz_mode ?? "select",
            cfg.num_choices ?? 3, cfg.total_questions ?? 5,
            cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
            cfg.mode ?? "random", cfg.positions ? JSON.stringify(cfg.positions) : null,
            cfg.texts ? JSON.stringify(cfg.texts) : null,
            cfg.target_types ? JSON.stringify(cfg.target_types) : null,
            cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null,
          ]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "spot_diff") {
        if (!cfg.image_a_url || !cfg.image_b_url) throw new Error("image_a_url and image_b_url are required for spot_diff");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.spot_diff_configs (image_a_url, image_b_url, hotspots, timer_mode, time_limit, question_i18n)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id`,
          [cfg.image_a_url, cfg.image_b_url, JSON.stringify(cfg.hotspots ?? []), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "focus_tap") {
        if (cfg.mode === "custom" && (!cfg.bg_image_url || !cfg.positions || (cfg.positions as unknown[]).length < 2)) {
          throw new Error("custom 模式的专注力点数字需要背景图和至少2个标记位置");
        }
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.focus_tap_configs (mode, grid_size, bg_image_url, positions, timer_mode, time_limit, question_i18n)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id`,
          [cfg.mode ?? "grid", cfg.grid_size ?? 4, cfg.bg_image_url ?? null,
           cfg.positions ? JSON.stringify(cfg.positions) : null, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
           cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "memory") {
        if (cfg.theme === "custom" && (!(cfg.custom_icons as unknown[])?.length || (cfg.custom_icons as unknown[]).length < 2)) {
          throw new Error("custom 主题的Memory配对需要至少2张自定义图片");
        }
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.memory_configs (theme, custom_icons, bg_image_url, pairs_count, preview_seconds, timer_mode, time_limit, question_i18n, layout, positions)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id`,
          [cfg.theme ?? "animal", cfg.custom_icons ? JSON.stringify(cfg.custom_icons) : null, cfg.bg_image_url ?? null,
           cfg.pairs_count ?? 6, cfg.preview_seconds ?? 3, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
           cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null,
           cfg.layout ?? "grid", cfg.positions ? JSON.stringify(cfg.positions) : null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "pattern") {
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.pattern_configs (theme, pattern_types, seq_length, num_choices, total_questions, timer_mode, time_limit, question_i18n)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id`,
          [cfg.theme ?? "shape", JSON.stringify(cfg.pattern_types ?? ["AB","ABC","AAB","ABB","AABB"]),
           cfg.seq_length ?? 7, cfg.num_choices ?? 3, cfg.total_questions ?? 5,
           cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
           cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "word_problem") {
        if (cfg.mode === "custom_scene") {
          if (!cfg.bg_image_url) throw new Error("自定义应用题需要背景图");
          if (!cfg.problem_text || !cfg.question_text) throw new Error("自定义应用题需要题目文字和问题");
          if (cfg.custom_answer === undefined || cfg.custom_answer === null) throw new Error("自定义应用题需要填正确答案");
        }
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.word_problem_configs
             (categories, answer_mode, num_choices, total_questions, chicken_min, chicken_max,
              speed_min, speed_max, meet_time_min, meet_time_max, timer_mode, time_limit,
              mode, bg_image_url, objects, texts, problem_text, question_text, custom_answer, unit)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           RETURNING id`,
          [
            JSON.stringify(cfg.categories ?? ["chicken_rabbit"]), cfg.answer_mode ?? "select",
            cfg.num_choices ?? 3, cfg.total_questions ?? 5,
            cfg.chicken_min ?? 1, cfg.chicken_max ?? 30,
            cfg.speed_min ?? 3, cfg.speed_max ?? 15,
            cfg.meet_time_min ?? 2, cfg.meet_time_max ?? 10,
            cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
            cfg.mode ?? "random", cfg.bg_image_url ?? null,
            cfg.objects ? JSON.stringify(cfg.objects) : null, cfg.texts ? JSON.stringify(cfg.texts) : null,
            cfg.problem_text ?? null, cfg.question_text ?? null, cfg.custom_answer ?? null, cfg.unit ?? null,
          ]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "maze") { // authored content, not generation: every field here IS the puzzle, not a parameter for making one
        if (!cfg.bg_image_url || !cfg.mask_image_url) throw new Error("bg_image_url and mask_image_url are required for maze");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.maze_configs (bg_image_url, mask_image_url, start_x, start_y, end_x, end_y, timer_mode, time_limit, question_i18n, pairs)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id`,
          [
            cfg.bg_image_url, cfg.mask_image_url,
            cfg.start_x ?? 0.1, cfg.start_y ?? 0.5, cfg.end_x ?? 0.9, cfg.end_y ?? 0.5,
            cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
            cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null,
            cfg.pairs ? JSON.stringify(cfg.pairs) : null,
          ]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "coloring") { // authored content: outline + region mask + per-region color rules, no generation
        const regions = cfg.regions as Array<{ marker_color: string; rule: "specific" | "free"; target_color?: string; label?: string }> | undefined;
        if (!cfg.bg_image_url || !cfg.region_mask_url) throw new Error("bg_image_url and region_mask_url are required for coloring");
        if (!regions?.length) throw new Error("至少要标记1个区块");
        if (regions.some((r) => r.rule === "specific" && !r.target_color)) throw new Error("选了「指定颜色」的区块，要填要求的颜色");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.coloring_configs (bg_image_url, region_mask_url, regions, timer_mode, time_limit, question_i18n)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id`,
          [cfg.bg_image_url, cfg.region_mask_url, JSON.stringify(regions), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "line_match") {
        // 架构升级——从"一一对应的pairs数组"换成左右各一份物件清单+多对
        // 多连线(list布局)，或者物件自由摆放按pair_key分组连线(scene布局)。
        // 判定这次改成client端直接核对(见 LineMatchGame.tsx 头部说明)，
        // 不再是"服务器藏答案"那一套，所以这里不用像sudoku那样拆分给
        // 学生/设计师两种不同视角，两边看到的是同一份数据。
        const layout = (cfg.layout as string) === "scene" ? "scene" : "list";
        if (layout === "scene") {
          const objects = cfg.objects as Array<{ image_url: string; x: number; y: number; w: number; h: number; rotation: number; pair_key?: string; flip_x?: boolean; flip_y?: boolean; opacity?: number }> | undefined;
          if (!objects?.length) throw new Error("自定义画面模式至少要摆1个物件");
          const byKey = new Map<string, number>();
          objects.forEach((o) => { const k = (o.pair_key ?? "").trim(); byKey.set(k, (byKey.get(k) ?? 0) + 1); });
          if (byKey.has("")) throw new Error("每个物件都要填「配对标记」，不能留空");
          const solo = [...byKey.entries()].filter(([, c]) => c < 2).map(([k]) => k);
          if (solo.length > 0) throw new Error(`配对标记「${solo.join("、")}」只有1个物件，至少要2个才能连线`);
          const { rows: cfgRows } = await client.query(
            `INSERT INTO edu.line_match_configs (layout, bg_image_url, objects, timer_mode, time_limit, question_i18n)
             VALUES ($1,$2,$3,$4,$5,$6)
             RETURNING id`,
            [layout, cfg.bg_image_url ?? null, JSON.stringify(objects), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
          configId = cfgRows[0].id;
        } else {
          const leftItems = cfg.left_items as Array<{ id: string; type: string; content: string }> | undefined;
          const rightItems = cfg.right_items as Array<{ id: string; type: string; content: string }> | undefined;
          const edges = cfg.edges as Array<{ leftId: string; rightId: string }> | undefined;
          if (!leftItems?.length || !rightItems?.length) throw new Error("左右两边至少各要有1个物件，内容不能空着");
          if (!edges?.length) throw new Error("至少要连1条线");
          const { rows: cfgRows } = await client.query(
            `INSERT INTO edu.line_match_configs (layout, left_items, right_items, edges, shuffle_right, timer_mode, time_limit, question_i18n)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING id`,
            [layout, JSON.stringify(leftItems), JSON.stringify(rightItems), JSON.stringify(edges), cfg.shuffle_right ?? true, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
          configId = cfgRows[0].id;
        }
      } else if (module_type === "ppt_lecture") { // 讲义类，不是游戏：一份转好的幻灯片图片清单，没有对错判断
        const slideUrls = cfg.slide_image_urls as string[] | undefined;
        if (!slideUrls?.length) throw new Error("请先上传并转换 PPT，至少要有1页幻灯片");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.ppt_lecture_configs (slide_image_urls, original_filename) VALUES ($1,$2) RETURNING id`,
          [JSON.stringify(slideUrls), cfg.original_filename ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "video_lecture") { // 讲义类，不是游戏：一个视频链接，没有对错判断
        if (!cfg.video_url) throw new Error("请填视频链接或上传视频");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.video_lecture_configs (video_url, poster_image_url) VALUES ($1,$2) RETURNING id`,
          [cfg.video_url, cfg.poster_image_url ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "play_along") { // 讲义类，不是游戏：乐谱+音频+同步标记，没有对错判断
        const markers = cfg.markers as unknown[] | undefined;
        if (!(cfg.sheet_image_urls as unknown[])?.length) throw new Error("请先上传乐谱图片");
        if (!cfg.audio_url) throw new Error("请上传或选择音频");
        if (!markers || markers.length < 2) throw new Error("至少要打2个时间标记");
        if (!cfg.original_bpm || (cfg.original_bpm as number) < 1) throw new Error("请填这首曲子的原速 BPM");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.play_along_configs (sheet_image_urls, original_filename, audio_url, markers, original_bpm)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id`,
          [JSON.stringify(cfg.sheet_image_urls), cfg.original_filename ?? null, cfg.audio_url, JSON.stringify(markers), cfg.original_bpm]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "number_maze") { // authored content: 跟迷宫一样，路径分岔那几个字段直接就是关卡本身；方格棋盘模式的cells/path也是设计师authored的路径答案，不是随机生成
        if (cfg.layout === "grid") {
          const path = cfg.path as Array<{ row: number; col: number }> | undefined;
          if (!(cfg.cells as unknown[])?.length) throw new Error("请先画好网格、填好数字");
          if (!path || path.length < 2) throw new Error("至少要标2个格子的路径顺序");
          const { rows: cfgRows } = await client.query(
            `INSERT INTO edu.number_maze_configs (layout, rows, cols, cells, path, line_color, given_color, bg_color, bg_enabled, opacity, timer_mode, time_limit, question_i18n)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING id`,
            [
              "grid", cfg.rows, cfg.cols, JSON.stringify(cfg.cells), JSON.stringify(path),
              cfg.line_color ?? null, cfg.given_color ?? null, cfg.bg_color ?? null, cfg.bg_enabled ?? false, cfg.opacity ?? null,
              cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null,
            ]
          );
          configId = cfgRows[0].id;
        } else {
          const decisionPoints = cfg.decision_points as Array<{ options: Array<{ value: string }> }> | undefined;
          if (!cfg.bg_image_url || !cfg.mask_image_url) throw new Error("背景图和可走路径都是必须的");
          if (!cfg.start || !cfg.end) throw new Error("请设好起点和终点");
          if (decisionPoints?.some((d) => d.options.some((o) => !o.value?.trim()))) throw new Error("每个分岔点的每个选项都要填数字");
          const { rows: cfgRows } = await client.query(
            `INSERT INTO edu.number_maze_configs (layout, bg_image_url, mask_image_url, start_x, start_y, end_x, end_y, decision_points, timer_mode, time_limit, question_i18n)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING id`,
            [
              "path", cfg.bg_image_url, cfg.mask_image_url,
              (cfg.start as { x: number }).x, (cfg.start as { y: number }).y,
              (cfg.end as { x: number }).x, (cfg.end as { y: number }).y,
              JSON.stringify(decisionPoints ?? []), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
              cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null,
            ]
          );
          configId = cfgRows[0].id;
        }
      } else if (module_type === "sticker_game") { // authored content: 贴纸摆的位置就是答案，跟line_match/迷宫同一个"client端直接核对"安全等级
        const objects = cfg.objects as unknown[] | undefined;
        if (!cfg.bg_image_url) throw new Error("请先选背景图片");
        if (!objects?.length) throw new Error("请至少放1个贴纸");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.sticker_game_configs (bg_image_url, objects, timer_mode, time_limit, question_i18n)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id`,
          [cfg.bg_image_url, JSON.stringify(objects), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "drag_drop") {
        // 统一拖拽引擎——阶段1只做了 position_target 这一种mode，跟
        // sticker_game 是同一个"摆的位置就是答案，client端直接核对"的
        // 安全模型，写入逻辑几乎照抄sticker_game，只是多存一个mode字段，
        // 给以后的sequence/sort_bins/fill_blank_tiles留好扩展位。
        const mode = (cfg.mode as string) || "position_target";
        if (mode !== "position_target") throw new Error(`drag_drop 的 "${mode}" 玩法还在开发中，目前只支持 position_target`);
        const objects = cfg.objects as unknown[] | undefined;
        if (!cfg.bg_image_url) throw new Error("请先选背景图片");
        if (!objects?.length) throw new Error("请至少放1个物件");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.drag_drop_configs (mode, bg_image_url, objects, timer_mode, time_limit, question_i18n)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id`,
          [mode, cfg.bg_image_url, JSON.stringify(objects), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "cube_layer_count") { // Stage2 逐层计数
        const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.cube_layer_count_configs (starting_level, total_questions, max_split_layers, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [startingLevel, cfg.total_questions ?? 5, cfg.max_split_layers ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "cube_find_hidden") { // Stage3 找隐藏方块
        const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.cube_find_hidden_configs (starting_level, total_questions, hidden_targets, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [startingLevel, cfg.total_questions ?? 5, cfg.hidden_targets ?? 1, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "cube_free_rotate") { // Stage4 自由旋转观察
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.cube_free_rotate_configs (total_shapes, shape_size, min_view_seconds, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [cfg.total_shapes ?? 3, cfg.shape_size ?? 3, cfg.min_view_seconds ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "cube_build") { // Stage5 自己搭积木
        const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.cube_build_configs (starting_level, total_questions, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "cube_three_view") { // Stage6 三视图
        const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.cube_three_view_configs (starting_level, total_questions, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "shape_count") { // 平面数方块(数正方形/长方形，或自定义画图)
        const layout = (cfg.layout as string) === "custom" ? "custom" : "grid";
        if (layout === "custom") {
          const shapes = (cfg.shapes as unknown[]) ?? [];
          const objects = (cfg.objects as unknown[]) ?? [];
          if (!cfg.bg_image_url && shapes.length === 0 && objects.length === 0) throw new Error("自定义画图模式至少要加一个背景图、形状或物件");
          const { rows: cfgRows } = await client.query(
            `INSERT INTO edu.shape_count_configs (layout, bg_image_url, shapes, objects, timer_mode, time_limit, question_i18n)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [layout, cfg.bg_image_url ?? null, JSON.stringify(shapes), JSON.stringify(objects), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
          configId = cfgRows[0].id;
        } else {
          const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
          const { rows: cfgRows } = await client.query(
            `INSERT INTO edu.shape_count_configs (layout, ask_type, starting_level, total_questions, timer_mode, time_limit)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [layout, cfg.ask_type ?? "both", startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
          configId = cfgRows[0].id;
        }
      } else if (module_type === "clock") { // 认钟表——生成参数，没有素材图/隐藏答案
        const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.clock_configs (starting_level, total_questions, mode, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [startingLevel, cfg.total_questions ?? 5, cfg.mode ?? "both", cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "latin_square") { // 图形排排看——生成参数，没有素材图/隐藏答案
        const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.latin_square_configs (starting_level, total_questions, theme, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [startingLevel, cfg.total_questions ?? 5, cfg.theme ?? "shape", cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "number_find") { // 数字大搜寻——grid模式纯生成，custom模式的背景图/装饰物件是纯装饰authored内容
        const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
        const layout = (cfg.layout as string) === "custom" ? "custom" : "grid";
        if (layout === "custom" && !cfg.bg_image_url) throw new Error("自定义画面模式要先选一张背景图");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.number_find_configs (layout, bg_image_url, decorations, grid_area, target_count, number_min, number_max, starting_level, total_questions, timer_mode, time_limit, question_i18n)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [layout, cfg.bg_image_url ?? null, cfg.decorations ? JSON.stringify(cfg.decorations) : null, cfg.grid_area ? JSON.stringify(cfg.grid_area) : null,
           cfg.target_count ?? 1, cfg.number_min ?? 1, cfg.number_max ?? 10, startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
           cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "number_sequence") { // 数列填空——纯生成参数，没有素材图
        const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.number_sequence_configs (starting_level, total_questions, timer_mode, time_limit, question_i18n)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "number_bond") { // 数的分解与合成——icon_urls是designer上传的图标，数量/拆分是现场生成
        const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
        const iconUrls = cfg.icon_urls as string[] | undefined;
        if (!iconUrls?.length) throw new Error("请至少上传1张图标图片");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.number_bond_configs (icon_urls, number_min, number_max, starting_level, total_questions, timer_mode, time_limit, question_i18n)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [JSON.stringify(iconUrls), cfg.number_min ?? 2, cfg.number_max ?? 10, startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
           cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "number_compare") { // 数字比大小——icon_urls是designer上传的图标，两边数量/比较符号是现场生成
        const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
        const iconUrls = cfg.icon_urls as string[] | undefined;
        if (!iconUrls?.length) throw new Error("请至少上传1张图标图片");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.number_compare_configs (icon_urls, number_min, number_max, starting_level, total_questions, timer_mode, time_limit, question_i18n)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [JSON.stringify(iconUrls), cfg.number_min ?? 1, cfg.number_max ?? 10, startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
           cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "number_addition") { // 加法算式——icon_urls是designer上传的图标，两个加数/答案是现场生成
        const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
        const iconUrls = cfg.icon_urls as string[] | undefined;
        if (!iconUrls?.length) throw new Error("请至少上传1张图标图片");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.number_addition_configs (icon_urls, number_min, number_max, starting_level, total_questions, timer_mode, time_limit, question_i18n)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [JSON.stringify(iconUrls), cfg.number_min ?? 1, cfg.number_max ?? 5, startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
           cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "chinese_stroke") { // 中文字笔顺练习——characters是designer指定的固定字库，笔顺数据本身不存数据库(前端从自己的静态资源目录读)
        const characters = cfg.characters as string[] | undefined;
        if (!characters?.length) throw new Error("请至少输入1个字");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.chinese_stroke_configs (characters, total_questions, timer_mode, time_limit, question_i18n)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [JSON.stringify(characters), cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
           cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "multiple_choice") { // 选择题——一个Activity一题，options/correct_option_ids直接发给前端(答案本来就摆在选项里，藏不住)
        const options = cfg.options as Array<{ id: string; text_i18n: Record<string, string> }> | undefined;
        const correctIds = cfg.correct_option_ids as string[] | undefined;
        if (!options || options.length < 2) throw new Error("至少要有2个选项");
        if (!correctIds?.length) throw new Error("请至少勾选1个正确答案");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.multiple_choice_configs (bg_image_url, objects, texts, answer_mode, options, correct_option_ids, question_i18n, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [cfg.bg_image_url ?? null, cfg.objects ? JSON.stringify(cfg.objects) : null, cfg.texts ? JSON.stringify(cfg.texts) : null,
           (cfg.answer_mode as string) === "multi" ? "multi" : "single", JSON.stringify(options), JSON.stringify(correctIds),
           JSON.stringify(cfg.question_i18n ?? {}), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "fill_blank") { // 填充题——一个Activity一题，句子里"___"标记空的位置，blanks按顺序对应每个空的正确答案
        const blanks = cfg.blanks as Array<{ accepted_answers: string[] }> | undefined;
        if (!blanks?.length) throw new Error("至少要有1个空");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.fill_blank_configs (bg_image_url, objects, texts, sentence_i18n, blanks, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [cfg.bg_image_url ?? null, cfg.objects ? JSON.stringify(cfg.objects) : null, cfg.texts ? JSON.stringify(cfg.texts) : null,
           JSON.stringify(cfg.sentence_i18n ?? {}), JSON.stringify(blanks), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "cube_stack") { // 生成参数，不是authored内容——没有素材图/隐藏答案，题目运行时现场生成
        const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.cube_stack_configs (starting_level, total_questions, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4)
           RETURNING id`,
          [startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      } else { // sudoku — authored content，两种布局：
        // "photo"(旧，默认)——一张图+标记哪些格子留空+每格答案。
        // "grid"(新，SceneEditor"自己画网格"存出来的)——没有照片，网格
        // 本身是前端画的，given_cells(明摆着给学生看的数字)要发给前端
        // 才画得出来；blank_cells只送位置不送答案，答案还是只在
        // 服务器端，跟photo模式同一套"答案不下发"的安全模型。
        //
        // ⚠️ 这两种模式之前只有前端做了(SceneEditor里的网格编辑器)，
        // 后端一直没跟上、一律当成photo模式处理、强制要求bg_image_url，
        // 导致grid模式保存必定失败(报"bg_image_url is required for
        // sudoku")。这次补上分支处理，edu.sudoku_configs 那张表也补了
        // 迁移(0YB_sudoku_grid_mode.sql)加上grid模式需要的字段。
        const sudokuLayout = (cfg.layout as string) === "grid" ? "grid" : "photo";
        if (sudokuLayout === "grid") {
          const givenCells = cfg.given_cells as Array<{ row: number; col: number; value: string }> | undefined;
          const blankCells = cfg.blank_cells as Array<{ row: number; col: number; answer: string }> | undefined;
          if (!cfg.rows || !cfg.cols) throw new Error("请先在编辑器里画好网格");
          if (!blankCells?.length) throw new Error("至少要有1个留空的格子给学生填");
          if (blankCells.some((c) => !c.answer)) throw new Error("每个留空的格子都要填答案（1-9）");
          const { rows: cfgRows } = await client.query(
            `INSERT INTO edu.sudoku_configs (layout, rows, cols, given_cells, blank_cells, line_color, given_color, blank_bg, bg_color, bg_enabled, opacity, difficulty, timer_mode, time_limit, question_i18n)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             RETURNING id`,
            [sudokuLayout, cfg.rows, cfg.cols, JSON.stringify(givenCells ?? []), JSON.stringify(blankCells),
             cfg.line_color ?? null, cfg.given_color ?? null, cfg.blank_bg ?? null, cfg.bg_color ?? null,
             cfg.bg_enabled ?? null, cfg.opacity ?? null, cfg.difficulty ?? "medium", cfg.timer_mode ?? "stopwatch",
             cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
          configId = cfgRows[0].id;
        } else {
          const cells = cfg.cells as Array<{ x: number; y: number; answer: number }> | undefined;
          if (!cfg.bg_image_url) throw new Error("bg_image_url is required for sudoku");
          if (!cells?.length) throw new Error("至少要标记1个空格并填答案");
          if (cells.some((c) => !Number.isInteger(c.answer) || c.answer < 1 || c.answer > 9)) {
            throw new Error("每个空格的答案必须是1到9的数字");
          }
          const { rows: cfgRows } = await client.query(
            `INSERT INTO edu.sudoku_configs (layout, bg_image_url, cells, difficulty, timer_mode, time_limit, question_i18n)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING id`,
            [sudokuLayout, cfg.bg_image_url, JSON.stringify(cells), cfg.difficulty ?? "medium", cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
          configId = cfgRows[0].id;
        }
      }

      const { rows: levelRows } = await client.query(
        `INSERT INTO edu.course_levels
           (course_id, order_index, module_type, module_config_id, title_i18n, created_by, explanation_text, explanation_image_url, explanation_video_url,
            category_id, group_id, curriculum_type_id, exercise_number, hint_text, audio_url,
            activity_type, teaching_modes, difficulty, age_group_min, age_group_max, duration_minutes, learning_outcomes, skills_developed, language, tags,
            parent_preview_enabled, usage_contexts, self_guided_programme_ids, cover_image_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
         RETURNING id, course_id, order_index, module_type, module_config_id, title_i18n, explanation_text, explanation_image_url, explanation_video_url,
                   category_id, group_id, curriculum_type_id, exercise_number, hint_text, audio_url,
                   activity_type, teaching_modes, difficulty, age_group_min, age_group_max, duration_minutes, learning_outcomes, skills_developed, language, tags,
                   parent_preview_enabled, usage_contexts, self_guided_programme_ids, cover_image_url`,
        [courseId, order_index ?? 0, module_type, configId, title_i18n ? JSON.stringify(title_i18n) : null, req.user!.sub,
         explanation_text ?? null, explanation_image_url ?? null, explanation_video_url ?? null,
         primaryCategoryId, group_id ?? null, curriculum_type_id ?? null, exerciseNumber,
         hint_text ?? null, audio_url ?? null,
         activity_type ?? "game", teaching_modes ? JSON.stringify(teaching_modes) : "[]", difficulty ?? null,
         age_group_min ?? null, age_group_max ?? null, duration_minutes ?? null,
         learning_outcomes ?? null, JSON.stringify(normalizeSkillsList(skills_developed)), language ?? "universal", normalizeActivityTags(tags),
         parent_preview_enabled === true, normalizeUsageContexts(usage_contexts), normalizeProgrammeIds(self_guided_programme_ids), cover_image_url ?? null]
      );
      const newLevel = levelRows[0];

      // 多对多关联——一个 Activity 可以同时挂好几个 Topic，全部写进
      // activity_topic_links；上面 course_levels.category_id 那个旧栏位
      // 只留第一个当"主分类"，向后兼容还没改的读取逻辑。
      for (const cid of categoryIds) {
        await client.query(
          `INSERT INTO edu.activity_topic_links (course_level_id, category_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [newLevel.id, cid]
        );
      }
      newLevel.category_ids = categoryIds;

      return newLevel;
    });

    created(res, result);
  } catch (err) {
    // same distinction updateLevel uses — a validation throw new
    // Error(...) from one of the per-module checks above should reach the
    // user as a clear 400, not get swallowed into "Internal server error"
    // once this runs with NODE_ENV=production (serverError only echoes the
    // real message in development — see utils/response.ts)
    if (err instanceof Error && !("code" in err)) { badRequest(res, err.message); return; }
    serverError(res, err);
  }
}

// 新增：独立建 Activity，不挂在任何 Course 底下——路由挂
// POST /activities（不像 createLevel 原本那条 POST /courses/:courseId/levels
// 需要在 URL 里带 courseId）。底层跟 createLevel 是同一个函数：courseId
// 现在从路由参数或请求体读都行，两个都没有就是 null，这个别名单纯是让
// 路由注册的地方语义读起来更清楚。
export const createActivity = createLevel;

// 编辑已经建好的习题 — this didn't exist at all until now: once created,
// a level could never be changed, only deleted-and-recreated (and deletion
// didn't exist either — see deleteLevel below). module_type is fixed once
// created (switching counting into maze isn't an "edit", it's a different
// exercise with a different config shape entirely) — everything else,
// including the full module-specific config, can be updated. Does NOT
// retroactively renumber an exercise that already has a number:
// renumbering something a designer is just fixing a typo on would be a
// bigger surprise than leaving it alone, same reasoning as why editing a
// category's prefix doesn't retroactively renumber existing exercises
// either. But an exercise that was created WITHOUT a Topic (and so never
// got a number at all — Topic is optional at creation) DOES get one
// generated the first time a Topic gets added via edit — that's not
// renumbering, it's numbering for the first time, a different situation
// with different expectations; see shouldGenerateNumber below.
export async function updateLevel(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { levelId } = req.params;
    const {
      title_i18n, config, explanation_text, explanation_image_url, explanation_video_url,
      category_id, category_ids, group_id, curriculum_type_id, hint_text, audio_url,
      activity_type, teaching_modes, difficulty, age_group_min, age_group_max, duration_minutes,
      learning_outcomes, skills_developed, language, tags, parent_preview_enabled,
      usage_contexts, self_guided_programme_ids, cover_image_url,
    } = req.body as {
      title_i18n?: object; config?: Record<string, unknown>;
      explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
      category_id?: string; category_ids?: string[]; group_id?: string; curriculum_type_id?: string;
      hint_text?: string; audio_url?: string;
      activity_type?: string; teaching_modes?: string[]; difficulty?: string;
      age_group_min?: number; age_group_max?: number; duration_minutes?: number;
      learning_outcomes?: string; skills_developed?: string[]; language?: string; tags?: string[];
      parent_preview_enabled?: boolean;
      usage_contexts?: string[]; self_guided_programme_ids?: string[];
      cover_image_url?: string;
    };
    // 注意：这里不像 createLevel 那样强制要求 Topic ——那个是"新建
    // Activity时必须先确定Topic"，这里如果本来就没有Topic（比如这个功能
    // 上线之前建的老 Activity），编辑其他内容（比如改个错字）不应该被
    // 卡住、逼着先补分类。categoryIdsProvided 区分"这次请求根本没带
    // category_ids/category_id 这两个字段"（不动关联）vs"带了、哪怕是
    // 空数组"（表示要把 Topic 关联换成这个新的集合，空数组=清空全部）。
    const categoryIdsProvided = category_ids !== undefined || category_id !== undefined;
    const categoryIds = categoryIdsProvided
      ? Array.from(new Set((category_ids && category_ids.length ? category_ids : (category_id ? [category_id] : [])).filter(Boolean)))
      : [];
    const primaryCategoryId = categoryIds[0] ?? null;

    const { rows: existingRows } = await query(
      `SELECT module_type, module_config_id, exercise_number FROM edu.course_levels WHERE id = $1`,
      [levelId]
    );
    if (!existingRows.length) { notFound(res, "Level not found"); return; }
    const { module_type, module_config_id, exercise_number: existingExerciseNumber } = existingRows[0] as { module_type: string; module_config_id: string; exercise_number: string | null };

    // 如果这个 Activity 从来没有过编号（建立的时候还没选 Topic，所以当时
    // 没生成），现在编辑时补上了 Topic，就该顺便把编号也生成出来——
    // 这不是"重新编号"（那种情况上面的注释说了刻意不做，避免打乱已经在用
    // 的编号），是"第一次有条件生成"，两者是不同的事。已经有编号的
    // Activity，这里不会去动它，边界条件只在"之前是null、现在有了
    // Topic"这一种情况下才触发。
    const shouldGenerateNumber = !existingExerciseNumber && primaryCategoryId;
    const newExerciseNumber = shouldGenerateNumber ? await nextExerciseNumber(primaryCategoryId, group_id ?? null) : null;

    await withTransaction(async (client) => {
      if (config) {
        const cfg = config;
        if (module_type === "counting") {
          if (cfg.mode === "custom_scene") {
            const positions = cfg.positions as Array<{ image_url?: string }> | undefined;
            const hasFallbackIcon = !!cfg.custom_icon_url;
            const everyPositionHasOwnImage = positions?.every((p) => !!p.image_url) ?? false;
            if (!cfg.bg_image_url || !positions?.length || !(hasFallbackIcon || everyPositionHasOwnImage)) {
              throw new Error("custom_scene 模式的点点数数需要背景图、至少1个物件，每个物件要有图片（自己的图片，或者一个共用的物件图片）");
            }
          }
          await client.query(
            `UPDATE edu.counting_configs SET
               theme=$2, custom_icon_url=$3, bg_image_url=$4, min_val=$5, max_val=$6, quiz_mode=$7,
               num_choices=$8, total_questions=$9, timer_mode=$10, time_limit=$11, mode=$12, positions=$13, texts=$14,
               target_types=$15, question_i18n=$16
             WHERE id=$1`,
            [
              module_config_id, cfg.theme ?? "apple", cfg.custom_icon_url ?? null, cfg.bg_image_url ?? null,
              cfg.min_val ?? 1, cfg.max_val ?? 10, cfg.quiz_mode ?? "select",
              cfg.num_choices ?? 3, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
              cfg.mode ?? "random", cfg.positions ? JSON.stringify(cfg.positions) : null, cfg.texts ? JSON.stringify(cfg.texts) : null,
              cfg.target_types ? JSON.stringify(cfg.target_types) : null,
              cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null,
            ]
          );
        } else if (module_type === "spot_diff") {
          if (!cfg.image_a_url || !cfg.image_b_url) throw new Error("image_a_url and image_b_url are required for spot_diff");
          await client.query(
            `UPDATE edu.spot_diff_configs SET image_a_url=$2, image_b_url=$3, hotspots=$4, timer_mode=$5, time_limit=$6, question_i18n=$7 WHERE id=$1`,
            [module_config_id, cfg.image_a_url, cfg.image_b_url, JSON.stringify(cfg.hotspots ?? []), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
        } else if (module_type === "focus_tap") {
          if (cfg.mode === "custom" && (!cfg.bg_image_url || !cfg.positions || (cfg.positions as unknown[]).length < 2)) {
            throw new Error("custom 模式的专注力点数字需要背景图和至少2个标记位置");
          }
          await client.query(
            `UPDATE edu.focus_tap_configs SET mode=$2, grid_size=$3, bg_image_url=$4, positions=$5, timer_mode=$6, time_limit=$7, question_i18n=$8 WHERE id=$1`,
            [module_config_id, cfg.mode ?? "grid", cfg.grid_size ?? 4, cfg.bg_image_url ?? null,
             cfg.positions ? JSON.stringify(cfg.positions) : null, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
             cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
        } else if (module_type === "memory") {
          if (cfg.theme === "custom" && (!(cfg.custom_icons as unknown[])?.length || (cfg.custom_icons as unknown[]).length < 2)) {
            throw new Error("custom 主题的Memory配对需要至少2张自定义图片");
          }
          await client.query(
            `UPDATE edu.memory_configs SET theme=$2, custom_icons=$3, bg_image_url=$4, pairs_count=$5, preview_seconds=$6, timer_mode=$7, time_limit=$8, question_i18n=$9, layout=$10, positions=$11 WHERE id=$1`,
            [module_config_id, cfg.theme ?? "animal", cfg.custom_icons ? JSON.stringify(cfg.custom_icons) : null, cfg.bg_image_url ?? null,
             cfg.pairs_count ?? 6, cfg.preview_seconds ?? 3, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
             cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null,
             cfg.layout ?? "grid", cfg.positions ? JSON.stringify(cfg.positions) : null]
          );
        } else if (module_type === "pattern") {
          await client.query(
            `UPDATE edu.pattern_configs SET theme=$2, pattern_types=$3, seq_length=$4, num_choices=$5, total_questions=$6, timer_mode=$7, time_limit=$8, question_i18n=$9 WHERE id=$1`,
            [module_config_id, cfg.theme ?? "shape", JSON.stringify(cfg.pattern_types ?? ["AB","ABC","AAB","ABB","AABB"]),
             cfg.seq_length ?? 7, cfg.num_choices ?? 3, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
             cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
        } else if (module_type === "word_problem") {
          if (cfg.mode === "custom_scene") {
            if (!cfg.bg_image_url) throw new Error("自定义应用题需要背景图");
            if (!cfg.problem_text || !cfg.question_text) throw new Error("自定义应用题需要题目文字和问题");
            if (cfg.custom_answer === undefined || cfg.custom_answer === null) throw new Error("自定义应用题需要填正确答案");
          }
          await client.query(
            `UPDATE edu.word_problem_configs SET
               categories=$2, answer_mode=$3, num_choices=$4, total_questions=$5, chicken_min=$6, chicken_max=$7,
               speed_min=$8, speed_max=$9, meet_time_min=$10, meet_time_max=$11, timer_mode=$12, time_limit=$13,
               mode=$14, bg_image_url=$15, objects=$16, texts=$17, problem_text=$18, question_text=$19, custom_answer=$20, unit=$21
             WHERE id=$1`,
            [
              module_config_id, JSON.stringify(cfg.categories ?? ["chicken_rabbit"]), cfg.answer_mode ?? "select",
              cfg.num_choices ?? 3, cfg.total_questions ?? 5,
              cfg.chicken_min ?? 1, cfg.chicken_max ?? 30, cfg.speed_min ?? 3, cfg.speed_max ?? 15,
              cfg.meet_time_min ?? 2, cfg.meet_time_max ?? 10, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
              cfg.mode ?? "random", cfg.bg_image_url ?? null,
              cfg.objects ? JSON.stringify(cfg.objects) : null, cfg.texts ? JSON.stringify(cfg.texts) : null,
              cfg.problem_text ?? null, cfg.question_text ?? null, cfg.custom_answer ?? null, cfg.unit ?? null,
            ]
          );
        } else if (module_type === "maze") {
          if (!cfg.bg_image_url || !cfg.mask_image_url) throw new Error("bg_image_url and mask_image_url are required for maze");
          await client.query(
            `UPDATE edu.maze_configs SET bg_image_url=$2, mask_image_url=$3, start_x=$4, start_y=$5, end_x=$6, end_y=$7, timer_mode=$8, time_limit=$9, question_i18n=$10, pairs=$11 WHERE id=$1`,
            [module_config_id, cfg.bg_image_url, cfg.mask_image_url,
             cfg.start_x ?? 0.1, cfg.start_y ?? 0.5, cfg.end_x ?? 0.9, cfg.end_y ?? 0.5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
             cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null,
             cfg.pairs ? JSON.stringify(cfg.pairs) : null]
          );
        } else if (module_type === "coloring") {
          const regions = cfg.regions as Array<{ marker_color: string; rule: "specific" | "free"; target_color?: string; label?: string }> | undefined;
          if (!cfg.bg_image_url || !cfg.region_mask_url) throw new Error("bg_image_url and region_mask_url are required for coloring");
          if (!regions?.length) throw new Error("至少要标记1个区块");
          if (regions.some((r) => r.rule === "specific" && !r.target_color)) throw new Error("选了「指定颜色」的区块，要填要求的颜色");
          await client.query(
            `UPDATE edu.coloring_configs SET bg_image_url=$2, region_mask_url=$3, regions=$4, timer_mode=$5, time_limit=$6, question_i18n=$7 WHERE id=$1`,
            [module_config_id, cfg.bg_image_url, cfg.region_mask_url, JSON.stringify(regions), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
        } else if (module_type === "line_match") {
          const layout = (cfg.layout as string) === "scene" ? "scene" : "list";
          if (layout === "scene") {
            const objects = cfg.objects as Array<{ image_url: string; x: number; y: number; w: number; h: number; rotation: number; pair_key?: string; flip_x?: boolean; flip_y?: boolean; opacity?: number }> | undefined;
            if (!objects?.length) throw new Error("自定义画面模式至少要摆1个物件");
            const byKey = new Map<string, number>();
            objects.forEach((o) => { const k = (o.pair_key ?? "").trim(); byKey.set(k, (byKey.get(k) ?? 0) + 1); });
            if (byKey.has("")) throw new Error("每个物件都要填「配对标记」，不能留空");
            const solo = [...byKey.entries()].filter(([, c]) => c < 2).map(([k]) => k);
            if (solo.length > 0) throw new Error(`配对标记「${solo.join("、")}」只有1个物件，至少要2个才能连线`);
            await client.query(
              // 切layout的话把另一边(list那几栏)清掉，避免留着旧数据混淆
              `UPDATE edu.line_match_configs SET layout=$2, bg_image_url=$3, objects=$4, left_items=NULL, right_items=NULL, edges=NULL, timer_mode=$5, time_limit=$6, question_i18n=$7 WHERE id=$1`,
              [module_config_id, layout, cfg.bg_image_url ?? null, JSON.stringify(objects), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
            );
          } else {
            const leftItems = cfg.left_items as Array<{ id: string; type: string; content: string }> | undefined;
            const rightItems = cfg.right_items as Array<{ id: string; type: string; content: string }> | undefined;
            const edges = cfg.edges as Array<{ leftId: string; rightId: string }> | undefined;
            if (!leftItems?.length || !rightItems?.length) throw new Error("左右两边至少各要有1个物件，内容不能空着");
            if (!edges?.length) throw new Error("至少要连1条线");
            await client.query(
              `UPDATE edu.line_match_configs SET layout=$2, left_items=$3, right_items=$4, edges=$5, bg_image_url=NULL, objects=NULL, shuffle_right=$6, timer_mode=$7, time_limit=$8, question_i18n=$9 WHERE id=$1`,
              [module_config_id, layout, JSON.stringify(leftItems), JSON.stringify(rightItems), JSON.stringify(edges), cfg.shuffle_right ?? true, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
            );
          }
        } else if (module_type === "ppt_lecture") {
          const slideUrls = cfg.slide_image_urls as string[] | undefined;
          if (!slideUrls?.length) throw new Error("请先上传并转换 PPT，至少要有1页幻灯片");
          await client.query(
            `UPDATE edu.ppt_lecture_configs SET slide_image_urls=$2, original_filename=$3 WHERE id=$1`,
            [module_config_id, JSON.stringify(slideUrls), cfg.original_filename ?? null]
          );
        } else if (module_type === "video_lecture") {
          if (!cfg.video_url) throw new Error("请填视频链接或上传视频");
          await client.query(
            `UPDATE edu.video_lecture_configs SET video_url=$2, poster_image_url=$3 WHERE id=$1`,
            [module_config_id, cfg.video_url, cfg.poster_image_url ?? null]
          );
        } else if (module_type === "play_along") {
          const markers = cfg.markers as unknown[] | undefined;
          if (!(cfg.sheet_image_urls as unknown[])?.length) throw new Error("请先上传乐谱图片");
          if (!cfg.audio_url) throw new Error("请上传或选择音频");
          if (!markers || markers.length < 2) throw new Error("至少要打2个时间标记");
          if (!cfg.original_bpm || (cfg.original_bpm as number) < 1) throw new Error("请填这首曲子的原速 BPM");
          await client.query(
            `UPDATE edu.play_along_configs SET sheet_image_urls=$2, original_filename=$3, audio_url=$4, markers=$5, original_bpm=$6 WHERE id=$1`,
            [module_config_id, JSON.stringify(cfg.sheet_image_urls), cfg.original_filename ?? null, cfg.audio_url, JSON.stringify(markers), cfg.original_bpm]
          );
        } else if (module_type === "number_maze") {
          if (cfg.layout === "grid") {
            const path = cfg.path as Array<{ row: number; col: number }> | undefined;
            if (!(cfg.cells as unknown[])?.length) throw new Error("请先画好网格、填好数字");
            if (!path || path.length < 2) throw new Error("至少要标2个格子的路径顺序");
            await client.query(
              `UPDATE edu.number_maze_configs SET layout=$2, rows=$3, cols=$4, cells=$5, path=$6, line_color=$7, given_color=$8, bg_color=$9, bg_enabled=$10, opacity=$11, timer_mode=$12, time_limit=$13, question_i18n=$14,
                 bg_image_url=NULL, mask_image_url=NULL, start_x=NULL, start_y=NULL, end_x=NULL, end_y=NULL, decision_points=NULL
               WHERE id=$1`,
              [
                module_config_id, "grid", cfg.rows, cfg.cols, JSON.stringify(cfg.cells), JSON.stringify(path),
                cfg.line_color ?? null, cfg.given_color ?? null, cfg.bg_color ?? null, cfg.bg_enabled ?? false, cfg.opacity ?? null,
                cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null,
              ]
            );
          } else {
            const decisionPoints = cfg.decision_points as Array<{ options: Array<{ value: string }> }> | undefined;
            if (!cfg.bg_image_url || !cfg.mask_image_url) throw new Error("背景图和可走路径都是必须的");
            if (!cfg.start || !cfg.end) throw new Error("请设好起点和终点");
            if (decisionPoints?.some((d) => d.options.some((o) => !o.value?.trim()))) throw new Error("每个分岔点的每个选项都要填数字");
            await client.query(
              `UPDATE edu.number_maze_configs SET layout=$2, bg_image_url=$3, mask_image_url=$4, start_x=$5, start_y=$6, end_x=$7, end_y=$8, decision_points=$9, timer_mode=$10, time_limit=$11, question_i18n=$12,
                 rows=NULL, cols=NULL, cells=NULL, path=NULL
               WHERE id=$1`,
              [
                module_config_id, "path", cfg.bg_image_url, cfg.mask_image_url,
                (cfg.start as { x: number }).x, (cfg.start as { y: number }).y,
                (cfg.end as { x: number }).x, (cfg.end as { y: number }).y,
                JSON.stringify(decisionPoints ?? []), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
                cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null,
              ]
            );
          }
        } else if (module_type === "sticker_game") {
          const objects = cfg.objects as unknown[] | undefined;
          if (!cfg.bg_image_url) throw new Error("请先选背景图片");
          if (!objects?.length) throw new Error("请至少放1个贴纸");
          await client.query(
            `UPDATE edu.sticker_game_configs SET bg_image_url=$2, objects=$3, timer_mode=$4, time_limit=$5, question_i18n=$6 WHERE id=$1`,
            [module_config_id, cfg.bg_image_url, JSON.stringify(objects), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
        } else if (module_type === "drag_drop") {
          const mode = (cfg.mode as string) || "position_target";
          if (mode !== "position_target") throw new Error(`drag_drop 的 "${mode}" 玩法还在开发中，目前只支持 position_target`);
          const objects = cfg.objects as unknown[] | undefined;
          if (!cfg.bg_image_url) throw new Error("请先选背景图片");
          if (!objects?.length) throw new Error("请至少放1个物件");
          await client.query(
            `UPDATE edu.drag_drop_configs SET mode=$2, bg_image_url=$3, objects=$4, timer_mode=$5, time_limit=$6, question_i18n=$7 WHERE id=$1`,
            [module_config_id, mode, cfg.bg_image_url, JSON.stringify(objects), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
        } else if (module_type === "cube_layer_count") {
          const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
          await client.query(
            `UPDATE edu.cube_layer_count_configs SET starting_level=$2, total_questions=$3, max_split_layers=$4, timer_mode=$5, time_limit=$6 WHERE id=$1`,
            [module_config_id, startingLevel, cfg.total_questions ?? 5, cfg.max_split_layers ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else if (module_type === "cube_find_hidden") {
          const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
          await client.query(
            `UPDATE edu.cube_find_hidden_configs SET starting_level=$2, total_questions=$3, hidden_targets=$4, timer_mode=$5, time_limit=$6 WHERE id=$1`,
            [module_config_id, startingLevel, cfg.total_questions ?? 5, cfg.hidden_targets ?? 1, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else if (module_type === "cube_free_rotate") {
          await client.query(
            `UPDATE edu.cube_free_rotate_configs SET total_shapes=$2, shape_size=$3, min_view_seconds=$4, timer_mode=$5, time_limit=$6 WHERE id=$1`,
            [module_config_id, cfg.total_shapes ?? 3, cfg.shape_size ?? 3, cfg.min_view_seconds ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else if (module_type === "cube_build") {
          const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
          await client.query(
            `UPDATE edu.cube_build_configs SET starting_level=$2, total_questions=$3, timer_mode=$4, time_limit=$5 WHERE id=$1`,
            [module_config_id, startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else if (module_type === "cube_three_view") {
          const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
          await client.query(
            `UPDATE edu.cube_three_view_configs SET starting_level=$2, total_questions=$3, timer_mode=$4, time_limit=$5 WHERE id=$1`,
            [module_config_id, startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else if (module_type === "shape_count") {
          const layout = (cfg.layout as string) === "custom" ? "custom" : "grid";
          if (layout === "custom") {
            const shapes = (cfg.shapes as unknown[]) ?? [];
            const objects = (cfg.objects as unknown[]) ?? [];
            if (!cfg.bg_image_url && shapes.length === 0 && objects.length === 0) throw new Error("自定义画图模式至少要加一个背景图、形状或物件");
            await client.query(
              `UPDATE edu.shape_count_configs SET layout=$2, bg_image_url=$3, shapes=$4, objects=$5, ask_type='both', starting_level=1, total_questions=5, timer_mode=$6, time_limit=$7, question_i18n=$8 WHERE id=$1`,
              [module_config_id, layout, cfg.bg_image_url ?? null, JSON.stringify(shapes), JSON.stringify(objects), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
            );
          } else {
            const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
            await client.query(
              `UPDATE edu.shape_count_configs SET layout=$2, ask_type=$3, starting_level=$4, total_questions=$5, timer_mode=$6, time_limit=$7, bg_image_url=NULL, shapes=NULL, objects=NULL WHERE id=$1`,
              [module_config_id, layout, cfg.ask_type ?? "both", startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
            );
          }
        } else if (module_type === "clock") {
          const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
          await client.query(
            `UPDATE edu.clock_configs SET starting_level=$2, total_questions=$3, mode=$4, timer_mode=$5, time_limit=$6 WHERE id=$1`,
            [module_config_id, startingLevel, cfg.total_questions ?? 5, cfg.mode ?? "both", cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else if (module_type === "latin_square") {
          const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
          await client.query(
            `UPDATE edu.latin_square_configs SET starting_level=$2, total_questions=$3, theme=$4, timer_mode=$5, time_limit=$6 WHERE id=$1`,
            [module_config_id, startingLevel, cfg.total_questions ?? 5, cfg.theme ?? "shape", cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else if (module_type === "number_find") {
          const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
          const layout = (cfg.layout as string) === "custom" ? "custom" : "grid";
          if (layout === "custom" && !cfg.bg_image_url) throw new Error("自定义画面模式要先选一张背景图");
          await client.query(
            `UPDATE edu.number_find_configs SET layout=$2, bg_image_url=$3, decorations=$4, grid_area=$5, target_count=$6, number_min=$7, number_max=$8, starting_level=$9, total_questions=$10, timer_mode=$11, time_limit=$12, question_i18n=$13 WHERE id=$1`,
            [module_config_id, layout, cfg.bg_image_url ?? null, cfg.decorations ? JSON.stringify(cfg.decorations) : null, cfg.grid_area ? JSON.stringify(cfg.grid_area) : null,
             cfg.target_count ?? 1, cfg.number_min ?? 1, cfg.number_max ?? 10, startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
             cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
        } else if (module_type === "number_sequence") {
          const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
          await client.query(
            `UPDATE edu.number_sequence_configs SET starting_level=$2, total_questions=$3, timer_mode=$4, time_limit=$5, question_i18n=$6 WHERE id=$1`,
            [module_config_id, startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
        } else if (module_type === "number_bond") {
          const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
          const iconUrls = cfg.icon_urls as string[] | undefined;
          if (!iconUrls?.length) throw new Error("请至少上传1张图标图片");
          await client.query(
            `UPDATE edu.number_bond_configs SET icon_urls=$2, number_min=$3, number_max=$4, starting_level=$5, total_questions=$6, timer_mode=$7, time_limit=$8, question_i18n=$9 WHERE id=$1`,
            [module_config_id, JSON.stringify(iconUrls), cfg.number_min ?? 2, cfg.number_max ?? 10, startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
             cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
        } else if (module_type === "number_compare") {
          const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
          const iconUrls = cfg.icon_urls as string[] | undefined;
          if (!iconUrls?.length) throw new Error("请至少上传1张图标图片");
          await client.query(
            `UPDATE edu.number_compare_configs SET icon_urls=$2, number_min=$3, number_max=$4, starting_level=$5, total_questions=$6, timer_mode=$7, time_limit=$8, question_i18n=$9 WHERE id=$1`,
            [module_config_id, JSON.stringify(iconUrls), cfg.number_min ?? 1, cfg.number_max ?? 10, startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
             cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
        } else if (module_type === "number_addition") {
          const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
          const iconUrls = cfg.icon_urls as string[] | undefined;
          if (!iconUrls?.length) throw new Error("请至少上传1张图标图片");
          await client.query(
            `UPDATE edu.number_addition_configs SET icon_urls=$2, number_min=$3, number_max=$4, starting_level=$5, total_questions=$6, timer_mode=$7, time_limit=$8, question_i18n=$9 WHERE id=$1`,
            [module_config_id, JSON.stringify(iconUrls), cfg.number_min ?? 1, cfg.number_max ?? 5, startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
             cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
        } else if (module_type === "chinese_stroke") {
          const characters = cfg.characters as string[] | undefined;
          if (!characters?.length) throw new Error("请至少输入1个字");
          await client.query(
            `UPDATE edu.chinese_stroke_configs SET characters=$2, total_questions=$3, timer_mode=$4, time_limit=$5, question_i18n=$6 WHERE id=$1`,
            [module_config_id, JSON.stringify(characters), cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
             cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
          );
        } else if (module_type === "multiple_choice") {
          const options = cfg.options as Array<{ id: string; text_i18n: Record<string, string> }> | undefined;
          const correctIds = cfg.correct_option_ids as string[] | undefined;
          if (!options || options.length < 2) throw new Error("至少要有2个选项");
          if (!correctIds?.length) throw new Error("请至少勾选1个正确答案");
          await client.query(
            `UPDATE edu.multiple_choice_configs SET bg_image_url=$2, objects=$3, texts=$4, answer_mode=$5, options=$6, correct_option_ids=$7, question_i18n=$8, timer_mode=$9, time_limit=$10 WHERE id=$1`,
            [module_config_id, cfg.bg_image_url ?? null, cfg.objects ? JSON.stringify(cfg.objects) : null, cfg.texts ? JSON.stringify(cfg.texts) : null,
             (cfg.answer_mode as string) === "multi" ? "multi" : "single", JSON.stringify(options), JSON.stringify(correctIds),
             JSON.stringify(cfg.question_i18n ?? {}), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else if (module_type === "fill_blank") {
          const blanks = cfg.blanks as Array<{ accepted_answers: string[] }> | undefined;
          if (!blanks?.length) throw new Error("至少要有1个空");
          await client.query(
            `UPDATE edu.fill_blank_configs SET bg_image_url=$2, objects=$3, texts=$4, sentence_i18n=$5, blanks=$6, timer_mode=$7, time_limit=$8 WHERE id=$1`,
            [module_config_id, cfg.bg_image_url ?? null, cfg.objects ? JSON.stringify(cfg.objects) : null, cfg.texts ? JSON.stringify(cfg.texts) : null,
             JSON.stringify(cfg.sentence_i18n ?? {}), JSON.stringify(blanks), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else if (module_type === "cube_stack") {
          const startingLevel = Math.min(10, Math.max(1, (cfg.starting_level as number) ?? 1));
          await client.query(
            `UPDATE edu.cube_stack_configs SET starting_level=$2, total_questions=$3, timer_mode=$4, time_limit=$5 WHERE id=$1`,
            [module_config_id, startingLevel, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else { // sudoku
          const sudokuLayout = (cfg.layout as string) === "grid" ? "grid" : "photo";
          if (sudokuLayout === "grid") {
            const givenCells = cfg.given_cells as Array<{ row: number; col: number; value: string }> | undefined;
            const blankCells = cfg.blank_cells as Array<{ row: number; col: number; answer: string }> | undefined;
            if (!cfg.rows || !cfg.cols) throw new Error("请先在编辑器里画好网格");
            if (!blankCells?.length) throw new Error("至少要有1个留空的格子给学生填");
            if (blankCells.some((c) => !c.answer)) throw new Error("每个留空的格子都要填答案（1-9）");
            // 切换成grid模式时，顺手把photo模式那两个字段清空(bg_image_url/
            // cells)，不然编辑器如果之前存过photo模式的数据，会留着一份
            // 没人用得到的旧图片网址混在数据库里。
            await client.query(
              `UPDATE edu.sudoku_configs SET layout=$2, bg_image_url=NULL, cells=NULL, rows=$3, cols=$4, given_cells=$5, blank_cells=$6, line_color=$7, given_color=$8, blank_bg=$9, bg_color=$10, bg_enabled=$11, opacity=$12, difficulty=$13, timer_mode=$14, time_limit=$15, question_i18n=$16 WHERE id=$1`,
              [module_config_id, sudokuLayout, cfg.rows, cfg.cols, JSON.stringify(givenCells ?? []), JSON.stringify(blankCells),
               cfg.line_color ?? null, cfg.given_color ?? null, cfg.blank_bg ?? null, cfg.bg_color ?? null,
               cfg.bg_enabled ?? null, cfg.opacity ?? null, cfg.difficulty ?? "medium", cfg.timer_mode ?? "stopwatch",
               cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
            );
          } else {
            const cells = cfg.cells as Array<{ x: number; y: number; answer: number }> | undefined;
            if (!cfg.bg_image_url) throw new Error("bg_image_url is required for sudoku");
            if (!cells?.length) throw new Error("至少要标记1个空格并填答案");
            if (cells.some((c) => !Number.isInteger(c.answer) || c.answer < 1 || c.answer > 9)) {
              throw new Error("每个空格的答案必须是1到9的数字");
            }
            // 切换回photo模式时，同样清空grid模式那些字段。
            await client.query(
              `UPDATE edu.sudoku_configs SET layout=$2, bg_image_url=$3, cells=$4, rows=NULL, cols=NULL, given_cells=NULL, blank_cells=NULL, difficulty=$5, timer_mode=$6, time_limit=$7, question_i18n=$8 WHERE id=$1`,
              [module_config_id, sudokuLayout, cfg.bg_image_url, JSON.stringify(cells), cfg.difficulty ?? "medium", cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null, cfg.question_i18n ? JSON.stringify(cfg.question_i18n) : null]
            );
          }
        }
      }

      await client.query(
        `UPDATE edu.course_levels SET
           title_i18n = COALESCE($2, title_i18n),
           explanation_text = $3, explanation_image_url = $4, explanation_video_url = $5,
           category_id = COALESCE($6, category_id), group_id = $7, curriculum_type_id = $8,
           hint_text = $9, audio_url = $10,
           activity_type = COALESCE($11, activity_type), difficulty = COALESCE($12, difficulty),
           age_group_min = COALESCE($13, age_group_min), age_group_max = COALESCE($14, age_group_max),
           duration_minutes = COALESCE($15, duration_minutes), learning_outcomes = COALESCE($16, learning_outcomes),
           language = COALESCE($17, language),
           teaching_modes = $18, skills_developed = $19, tags = $20,
           exercise_number = COALESCE($21, exercise_number),
           parent_preview_enabled = COALESCE($22, parent_preview_enabled),
           usage_contexts = $23, self_guided_programme_ids = $24, cover_image_url = $25
         WHERE id = $1`,
        [
          levelId, title_i18n ? JSON.stringify(title_i18n) : null,
          explanation_text ?? null, explanation_image_url ?? null, explanation_video_url ?? null,
          primaryCategoryId, group_id ?? null, curriculum_type_id ?? null,
          hint_text ?? null, audio_url ?? null,
          activity_type ?? null, difficulty ?? null,
          age_group_min ?? null, age_group_max ?? null, duration_minutes ?? null, learning_outcomes ?? null,
          language ?? null,
          JSON.stringify(teaching_modes ?? []), JSON.stringify(normalizeSkillsList(skills_developed)), normalizeActivityTags(tags),
          newExerciseNumber,
          typeof parent_preview_enabled === "boolean" ? parent_preview_enabled : null,
          normalizeUsageContexts(usage_contexts), normalizeProgrammeIds(self_guided_programme_ids),
          cover_image_url ?? null,
        ]
      );

      // 只在这次请求确实带了 category_ids/category_id 时才替换关联——
      // 没带的话（比如只是改个错字）保留原来挂的那些 Topic 不动。带了
      // 就整个替换成新的集合（空数组=清空全部）。
      if (categoryIdsProvided) {
        await client.query(`DELETE FROM edu.activity_topic_links WHERE course_level_id = $1`, [levelId]);
        for (const cid of categoryIds) {
          await client.query(
            `INSERT INTO edu.activity_topic_links (course_level_id, category_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
            [levelId, cid]
          );
        }
      }
    });

    ok(res, { id: levelId }, "Updated");
  } catch (err) {
    // distinguishes a validation throw new Error(...) from inside this
    // function (surface the message, it's meant to be read) from a real
    // database error (which has a `.code` property from pg — those stay
    // generic 500s, same as everywhere else)
    if (err instanceof Error && !("code" in err)) { badRequest(res, err.message); return; }
    serverError(res, err);
  }
}

// 删除习题 — didn't exist either. Blocked by the FK from
// edu.progress_records / edu.assignments if any student has already
// played or been assigned this exercise — same "let Postgres's own
// constraint say no, surface it clearly" pattern as deleting an
// exercise-classification group.
export async function deleteLevel(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { levelId } = req.params;
    await query(`DELETE FROM edu.course_levels WHERE id = $1`, [levelId]);
    ok(res, null, "Deleted");
  } catch (err) {
    const e = err as { code?: string };
    if (e?.code === "23503") { badRequest(res, "已经有学生玩过或被指派了这个习题，没办法删除——可以考虑保留但不再使用"); return; }
    serverError(res, err);
  }
}

// Fetches a level plus its full module config, ready for the student-side
// level player to render. The shape of `config` depends entirely on
// module_type — the frontend switches on that field to know which engine
// component to mount and what props to pass it.
// 把"根据 module_type 查对应配置表、拼出完整播放内容"这部分从 getLevel
// 里抽出来——分享模式(shareLinks.controller.ts#getSharedActivity)要复用
// 一模一样的逻辑，但不走上面那套订阅/年级/家长试玩权限检查(公开分享
// token本身就是授权凭证)，抽成独立函数两边共用，不然这275行的
// module_type大分支就要维护两份、改一处忘了改另一处。
export async function buildLevelPayload(level: Record<string, unknown>): Promise<Record<string, unknown>> {
    let config = null;
    if (level.module_type === "counting") {
      const { rows: cfgRows } = await query(
        `SELECT theme, custom_icon_url, bg_image_url, min_val, max_val,
                quiz_mode, num_choices, total_questions, timer_mode, time_limit, mode, positions, texts,
                target_types, question_i18n
         FROM edu.counting_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "spot_diff") {
      const { rows: cfgRows } = await query(
        `SELECT image_a_url, image_b_url, hotspots, timer_mode, time_limit, question_i18n
         FROM edu.spot_diff_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "focus_tap") {
      const { rows: cfgRows } = await query(
        `SELECT mode, grid_size, bg_image_url, positions, timer_mode, time_limit, question_i18n
         FROM edu.focus_tap_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "memory") {
      const { rows: cfgRows } = await query(
        `SELECT theme, custom_icons, bg_image_url, pairs_count, preview_seconds, timer_mode, time_limit, question_i18n, layout, positions
         FROM edu.memory_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "pattern") {
      const { rows: cfgRows } = await query(
        `SELECT theme, pattern_types, seq_length, num_choices, total_questions, timer_mode, time_limit, question_i18n
         FROM edu.pattern_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "word_problem") {
      const { rows: cfgRows } = await query(
        `SELECT categories, answer_mode, num_choices, total_questions,
                chicken_min, chicken_max, speed_min, speed_max, meet_time_min, meet_time_max,
                timer_mode, time_limit, mode, bg_image_url, objects, texts, problem_text, question_text, unit
         FROM edu.word_problem_configs WHERE id = $1`,
        [level.module_config_id]
      );
      // 隐藏的答案 — same reasoning as sudoku: custom_answer must not reach
      // a student before they've submitted. This SELECT doesn't even
      // fetch custom_answer, so there's nothing to strip after the fact —
      // it's just never in the row to begin with.
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "maze") {
      const { rows: cfgRows } = await query(
        `SELECT bg_image_url, mask_image_url, start_x, start_y, end_x, end_y, timer_mode, time_limit, question_i18n, pairs
         FROM edu.maze_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "coloring") {
      const { rows: cfgRows } = await query(
        `SELECT bg_image_url, region_mask_url, regions, timer_mode, time_limit, question_i18n FROM edu.coloring_configs WHERE id = $1`,
        [level.module_config_id]
      );
      const row = cfgRows[0];
      if (row) {
        // 隐藏的答案 — target_color (the required fill color for a
        // 'specific'-rule region) must never reach the client before
        // checking, same principle as sudoku's digits. marker_color DOES
        // get sent — the student needs it to know which region a click
        // landed on (read the pixel color off region_mask_url, match
        // against marker_color) — that's just "where are the regions",
        // not "what's the right answer".
        type Region = { marker_color: string; rule: "specific" | "free"; target_color?: string; label?: string };
        const regions = (row.regions as Region[]).map((r) => ({ marker_color: r.marker_color, rule: r.rule, label: r.label }));
        config = { bg_image_url: row.bg_image_url, region_mask_url: row.region_mask_url, regions, timer_mode: row.timer_mode, time_limit: row.time_limit, question_i18n: row.question_i18n };
      } else {
        config = null;
      }
    } else if (level.module_type === "ppt_lecture") {
      // 讲义类没有要藏的答案——直接把幻灯片图片清单给学生/老师看，这就是
      // 全部内容，不是谜题的一部分。
      const { rows: cfgRows } = await query(
        `SELECT slide_image_urls, original_filename FROM edu.ppt_lecture_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "video_lecture") {
      const { rows: cfgRows } = await query(
        `SELECT video_url, poster_image_url FROM edu.video_lecture_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "play_along") {
      // 讲义类没有要藏的答案——跟弹练习靠时间标记同步，不是谜题
      const { rows: cfgRows } = await query(
        `SELECT sheet_image_urls, original_filename, audio_url, markers, original_bpm FROM edu.play_along_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "number_maze") {
      // 分岔点的正确答案(correctIndex)、方格棋盘的路径(path)都直接发给
      // 前端——client端直接核对，跟line_match/迷宫是同一个"休闲游戏"
      // 安全等级，不是隐藏答案server端核对那一套。
      const { rows: cfgRows } = await query(
        `SELECT layout, bg_image_url, mask_image_url, start_x, start_y, end_x, end_y, decision_points,
                rows, cols, cells, path, line_color, given_color, bg_color, bg_enabled, opacity,
                timer_mode, time_limit, question_i18n
         FROM edu.number_maze_configs WHERE id = $1`,
        [level.module_config_id]
      );
      const nmRow = cfgRows[0];
      if (nmRow) {
        config = nmRow.layout === "grid"
          ? { layout: "grid", rows: nmRow.rows, cols: nmRow.cols, cells: nmRow.cells, path: nmRow.path, line_color: nmRow.line_color, given_color: nmRow.given_color, bg_color: nmRow.bg_color, bg_enabled: nmRow.bg_enabled, opacity: nmRow.opacity, timer_mode: nmRow.timer_mode, time_limit: nmRow.time_limit, question_i18n: nmRow.question_i18n }
          : { layout: "path", bg_image_url: nmRow.bg_image_url, mask_image_url: nmRow.mask_image_url, start: { x: nmRow.start_x, y: nmRow.start_y }, end: { x: nmRow.end_x, y: nmRow.end_y }, decision_points: nmRow.decision_points, timer_mode: nmRow.timer_mode, time_limit: nmRow.time_limit, question_i18n: nmRow.question_i18n };
      } else {
        config = null;
      }
    } else if (level.module_type === "sticker_game") {
      // 贴纸摆放位置直接发给前端——同上，client端直接核对
      const { rows: cfgRows } = await query(
        `SELECT bg_image_url, objects, timer_mode, time_limit, question_i18n FROM edu.sticker_game_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "drag_drop") {
      // 统一拖拽引擎——阶段1只有position_target这一种mode，安全模型跟
      // sticker_game完全一致(位置直接发给前端，client端判定)，config
      // 里带上mode字段，前端DragDropGame.tsx靠这个字段决定用哪套UI渲染。
      const { rows: cfgRows } = await query(
        `SELECT mode, bg_image_url, objects, timer_mode, time_limit, question_i18n FROM edu.drag_drop_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "line_match") {
      // 不再隐藏配对关系——这版connect-the-dots改成client端直接判定(见
      // LineMatchGame.tsx头部说明)，edges/pair_key本来就要直接发给前端
      // 才能玩，跟贴纸游戏/数字迷宫是同一个"休闲游戏，不用防作弊"的安全
      // 等级，不是疏忽漏掉隐藏逻辑。scene/list两种布局原样透传；pairs是
      // 旧数据(没有layout概念)，前端 normalizeListData() 自己会转换。
      const { rows: cfgRows } = await query(
        `SELECT layout, left_items, right_items, edges, pairs, shuffle_right, bg_image_url, objects, timer_mode, time_limit, question_i18n FROM edu.line_match_configs WHERE id = $1`,
        [level.module_config_id]
      );
      const row = cfgRows[0];
      if (row) {
        config = row.layout === "scene"
          ? { layout: "scene", bg_image_url: row.bg_image_url, objects: row.objects, timer_mode: row.timer_mode, time_limit: row.time_limit, question_i18n: row.question_i18n }
          : {
              layout: "list", left_items: row.left_items, right_items: row.right_items, edges: row.edges, pairs: row.pairs,
              shuffle_right: row.shuffle_right, timer_mode: row.timer_mode, time_limit: row.time_limit, question_i18n: row.question_i18n,
            };
      } else {
        config = null;
      }
    } else if (level.module_type === "sudoku") {
      const { rows: cfgRows } = await query(
        `SELECT layout, bg_image_url, cells, rows, cols, given_cells, blank_cells, line_color, given_color, blank_bg, bg_color, bg_enabled, opacity, difficulty, timer_mode, time_limit, question_i18n FROM edu.sudoku_configs WHERE id = $1`,
        [level.module_config_id]
      );
      const row = cfgRows[0];
      if (row && row.layout === "grid") {
        // grid模式——given_cells本来就是"明摆着给学生看的数字"，原样发；
        // blank_cells只送位置，answer这个字段(隐藏的答案)不能发给学生，
        // 跟photo模式一样的"答案不下发"原则。
        const blankCellsWithoutAnswers = (row.blank_cells as Array<{ row: number; col: number }>).map((c) => ({ row: c.row, col: c.col }));
        config = {
          layout: "grid", rows: row.rows, cols: row.cols, given_cells: row.given_cells, blank_cells: blankCellsWithoutAnswers,
          line_color: row.line_color, given_color: row.given_color, blank_bg: row.blank_bg, bg_color: row.bg_color, bg_enabled: row.bg_enabled, opacity: row.opacity,
          difficulty: row.difficulty, timer_mode: row.timer_mode, time_limit: row.time_limit, question_i18n: row.question_i18n,
        };
      } else if (row) {
        // 隐藏的答案 — the correct digit for each cell must NEVER reach the
        // client until checkSudoku validates it server-side. Sending the
        // full cell (including `answer`) here would put the solution
        // straight into the browser's network tab / React state, visible
        // to anyone who opens devtools before even attempting the puzzle —
        // defeats "隐藏答案" entirely. Only position survives the trip.
        const cellsWithoutAnswers = (row.cells as Array<{ x: number; y: number }>).map((c) => ({ x: c.x, y: c.y }));
        config = { layout: "photo", bg_image_url: row.bg_image_url, cells: cellsWithoutAnswers, difficulty: row.difficulty, timer_mode: row.timer_mode, time_limit: row.time_limit, question_i18n: row.question_i18n };
      }
    } else if (level.module_type === "cube_layer_count") {
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, max_split_layers, timer_mode, time_limit FROM edu.cube_layer_count_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "cube_find_hidden") {
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, hidden_targets, timer_mode, time_limit FROM edu.cube_find_hidden_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "cube_free_rotate") {
      const { rows: cfgRows } = await query(
        `SELECT total_shapes, shape_size, min_view_seconds, timer_mode, time_limit FROM edu.cube_free_rotate_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "cube_build") {
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, timer_mode, time_limit FROM edu.cube_build_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "cube_three_view") {
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, timer_mode, time_limit FROM edu.cube_three_view_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "shape_count") {
      // 没有藏答案这回事(不管grid还是custom布局)——grid的答案是公式算的，
      // custom的答案是shapes/objects数组本身，client端直接判定，安全
      // 等级跟贴纸游戏/数字迷宫一致，两种布局字段都直接给前端就行。
      const { rows: cfgRows } = await query(
        `SELECT layout, ask_type, starting_level, total_questions, bg_image_url, shapes, objects, timer_mode, time_limit, question_i18n FROM edu.shape_count_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "clock") {
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, mode, timer_mode, time_limit FROM edu.clock_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "latin_square") {
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, theme, timer_mode, time_limit FROM edu.latin_square_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "number_find") {
      const { rows: cfgRows } = await query(
        `SELECT layout, bg_image_url, decorations, grid_area, target_count, number_min, number_max, starting_level, total_questions, timer_mode, time_limit, question_i18n FROM edu.number_find_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "number_sequence") {
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, timer_mode, time_limit, question_i18n FROM edu.number_sequence_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "number_bond") {
      const { rows: cfgRows } = await query(
        `SELECT icon_urls, number_min, number_max, starting_level, total_questions, timer_mode, time_limit, question_i18n FROM edu.number_bond_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "number_compare") {
      const { rows: cfgRows } = await query(
        `SELECT icon_urls, number_min, number_max, starting_level, total_questions, timer_mode, time_limit, question_i18n FROM edu.number_compare_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "number_addition") {
      const { rows: cfgRows } = await query(
        `SELECT icon_urls, number_min, number_max, starting_level, total_questions, timer_mode, time_limit, question_i18n FROM edu.number_addition_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "chinese_stroke") {
      const { rows: cfgRows } = await query(
        `SELECT characters, total_questions, timer_mode, time_limit, question_i18n FROM edu.chinese_stroke_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "multiple_choice") {
      const { rows: cfgRows } = await query(
        `SELECT bg_image_url, objects, texts, answer_mode, options, correct_option_ids, question_i18n, timer_mode, time_limit FROM edu.multiple_choice_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "fill_blank") {
      const { rows: cfgRows } = await query(
        `SELECT bg_image_url, objects, texts, sentence_i18n, blanks, timer_mode, time_limit FROM edu.fill_blank_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "cube_stack") {
      // 没有藏答案这回事——题目是前端运行时现场生成的3D结构，判定也是
      // 纯计算(数方块总数)，不是server端核对一份authored好的正确答案，
      // 所以这几个参数字段直接给前端就行，跟number_maze/贴纸同一个
      // "client端直接判定"的安全等级。
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, timer_mode, time_limit FROM edu.cube_stack_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    }

    const { course_grade_tier_id, ...levelForResponse } = level;
    return { ...levelForResponse, config };
}

export async function getLevel(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { levelId } = req.params;
    const { rows } = await query(
      `SELECT cl.id, cl.course_id, cl.order_index, cl.module_type, cl.module_config_id,
              cl.title_i18n, cl.video_url_i18n, cl.ppt_url_i18n, cl.illustration_url, cl.points_reward,
              cl.explanation_text, cl.explanation_image_url, cl.explanation_video_url, cl.exercise_number,
              cl.hint_text, cl.audio_url,
              cl.activity_type, cl.teaching_modes, cl.difficulty, cl.age_group_min, cl.age_group_max,
              cl.duration_minutes, cl.learning_outcomes, cl.skills_developed, cl.language, cl.tags, cl.parent_preview_enabled, cl.usage_contexts, cl.self_guided_programme_ids, cl.cover_image_url,
              c.grade_tier_id AS course_grade_tier_id
       FROM edu.course_levels cl
       LEFT JOIN edu.courses c ON c.id = cl.course_id
       WHERE cl.id = $1`,
      [levelId]
    );
    if (!rows.length) { notFound(res, "Level not found"); return; }
    const level = rows[0];

    // ── NEW: grade-tier access control ────────────────────────────────────────
    // A STUDENT can only play levels whose course is tagged with the grade
    // tier they're actually subscribed to (see family.controller.ts#addChild
    // — subscriptions bind to ONE tier, not "everything"). Every other role
    // (course designer previewing their own work, teacher checking an
    // assignment, operator) skips this check entirely.
    const { rows: roleRows } = await query(
      `SELECT r.code FROM rbac.user_roles ur
       JOIN rbac.roles r ON r.id = ur.role_id AND r.is_deleted = false
       WHERE ur.user_id = $1 AND ur.is_active = true`,
      [req.user!.sub]
    );
    const isStudent = (roleRows as { code: string }[]).some((r) => r.code === "STUDENT");
    const isParent = (roleRows as { code: string }[]).some((r) => r.code === "PARENT");

    // ── 家长"试玩"门控 ──────────────────────────────────────────────────────
    // 家长不是学生，不走订阅/年级那一套检查——但也不能因此就能玩任何一关。
    // 只有 operator 明确标记 parent_preview_enabled=true 的关卡，家长才能
    // 打开。这里直接 return，不落入下面 isStudent 的分支（家长本来就不是
    // 学生，isStudent 恒为 false，不会重复判断）。
    if (isParent && !level.parent_preview_enabled) {
      forbidden(res, "这一关还没开放给家长试玩"); return;
    }

    if (isStudent) {
      const { rows: subRows } = await query(
        `SELECT status, trial_ends_at, grace_period_ends_at, grade_tier_id
         FROM edu.subscriptions WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [req.user!.sub]
      );
      const sub = subRows[0] as { status: string; trial_ends_at: Date; grace_period_ends_at: Date | null; grade_tier_id: string | null } | undefined;
      const now = new Date();
      const hasActiveSub = sub && (
        (sub.status === "trial" && new Date(sub.trial_ends_at) > now) ||
        sub.status === "active" ||
        (sub.status === "past_due" && sub.grace_period_ends_at && new Date(sub.grace_period_ends_at) > now)
      );
      if (!hasActiveSub) { forbidden(res, "没有有效的订阅"); return; }
      if (!level.course_grade_tier_id || sub!.grade_tier_id !== level.course_grade_tier_id) {
        forbidden(res, "这门课不在你订阅的等级里"); return;
      }
    }
    // ── end NEW ──────────────────────────────────────────────────────────────

    const payload = await buildLevelPayload(level);
    ok(res, payload);
  } catch (err) { serverError(res, err); }
}

// ── Progress ─────────────────────────────────────────────────────────────────
export async function submitProgress(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { levelId } = req.params;
    const { module_type, score, max_score, time_spent_seconds, mistakes, completed, extra_data } =
      req.body as Record<string, unknown>;

    const { rows: prevRows } = await query(
      `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt
       FROM edu.progress_records WHERE student_id = $1 AND course_level_id = $2`,
      [req.user!.sub, levelId]
    );

    const { rows } = await query(
      `INSERT INTO edu.progress_records
         (student_id, course_level_id, module_type, score, max_score, time_spent_seconds, mistakes, completed, attempt_number, extra_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, score, max_score, time_spent_seconds, mistakes, completed, attempt_number, played_at`,
      [
        req.user!.sub, levelId, module_type ?? null, score ?? null, max_score ?? null,
        time_spent_seconds ?? null, mistakes ?? 0, completed ?? false,
        prevRows[0].next_attempt, extra_data ? JSON.stringify(extra_data) : null,
      ]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function listMyProgress(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT pr.id, pr.course_level_id, pr.module_type, pr.score, pr.max_score,
              pr.time_spent_seconds, pr.mistakes, pr.completed, pr.attempt_number, pr.played_at,
              cl.title_i18n AS level_title_i18n
       FROM edu.progress_records pr
       JOIN edu.course_levels cl ON cl.id = pr.course_level_id
       WHERE pr.student_id = $1
       ORDER BY pr.played_at DESC
       LIMIT 50`,
      [req.user!.sub]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// ── 排行榜（全平台）──────────────────────────────────────────────────────────
// 每个学生在这个 Activity 上玩过好几次（progress_records 每次都插入新行，
// 见 submitProgress），排行榜按"每个学生自己的历史最佳一次"参与排名——
// 不是每次尝试都占一个名次，不然刷分/多玩几次的人会把榜单刷满，失去
// 排行榜的意义。排序依据：分数高优先，同分再比用时短优先（跟课程设计
// 那边确认过的规则）。
// 因为 Phase 1 还没有"assignment/班级"概念（见文件开头注释），这里就是
// 名副其实的"全平台"——不按班级/课程分开。
export async function getLevelLeaderboard(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { levelId } = req.params;
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));

    const { rows: ranked } = await query(
      `WITH best_per_student AS (
         SELECT DISTINCT ON (pr.student_id)
           pr.student_id, pr.score, pr.max_score, pr.time_spent_seconds, pr.mistakes, pr.completed, pr.played_at
         FROM edu.progress_records pr
         WHERE pr.course_level_id = $1 AND pr.score IS NOT NULL
         ORDER BY pr.student_id, pr.score DESC, pr.time_spent_seconds ASC NULLS LAST, pr.played_at ASC
       )
       SELECT bp.student_id, u.username, p.full_name_zh, p.full_name_en,
              bp.score, bp.max_score, bp.time_spent_seconds, bp.mistakes, bp.completed, bp.played_at,
              RANK() OVER (ORDER BY bp.score DESC, bp.time_spent_seconds ASC NULLS LAST) AS rank
       FROM best_per_student bp
       JOIN auth.users u ON u.id = bp.student_id
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       ORDER BY rank ASC`,
      [levelId]
    );

    const myEntry = ranked.find((r) => r.student_id === req.user!.sub) ?? null;
    ok(res, { entries: ranked.slice(0, limit), my_rank: myEntry?.rank ?? null, total_players: ranked.length });
  } catch (err) { serverError(res, err); }
}

// ── 我的记录（单个 Activity）─────────────────────────────────────────────────
// 历史最佳一次 + 最近的完整历史列表，两者都要（跟课程设计那边确认过）。
// "最佳"跟排行榜用同一套排序规则（分数高优先，同分比用时），这样两处
// 显示的"最佳成绩"是同一个数字，不会前后矛盾。
export async function getMyLevelRecords(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { levelId } = req.params;

    const { rows: bestRows } = await query(
      `SELECT score, max_score, time_spent_seconds, mistakes, completed, attempt_number, played_at
       FROM edu.progress_records
       WHERE student_id = $1 AND course_level_id = $2 AND score IS NOT NULL
       ORDER BY score DESC, time_spent_seconds ASC NULLS LAST, played_at ASC
       LIMIT 1`,
      [req.user!.sub, levelId]
    );

    const { rows: historyRows } = await query(
      `SELECT id, score, max_score, time_spent_seconds, mistakes, completed, attempt_number, played_at
       FROM edu.progress_records
       WHERE student_id = $1 AND course_level_id = $2
       ORDER BY played_at DESC
       LIMIT 20`,
      [req.user!.sub, levelId]
    );

    ok(res, { best: bestRows[0] ?? null, history: historyRows });
  } catch (err) { serverError(res, err); }
}


// operator 专用——全平台的学习记录总览，不像 listMyProgress(只能看自己)、
// getChildProgress(家长只能看自己孩子)、getClassProgress(老师只能看自己
// 班级) 那样受限于"是谁在查"，这里可以查任何学生、任何 Activity、任何
// 时间段。按学生姓名/用户名/Activity标题/编号搜索，可以叠加按模块类型、
// 完成状态、日期区间筛选。
export async function listAllProgressRecords(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req, 30);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const studentId = typeof req.query.student_id === "string" ? req.query.student_id : "";
    const moduleType = typeof req.query.module_type === "string" ? req.query.module_type : "";
    const completedOnly = req.query.completed === "true";
    const dateFrom = typeof req.query.date_from === "string" ? req.query.date_from : "";
    const dateTo = typeof req.query.date_to === "string" ? req.query.date_to : "";

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`(lower(u.username) LIKE $${params.length} OR lower(p.full_name_zh) LIKE $${params.length} OR lower(p.full_name_en) LIKE $${params.length} OR lower(cl.title_i18n->>'zh') LIKE $${params.length} OR lower(cl.exercise_number) LIKE $${params.length})`);
    }
    if (studentId) { params.push(studentId); conditions.push(`pr.student_id = $${params.length}`); }
    if (moduleType) { params.push(moduleType); conditions.push(`pr.module_type = $${params.length}`); }
    if (completedOnly) conditions.push(`pr.completed = true`);
    if (dateFrom) { params.push(dateFrom); conditions.push(`pr.played_at >= $${params.length}`); }
    if (dateTo) { params.push(dateTo); conditions.push(`pr.played_at <= $${params.length}`); }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const joins = `
       FROM edu.progress_records pr
       JOIN auth.users u ON u.id = pr.student_id
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       LEFT JOIN edu.course_levels cl ON cl.id = pr.course_level_id`;

    const { rows: countRows } = await query(`SELECT count(*)::int AS total ${joins} ${whereClause}`, params);
    const total = countRows[0]?.total ?? 0;

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT pr.id, pr.played_at, pr.module_type, pr.score, pr.max_score, pr.time_spent_seconds, pr.mistakes, pr.completed, pr.attempt_number,
              u.id AS student_id, u.username, p.full_name_zh, p.full_name_en,
              COALESCE(roles.role_codes, ARRAY[]::text[]) AS role_codes,
              cl.id AS course_level_id, cl.title_i18n AS level_title_i18n, cl.exercise_number
       ${joins}
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT r.code) AS role_codes
         FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id
         WHERE ur.user_id = u.id AND ur.is_active = true
       ) roles ON true
       ${whereClause}
       ORDER BY pr.played_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.status(200).json({ success: true, message: "Success", data: rows, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) { serverError(res, err); }
}

// ── 数独: server-side answer checking ────────────────────────────────────────
// The ONLY place the correct digits ever get read back out of
// edu.sudoku_configs after creation — getLevel deliberately never sends
// them to the client (see the sudoku branch above). A student submits
// whatever they've filled in (same order/length as the cells array
// getLevel gave them, blanks as null), this compares against the real
// answers server-side, and returns per-cell correctness plus the full
// solution — matching "当游戏结束可以显示答案" (once you've submitted, you
// can see the right answers), not before.
export async function checkSudoku(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { levelId } = req.params;
    const { values } = req.body as { values: (number | null)[] };
    if (!Array.isArray(values)) { badRequest(res, "values must be an array"); return; }

    const { rows: levelRows } = await query(
      `SELECT module_config_id FROM edu.course_levels WHERE id = $1 AND module_type = 'sudoku'`,
      [levelId]
    );
    if (!levelRows.length) { notFound(res, "Sudoku level not found"); return; }

    const { rows: cfgRows } = await query(`SELECT layout, cells, blank_cells FROM edu.sudoku_configs WHERE id = $1`, [levelRows[0].module_config_id]);
    if (!cfgRows.length) { notFound(res, "Sudoku config not found"); return; }
    // grid模式的答案在blank_cells里(row/col/answer，answer是字符串"1"~"9")，
    // photo模式在cells里(x/y/answer，answer是数字1~9)——统一转成同一套
    // "answer数字数组"格式，下面的比对逻辑两种模式完全共用，不用分开写。
    const isGrid = cfgRows[0].layout === "grid";
    const answers: number[] = isGrid
      ? (cfgRows[0].blank_cells as Array<{ answer: string }>).map((c) => parseInt(c.answer, 10))
      : (cfgRows[0].cells as Array<{ answer: number }>).map((c) => c.answer);

    if (values.length !== answers.length) { badRequest(res, `values must have exactly ${answers.length} entries, matching the cells this puzzle has`); return; }

    const correct = answers.map((a, i) => values[i] === a);
    const allCorrect = correct.every(Boolean);
    const solution = answers;

    ok(res, { correct, allCorrect, solution });
  } catch (err) { serverError(res, err); }
}

// 编辑用的完整资料 — the DESIGNER's own view of a level they authored,
// distinct from getLevel (the student-facing play view). The only real
// difference: sudoku's `cells` here keep their `answer` field. Stripping
// answers in getLevel protects against a STUDENT seeing them before
// attempting the puzzle — that protection makes no sense applied to the
// designer editing their own puzzle; they wrote the answer, hiding it from
// them just makes editing impossible (they'd have to re-guess their own
// puzzle to edit it). Gated by courses.manage at the route level, same as
// create/update — no subscription/grade-tier gating here, this isn't a
// play-access check.
export async function getLevelForEdit(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { levelId } = req.params;
    const { rows } = await query(
      `SELECT cl.id, cl.course_id, cl.order_index, cl.module_type, cl.module_config_id,
              cl.title_i18n, cl.explanation_text, cl.explanation_image_url, cl.explanation_video_url,
              cl.exercise_number, cl.hint_text, cl.audio_url, cl.category_id, cl.group_id, cl.curriculum_type_id,
              cl.activity_type, cl.teaching_modes, cl.difficulty, cl.age_group_min, cl.age_group_max,
              cl.duration_minutes, cl.learning_outcomes, cl.skills_developed, cl.language, cl.tags, cl.parent_preview_enabled, cl.usage_contexts, cl.self_guided_programme_ids, cl.cover_image_url
       FROM edu.course_levels cl
       WHERE cl.id = $1`,
      [levelId]
    );
    if (!rows.length) { notFound(res, "Level not found"); return; }
    const level = rows[0];

    // 一个 Activity 可能同时挂好几个 Topic——查出全部（不是只有旧栏位那
    // 一个），给编辑表单的多选用。
    const { rows: topicLinkRows } = await query(
      `SELECT category_id FROM edu.activity_topic_links WHERE course_level_id = $1`,
      [levelId]
    );
    level.category_ids = (topicLinkRows as { category_id: string }[]).map((r) => r.category_id);

    let config = null;
    if (level.module_type === "counting") {
      const { rows: cfgRows } = await query(
        `SELECT theme, custom_icon_url, bg_image_url, min_val, max_val,
                quiz_mode, num_choices, total_questions, timer_mode, time_limit, mode, positions, texts,
                target_types, question_i18n
         FROM edu.counting_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "spot_diff") {
      const { rows: cfgRows } = await query(
        `SELECT image_a_url, image_b_url, hotspots, timer_mode, time_limit, question_i18n FROM edu.spot_diff_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "focus_tap") {
      const { rows: cfgRows } = await query(
        `SELECT mode, grid_size, bg_image_url, positions, timer_mode, time_limit, question_i18n FROM edu.focus_tap_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "memory") {
      const { rows: cfgRows } = await query(
        `SELECT theme, custom_icons, bg_image_url, pairs_count, preview_seconds, timer_mode, time_limit, question_i18n, layout, positions FROM edu.memory_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "pattern") {
      const { rows: cfgRows } = await query(
        `SELECT theme, pattern_types, seq_length, num_choices, total_questions, timer_mode, time_limit, question_i18n FROM edu.pattern_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "word_problem") {
      const { rows: cfgRows } = await query(
        `SELECT categories, answer_mode, num_choices, total_questions,
                chicken_min, chicken_max, speed_min, speed_max, meet_time_min, meet_time_max, timer_mode, time_limit,
                mode, bg_image_url, objects, texts, problem_text, question_text, custom_answer, unit
         FROM edu.word_problem_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "maze") {
      const { rows: cfgRows } = await query(
        `SELECT bg_image_url, mask_image_url, start_x, start_y, end_x, end_y, timer_mode, time_limit, question_i18n, pairs FROM edu.maze_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "coloring") {
      // 设计者视角要看完整原始 regions（含每个区块的 target_color 正确
      // 答案），跟 getLevel 那个学生视角刻意隐藏 target_color 的做法不
      // 一样——设计者本来就需要知道要求的颜色才能编辑。
      const { rows: cfgRows } = await query(
        `SELECT bg_image_url, region_mask_url, regions, timer_mode, time_limit, question_i18n FROM edu.coloring_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "ppt_lecture") {
      const { rows: cfgRows } = await query(
        `SELECT slide_image_urls, original_filename FROM edu.ppt_lecture_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "video_lecture") {
      const { rows: cfgRows } = await query(
        `SELECT video_url, poster_image_url FROM edu.video_lecture_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "play_along") {
      const { rows: cfgRows } = await query(
        `SELECT sheet_image_urls, original_filename, audio_url, markers, original_bpm FROM edu.play_along_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "number_maze") {
      // 设计者视角不用另外拆——number_maze 本来就没有藏答案，跟学生
      // 视角(getLevel)读到的是同一份数据。
      const { rows: cfgRows } = await query(
        `SELECT layout, bg_image_url, mask_image_url, start_x, start_y, end_x, end_y, decision_points,
                rows, cols, cells, path, line_color, given_color, bg_color, bg_enabled, opacity,
                timer_mode, time_limit, question_i18n
         FROM edu.number_maze_configs WHERE id = $1`,
        [level.module_config_id]
      );
      const nmRow = cfgRows[0];
      if (nmRow) {
        config = nmRow.layout === "grid"
          ? { layout: "grid", rows: nmRow.rows, cols: nmRow.cols, cells: nmRow.cells, path: nmRow.path, line_color: nmRow.line_color, given_color: nmRow.given_color, bg_color: nmRow.bg_color, bg_enabled: nmRow.bg_enabled, opacity: nmRow.opacity, timer_mode: nmRow.timer_mode, time_limit: nmRow.time_limit, question_i18n: nmRow.question_i18n }
          : { layout: "path", bg_image_url: nmRow.bg_image_url, mask_image_url: nmRow.mask_image_url, start: { x: nmRow.start_x, y: nmRow.start_y }, end: { x: nmRow.end_x, y: nmRow.end_y }, decision_points: nmRow.decision_points, timer_mode: nmRow.timer_mode, time_limit: nmRow.time_limit, question_i18n: nmRow.question_i18n };
      } else {
        config = null;
      }
    } else if (level.module_type === "sticker_game") {
      const { rows: cfgRows } = await query(
        `SELECT bg_image_url, objects, timer_mode, time_limit, question_i18n FROM edu.sticker_game_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "drag_drop") {
      const { rows: cfgRows } = await query(
        `SELECT mode, bg_image_url, objects, timer_mode, time_limit, question_i18n FROM edu.drag_drop_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "line_match") {
      // 不再需要跟学生视角分开处理——client端判定之后两边看到的就是
      // 同一份数据，这里直接把所有栏位原样给前端，CourseDesignerPage.tsx
      // 自己认得 layout/left_items/right_items/edges/objects/pairs 这些
      // 字段该怎么读。
      const { rows: cfgRows } = await query(
        `SELECT layout, left_items, right_items, edges, pairs, shuffle_right, bg_image_url, objects, timer_mode, time_limit, question_i18n FROM edu.line_match_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "sudoku") {
      // the ONLY branch that differs from getLevel: cells/blank_cells keep `answer`
      const { rows: cfgRows } = await query(
        `SELECT layout, bg_image_url, cells, rows, cols, given_cells, blank_cells, line_color, given_color, blank_bg, bg_color, bg_enabled, opacity, difficulty, timer_mode, time_limit, question_i18n FROM edu.sudoku_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "cube_layer_count") {
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, max_split_layers, timer_mode, time_limit FROM edu.cube_layer_count_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "cube_find_hidden") {
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, hidden_targets, timer_mode, time_limit FROM edu.cube_find_hidden_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "cube_free_rotate") {
      const { rows: cfgRows } = await query(
        `SELECT total_shapes, shape_size, min_view_seconds, timer_mode, time_limit FROM edu.cube_free_rotate_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "cube_build") {
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, timer_mode, time_limit FROM edu.cube_build_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "cube_three_view") {
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, timer_mode, time_limit FROM edu.cube_three_view_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "shape_count") {
      const { rows: cfgRows } = await query(
        `SELECT layout, ask_type, starting_level, total_questions, bg_image_url, shapes, objects, timer_mode, time_limit, question_i18n FROM edu.shape_count_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "clock") {
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, mode, timer_mode, time_limit FROM edu.clock_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "latin_square") {
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, theme, timer_mode, time_limit FROM edu.latin_square_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "number_find") {
      const { rows: cfgRows } = await query(
        `SELECT layout, bg_image_url, decorations, grid_area, target_count, number_min, number_max, starting_level, total_questions, timer_mode, time_limit, question_i18n FROM edu.number_find_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "number_sequence") {
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, timer_mode, time_limit, question_i18n FROM edu.number_sequence_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "number_bond") {
      const { rows: cfgRows } = await query(
        `SELECT icon_urls, number_min, number_max, starting_level, total_questions, timer_mode, time_limit, question_i18n FROM edu.number_bond_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "number_compare") {
      const { rows: cfgRows } = await query(
        `SELECT icon_urls, number_min, number_max, starting_level, total_questions, timer_mode, time_limit, question_i18n FROM edu.number_compare_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "number_addition") {
      const { rows: cfgRows } = await query(
        `SELECT icon_urls, number_min, number_max, starting_level, total_questions, timer_mode, time_limit, question_i18n FROM edu.number_addition_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "chinese_stroke") {
      const { rows: cfgRows } = await query(
        `SELECT characters, total_questions, timer_mode, time_limit, question_i18n FROM edu.chinese_stroke_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "multiple_choice") {
      const { rows: cfgRows } = await query(
        `SELECT bg_image_url, objects, texts, answer_mode, options, correct_option_ids, question_i18n, timer_mode, time_limit FROM edu.multiple_choice_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "fill_blank") {
      const { rows: cfgRows } = await query(
        `SELECT bg_image_url, objects, texts, sentence_i18n, blanks, timer_mode, time_limit FROM edu.fill_blank_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "cube_stack") {
      // 设计者视角跟学生视角(getLevel)是同一份数据——没有要隐藏的答案
      const { rows: cfgRows } = await query(
        `SELECT starting_level, total_questions, timer_mode, time_limit FROM edu.cube_stack_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    }

    ok(res, { ...level, config });
  } catch (err) { serverError(res, err); }
}

// ── 应用题自定义模式: server-side answer checking ──────────────────────────────
// Same reasoning as checkSudoku — custom_answer never reaches the student
// via getLevel (see that branch's comment above), so checking a submitted
// answer has to happen here, server-side, against the real hidden value.
// Only relevant for mode='custom_scene' — random-generation categories
// check their own answer client-side (the "answer" there is just whichever
// number the generator function produced this round, nothing secret).
export async function checkWordProblem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { levelId } = req.params;
    const { value } = req.body as { value: number };
    if (typeof value !== "number") { badRequest(res, "value must be a number"); return; }

    const { rows: levelRows } = await query(
      `SELECT module_config_id FROM edu.course_levels WHERE id = $1 AND module_type = 'word_problem'`,
      [levelId]
    );
    if (!levelRows.length) { notFound(res, "Word problem level not found"); return; }

    const { rows: cfgRows } = await query(`SELECT custom_answer FROM edu.word_problem_configs WHERE id = $1`, [levelRows[0].module_config_id]);
    if (!cfgRows.length || cfgRows[0].custom_answer === null) { notFound(res, "This exercise doesn't have a custom answer set"); return; }

    const correctAnswer = Number(cfgRows[0].custom_answer);
    const correct = Math.abs(value - correctAnswer) < 0.001; // numeric column can come back with float noise, same tolerance pattern as elsewhere in this codebase
    ok(res, { correct, answer: correctAnswer });
  } catch (err) { serverError(res, err); }
}

// ── Activity Management: 全平台 Activity 列表（搜索/筛选/排序/分页）────────────────
// The backend for the Activity Management page — every Activity across
// every course in one flat, sortable table, filterable by any combination
// of Programme/Subject/Topic (all optional — leaving them off just returns
// everything), searchable by title/exercise number, paginated. This is the
// PRIMARY way to browse Activities now — courses are just the container
// each one happens to live in, not the entry point for finding one.
const ACTIVITY_SORT_COLUMNS: Record<string, string> = {
  // topic/subject/programme 排序取"随便一个挂着的"名字当代表——一个
  // Activity 现在可能同时挂好几个 Topic，严格排序意义不大，这里只是
  // 方便浏览时大致分组，不是权威排序。
  programme: "sort_programme_name", subject: "sort_subject_name", topic: "sort_topic_name",
  activity: "cl.title_i18n->>'zh'", exercise_number: "cl.exercise_number", created_at: "cl.created_at",
};

export async function listAllActivities(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req, 20);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const programmeId = typeof req.query.programme_id === "string" ? req.query.programme_id : "";
    const subjectId = typeof req.query.subject_id === "string" ? req.query.subject_id : "";
    const categoryId = typeof req.query.category_id === "string" ? req.query.category_id : "";
    const moduleType = typeof req.query.module_type === "string" ? req.query.module_type : "";
    const sortKey = ACTIVITY_SORT_COLUMNS[String(req.query.sort)] ? String(req.query.sort) : "created_at";
    const order = req.query.order === "asc" ? "ASC" : "DESC";

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`(lower(cl.title_i18n->>'zh') LIKE $${params.length} OR lower(cl.title_i18n->>'en') LIKE $${params.length} OR lower(cl.exercise_number) LIKE $${params.length})`);
    }
    // 一个 Activity 现在可以同时挂好几个 Topic，筛选改用 EXISTS 子查询——
    // 只要"挂的其中一个符合条件"就算命中，不会因为多对多 JOIN 出现同一
    // 个 Activity 重复好几行的问题。
    if (categoryId) {
      params.push(categoryId);
      conditions.push(`EXISTS (SELECT 1 FROM edu.activity_topic_links atl WHERE atl.course_level_id = cl.id AND atl.category_id = $${params.length})`);
    }
    if (subjectId) {
      params.push(subjectId);
      conditions.push(`EXISTS (SELECT 1 FROM edu.activity_topic_links atl JOIN edu.exercise_categories ec ON ec.id = atl.category_id WHERE atl.course_level_id = cl.id AND ec.subject_id = $${params.length})`);
    }
    if (programmeId) {
      params.push(programmeId);
      conditions.push(`EXISTS (SELECT 1 FROM edu.activity_topic_links atl JOIN edu.exercise_categories ec ON ec.id = atl.category_id JOIN edu.subjects s ON s.id = ec.subject_id WHERE atl.course_level_id = cl.id AND s.programme_id = $${params.length})`);
    }
    // 前端"按类型分组"那个第二层列表页要用——之前没有这个筛选，前端只能
    // 拉一大批回去自己在内存里过滤，数量一大会不准。
    if (moduleType) {
      params.push(moduleType);
      conditions.push(`cl.module_type = $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const joins = `
       FROM edu.course_levels cl
       LEFT JOIN edu.courses c ON c.id = cl.course_id`;

    const { rows: countRows } = await query(`SELECT count(*)::int AS total ${joins} ${whereClause}`, params);
    const total = countRows[0]?.total ?? 0;

    params.push(limit, offset);
    // student_id 参数放在 limit/offset 后面 push，所以下面SQL里三个
    // 占位符的位置都要跟着往后挪一个——这里特意用 params.length 在
    // "全部push完之后"才计算，不要在写SQL文字的时候用push之前的旧
    // params.length，两者数字不一样，混着用位置会错位、可能会把
    // student_id 的值当成offset用（相反也一样），SQL不会报错但结果
    // 全错，比较隐蔽的一种bug。
    params.push(req.user!.sub);
    const limitIdx = params.length - 2, offsetIdx = params.length - 1, studentIdx = params.length;
    const { rows } = await query(
      `SELECT cl.id, cl.course_id, cl.module_type, cl.title_i18n, cl.exercise_number, cl.created_at, cl.cover_image_url,
              c.title_i18n AS course_title_i18n,
              COALESCE(topics.topics, '[]'::json) AS topics,
              topics.sort_topic_name, topics.sort_subject_name, topics.sort_programme_name,
              COALESCE(my_plays.play_count, 0)::int AS my_play_count,
              COALESCE(total_plays.play_count, 0)::int AS total_play_count
       ${joins}
       LEFT JOIN LATERAL (
         SELECT
           json_agg(json_build_object(
             'category_id', ec.id, 'topic_name_zh', ec.name_zh,
             'subject_id', s.id, 'subject_name_zh', s.name_zh,
             'programme_id', p.id, 'programme_name_zh', p.name_zh
           ) ORDER BY ec.name_zh) AS topics,
           (array_agg(ec.name_zh ORDER BY ec.name_zh))[1] AS sort_topic_name,
           (array_agg(s.name_zh ORDER BY s.name_zh))[1] AS sort_subject_name,
           (array_agg(p.name_zh ORDER BY p.name_zh))[1] AS sort_programme_name
         FROM edu.activity_topic_links atl
         JOIN edu.exercise_categories ec ON ec.id = atl.category_id
         JOIN edu.subjects s ON s.id = ec.subject_id
         JOIN edu.programmes p ON p.id = s.programme_id
         WHERE atl.course_level_id = cl.id
       ) topics ON true
       -- "登录者一共玩了几次"——只算当前这个人自己试玩过的次数，不是全部
       -- 学生的累计次数，所以是按 student_id = 当前登录用户 过滤，不是
       -- 单纯 count(*)。设计师/老师自己在"试玩"按钮点过几次，就会反映
       -- 在这个数字上。
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS play_count
         FROM edu.progress_records pr
         WHERE pr.course_level_id = cl.id AND pr.student_id = $${studentIdx}
       ) my_plays ON true
       -- "总玩次数"——所有人加起来玩过几次，不分是谁，这个才是真的
       -- count(*)，不加 student_id 过滤。
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS play_count
         FROM edu.progress_records pr
         WHERE pr.course_level_id = cl.id
       ) total_plays ON true
       ${whereClause}
       ORDER BY ${ACTIVITY_SORT_COLUMNS[sortKey]} ${order} NULLS LAST
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    // sort_* 那几个栏位只是排序用的内部辅助值，不用回传给前端
    const cleaned = rows.map(({ sort_topic_name, sort_subject_name, sort_programme_name, ...rest }) => rest);

    res.status(200).json({ success: true, message: "Success", data: cleaned, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) { serverError(res, err); }
}

// ── 连线配对: server-side answer checking (DEPRECATED，前端已经不再调用) ─────────
// 架构升级之后(见 LineMatchGame.tsx 头部说明)，连线配对改成client端直接
// 判定——edges/pair_key 直接经 getLevel 发给前端，不再隐藏，所以也不需要
// 这个API核对答案了。这个函数还留着(没删)，但它读的是旧的 `pairs` 栏位，
// 对新格式的Activity(用了left_items/edges/objects的)不会返回正确结果——
// 不影响现在的运行时，因为前端压根不会再调用它，纯粹留着以防万一以后
// 又要走回"server端藏答案"这条路，需要的话再回来更新这里的逻辑。
export async function checkLineMatch(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { levelId } = req.params;
    const { matches } = req.body as { matches: Array<{ left_id: number; right_content: string }> };
    if (!Array.isArray(matches)) { badRequest(res, "matches must be an array"); return; }

    const { rows: levelRows } = await query(
      `SELECT module_config_id FROM edu.course_levels WHERE id = $1 AND module_type = 'line_match'`,
      [levelId]
    );
    if (!levelRows.length) { notFound(res, "Line-match level not found"); return; }

    const { rows: cfgRows } = await query(`SELECT pairs FROM edu.line_match_configs WHERE id = $1`, [levelRows[0].module_config_id]);
    if (!cfgRows.length) { notFound(res, "Config not found"); return; }
    type Pair = { left: { type: string; content: string }; right: { type: string; content: string } };
    const pairs = cfgRows[0].pairs as Pair[];

    const results = matches.map((m) => {
      const pair = pairs[m.left_id];
      const correct = !!pair && pair.right.content === m.right_content;
      return { left_id: m.left_id, correct };
    });
    const allCorrect = results.length === pairs.length && results.every((r) => r.correct);
    ok(res, { results, allCorrect, totalPairs: pairs.length });
  } catch (err) { serverError(res, err); }
}

// ── 填色游戏: server-side answer checking ──────────────────────────────────────
// target_color for a 'specific'-rule region never reaches the client via
// getLevel (see that branch's comment) — the student submits which color
// they filled EACH region with (identified by marker_color, the same
// identifier the client used to know which region a click landed on —
// see the file header note on why marker_color itself isn't secret, only
// target_color is), and this compares against the real
// edu.coloring_configs.regions server-side. A 'free'-rule region just
// needs to have been filled with *something* — any non-empty color
// string counts, there's no specific right answer to check against.
export async function checkColoring(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { levelId } = req.params;
    const { fills } = req.body as { fills: Record<string, string> }; // marker_color -> student's chosen color
    if (!fills || typeof fills !== "object") { badRequest(res, "fills must be an object"); return; }

    const { rows: levelRows } = await query(
      `SELECT module_config_id FROM edu.course_levels WHERE id = $1 AND module_type = 'coloring'`,
      [levelId]
    );
    if (!levelRows.length) { notFound(res, "Coloring level not found"); return; }

    const { rows: cfgRows } = await query(`SELECT regions FROM edu.coloring_configs WHERE id = $1`, [levelRows[0].module_config_id]);
    if (!cfgRows.length) { notFound(res, "Config not found"); return; }
    type Region = { marker_color: string; rule: "specific" | "free"; target_color?: string; label?: string };
    const regions = cfgRows[0].regions as Region[];

    const results = regions.map((r) => {
      const filled = fills[r.marker_color];
      const correct = r.rule === "free" ? !!filled : (!!filled && filled.toLowerCase() === r.target_color?.toLowerCase());
      return { marker_color: r.marker_color, correct };
    });
    const allCorrect = results.every((r) => r.correct);
    ok(res, { results, allCorrect, totalRegions: regions.length });
  } catch (err) { serverError(res, err); }
}