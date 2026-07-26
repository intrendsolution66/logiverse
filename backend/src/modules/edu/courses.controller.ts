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
              c.grade_tier_id, gt.code AS grade_tier_code, gt.name_i18n AS grade_tier_name_i18n
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
    const { title_i18n, description_i18n, age_group, organization_id, grade_tier_id } = req.body as Record<string, unknown>;
    if (!title_i18n) { badRequest(res, "title_i18n is required"); return; }
    if (!grade_tier_id) { badRequest(res, "grade_tier_id is required — pick a grade tier (see /edu/grade-tiers) or create one first"); return; }

    const { rows } = await query(
      `INSERT INTO edu.courses (title_i18n, description_i18n, age_group, organization_id, grade_tier_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title_i18n, description_i18n, age_group, grade_tier_id, created_at`,
      [JSON.stringify(title_i18n), description_i18n ? JSON.stringify(description_i18n) : null,
       age_group ?? null, organization_id ?? null, grade_tier_id, req.user!.sub]
    );
    created(res, rows[0]);
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
              cl.activity_type, cl.difficulty, cl.tags,
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

export async function createLevel(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { courseId } = req.params;
    const {
      module_type, order_index, title_i18n, config, explanation_text, explanation_image_url, explanation_video_url,
      category_id, group_id, curriculum_type_id, hint_text, audio_url,
      activity_type, teaching_modes, difficulty, age_group_min, age_group_max, duration_minutes,
      learning_outcomes, skills_developed, language, tags,
    } = req.body as {
      module_type: string; order_index?: number; title_i18n?: object; config: Record<string, unknown>;
      explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
      category_id?: string; group_id?: string; curriculum_type_id?: string;
      hint_text?: string; audio_url?: string;
      activity_type?: string; teaching_modes?: string[]; difficulty?: string;
      age_group_min?: number; age_group_max?: number; duration_minutes?: number;
      learning_outcomes?: string; skills_developed?: string[]; language?: string; tags?: string[];
    };
    if (!module_type) { badRequest(res, "module_type is required"); return; }
    // category_id (Topic) 新建时不强制要求——可以先建 Activity，之后再
    // 透过 updateLevel 补上分类，跟 updateLevel 那边一直以来的选填逻辑
    // 一致，不用再分"新建强制/编辑不强制"这两套规则。

    const SUPPORTED = ["counting", "spot_diff", "focus_tap", "memory", "pattern", "word_problem", "maze", "sudoku", "line_match", "coloring", "ppt_lecture", "video_lecture"];
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
    const exerciseNumber = category_id ? await nextExerciseNumber(category_id, group_id ?? null) : null;

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
             (theme, custom_icon_url, bg_image_url, min_val, max_val, quiz_mode, num_choices, total_questions, timer_mode, time_limit, mode, positions, texts)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING id`,
          [
            cfg.theme ?? "apple", cfg.custom_icon_url ?? null, cfg.bg_image_url ?? null,
            cfg.min_val ?? 1, cfg.max_val ?? 10, cfg.quiz_mode ?? "select",
            cfg.num_choices ?? 3, cfg.total_questions ?? 5,
            cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
            cfg.mode ?? "random", cfg.positions ? JSON.stringify(cfg.positions) : null,
            cfg.texts ? JSON.stringify(cfg.texts) : null,
          ]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "spot_diff") {
        if (!cfg.image_a_url || !cfg.image_b_url) throw new Error("image_a_url and image_b_url are required for spot_diff");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.spot_diff_configs (image_a_url, image_b_url, hotspots, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id`,
          [cfg.image_a_url, cfg.image_b_url, JSON.stringify(cfg.hotspots ?? []), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "focus_tap") {
        if (cfg.mode === "custom" && (!cfg.bg_image_url || !cfg.positions || (cfg.positions as unknown[]).length < 2)) {
          throw new Error("custom 模式的专注力点数字需要背景图和至少2个标记位置");
        }
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.focus_tap_configs (mode, grid_size, bg_image_url, positions, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id`,
          [cfg.mode ?? "grid", cfg.grid_size ?? 4, cfg.bg_image_url ?? null,
           cfg.positions ? JSON.stringify(cfg.positions) : null, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "memory") {
        if (cfg.theme === "custom" && (!(cfg.custom_icons as unknown[])?.length || (cfg.custom_icons as unknown[]).length < 2)) {
          throw new Error("custom 主题的Memory配对需要至少2张自定义图片");
        }
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.memory_configs (theme, custom_icons, bg_image_url, pairs_count, preview_seconds, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id`,
          [cfg.theme ?? "animal", cfg.custom_icons ? JSON.stringify(cfg.custom_icons) : null, cfg.bg_image_url ?? null,
           cfg.pairs_count ?? 6, cfg.preview_seconds ?? 3, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "pattern") {
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.pattern_configs (theme, pattern_types, seq_length, num_choices, total_questions, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id`,
          [cfg.theme ?? "shape", JSON.stringify(cfg.pattern_types ?? ["AB","ABC","AAB","ABB","AABB"]),
           cfg.seq_length ?? 7, cfg.num_choices ?? 3, cfg.total_questions ?? 5,
           cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
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
          `INSERT INTO edu.maze_configs (bg_image_url, mask_image_url, start_x, start_y, end_x, end_y, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id`,
          [
            cfg.bg_image_url, cfg.mask_image_url,
            cfg.start_x ?? 0.1, cfg.start_y ?? 0.5, cfg.end_x ?? 0.9, cfg.end_y ?? 0.5,
            cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
          ]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "coloring") { // authored content: outline + region mask + per-region color rules, no generation
        const regions = cfg.regions as Array<{ marker_color: string; rule: "specific" | "free"; target_color?: string; label?: string }> | undefined;
        if (!cfg.bg_image_url || !cfg.region_mask_url) throw new Error("bg_image_url and region_mask_url are required for coloring");
        if (!regions?.length) throw new Error("至少要标记1个区块");
        if (regions.some((r) => r.rule === "specific" && !r.target_color)) throw new Error("选了「指定颜色」的区块，要填要求的颜色");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.coloring_configs (bg_image_url, region_mask_url, regions, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id`,
          [cfg.bg_image_url, cfg.region_mask_url, JSON.stringify(regions), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      } else if (module_type === "line_match") { // authored content: every pair IS the puzzle, same as maze/sudoku — no random-generation mode
        const pairs = cfg.pairs as Array<{ left: { type: string; content: string }; right: { type: string; content: string } }> | undefined;
        if (!pairs?.length) throw new Error("至少要有1组配对");
        if (pairs.some((p) => !p.left?.content || !p.right?.content)) throw new Error("每一组配对，左右两边都要填内容");
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.line_match_configs (pairs, shuffle_right, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4)
           RETURNING id`,
          [JSON.stringify(pairs), cfg.shuffle_right ?? true, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
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
      } else { // sudoku — authored content: a puzzle IMAGE + which cells are blank + the correct digit for each. Never generates or validates a real sudoku's row/column/box constraints, same "authored answer, not computed" principle as everything else here.
        const cells = cfg.cells as Array<{ x: number; y: number; answer: number }> | undefined;
        if (!cfg.bg_image_url) throw new Error("bg_image_url is required for sudoku");
        if (!cells?.length) throw new Error("至少要标记1个空格并填答案");
        if (cells.some((c) => !Number.isInteger(c.answer) || c.answer < 1 || c.answer > 9)) {
          throw new Error("每个空格的答案必须是1到9的数字");
        }
        const { rows: cfgRows } = await client.query(
          `INSERT INTO edu.sudoku_configs (bg_image_url, cells, difficulty, timer_mode, time_limit)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id`,
          [cfg.bg_image_url, JSON.stringify(cells), cfg.difficulty ?? "medium", cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
        );
        configId = cfgRows[0].id;
      }

      const { rows: levelRows } = await client.query(
        `INSERT INTO edu.course_levels
           (course_id, order_index, module_type, module_config_id, title_i18n, created_by, explanation_text, explanation_image_url, explanation_video_url,
            category_id, group_id, curriculum_type_id, exercise_number, hint_text, audio_url,
            activity_type, teaching_modes, difficulty, age_group_min, age_group_max, duration_minutes, learning_outcomes, skills_developed, language, tags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         RETURNING id, course_id, order_index, module_type, module_config_id, title_i18n, explanation_text, explanation_image_url, explanation_video_url,
                   category_id, group_id, curriculum_type_id, exercise_number, hint_text, audio_url,
                   activity_type, teaching_modes, difficulty, age_group_min, age_group_max, duration_minutes, learning_outcomes, skills_developed, language, tags`,
        [courseId, order_index ?? 0, module_type, configId, title_i18n ? JSON.stringify(title_i18n) : null, req.user!.sub,
         explanation_text ?? null, explanation_image_url ?? null, explanation_video_url ?? null,
         category_id ?? null, group_id ?? null, curriculum_type_id ?? null, exerciseNumber,
         hint_text ?? null, audio_url ?? null,
         activity_type ?? "game", teaching_modes ? JSON.stringify(teaching_modes) : "[]", difficulty ?? null,
         age_group_min ?? null, age_group_max ?? null, duration_minutes ?? null,
         learning_outcomes ?? null, JSON.stringify(normalizeSkillsList(skills_developed)), language ?? "universal", normalizeActivityTags(tags)]
      );
      return levelRows[0];
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
      category_id, group_id, curriculum_type_id, hint_text, audio_url,
      activity_type, teaching_modes, difficulty, age_group_min, age_group_max, duration_minutes,
      learning_outcomes, skills_developed, language, tags,
    } = req.body as {
      title_i18n?: object; config?: Record<string, unknown>;
      explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
      category_id?: string; group_id?: string; curriculum_type_id?: string;
      hint_text?: string; audio_url?: string;
      activity_type?: string; teaching_modes?: string[]; difficulty?: string;
      age_group_min?: number; age_group_max?: number; duration_minutes?: number;
      learning_outcomes?: string; skills_developed?: string[]; language?: string; tags?: string[];
    };
    // 注意：这里不像 createLevel 那样强制要求 category_id ——那个是"新建
    // Activity时必须先确定Topic"，这里如果本来就没有Topic（比如这个功能
    // 上线之前建的老 Activity），编辑其他内容（比如改个错字）不应该被
    // 卡住、逼着先补分类。下面 UPDATE 语句对 category_id 用 COALESCE，
    // 没传就保留原样，不会因为这次编辑没带这个栏位就被清空。

    const { rows: existingRows } = await query(
      `SELECT module_type, module_config_id, exercise_number FROM edu.course_levels WHERE id = $1`,
      [levelId]
    );
    if (!existingRows.length) { notFound(res, "Level not found"); return; }
    const { module_type, module_config_id, exercise_number: existingExerciseNumber } = existingRows[0] as { module_type: string; module_config_id: string; exercise_number: string | null };

    // 如果这个 Activity 从来没有过编号（建立的时候还没选 Topic，所以当时
    // 没生成），现在编辑时补上了 category_id，就该顺便把编号也生成出来——
    // 这不是"重新编号"（那种情况上面的注释说了刻意不做，避免打乱已经在用
    // 的编号），是"第一次有条件生成"，两者是不同的事。已经有编号的
    // Activity，这里不会去动它，边界条件只在"之前是null、现在有了
    // category_id"这一种情况下才触发。
    const shouldGenerateNumber = !existingExerciseNumber && category_id;
    const newExerciseNumber = shouldGenerateNumber ? await nextExerciseNumber(category_id, group_id ?? null) : null;

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
               num_choices=$8, total_questions=$9, timer_mode=$10, time_limit=$11, mode=$12, positions=$13, texts=$14
             WHERE id=$1`,
            [
              module_config_id, cfg.theme ?? "apple", cfg.custom_icon_url ?? null, cfg.bg_image_url ?? null,
              cfg.min_val ?? 1, cfg.max_val ?? 10, cfg.quiz_mode ?? "select",
              cfg.num_choices ?? 3, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null,
              cfg.mode ?? "random", cfg.positions ? JSON.stringify(cfg.positions) : null, cfg.texts ? JSON.stringify(cfg.texts) : null,
            ]
          );
        } else if (module_type === "spot_diff") {
          if (!cfg.image_a_url || !cfg.image_b_url) throw new Error("image_a_url and image_b_url are required for spot_diff");
          await client.query(
            `UPDATE edu.spot_diff_configs SET image_a_url=$2, image_b_url=$3, hotspots=$4, timer_mode=$5, time_limit=$6 WHERE id=$1`,
            [module_config_id, cfg.image_a_url, cfg.image_b_url, JSON.stringify(cfg.hotspots ?? []), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else if (module_type === "focus_tap") {
          if (cfg.mode === "custom" && (!cfg.bg_image_url || !cfg.positions || (cfg.positions as unknown[]).length < 2)) {
            throw new Error("custom 模式的专注力点数字需要背景图和至少2个标记位置");
          }
          await client.query(
            `UPDATE edu.focus_tap_configs SET mode=$2, grid_size=$3, bg_image_url=$4, positions=$5, timer_mode=$6, time_limit=$7 WHERE id=$1`,
            [module_config_id, cfg.mode ?? "grid", cfg.grid_size ?? 4, cfg.bg_image_url ?? null,
             cfg.positions ? JSON.stringify(cfg.positions) : null, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else if (module_type === "memory") {
          if (cfg.theme === "custom" && (!(cfg.custom_icons as unknown[])?.length || (cfg.custom_icons as unknown[]).length < 2)) {
            throw new Error("custom 主题的Memory配对需要至少2张自定义图片");
          }
          await client.query(
            `UPDATE edu.memory_configs SET theme=$2, custom_icons=$3, bg_image_url=$4, pairs_count=$5, preview_seconds=$6, timer_mode=$7, time_limit=$8 WHERE id=$1`,
            [module_config_id, cfg.theme ?? "animal", cfg.custom_icons ? JSON.stringify(cfg.custom_icons) : null, cfg.bg_image_url ?? null,
             cfg.pairs_count ?? 6, cfg.preview_seconds ?? 3, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else if (module_type === "pattern") {
          await client.query(
            `UPDATE edu.pattern_configs SET theme=$2, pattern_types=$3, seq_length=$4, num_choices=$5, total_questions=$6, timer_mode=$7, time_limit=$8 WHERE id=$1`,
            [module_config_id, cfg.theme ?? "shape", JSON.stringify(cfg.pattern_types ?? ["AB","ABC","AAB","ABB","AABB"]),
             cfg.seq_length ?? 7, cfg.num_choices ?? 3, cfg.total_questions ?? 5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
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
            `UPDATE edu.maze_configs SET bg_image_url=$2, mask_image_url=$3, start_x=$4, start_y=$5, end_x=$6, end_y=$7, timer_mode=$8, time_limit=$9 WHERE id=$1`,
            [module_config_id, cfg.bg_image_url, cfg.mask_image_url,
             cfg.start_x ?? 0.1, cfg.start_y ?? 0.5, cfg.end_x ?? 0.9, cfg.end_y ?? 0.5, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else if (module_type === "coloring") {
          const regions = cfg.regions as Array<{ marker_color: string; rule: "specific" | "free"; target_color?: string; label?: string }> | undefined;
          if (!cfg.bg_image_url || !cfg.region_mask_url) throw new Error("bg_image_url and region_mask_url are required for coloring");
          if (!regions?.length) throw new Error("至少要标记1个区块");
          if (regions.some((r) => r.rule === "specific" && !r.target_color)) throw new Error("选了「指定颜色」的区块，要填要求的颜色");
          await client.query(
            `UPDATE edu.coloring_configs SET bg_image_url=$2, region_mask_url=$3, regions=$4, timer_mode=$5, time_limit=$6 WHERE id=$1`,
            [module_config_id, cfg.bg_image_url, cfg.region_mask_url, JSON.stringify(regions), cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
        } else if (module_type === "line_match") {
          const pairs = cfg.pairs as Array<{ left: { type: string; content: string }; right: { type: string; content: string } }> | undefined;
          if (!pairs?.length) throw new Error("至少要有1组配对");
          if (pairs.some((p) => !p.left?.content || !p.right?.content)) throw new Error("每一组配对，左右两边都要填内容");
          await client.query(
            `UPDATE edu.line_match_configs SET pairs=$2, shuffle_right=$3, timer_mode=$4, time_limit=$5 WHERE id=$1`,
            [module_config_id, JSON.stringify(pairs), cfg.shuffle_right ?? true, cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
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
        } else { // sudoku
          const cells = cfg.cells as Array<{ x: number; y: number; answer: number }> | undefined;
          if (!cfg.bg_image_url) throw new Error("bg_image_url is required for sudoku");
          if (!cells?.length) throw new Error("至少要标记1个空格并填答案");
          if (cells.some((c) => !Number.isInteger(c.answer) || c.answer < 1 || c.answer > 9)) {
            throw new Error("每个空格的答案必须是1到9的数字");
          }
          await client.query(
            `UPDATE edu.sudoku_configs SET bg_image_url=$2, cells=$3, difficulty=$4, timer_mode=$5, time_limit=$6 WHERE id=$1`,
            [module_config_id, cfg.bg_image_url, JSON.stringify(cells), cfg.difficulty ?? "medium", cfg.timer_mode ?? "stopwatch", cfg.time_limit ?? null]
          );
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
           exercise_number = COALESCE($21, exercise_number)
         WHERE id = $1`,
        [
          levelId, title_i18n ? JSON.stringify(title_i18n) : null,
          explanation_text ?? null, explanation_image_url ?? null, explanation_video_url ?? null,
          category_id ?? null, group_id ?? null, curriculum_type_id ?? null,
          hint_text ?? null, audio_url ?? null,
          activity_type ?? null, difficulty ?? null,
          age_group_min ?? null, age_group_max ?? null, duration_minutes ?? null, learning_outcomes ?? null,
          language ?? null,
          JSON.stringify(teaching_modes ?? []), JSON.stringify(normalizeSkillsList(skills_developed)), normalizeActivityTags(tags),
          newExerciseNumber,
        ]
      );
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
export async function getLevel(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { levelId } = req.params;
    const { rows } = await query(
      `SELECT cl.id, cl.course_id, cl.order_index, cl.module_type, cl.module_config_id,
              cl.title_i18n, cl.video_url_i18n, cl.ppt_url_i18n, cl.illustration_url, cl.points_reward,
              cl.explanation_text, cl.explanation_image_url, cl.explanation_video_url, cl.exercise_number,
              cl.hint_text, cl.audio_url,
              cl.activity_type, cl.teaching_modes, cl.difficulty, cl.age_group_min, cl.age_group_max,
              cl.duration_minutes, cl.learning_outcomes, cl.skills_developed, cl.language, cl.tags,
              c.grade_tier_id AS course_grade_tier_id
       FROM edu.course_levels cl
       JOIN edu.courses c ON c.id = cl.course_id
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

    let config = null;
    if (level.module_type === "counting") {
      const { rows: cfgRows } = await query(
        `SELECT theme, custom_icon_url, bg_image_url, min_val, max_val,
                quiz_mode, num_choices, total_questions, timer_mode, time_limit, mode, positions, texts
         FROM edu.counting_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "spot_diff") {
      const { rows: cfgRows } = await query(
        `SELECT image_a_url, image_b_url, hotspots, timer_mode, time_limit
         FROM edu.spot_diff_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "focus_tap") {
      const { rows: cfgRows } = await query(
        `SELECT mode, grid_size, bg_image_url, positions, timer_mode, time_limit
         FROM edu.focus_tap_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "memory") {
      const { rows: cfgRows } = await query(
        `SELECT theme, custom_icons, bg_image_url, pairs_count, preview_seconds, timer_mode, time_limit
         FROM edu.memory_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "pattern") {
      const { rows: cfgRows } = await query(
        `SELECT theme, pattern_types, seq_length, num_choices, total_questions, timer_mode, time_limit
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
        `SELECT bg_image_url, mask_image_url, start_x, start_y, end_x, end_y, timer_mode, time_limit
         FROM edu.maze_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "coloring") {
      const { rows: cfgRows } = await query(
        `SELECT bg_image_url, region_mask_url, regions, timer_mode, time_limit FROM edu.coloring_configs WHERE id = $1`,
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
        config = { bg_image_url: row.bg_image_url, region_mask_url: row.region_mask_url, regions, timer_mode: row.timer_mode, time_limit: row.time_limit };
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
    } else if (level.module_type === "line_match") {
      const { rows: cfgRows } = await query(
        `SELECT pairs, shuffle_right, timer_mode, time_limit FROM edu.line_match_configs WHERE id = $1`,
        [level.module_config_id]
      );
      const row = cfgRows[0];
      if (row) {
        // 隐藏的配对关系 — the left↔right pairing must never reach the
        // client in a form where matching IDs/indices give it away (open
        // devtools, see left[2] and right[2] both carry the same index,
        // done). Left items keep their natural pair_index as id — the
        // left column isn't shuffled and isn't secret on its own. Right
        // items get shuffled into random display order with a plain
        // sequential id UNRELATED to pair_index, and no pair_index field
        // at all. Checking later happens by re-deriving the answer from
        // the stored `pairs` array server-side (checkLineMatch), not by
        // trusting any client-supplied index.
        type Pair = { left: { type: string; content: string }; right: { type: string; content: string } };
        const pairs = row.pairs as Pair[];
        const leftItems = pairs.map((p, i) => ({ id: i, type: p.left.type, content: p.left.content }));
        const rightOrder = pairs.map((_, i) => i);
        if (row.shuffle_right) {
          for (let i = rightOrder.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rightOrder[i], rightOrder[j]] = [rightOrder[j], rightOrder[i]];
          }
        }
        const rightItems = rightOrder.map((pairIdx, displayIdx) => ({ id: `r${displayIdx}`, type: pairs[pairIdx].right.type, content: pairs[pairIdx].right.content }));
        config = { left_items: leftItems, right_items: rightItems, timer_mode: row.timer_mode, time_limit: row.time_limit };
      } else {
        config = null;
      }
    } else if (level.module_type === "sudoku") {
      const { rows: cfgRows } = await query(
        `SELECT bg_image_url, cells, difficulty, timer_mode, time_limit FROM edu.sudoku_configs WHERE id = $1`,
        [level.module_config_id]
      );
      const row = cfgRows[0];
      if (row) {
        // 隐藏的答案 — the correct digit for each cell must NEVER reach the
        // client until checkSudoku validates it server-side. Sending the
        // full cell (including `answer`) here would put the solution
        // straight into the browser's network tab / React state, visible
        // to anyone who opens devtools before even attempting the puzzle —
        // defeats "隐藏答案" entirely. Only position survives the trip.
        const cellsWithoutAnswers = (row.cells as Array<{ x: number; y: number }>).map((c) => ({ x: c.x, y: c.y }));
        config = { bg_image_url: row.bg_image_url, cells: cellsWithoutAnswers, difficulty: row.difficulty, timer_mode: row.timer_mode, time_limit: row.time_limit };
      }
    }

    const { course_grade_tier_id, ...levelForResponse } = level;
    ok(res, { ...levelForResponse, config });
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

    const { rows: cfgRows } = await query(`SELECT cells FROM edu.sudoku_configs WHERE id = $1`, [levelRows[0].module_config_id]);
    if (!cfgRows.length) { notFound(res, "Sudoku config not found"); return; }
    const cells = cfgRows[0].cells as Array<{ x: number; y: number; answer: number }>;

    if (values.length !== cells.length) { badRequest(res, `values must have exactly ${cells.length} entries, matching the cells this puzzle has`); return; }

    const correct = cells.map((c, i) => values[i] === c.answer);
    const allCorrect = correct.every(Boolean);
    const solution = cells.map((c) => c.answer);

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
              cl.duration_minutes, cl.learning_outcomes, cl.skills_developed, cl.language, cl.tags
       FROM edu.course_levels cl
       WHERE cl.id = $1`,
      [levelId]
    );
    if (!rows.length) { notFound(res, "Level not found"); return; }
    const level = rows[0];

    let config = null;
    if (level.module_type === "counting") {
      const { rows: cfgRows } = await query(
        `SELECT theme, custom_icon_url, bg_image_url, min_val, max_val,
                quiz_mode, num_choices, total_questions, timer_mode, time_limit, mode, positions, texts
         FROM edu.counting_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "spot_diff") {
      const { rows: cfgRows } = await query(
        `SELECT image_a_url, image_b_url, hotspots, timer_mode, time_limit FROM edu.spot_diff_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "focus_tap") {
      const { rows: cfgRows } = await query(
        `SELECT mode, grid_size, bg_image_url, positions, timer_mode, time_limit FROM edu.focus_tap_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "memory") {
      const { rows: cfgRows } = await query(
        `SELECT theme, custom_icons, bg_image_url, pairs_count, preview_seconds, timer_mode, time_limit FROM edu.memory_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "pattern") {
      const { rows: cfgRows } = await query(
        `SELECT theme, pattern_types, seq_length, num_choices, total_questions, timer_mode, time_limit FROM edu.pattern_configs WHERE id = $1`,
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
        `SELECT bg_image_url, mask_image_url, start_x, start_y, end_x, end_y, timer_mode, time_limit FROM edu.maze_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "coloring") {
      // 设计者视角要看完整原始 regions（含每个区块的 target_color 正确
      // 答案），跟 getLevel 那个学生视角刻意隐藏 target_color 的做法不
      // 一样——设计者本来就需要知道要求的颜色才能编辑。
      const { rows: cfgRows } = await query(
        `SELECT bg_image_url, region_mask_url, regions, timer_mode, time_limit FROM edu.coloring_configs WHERE id = $1`,
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
    } else if (level.module_type === "line_match") {
      // 设计者视角要看完整原始配对（pairs 数组本身，左右两边都带内容，
      // 没有shuffle、没有隐藏），跟 getLevel 那个学生视角刻意拆开的做法
      // 不一样——设计者本来就需要知道正确答案才能编辑。
      const { rows: cfgRows } = await query(
        `SELECT pairs, shuffle_right, timer_mode, time_limit FROM edu.line_match_configs WHERE id = $1`,
        [level.module_config_id]
      );
      config = cfgRows[0] ?? null;
    } else if (level.module_type === "sudoku") {
      // the ONLY branch that differs from getLevel: cells keep `answer`
      const { rows: cfgRows } = await query(
        `SELECT bg_image_url, cells, difficulty, timer_mode, time_limit FROM edu.sudoku_configs WHERE id = $1`,
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
  programme: "p.name_zh", subject: "s.name_zh", topic: "ec.name_zh",
  activity: "cl.title_i18n->>'zh'", exercise_number: "cl.exercise_number", created_at: "cl.created_at",
};

export async function listAllActivities(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req, 20);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const programmeId = typeof req.query.programme_id === "string" ? req.query.programme_id : "";
    const subjectId = typeof req.query.subject_id === "string" ? req.query.subject_id : "";
    const categoryId = typeof req.query.category_id === "string" ? req.query.category_id : "";
    const sortKey = ACTIVITY_SORT_COLUMNS[String(req.query.sort)] ? String(req.query.sort) : "created_at";
    const order = req.query.order === "asc" ? "ASC" : "DESC";

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`(lower(cl.title_i18n->>'zh') LIKE $${params.length} OR lower(cl.title_i18n->>'en') LIKE $${params.length} OR lower(cl.exercise_number) LIKE $${params.length})`);
    }
    if (programmeId) { params.push(programmeId); conditions.push(`p.id = $${params.length}`); }
    if (subjectId) { params.push(subjectId); conditions.push(`s.id = $${params.length}`); }
    if (categoryId) { params.push(categoryId); conditions.push(`ec.id = $${params.length}`); }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const joins = `
       FROM edu.course_levels cl
       JOIN edu.courses c ON c.id = cl.course_id
       LEFT JOIN edu.exercise_categories ec ON ec.id = cl.category_id
       LEFT JOIN edu.subjects s ON s.id = ec.subject_id
       LEFT JOIN edu.programmes p ON p.id = s.programme_id`;

    const { rows: countRows } = await query(`SELECT count(*)::int AS total ${joins} ${whereClause}`, params);
    const total = countRows[0]?.total ?? 0;

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT cl.id, cl.course_id, cl.module_type, cl.title_i18n, cl.exercise_number, cl.created_at,
              c.title_i18n AS course_title_i18n,
              p.id AS programme_id, p.name_zh AS programme_name_zh,
              s.id AS subject_id, s.name_zh AS subject_name_zh,
              ec.id AS category_id, ec.name_zh AS topic_name_zh
       ${joins}
       ${whereClause}
       ORDER BY ${ACTIVITY_SORT_COLUMNS[sortKey]} ${order} NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.status(200).json({ success: true, message: "Success", data: rows, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) { serverError(res, err); }
}

// ── 连线配对: server-side answer checking ──────────────────────────────────────
// Same reasoning as checkSudoku/checkWordProblem — the correct left↔right
// pairing never reaches the client via getLevel (see that branch's
// comment), so validating what a student matched has to happen here,
// against the real edu.line_match_configs.pairs array. The student submits
// which left pair_index they connected to which right CONTENT (not an
// opaque right-side id, since no session persists that id's meaning
// between requests — see getLevel's line_match branch for why content is
// the stable, checkable thing here instead).
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
