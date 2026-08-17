// backend/src/modules/edu/shareLinks.controller.ts
//
// 通用分享链接——设计师这边生成/查看/撤销都走 courses.manage 权限，跟
// 平常的内容管理接口一样；公开访问那几个函数(resolveShareToken 打头的)
// 故意不挂 authenticate，因为访问这些接口的人根本没有账号——token本身
// 就是这条请求的凭证，校验逻辑在函数内部自己做(查表、看过期/撤销)，
// 不是靠中间件。
//
// 这一版只实现了 resource_type='lesson' 的公开播放/判分——试卷和
// Activity 的分享是下一阶段要做的，同一张 share_links 表已经预留了
// resource_type字段，届时照着这里 getSharedLesson/checkSharedBankQuestion
// 的模式加对应的函数就行，不用改这张表结构。
//
// 公开访客的作答不会被记录进 media_progress——这些是匿名访客，没有
// student_id可以挂，而且本来就不该跟真实学生的学习记录混在一起，逻辑
// 上跟"试玩预览"是同一个原则(该功能只服务"能不能看到内容、能不能判
// 分对错"，不服务"追踪这个人的学习进度")。

import type { Request, Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { randomBytes } from "crypto";
import { query } from "../../config/db.js";
import { ok, created, badRequest, notFound, forbidden, serverError } from "../../utils/response.js";
import { gradeQuestion, stripAnswers } from "./examPaper.controller.js";
import { bankQuestionPreview } from "./lessons.controller.js";
import { buildLevelPayload } from "./courses.controller.js";

const RESOURCE_TYPES = ["lesson", "exam_paper", "activity"];

// ── 设计师管理 (courses.manage) ──────────────────────────────────────────────

export async function createShareLink(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { resource_type, resource_id, expires_in_days } = req.body as Record<string, unknown>;
    if (!resource_type || !RESOURCE_TYPES.includes(resource_type as string)) {
      badRequest(res, `resource_type must be one of: ${RESOURCE_TYPES.join(", ")}`); return;
    }
    if (!resource_id) { badRequest(res, "resource_id is required"); return; }

    // exam_paper 的分享还在开发中——只有 lesson 和 activity 这两种真正做出了
    // 公开播放/判分那一套，试卷这块先在生成这一步挡住，不让设计师生成一个
    // 点开会404的死链接。
    if (resource_type === "exam_paper") {
      badRequest(res, "试卷的分享链接还在开发中，目前支持分享课时和Activity"); return;
    }

    let title: string | null = null;
    if (resource_type === "lesson") {
      const { rows: lessonRows } = await query(`SELECT title_i18n FROM edu.lessons WHERE id = $1`, [resource_id]);
      if (!lessonRows.length) { notFound(res, "课时不存在"); return; }
      const titleObj = lessonRows[0].title_i18n as Record<string, string>;
      title = titleObj?.zh ?? titleObj?.en ?? null;
    } else if (resource_type === "activity") {
      const { rows: levelRows } = await query(`SELECT title_i18n FROM edu.course_levels WHERE id = $1`, [resource_id]);
      if (!levelRows.length) { notFound(res, "Activity不存在"); return; }
      const titleObj = levelRows[0].title_i18n as Record<string, string>;
      title = titleObj?.zh ?? titleObj?.en ?? null;
    }

    const token = randomBytes(24).toString("hex"); // 48个字符，够长不容易被猜到
    const expiresAt = Number.isInteger(expires_in_days) && (expires_in_days as number) > 0
      ? new Date(Date.now() + (expires_in_days as number) * 86400_000).toISOString()
      : null;

    const { rows } = await query(
      `INSERT INTO edu.share_links (token, resource_type, resource_id, title, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [token, resource_type, resource_id, title, req.user!.sub, expiresAt]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function listShareLinks(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { resource_type, resource_id } = req.query as Record<string, string>;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (resource_type) { params.push(resource_type); conditions.push(`resource_type = $${params.length}`); }
    if (resource_id) { params.push(resource_id); conditions.push(`resource_id = $${params.length}`); }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await query(
      `SELECT * FROM edu.share_links ${whereClause} ORDER BY created_at DESC`,
      params
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function revokeShareLink(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `UPDATE edu.share_links SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING *`,
      [id]
    );
    if (!rows.length) { notFound(res, "分享链接不存在，或者已经被撤销了"); return; }
    ok(res, rows[0], "已撤销");
  } catch (err) { serverError(res, err); }
}

// ── 公开访问 (不要 authenticate——token本身就是凭证) ──────────────────────────

// 校验token有效——存在、没过期、没被撤销。resourceType不传就不限制类型，
// 传了就顺便确认这个token确实是给这种资源用的(比如防止拿lesson的token
// 硬凑exam_paper的接口)。
async function getActiveShareLink(token: string, resourceType?: string) {
  const { rows } = await query(
    `SELECT * FROM edu.share_links
     WHERE token = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [token]
  );
  if (!rows.length) return null;
  if (resourceType && rows[0].resource_type !== resourceType) return null;
  return rows[0];
}

export async function resolveShareToken(req: Request, res: Response): Promise<void> {
  try {
    const { token } = req.params;
    const link = await getActiveShareLink(token);
    if (!link) { notFound(res, "这个分享链接无效、已过期，或者已经被撤销了"); return; }
    await query(`UPDATE edu.share_links SET view_count = view_count + 1 WHERE id = $1`, [link.id]);
    ok(res, { resource_type: link.resource_type, resource_id: link.resource_id, title: link.title });
  } catch (err) { serverError(res, err); }
}

export async function getSharedLesson(req: Request, res: Response): Promise<void> {
  try {
    const { token } = req.params;
    const link = await getActiveShareLink(token, "lesson");
    if (!link) { notFound(res, "这个分享链接无效、已过期，或者已经被撤销了"); return; }

    const { rows: lessonRows } = await query(
      `SELECT id, course_id, title_i18n, order_index FROM edu.lessons WHERE id = $1`,
      [link.resource_id]
    );
    if (!lessonRows.length) { notFound(res, "这堂课已经被删除了"); return; }

    // 跟设计师视角 lessons.controller.ts#getLesson 的quiz步骤处理是同一套
    // 逻辑——只给分类/题型/预览文字，bank_config(含正确答案)绝不会离开
    // 这个函数。
    const { rows: steps } = await query(
      `SELECT ls.id, ls.order_index, ls.step_type, ls.media_url, ls.media_title, ls.slide_urls,
              ls.course_level_id, cl.title_i18n AS level_title_i18n, cl.module_type,
              ls.bank_question_id, eqb.category AS bank_category, eqb.question_type AS bank_question_type,
              eqb.config AS bank_config
       FROM edu.lesson_steps ls
       LEFT JOIN edu.course_levels cl ON cl.id = ls.course_level_id
       LEFT JOIN edu.exam_question_bank eqb ON eqb.id = ls.bank_question_id
       WHERE ls.lesson_id = $1
       ORDER BY ls.order_index ASC`,
      [link.resource_id]
    );
    const cleanedSteps = steps.map((s) => {
      if (s.step_type !== "quiz" || !s.bank_config) return s;
      const { bank_config, ...rest } = s;
      return { ...rest, bank_question_preview: bankQuestionPreview(s.bank_question_type, bank_config) };
    });

    ok(res, { ...lessonRows[0], steps: cleanedSteps });
  } catch (err) { serverError(res, err); }
}

// 播放题库题目(去答案版)——给分享出去的课时里的quiz步骤用，跟
// examApi.playBankQuestion是同一个作用，只是这里是公开访问版本，靠
// token(不是登录态)确认"这道题确实属于这个分享出去的课时"。
export async function playSharedBankQuestion(req: Request, res: Response): Promise<void> {
  try {
    const { token, questionId } = req.params;
    const link = await getActiveShareLink(token, "lesson");
    if (!link) { notFound(res, "这个分享链接无效、已过期，或者已经被撤销了"); return; }

    // 确认这道题真的是这堂课里的某个quiz步骤引用的题目，不是随便传一个
    // questionId就能白嫖任意题库题目内容(哪怕是去答案版，也不该无差别
    // 开放整个题库)。
    const { rows: stepRows } = await query(
      `SELECT 1 FROM edu.lesson_steps WHERE lesson_id = $1 AND bank_question_id = $2 AND step_type = 'quiz'`,
      [link.resource_id, questionId]
    );
    if (!stepRows.length) { forbidden(res, "这道题不属于这堂分享出去的课"); return; }

    const { rows } = await query(`SELECT id, category, question_type, config FROM edu.exam_question_bank WHERE id = $1`, [questionId]);
    if (!rows.length) { notFound(res, "题目不存在——可能已经从题库删除了"); return; }
    const q = rows[0];
    ok(res, { id: q.id, category: q.category, question_type: q.question_type, config: stripAnswers(q.question_type, q.config) });
  } catch (err) { serverError(res, err); }
}

export async function checkSharedBankQuestion(req: Request, res: Response): Promise<void> {
  try {
    const { token, questionId } = req.params;
    const { answer } = req.body as { answer?: unknown };
    const link = await getActiveShareLink(token, "lesson");
    if (!link) { notFound(res, "这个分享链接无效、已过期，或者已经被撤销了"); return; }

    const { rows: stepRows } = await query(
      `SELECT 1 FROM edu.lesson_steps WHERE lesson_id = $1 AND bank_question_id = $2 AND step_type = 'quiz'`,
      [link.resource_id, questionId]
    );
    if (!stepRows.length) { forbidden(res, "这道题不属于这堂分享出去的课"); return; }

    const { rows } = await query(`SELECT question_type, config FROM edu.exam_question_bank WHERE id = $1`, [questionId]);
    if (!rows.length) { notFound(res, "题目不存在——可能已经从题库删除了"); return; }
    const q = rows[0];
    const isCorrect = gradeQuestion(q.question_type, q.config, answer);
    ok(res, { is_correct: isCorrect });
  } catch (err) { serverError(res, err); }
}

// ── Activity 分享——公开播放/判分 ──────────────────────────────────────────────
//
// getSharedActivity 复用 courses.controller.ts#buildLevelPayload，跟
// getLevel是同一套"根据module_type查配置表、隐藏该藏的答案"逻辑，只是
// 不走订阅/年级/家长试玩那些权限检查——分享token本身就是授权凭证。
export async function getSharedActivity(req: Request, res: Response): Promise<void> {
  try {
    const { token } = req.params;
    const link = await getActiveShareLink(token, "activity");
    if (!link) { notFound(res, "这个分享链接无效、已过期，或者已经被撤销了"); return; }

    const { rows } = await query(
      `SELECT cl.id, cl.course_id, cl.order_index, cl.module_type, cl.module_config_id,
              cl.title_i18n, cl.video_url_i18n, cl.ppt_url_i18n, cl.illustration_url, cl.points_reward,
              cl.explanation_text, cl.explanation_image_url, cl.explanation_video_url, cl.exercise_number,
              cl.hint_text, cl.audio_url,
              cl.activity_type, cl.teaching_modes, cl.difficulty, cl.age_group_min, cl.age_group_max,
              cl.duration_minutes, cl.learning_outcomes, cl.skills_developed, cl.language, cl.tags, cl.cover_image_url
       FROM edu.course_levels cl WHERE cl.id = $1`,
      [link.resource_id]
    );
    if (!rows.length) { notFound(res, "这个Activity已经被删除了"); return; }

    const payload = await buildLevelPayload(rows[0]);
    ok(res, payload);
  } catch (err) { serverError(res, err); }
}

// 确认这个token确实对应这个Activity——三个判分代理共用，不然任何人拿着
// 任意一个有效token就能核对任意levelId的答案，等于变相绕开了"分享的是
// 哪一个Activity"这层限制。
async function assertSharedActivity(token: string, levelId: string) {
  const link = await getActiveShareLink(token, "activity");
  if (!link || link.resource_id !== levelId) return false;
  return true;
}

export async function checkSharedSudoku(req: Request, res: Response): Promise<void> {
  try {
    const { token, levelId } = req.params;
    if (!(await assertSharedActivity(token, levelId))) { notFound(res, "这个分享链接无效、已过期，或者已经被撤销了"); return; }
    const { values } = req.body as { values: (number | null)[] };
    if (!Array.isArray(values)) { badRequest(res, "values must be an array"); return; }

    const { rows: levelRows } = await query(`SELECT module_config_id FROM edu.course_levels WHERE id = $1 AND module_type = 'sudoku'`, [levelId]);
    if (!levelRows.length) { notFound(res, "Sudoku level not found"); return; }
    const { rows: cfgRows } = await query(`SELECT layout, cells, blank_cells FROM edu.sudoku_configs WHERE id = $1`, [levelRows[0].module_config_id]);
    if (!cfgRows.length) { notFound(res, "Sudoku config not found"); return; }

    const isGrid = cfgRows[0].layout === "grid";
    const answers: number[] = isGrid
      ? (cfgRows[0].blank_cells as Array<{ answer: string }>).map((c) => parseInt(c.answer, 10))
      : (cfgRows[0].cells as Array<{ answer: number }>).map((c) => c.answer);
    if (values.length !== answers.length) { badRequest(res, `values must have exactly ${answers.length} entries`); return; }

    const correct = answers.map((a, i) => values[i] === a);
    ok(res, { correct, allCorrect: correct.every(Boolean), solution: answers });
  } catch (err) { serverError(res, err); }
}

export async function checkSharedColoring(req: Request, res: Response): Promise<void> {
  try {
    const { token, levelId } = req.params;
    if (!(await assertSharedActivity(token, levelId))) { notFound(res, "这个分享链接无效、已过期，或者已经被撤销了"); return; }
    const { fills } = req.body as { fills: Record<string, string> };
    if (!fills || typeof fills !== "object") { badRequest(res, "fills must be an object"); return; }

    const { rows: levelRows } = await query(`SELECT module_config_id FROM edu.course_levels WHERE id = $1 AND module_type = 'coloring'`, [levelId]);
    if (!levelRows.length) { notFound(res, "Coloring level not found"); return; }
    const { rows: cfgRows } = await query(`SELECT regions FROM edu.coloring_configs WHERE id = $1`, [levelRows[0].module_config_id]);
    if (!cfgRows.length) { notFound(res, "Config not found"); return; }

    type Region = { marker_color: string; rule: "specific" | "free"; target_color?: string };
    const regions = cfgRows[0].regions as Region[];
    const results = regions.map((r) => {
      const filled = fills[r.marker_color];
      const correct = r.rule === "free" ? !!filled : (!!filled && filled.toLowerCase() === r.target_color?.toLowerCase());
      return { marker_color: r.marker_color, correct };
    });
    ok(res, { results, allCorrect: results.every((r) => r.correct), totalRegions: regions.length });
  } catch (err) { serverError(res, err); }
}

export async function checkSharedWordProblem(req: Request, res: Response): Promise<void> {
  try {
    const { token, levelId } = req.params;
    if (!(await assertSharedActivity(token, levelId))) { notFound(res, "这个分享链接无效、已过期，或者已经被撤销了"); return; }
    const { value } = req.body as { value: number };
    if (typeof value !== "number") { badRequest(res, "value must be a number"); return; }

    const { rows: levelRows } = await query(`SELECT module_config_id FROM edu.course_levels WHERE id = $1 AND module_type = 'word_problem'`, [levelId]);
    if (!levelRows.length) { notFound(res, "Word problem level not found"); return; }
    const { rows: cfgRows } = await query(`SELECT custom_answer FROM edu.word_problem_configs WHERE id = $1`, [levelRows[0].module_config_id]);
    if (!cfgRows.length || cfgRows[0].custom_answer === null) { notFound(res, "This exercise doesn't have a custom answer set"); return; }

    const correctAnswer = Number(cfgRows[0].custom_answer);
    const correct = Math.abs(value - correctAnswer) < 0.001;
    ok(res, { correct, answer: correctAnswer });
  } catch (err) { serverError(res, err); }
}