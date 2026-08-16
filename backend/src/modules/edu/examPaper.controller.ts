// backend/src/modules/edu/examPaper.controller.ts
//
// 试卷/比赛系统 —— 跟 courses.controller.ts 管的 Activity 体系是两套
// 独立的东西：Activity 是挂在 Programme→Subject→Topic 底下的课程内容，
// 判分在前端做、正确答案本来就会下发给客户端（休闲游戏的信任模型）；
// 试卷是真正的考试/比赛（比如 SASMO 2026），题目专属这份试卷、不跟
// Activity 库共用，判分必须在这里（后端）完成——正确答案永远不下发到
// 学生作答期间能看到的任何响应里。
//
// 权限：
//   courses.manage —— 建/改/删试卷本身和题目（内容管理）
//   classes.manage —— 管理试卷的受邀学生名单（跟 addStudentToClass 同一
//                      个门槛，都是"决定谁能接触到这份内容"的操作）
//   学生端的路由只要求 authenticate，白名单检查在各自的 handler 内部做
//   （不是RBAC权限问题，是"这份资源是不是分给了这个人"的业务检查）。

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query, withTransaction } from "../../config/db.js";
import { ok, created, paginated, badRequest, notFound, forbidden, serverError } from "../../utils/response.js";
import { parsePagination } from "../../utils/pagination.js";

// ── 判分逻辑 ───────────────────────────────────────────────────────────────
// 跟 MultipleChoiceGame.tsx / FillBlankGame.tsx 客户端的判定逻辑完全对应，
// 只是这里跑在服务器上、拿的是数据库里存的 config（含正确答案），学生
// 提交的 answer 永远只是"填了什么"，不含判定结果。
// 跟游戏引擎一样：整题要么全对要么不对，不做部分给分——分值(marks)是
// 这道题的满分，不是按空/按选项拆分算分。

function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase();
}

// Fisher-Yates 洗牌——贴纸游戏的贴纸盘顺序打乱用，不能让顺序本身泄露
// 出"哪张贴纸对应哪个槽位"这层信息(比如如果不打乱，数组顺序天生就
// 跟槽位顺序一一对应，等于没加密)。
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function gradeQuestion(questionType: string, config: Record<string, unknown>, studentAnswer: unknown): boolean {
  if (questionType === "multiple_choice") {
    const correctIds = new Set((config.correct_option_ids as string[]) ?? []);
    const selected = Array.isArray(studentAnswer) ? (studentAnswer as string[]) : [];
    return selected.length === correctIds.size && selected.every((id) => correctIds.has(id));
  }
  if (questionType === "fill_blank") {
    const blanks = (config.blanks as Array<{ accepted_answers: string[] }>) ?? [];
    const values = Array.isArray(studentAnswer) ? (studentAnswer as string[]) : [];
    if (values.length !== blanks.length) return false;
    return blanks.every((b, i) => {
      const accepted = b.accepted_answers ?? [];
      const normalized = normalizeAnswer(String(values[i] ?? ""));
      return accepted.some((a) => normalizeAnswer(a) === normalized);
    });
  }
  if (questionType === "coloring") {
    const regions = (config.regions as Array<{ id: string; colorable: boolean; correct_color?: string }>) ?? [];
    const colorable = regions.filter((r) => r.colorable);
    const submitted = (studentAnswer && typeof studentAnswer === "object" ? studentAnswer : {}) as Record<string, string>;
    if (colorable.length === 0) return false; // 没有可上色区域的填色题算配置错误，保守判不对
    return colorable.every((r) => {
      const given = (submitted[r.id] ?? "").trim().toLowerCase();
      const correct = (r.correct_color ?? "").trim().toLowerCase();
      return given && given === correct;
    });
  }
  if (questionType === "sudoku") {
    // 数独的config结构照搬Activity那边的格式：blank_cells是"留空给学生
    // 填"的格子，每个格子有row/col/answer。学生提交的答案按"row-col"
    // 拼成字符串当key，值是学生填的数字。全部格子都对才算这题对，跟
    // 其他题型统一"全对才算对"的规则。
    const blankCells = (config.blank_cells as Array<{ row: number; col: number; answer: string }>) ?? [];
    const submitted = (studentAnswer && typeof studentAnswer === "object" ? studentAnswer : {}) as Record<string, string>;
    if (blankCells.length === 0) return false;
    return blankCells.every((c) => {
      const key = `${c.row}-${c.col}`;
      return String(submitted[key] ?? "").trim() === String(c.answer ?? "").trim();
    });
  }
  if (questionType === "sticker_game") {
    // 贴纸游戏的判分在考试场景下简化成"离散匹配"：每个目标位置(objects
    // 数组的每一项)对应一个ID，正确答案是这个位置本来该贴哪张贴纸
    // (image_url)。这跟原本Activity那边"按像素坐标容差判定"不一样——
    // 正式考试要求判定结果是确定的、可复现的，不适合用带容差的模糊
    // 位置判定，所以改成"这张贴纸有没有被拖到正确的那个槽位"这种离散
        // 判定，更适合服务器端严格判分。
    const objects = (config.objects as Array<{ id: string; image_url: string }>) ?? [];
    const submitted = (studentAnswer && typeof studentAnswer === "object" ? studentAnswer : {}) as Record<string, string>;
    if (objects.length === 0) return false;
    return objects.every((o) => submitted[o.id] === o.image_url);
  }
  return false; // 未知题型——保守起见判不对，不是判满分
}

// 学生作答界面/PDF 用的"去掉答案"版本——multiple_choice 去掉
// correct_option_ids，fill_blank 去掉每个 blank 的 accepted_answers，
// 只留 sentence_i18n 和"这里有几个空"这个数量信息（前端渲染输入框
// 要知道空的数量，但不需要、也不能知道答案是什么）。
function stripAnswers(questionType: string, config: Record<string, unknown>): Record<string, unknown> {
  if (questionType === "multiple_choice") {
    const { correct_option_ids, ...rest } = config;
    return rest;
  }
  if (questionType === "fill_blank") {
    const blanks = (config.blanks as Array<unknown>) ?? [];
    return { ...config, blanks: blanks.map(() => ({})) }; // 保留空的数量，去掉每个空的accepted_answers
  }
  if (questionType === "coloring") {
    const regions = (config.regions as Array<Record<string, unknown>>) ?? [];
    return { ...config, regions: regions.map((r) => { const { correct_color, ...rest } = r; return rest; }) };
  }
  if (questionType === "sudoku") {
    const blankCells = (config.blank_cells as Array<Record<string, unknown>>) ?? [];
    return { ...config, blank_cells: blankCells.map((c) => { const { answer, ...rest } = c; return rest; }) };
  }
  if (questionType === "sticker_game") {
    const objects = (config.objects as Array<Record<string, unknown>>) ?? [];
    // 位置/形状信息(x,y,w,h,rotation)保留——学生需要知道虚线框长什么样、
    // 放在哪；每个槽位本身去掉image_url(不透露"这个槽位该贴哪张"这层
    // 对应关系)。贴纸本身不是秘密，秘密的是对应关系，所以另外打乱顺序
    // 生成一份"贴纸盘"(tray)供学生拖动，貌似跟槽位无关联。
    const tray = shuffleArray(objects.map((o) => o.image_url as string));
    return { ...config, objects: objects.map((o) => { const { image_url, ...rest } = o; return rest; }), tray };
  }
  return config;
}

async function recomputeTotalMarks(paperId: string): Promise<void> {
  // 固定题贡献 marks 本身；随机槽贡献 marks×random_count(抽N题，每题这个分值)
  await query(
    `UPDATE edu.exam_papers SET total_marks = (
       SELECT COALESCE(SUM(
         CASE WHEN slot_type = 'random_category' THEN marks * COALESCE(random_count, 0) ELSE marks END
       ), 0) FROM edu.exam_paper_questions WHERE paper_id = $1
     ), updated_at = now() WHERE id = $1`,
    [paperId]
  );
}

// 试卷是不是真的存在——大部分 handler 开头都要做这个检查，抽出来避免
// 每个函数都重复写。
async function getPaperOr404(paperId: string) {
  const { rows } = await query(`SELECT * FROM edu.exam_papers WHERE id = $1`, [paperId]);
  return rows[0] ?? null;
}

// ── 试卷本身 CRUD (courses.manage) ──────────────────────────────────────────

export async function listExamPapers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req, 20);
    const { rows: countRows } = await query(`SELECT COUNT(*)::int AS total FROM edu.exam_papers`);
    const { rows } = await query(
      `SELECT ep.*, COUNT(DISTINCT eps.student_id)::int AS student_count,
              COUNT(DISTINCT ea.id)::int AS attempt_count
       FROM edu.exam_papers ep
       LEFT JOIN edu.exam_paper_students eps ON eps.paper_id = ep.id
       LEFT JOIN edu.exam_attempts ea ON ea.paper_id = ep.id
       GROUP BY ep.id ORDER BY ep.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    paginated(res, rows, countRows[0].total, page, limit);
  } catch (err) { serverError(res, err); }
}

export async function createExamPaper(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { title_i18n, description, time_limit_minutes, opens_at, closes_at, org_id, allow_retake, max_attempts, review_policy } = req.body as Record<string, unknown>;
    if (!title_i18n) { badRequest(res, "title_i18n is required"); return; }
    if (review_policy && !["immediate", "after_close"].includes(review_policy as string)) { badRequest(res, "review_policy 必须是 immediate 或 after_close"); return; }
    const { rows } = await query(
      `INSERT INTO edu.exam_papers (title_i18n, description, time_limit_minutes, opens_at, closes_at, org_id, created_by, allow_retake, max_attempts, review_policy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [JSON.stringify(title_i18n), description ?? null, time_limit_minutes ?? 60, opens_at ?? null, closes_at ?? null, org_id ?? null, req.user!.sub,
       allow_retake ?? false, (allow_retake ? (max_attempts ?? 3) : 1), review_policy ?? "after_close"]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

// 设计师编辑视图——带完整题目内容（含正确答案），courses.manage 才能碰。
export async function getExamPaperForEdit(req: AuthRequest, res: Response): Promise<void> {
  try {
    const paper = await getPaperOr404(req.params.paperId);
    if (!paper) { notFound(res, "试卷不存在"); return; }
    const { rows: questions } = await query(
      `SELECT * FROM edu.exam_paper_questions WHERE paper_id = $1 ORDER BY order_index ASC`,
      [req.params.paperId]
    );
    ok(res, { ...paper, questions });
  } catch (err) { serverError(res, err); }
}

export async function updateExamPaper(req: AuthRequest, res: Response): Promise<void> {
  try {
    const paper = await getPaperOr404(req.params.paperId);
    if (!paper) { notFound(res, "试卷不存在"); return; }
    const { title_i18n, description, time_limit_minutes, opens_at, closes_at, allow_retake, max_attempts, review_policy } = req.body as Record<string, unknown>;
    if (review_policy && !["immediate", "after_close"].includes(review_policy as string)) { badRequest(res, "review_policy 必须是 immediate 或 after_close"); return; }
    const { rows } = await query(
      `UPDATE edu.exam_papers SET
         title_i18n = COALESCE($2, title_i18n), description = $3,
         time_limit_minutes = COALESCE($4, time_limit_minutes),
         opens_at = $5, closes_at = $6,
         allow_retake = COALESCE($7, allow_retake), max_attempts = COALESCE($8, max_attempts),
         review_policy = COALESCE($9, review_policy),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.paperId, title_i18n ? JSON.stringify(title_i18n) : null, description ?? paper.description,
       time_limit_minutes ?? null, opens_at ?? null, closes_at ?? null,
       allow_retake ?? null, max_attempts ?? null, review_policy ?? null]
    );
    ok(res, rows[0], "Updated");
  } catch (err) { serverError(res, err); }
}

// 发布/收回——draft 才能发布（发布前应该已经加好题目），published 可以
// 收回改回 draft（比如发现题目有误要临时下架修正）；closed 是终态，一旦
// 有学生已经交卷计入成绩，不应该再被随便改回其他状态，这里索性不开放
// closed 的反向切换入口，真要重新开放同一份试卷用"复制成新试卷"而不是
// 改状态，避免混淆已有的作答记录属于"这一次"还是"上一次"。
export async function setExamPaperStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const paper = await getPaperOr404(req.params.paperId);
    if (!paper) { notFound(res, "试卷不存在"); return; }
    const { status } = req.body as { status?: string };
    if (!status || !["draft", "published", "closed"].includes(status)) { badRequest(res, "status 必须是 draft/published/closed"); return; }
    if (paper.status === "closed") { badRequest(res, "已结束的试卷不能再改状态，请另建一份新试卷"); return; }
    if (status === "published") {
      const { rows: qc } = await query(`SELECT COUNT(*)::int AS c FROM edu.exam_paper_questions WHERE paper_id = $1`, [req.params.paperId]);
      if (qc[0].c === 0) { badRequest(res, "发布前至少要加1道题目"); return; }
    }
    const { rows } = await query(`UPDATE edu.exam_papers SET status=$2, updated_at=now() WHERE id=$1 RETURNING *`, [req.params.paperId, status]);
    ok(res, rows[0], "Updated");
  } catch (err) { serverError(res, err); }
}

export async function deleteExamPaper(req: AuthRequest, res: Response): Promise<void> {
  try {
    const paper = await getPaperOr404(req.params.paperId);
    if (!paper) { notFound(res, "试卷不存在"); return; }
    const { rows: attempted } = await query(`SELECT COUNT(*)::int AS c FROM edu.exam_attempts WHERE paper_id = $1`, [req.params.paperId]);
    if (attempted[0].c > 0) { badRequest(res, "已经有学生作答过，不能删除——如果要下架请改状态成 closed"); return; }
    await query(`DELETE FROM edu.exam_papers WHERE id = $1`, [req.params.paperId]); // ON DELETE CASCADE 会连带删掉题目和学生名单
    ok(res, null, "Deleted");
  } catch (err) { serverError(res, err); }
}

// ── 试卷题目 CRUD (courses.manage) ──────────────────────────────────────────

function validateQuestionConfig(questionType: string, config: Record<string, unknown>): void {
  if (questionType === "multiple_choice") {
    const options = config.options as Array<{ id: string }> | undefined;
    const correctIds = config.correct_option_ids as string[] | undefined;
    if (!options || options.length < 2) throw new Error("选择题至少要有2个选项");
    if (!correctIds || correctIds.length === 0) throw new Error("选择题至少要勾选1个正确答案");
  } else if (questionType === "fill_blank") {
    const blanks = config.blanks as Array<{ accepted_answers: string[] }> | undefined;
    if (!blanks || blanks.length === 0) throw new Error("填充题至少要有1个空");
    if (blanks.some((b) => !b.accepted_answers?.length)) throw new Error("每个空都要至少填1个正确答案");
    // 英文/马来文版本的句子如果填了，里面"___"的数量必须跟中文版一致——
    // 答案(blanks数组)是按"第几个空"对应的，不同语言版本的空格数量一旦
    // 不一样，学生看不同语言时空的数量和答案就会错位。
    const sentI18n = config.sentence_i18n as Record<string, string> | undefined;
    const zhBlanks = (sentI18n?.zh?.match(/___/g) ?? []).length;
    for (const lang of ["en", "ms"] as const) {
      const text = sentI18n?.[lang];
      if (text && (text.match(/___/g) ?? []).length !== zhBlanks) {
        throw new Error(`${lang === "en" ? "英文" : "马来文"}版句子里"___"的数量要跟中文版一致(${zhBlanks}个)，不然不同语言的空会对不上答案`);
      }
    }
  } else if (questionType === "coloring") {
    const regions = config.regions as Array<{ colorable: boolean; correct_color?: string }> | undefined;
    const palette = config.palette as string[] | undefined;
    if (!palette || palette.length === 0) throw new Error("填色题至少要设1个调色盘颜色");
    if (!regions || regions.length === 0) throw new Error("填色题至少要放1个形状");
    const colorable = regions.filter((r) => r.colorable);
    if (colorable.length === 0) throw new Error("至少要有1个区域勾选\"可上色\"，不然学生没东西可以上色");
    if (colorable.some((r) => !r.correct_color)) throw new Error("每个可上色的区域都要设正确颜色");
  } else if (questionType === "sudoku") {
    const blankCells = config.blank_cells as Array<{ row: number; col: number; answer: string }> | undefined;
    if (!blankCells || blankCells.length === 0) throw new Error("数独至少要有1个留空给学生填的格子");
    if (blankCells.some((c) => !c.answer)) throw new Error("每个留空的格子都要有正确答案");
  } else if (questionType === "sticker_game") {
    const objects = config.objects as Array<{ id?: string; image_url?: string }> | undefined;
    if (!objects || objects.length === 0) throw new Error("贴纸游戏至少要有1个贴纸槽位");
    if (objects.some((o) => !o.id)) throw new Error("贴纸槽位缺少id——从Activity库导入时应该自动补上，请重新导入");
    if (objects.some((o) => !o.image_url)) throw new Error("每个贴纸槽位都要有对应的贴纸图片");
  } else {
    throw new Error(`不支持的题型: ${questionType}`);
  }
}

// 一"槽"要么是固定题(内容写死，跟以前一样)，要么是随机槽(声明从题库
// 某个分类抽N题，具体题目要到学生开始作答那一刻才抽)——两种槽位必填
// 的字段不一样，这里统一校验入口，报错信息直接告诉设计师少填了什么。
function validateQuestionSlot(body: Record<string, unknown>): void {
  const slotType = (body.slot_type as string) ?? "fixed";
  if (slotType === "fixed") {
    if (!body.question_type || !body.config) throw new Error("固定题需要 question_type 和 config");
    validateQuestionConfig(body.question_type as string, body.config as Record<string, unknown>);
  } else if (slotType === "random_category") {
    if (!body.random_category) throw new Error("随机槽需要指定 random_category(从题库哪个分类抽)");
    const count = body.random_count as number | undefined;
    if (!count || count < 1) throw new Error("随机槽需要指定 random_count(抽几题)，至少1题");
  } else {
    throw new Error(`不支持的槽位类型: ${slotType}`);
  }
}

// 加一道题——插到试卷末尾（order_index = 当前题目数）。已发布的试卷不
// 允许再改题目内容，避免有学生已经开始作答之后题目突然变了——要改的
// 话先把状态收回 draft。
export async function addExamPaperQuestion(req: AuthRequest, res: Response): Promise<void> {
  try {
    const paper = await getPaperOr404(req.params.paperId);
    if (!paper) { notFound(res, "试卷不存在"); return; }
    if (paper.status !== "draft") { badRequest(res, "已发布的试卷不能改题目，请先把状态收回草稿"); return; }
    const body = req.body as Record<string, unknown>;
    validateQuestionSlot(body);
    const slotType = (body.slot_type as string) ?? "fixed";
    const { rows: cnt } = await query(`SELECT COUNT(*)::int AS c FROM edu.exam_paper_questions WHERE paper_id = $1`, [req.params.paperId]);
    const { rows } = await query(
      `INSERT INTO edu.exam_paper_questions (paper_id, order_index, slot_type, question_type, marks, config, random_category, random_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        req.params.paperId, cnt[0].c, slotType,
        slotType === "fixed" ? (body.question_type as string) : null,
        (body.marks as number) ?? 1,
        slotType === "fixed" ? JSON.stringify(body.config) : null,
        slotType === "random_category" ? (body.random_category as string) : null,
        slotType === "random_category" ? (body.random_count as number) : null,
      ]
    );
    await recomputeTotalMarks(req.params.paperId);
    created(res, rows[0]);
  } catch (err) {
    if (err instanceof Error && !("code" in err)) { badRequest(res, err.message); return; }
    serverError(res, err);
  }
}

export async function updateExamPaperQuestion(req: AuthRequest, res: Response): Promise<void> {
  try {
    const paper = await getPaperOr404(req.params.paperId);
    if (!paper) { notFound(res, "试卷不存在"); return; }
    if (paper.status !== "draft") { badRequest(res, "已发布的试卷不能改题目，请先把状态收回草稿"); return; }
    const body = req.body as Record<string, unknown>;
    if (body.slot_type) validateQuestionSlot(body); // 只在明确要改槽位类型时才校验；单纯改分值这种局部更新不强制重新校验整槽
    const slotType = body.slot_type as string | undefined;
    const { rows } = await query(
      `UPDATE edu.exam_paper_questions SET
         slot_type = COALESCE($3, slot_type),
         question_type = CASE WHEN $3 = 'fixed' THEN $4 WHEN $3 = 'random_category' THEN NULL ELSE COALESCE($4, question_type) END,
         marks = COALESCE($5, marks),
         config = CASE WHEN $3 = 'fixed' THEN $6 WHEN $3 = 'random_category' THEN NULL ELSE COALESCE($6, config) END,
         random_category = CASE WHEN $3 = 'random_category' THEN $7 WHEN $3 = 'fixed' THEN NULL ELSE COALESCE($7, random_category) END,
         random_count = CASE WHEN $3 = 'random_category' THEN $8 WHEN $3 = 'fixed' THEN NULL ELSE COALESCE($8, random_count) END,
         updated_at = now()
       WHERE id = $2 AND paper_id = $1 RETURNING *`,
      [
        req.params.paperId, req.params.questionId, slotType ?? null,
        body.question_type ?? null, body.marks ?? null,
        body.config ? JSON.stringify(body.config) : null,
        body.random_category ?? null, body.random_count ?? null,
      ]
    );
    if (!rows[0]) { notFound(res, "题目不存在"); return; }
    await recomputeTotalMarks(req.params.paperId);
    ok(res, rows[0], "Updated");
  } catch (err) {
    if (err instanceof Error && !("code" in err)) { badRequest(res, err.message); return; }
    serverError(res, err);
  }
}

// 删掉一道题之后，后面题目的 order_index 要往前补齐，不然会留洞（不影响
// 功能，但下次排序/插入容易搞混），干脆用事务一次性重新编号。
export async function deleteExamPaperQuestion(req: AuthRequest, res: Response): Promise<void> {
  try {
    const paper = await getPaperOr404(req.params.paperId);
    if (!paper) { notFound(res, "试卷不存在"); return; }
    if (paper.status !== "draft") { badRequest(res, "已发布的试卷不能改题目，请先把状态收回草稿"); return; }
    await withTransaction(async (client) => {
      const { rowCount } = await client.query(`DELETE FROM edu.exam_paper_questions WHERE id = $1 AND paper_id = $2`, [req.params.questionId, req.params.paperId]);
      if (!rowCount) throw new Error("题目不存在");
      const { rows: remaining } = await client.query(
        `SELECT id FROM edu.exam_paper_questions WHERE paper_id = $1 ORDER BY order_index ASC`,
        [req.params.paperId]
      );
      for (let i = 0; i < remaining.length; i++) {
        await client.query(`UPDATE edu.exam_paper_questions SET order_index = $2 WHERE id = $1`, [remaining[i].id, i]);
      }
    });
    await recomputeTotalMarks(req.params.paperId);
    ok(res, null, "Deleted");
  } catch (err) {
    if (err instanceof Error && !("code" in err)) { notFound(res, err.message); return; }
    serverError(res, err);
  }
}

// 拖拽调整题目顺序——前端传完整的新顺序(题目id数组)，后端按这个顺序
// 重新写 order_index，一次性事务处理。
export async function reorderExamPaperQuestions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const paper = await getPaperOr404(req.params.paperId);
    if (!paper) { notFound(res, "试卷不存在"); return; }
    if (paper.status !== "draft") { badRequest(res, "已发布的试卷不能改题目顺序，请先把状态收回草稿"); return; }
    const { question_ids } = req.body as { question_ids?: string[] };
    if (!Array.isArray(question_ids) || question_ids.length === 0) { badRequest(res, "question_ids is required"); return; }
    await withTransaction(async (client) => {
      const { rows: existing } = await client.query(`SELECT id FROM edu.exam_paper_questions WHERE paper_id = $1`, [req.params.paperId]);
      const existingIds = new Set(existing.map((r) => r.id));
      if (question_ids.length !== existing.length || question_ids.some((id) => !existingIds.has(id))) {
        throw new Error("question_ids 必须正好是这份试卷现有的全部题目id，不能多也不能少");
      }
      for (let i = 0; i < question_ids.length; i++) {
        await client.query(`UPDATE edu.exam_paper_questions SET order_index = $2 WHERE id = $1`, [question_ids[i], i]);
      }
    });
    ok(res, null, "Reordered");
  } catch (err) {
    if (err instanceof Error && !("code" in err)) { badRequest(res, err.message); return; }
    serverError(res, err);
  }
}

// ── 题库 (courses.manage) —— 随机槽从这里抽题 ───────────────────────────────

// 从 Activity 库(course_levels)找可以导入的题目——只支持 multiple_choice/
// fill_blank/sudoku/sticker_game 这几种(跟考试系统已经支持判分的题型
// 对应)。返回的是"预览"，不是真的导入，前端选中后再调
// importFromActivity 才会真正复制一份进题库。
export async function listImportableActivities(req: AuthRequest, res: Response): Promise<void> {
  try {
    const moduleType = req.query.module_type as string | undefined;
    const SUPPORTED = ["multiple_choice", "fill_blank", "sudoku", "sticker_game"];
    if (!moduleType || !SUPPORTED.includes(moduleType)) { badRequest(res, `module_type 必须是 ${SUPPORTED.join("/")}`); return; }
    const { page, limit, offset } = parsePagination(req, 30);
    const { rows: countRows } = await query(`SELECT COUNT(*)::int AS total FROM edu.course_levels WHERE module_type = $1`, [moduleType]);
    const { rows } = await query(
      `SELECT id, title_i18n, module_type, config FROM edu.course_levels WHERE module_type = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
      [moduleType, limit, offset]
    );
    paginated(res, rows, countRows[0].total, page, limit);
  } catch (err) { serverError(res, err); }
}

// 真正导入——把选中的Activity的config**复制**一份存进题库(不是引用，
// 这份复制品之后Activity那边怎么改都不影响它，判分安全性也是独立的)。
// 贴纸游戏(objects数组)原本没有稳定id，只靠数组顺序区分——考试判分需要
// 每个槽位有个不会变的id，这里导入时统一补上。数独/选择题/填充题本来
// 就有稳定的字段结构，不用额外处理。
export async function importFromActivity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { activity_id, category } = req.body as { activity_id?: string; category?: string };
    if (!activity_id) { badRequest(res, "activity_id is required"); return; }
    if (!category?.trim()) { badRequest(res, "category is required"); return; }
    const { rows } = await query(`SELECT module_type, config FROM edu.course_levels WHERE id = $1`, [activity_id]);
    const activity = rows[0];
    if (!activity) { notFound(res, "找不到这个Activity"); return; }
    const SUPPORTED = ["multiple_choice", "fill_blank", "sudoku", "sticker_game"];
    if (!SUPPORTED.includes(activity.module_type)) { badRequest(res, `暂不支持导入 ${activity.module_type} 这个类型`); return; }

    let config = activity.config as Record<string, unknown>;
    if (activity.module_type === "sticker_game") {
      const objects = (config.objects as Array<Record<string, unknown>>) ?? [];
      config = { ...config, objects: objects.map((o, i) => ({ id: o.id ?? `slot_${i}`, ...o })) };
    }

    validateQuestionConfig(activity.module_type, config);
    const { rows: created2 } = await query(
      `INSERT INTO edu.exam_question_bank (category, question_type, config, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [category.trim(), activity.module_type, JSON.stringify(config), req.user!.sub]
    );
    created(res, created2[0]);
  } catch (err) {
    if (err instanceof Error && !("code" in err)) { badRequest(res, err.message); return; }
    serverError(res, err);
  }
}

export async function listQuestionBankCategories(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT category, COUNT(*)::int AS question_count FROM edu.exam_question_bank GROUP BY category ORDER BY category ASC`
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function listQuestionBank(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req, 30);
    const category = req.query.category as string | undefined;
    const params: unknown[] = [];
    let where = "";
    if (category) { params.push(category); where = `WHERE category = $${params.length}`; }
    const { rows: countRows } = await query(`SELECT COUNT(*)::int AS total FROM edu.exam_question_bank ${where}`, params);
    const { rows } = await query(
      `SELECT * FROM edu.exam_question_bank ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    paginated(res, rows, countRows[0].total, page, limit);
  } catch (err) { serverError(res, err); }
}

export async function createQuestionBankQuestion(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { category, question_type, config } = req.body as { category?: string; question_type?: string; config?: Record<string, unknown> };
    if (!category?.trim()) { badRequest(res, "category is required"); return; }
    if (!question_type || !config) { badRequest(res, "question_type and config are required"); return; }
    validateQuestionConfig(question_type, config);
    const { rows } = await query(
      `INSERT INTO edu.exam_question_bank (category, question_type, config, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [category.trim(), question_type, JSON.stringify(config), req.user!.sub]
    );
    created(res, rows[0]);
  } catch (err) {
    if (err instanceof Error && !("code" in err)) { badRequest(res, err.message); return; }
    serverError(res, err);
  }
}

export async function updateQuestionBankQuestion(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { category, question_type, config } = req.body as { category?: string; question_type?: string; config?: Record<string, unknown> };
    if (question_type && config) validateQuestionConfig(question_type, config);
    const { rows } = await query(
      `UPDATE edu.exam_question_bank SET
         category = COALESCE($2, category), question_type = COALESCE($3, question_type),
         config = COALESCE($4, config), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.questionId, category?.trim() ?? null, question_type ?? null, config ? JSON.stringify(config) : null]
    );
    if (!rows[0]) { notFound(res, "题目不存在"); return; }
    ok(res, rows[0], "Updated");
  } catch (err) {
    if (err instanceof Error && !("code" in err)) { badRequest(res, err.message); return; }
    serverError(res, err);
  }
}

// 删之前检查有没有已经被抽进过某次作答快照——如果有，说明这道题已经
// 被实际考过、判过分，删掉题库原题不影响那些历史快照(exam_attempt_
// questions 存的是复制进去的内容，不是引用)，可以放心删，不用挡着。
export async function deleteQuestionBankQuestion(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rowCount } = await query(`DELETE FROM edu.exam_question_bank WHERE id = $1`, [req.params.questionId]);
    if (!rowCount) { notFound(res, "题目不存在"); return; }
    ok(res, null, "Deleted");
  } catch (err) { serverError(res, err); }
}

// ── 受邀学生名单/白名单管理 (classes.manage) ────────────────────────────────

export async function listExamPaperStudents(req: AuthRequest, res: Response): Promise<void> {
  try {
    const paper = await getPaperOr404(req.params.paperId);
    if (!paper) { notFound(res, "试卷不存在"); return; }
    const { rows } = await query(
      `SELECT eps.*, up.full_name_zh, up.full_name_en, u.username, u.email,
              ea.status AS attempt_status, ea.score, ea.max_score, ea.submitted_at
       FROM edu.exam_paper_students eps
       JOIN auth.users u ON u.id = eps.student_id
       LEFT JOIN auth.user_profiles up ON up.user_id = u.id
       LEFT JOIN edu.exam_attempts ea ON ea.paper_id = eps.paper_id AND ea.student_id = eps.student_id
         AND ea.id = (SELECT id FROM edu.exam_attempts WHERE paper_id = eps.paper_id AND student_id = eps.student_id ORDER BY started_at DESC LIMIT 1)
       WHERE eps.paper_id = $1 ORDER BY eps.invited_at ASC`,
      [req.params.paperId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// 批量加学生——传学生id数组，已经在名单里的会被 ON CONFLICT 跳过（不
// 会重复插入报错），返回本次实际新加的人数，方便前端提示"已加X人，
// 其中Y人本来就在名单里"这种反馈。
export async function addExamPaperStudents(req: AuthRequest, res: Response): Promise<void> {
  try {
    const paper = await getPaperOr404(req.params.paperId);
    if (!paper) { notFound(res, "试卷不存在"); return; }
    const { student_ids } = req.body as { student_ids?: string[] };
    if (!Array.isArray(student_ids) || student_ids.length === 0) { badRequest(res, "student_ids is required"); return; }
    const { rows } = await query(
      `INSERT INTO edu.exam_paper_students (paper_id, student_id, invited_by)
       SELECT $1, sid, $2 FROM unnest($3::uuid[]) AS sid
       ON CONFLICT (paper_id, student_id) DO NOTHING
       RETURNING student_id`,
      [req.params.paperId, req.user!.sub, student_ids]
    );
    ok(res, { added: rows.length, requested: student_ids.length }, "Added");
  } catch (err) { serverError(res, err); }
}

export async function removeExamPaperStudent(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rowCount } = await query(
      `DELETE FROM edu.exam_paper_students WHERE paper_id = $1 AND student_id = $2`,
      [req.params.paperId, req.params.studentId]
    );
    if (!rowCount) { notFound(res, "这个学生不在名单里"); return; }
    ok(res, null, "Removed");
  } catch (err) { serverError(res, err); }
}

// ── 学生端：作答流程 (authenticate only，白名单/时间窗口检查在内部做) ────────

// 学生自己被分配到的全部试卷——列表页用，带每份试卷自己的作答状态。
export async function listMyExamPapers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT ep.id, ep.title_i18n, ep.description, ep.time_limit_minutes, ep.opens_at, ep.closes_at,
              ep.status, ep.total_marks,
              ea.id AS attempt_id, ea.status AS attempt_status, ea.score, ea.submitted_at
       FROM edu.exam_paper_students eps
       JOIN edu.exam_papers ep ON ep.id = eps.paper_id
       LEFT JOIN edu.exam_attempts ea ON ea.paper_id = ep.id AND ea.student_id = eps.student_id
         AND ea.id = (SELECT id FROM edu.exam_attempts WHERE paper_id = ep.id AND student_id = eps.student_id ORDER BY started_at DESC LIMIT 1)
       WHERE eps.student_id = $1 AND ep.status = 'published'
       ORDER BY ep.opens_at ASC NULLS LAST, ep.created_at DESC`,
      [req.user!.sub]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// 运营/设计师"试玩预览"——跟学生正式作答是两条完全独立的路径：不检查
// 白名单、不要求已发布(草稿也能试玩)、不检查开考/截止时间；随机槽现场
// 抽一次题(不持久化，每次预览都可能抽到不同的，方便测试随机效果)；
// 直接把完整config(含正确答案)吐出来——判分交给前端就地算，不写入
// exam_attempts 这张表，天然不会污染真实的排行榜/学生重考次数统计。
// 权限跟编辑试卷一致，本来就能看到完整答案，不需要额外的"隐藏答案"
// 这层保护。
export async function getExamPaperPreview(req: AuthRequest, res: Response): Promise<void> {
  try {
    const paper = await getPaperOr404(req.params.paperId);
    if (!paper) { notFound(res, "试卷不存在"); return; }
    const { rows: slots } = await query(
      `SELECT * FROM edu.exam_paper_questions WHERE paper_id = $1 ORDER BY order_index ASC`,
      [req.params.paperId]
    );
    if (slots.length === 0) { badRequest(res, "这份试卷还没有题目"); return; }

    const questions: Array<{ question_type: string; marks: number; config: Record<string, unknown> }> = [];
    for (const slot of slots) {
      if (slot.slot_type === "random_category") {
        const { rows: drawn } = await query(
          `SELECT question_type, config FROM edu.exam_question_bank WHERE category = $1 ORDER BY random() LIMIT $2`,
          [slot.random_category, slot.random_count]
        );
        for (const d of drawn) questions.push({ question_type: d.question_type, marks: slot.marks, config: d.config });
      } else {
        questions.push({ question_type: slot.question_type, marks: slot.marks, config: slot.config });
      }
    }

    ok(res, {
      title_i18n: paper.title_i18n, time_limit_minutes: paper.time_limit_minutes,
      total_marks: questions.reduce((sum, q) => sum + q.marks, 0),
      questions: questions.map((q, i) => ({ id: `preview_${i}`, order_index: i, ...q })),
    });
  } catch (err) { serverError(res, err); }
}

// 开始作答——检查白名单+发布状态+时间窗口+重考次数上限，创建一条
// in_progress 的 exam_attempts记录，并把这次实际要问的题目"物化"进
// exam_attempt_questions：固定题直接复制内容；随机槽现场从题库对应
// 分类里随机抽 random_count 题，一并复制进快照——这份快照之后判分、
// 之后回看，都只认它，不再依赖考卷/题库当下的最新状态。
// 如果已经有一条in_progress的（比如学生中途刷新页面），直接续用同一条、
// 复用它当初物化好的题目快照，不重新抽——同一次作答从头到尾用同一批题。
export async function startExamAttempt(req: AuthRequest, res: Response): Promise<void> {
  try {
    const paper = await getPaperOr404(req.params.paperId);
    if (!paper) { notFound(res, "试卷不存在"); return; }
    if (paper.status !== "published") { forbidden(res, "这份试卷还没开放作答"); return; }

    const now = new Date();
    if (paper.opens_at && now < new Date(paper.opens_at)) { forbidden(res, "还没到开考时间"); return; }
    if (paper.closes_at && now > new Date(paper.closes_at)) { forbidden(res, "已经过了截止时间"); return; }

    const { rows: roster } = await query(
      `SELECT 1 FROM edu.exam_paper_students WHERE paper_id = $1 AND student_id = $2`,
      [req.params.paperId, req.user!.sub]
    );
    if (!roster[0]) { forbidden(res, "你不在这份试卷的受邀名单里"); return; }

    // 已经用完的次数——in_progress的那条不算"用掉"的一次，只有交过卷
    // (submitted/graded)才算数，避免"开始了但还没交"占掉一次配额。
    const { rows: doneCount } = await query(
      `SELECT COUNT(*)::int AS c FROM edu.exam_attempts WHERE paper_id = $1 AND student_id = $2 AND status != 'in_progress'`,
      [req.params.paperId, req.user!.sub]
    );
    const attemptsUsed = doneCount[0].c;
    const attemptLimit = paper.allow_retake ? paper.max_attempts : 1;
    if (attemptsUsed >= attemptLimit) {
      forbidden(res, paper.allow_retake ? `已经考满 ${attemptLimit} 次上限，不能再考了` : "你已经交过这份试卷了，不能重新作答");
      return;
    }

    let { rows: existing } = await query(
      `SELECT * FROM edu.exam_attempts WHERE paper_id = $1 AND student_id = $2 AND status = 'in_progress'`,
      [req.params.paperId, req.user!.sub]
    );
    let attempt = existing[0];

    if (!attempt) {
      // 新开一次作答——先物化题目快照，再用快照的真实总分建 attempt。
      attempt = await withTransaction(async (client) => {
        const { rows: slots } = await client.query(
          `SELECT * FROM edu.exam_paper_questions WHERE paper_id = $1 ORDER BY order_index ASC`,
          [req.params.paperId]
        );

        const materialized: Array<{ question_type: string; marks: number; config: Record<string, unknown>; paper_question_id: string }> = [];
        for (const slot of slots) {
          if (slot.slot_type === "random_category") {
            const { rows: drawn } = await client.query(
              `SELECT question_type, config FROM edu.exam_question_bank WHERE category = $1 ORDER BY random() LIMIT $2`,
              [slot.random_category, slot.random_count]
            );
            if (drawn.length < slot.random_count) {
              throw new Error(`题库里"${slot.random_category}"分类只有${drawn.length}题，不够抽${slot.random_count}题——请先去题库给这个分类加题`);
            }
            for (const d of drawn) {
              materialized.push({ question_type: d.question_type, marks: slot.marks, config: d.config, paper_question_id: slot.id });
            }
          } else {
            materialized.push({ question_type: slot.question_type, marks: slot.marks, config: slot.config, paper_question_id: slot.id });
          }
        }

        const maxScore = materialized.reduce((sum, m) => sum + m.marks, 0);
        const { rows: newAttempt } = await client.query(
          `INSERT INTO edu.exam_attempts (paper_id, student_id, max_score) VALUES ($1,$2,$3) RETURNING *`,
          [req.params.paperId, req.user!.sub, maxScore]
        );

        for (let i = 0; i < materialized.length; i++) {
          const m = materialized[i];
          await client.query(
            `INSERT INTO edu.exam_attempt_questions (attempt_id, paper_question_id, order_index, question_type, marks, config)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [newAttempt[0].id, m.paper_question_id, i, m.question_type, m.marks, JSON.stringify(m.config)]
          );
        }
        return newAttempt[0];
      });
    }

    const { rows: attemptQuestions } = await query(
      `SELECT id, order_index, question_type, marks, config FROM edu.exam_attempt_questions WHERE attempt_id = $1 ORDER BY order_index ASC`,
      [attempt.id]
    );
    const safeQuestions = attemptQuestions.map((q) => ({ ...q, config: stripAnswers(q.question_type, q.config) }));

    // 剩余时间——从 attempt.started_at 算起，不是每次请求都重新给满
    // time_limit_minutes，不然学生刷新页面就能无限续时间。
    const elapsedSeconds = (Date.now() - new Date(attempt.started_at).getTime()) / 1000;
    const remainingSeconds = Math.max(0, paper.time_limit_minutes * 60 - elapsedSeconds);

    ok(res, {
      attempt_id: attempt.id, started_at: attempt.started_at,
      title_i18n: paper.title_i18n, remaining_seconds: Math.round(remainingSeconds),
      questions: safeQuestions,
    });
  } catch (err) {
    if (err instanceof Error && !("code" in err)) { badRequest(res, err.message); return; }
    serverError(res, err);
  }
}

// 交卷——服务器重新核对每一题，算出真实分数，不信任前端传上来的分数。
// 判分对象是 exam_attempt_questions(这次作答的题目快照)，不是
// exam_paper_questions——学生提交的 answers 现在按"快照题目的id"作为
// key(不是考卷槽位id，因为随机槽一个槽对应好几道具体题，没有单一id可
// 对应，只有物化后的快照题目才有稳定的、这次作答专属的id)。
export async function submitExamAttempt(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows: attempts } = await query(`SELECT * FROM edu.exam_attempts WHERE id = $1`, [req.params.attemptId]);
    const attempt = attempts[0];
    if (!attempt) { notFound(res, "作答记录不存在"); return; }
    if (attempt.student_id !== req.user!.sub) { forbidden(res, "这不是你的作答记录"); return; }
    if (attempt.status !== "in_progress") { badRequest(res, "这份作答已经交过了"); return; }

    const { answers } = req.body as { answers?: Record<string, unknown> };
    const submittedAnswers = answers ?? {};

    const { rows: questions } = await query(
      `SELECT id, question_type, marks, config FROM edu.exam_attempt_questions WHERE attempt_id = $1`,
      [req.params.attemptId]
    );

    let score = 0;
    for (const q of questions) {
      const isCorrect = gradeQuestion(q.question_type, q.config, submittedAnswers[q.id]);
      if (isCorrect) score += q.marks;
    }

    const { rows: updated } = await query(
      `UPDATE edu.exam_attempts SET status='submitted', submitted_at=now(), score=$2, answers=$3 WHERE id=$1 RETURNING *`,
      [req.params.attemptId, score, JSON.stringify(submittedAnswers)]
    );
    ok(res, { score, max_score: updated[0].max_score, submitted_at: updated[0].submitted_at }, "Submitted");
  } catch (err) { serverError(res, err); }
}

// 交卷之后立即查——只有总分，不带每题详情。总分本身可以立刻看(常见的
// "考完马上知道大概考得怎样"体验)，但"这题对不对/正确答案是什么"这种
// 逐题细节要等下面 getExamAttemptReview 那个接口，且被截止时间挡住。
export async function getExamAttempt(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(`SELECT * FROM edu.exam_attempts WHERE id = $1`, [req.params.attemptId]);
    const attempt = rows[0];
    if (!attempt) { notFound(res, "作答记录不存在"); return; }
    if (attempt.student_id !== req.user!.sub) { forbidden(res, "这不是你的作答记录"); return; }
    ok(res, { id: attempt.id, status: attempt.status, score: attempt.score, max_score: attempt.max_score, submitted_at: attempt.submitted_at });
  } catch (err) { serverError(res, err); }
}

// 逐题回看详情(每题对不对、正确答案是什么)——按试卷的 review_policy
// 决定要不要等：自主练习(immediate)交卷立刻能看，没有"泄题给其他同学"
// 这个顾虑；正式比赛(after_close，默认值)必须等 closes_at 过了才能看，
// 不然先交卷的学生看到答案会泄题给还没考的同学。如果比赛模式的试卷
// 没设置 closes_at(没给截止时间)，保守起见视为"一直不能看逐题详情"
// (不是自动放行)——真要给学生看，出题者应该明确把 review_policy 设成
// immediate，而不是靠"忘记填截止时间"这种意外方式放行。
export async function getExamAttemptReview(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(`SELECT * FROM edu.exam_attempts WHERE id = $1`, [req.params.attemptId]);
    const attempt = rows[0];
    if (!attempt) { notFound(res, "作答记录不存在"); return; }
    if (attempt.student_id !== req.user!.sub) { forbidden(res, "这不是你的作答记录"); return; }
    if (attempt.status === "in_progress") { badRequest(res, "还没交卷，不能查看详情"); return; }

    const paper = await getPaperOr404(attempt.paper_id);
    if (paper?.review_policy !== "immediate") {
      if (!paper?.closes_at) { forbidden(res, "这份试卷还不能查看逐题详情"); return; }
      if (new Date() < new Date(paper.closes_at)) { forbidden(res, "要等考试截止时间过了才能查看逐题详情，现在只能看总分"); return; }
    }

    const { rows: questions } = await query(
      `SELECT id, order_index, question_type, marks, config FROM edu.exam_attempt_questions WHERE attempt_id = $1 ORDER BY order_index ASC`,
      [req.params.attemptId]
    );
    const submittedAnswers = (attempt.answers ?? {}) as Record<string, unknown>;
    const breakdown = questions.map((q) => ({
      id: q.id, order_index: q.order_index, question_type: q.question_type, marks: q.marks,
      config: q.config, // 这里带完整config(含正确答案)——已经通过上面的检查，可以看了
      student_answer: submittedAnswers[q.id] ?? null,
      is_correct: gradeQuestion(q.question_type, q.config, submittedAnswers[q.id]),
    }));
    ok(res, { id: attempt.id, score: attempt.score, max_score: attempt.max_score, submitted_at: attempt.submitted_at, questions: breakdown });
  } catch (err) { serverError(res, err); }
}

// 我在这份试卷上的历史成绩——重考多次的情况下，看每一次分别考了多少分。
export async function listMyAttemptsForPaper(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT id, status, score, max_score, started_at, submitted_at
       FROM edu.exam_attempts WHERE paper_id = $1 AND student_id = $2 ORDER BY started_at ASC`,
      [req.params.paperId, req.user!.sub]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// 排行榜——每个学生取历史最佳一次成绩参与排名(不是每次尝试都占一个
// 名次，不然重考次数多的人会把榜单刷满，失去排行榜的意义)。只统计
// status='submitted'的作答，in_progress的不算数。
export async function getExamPaperLeaderboard(req: AuthRequest, res: Response): Promise<void> {
  try {
    const paper = await getPaperOr404(req.params.paperId);
    if (!paper) { notFound(res, "试卷不存在"); return; }
    const { rows } = await query(
      `SELECT u.id AS student_id, up.full_name_zh, up.full_name_en, u.username, MAX(ea.score) AS best_score,
              MIN(ea.submitted_at) FILTER (WHERE ea.score = (SELECT MAX(score) FROM edu.exam_attempts WHERE paper_id = ea.paper_id AND student_id = ea.student_id)) AS best_submitted_at
       FROM edu.exam_attempts ea
       JOIN auth.users u ON u.id = ea.student_id
       LEFT JOIN auth.user_profiles up ON up.user_id = u.id
       WHERE ea.paper_id = $1 AND ea.status = 'submitted'
       GROUP BY u.id, up.full_name_zh, up.full_name_en, u.username
       ORDER BY best_score DESC, best_submitted_at ASC`, // 同分的话，谁先达到这个最佳成绩排前面
      [req.params.paperId]
    );
    ok(res, { total_marks: paper.total_marks, rankings: rows });
  } catch (err) { serverError(res, err); }
}

// ── PDF 生成 (courses.manage) ────────────────────────────────────────────────
// 用 Puppeteer(无头浏览器)把试卷渲染成HTML再转PDF——中文排版效果比轻量
// PDF库好很多，代价是这个依赖比较重(内建一份Chromium)。这里用一个单例
// browser 实例，第一次调用时才真正启动(懒加载)，之后的请求复用同一个
// 浏览器进程开新页面，不必每次都重新拉起一个完整浏览器(那样会很慢)。
import puppeteer, { type Browser } from "puppeteer";

let browserInstance: Browser | null = null;
async function getBrowser(): Promise<Browser> {
  if (browserInstance) return browserInstance;
  browserInstance = await puppeteer.launch({
    headless: true,
    // Docker容器里跑无头Chrome，默认沙盒机制经常因为容器权限问题起不来，
    // 这两个参数是headless Chrome在容器环境的标准解法(牺牲一点隔离性
    // 换取能跑起来——容器本身已经是隔离边界，可以接受)。
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  return browserInstance;
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// 填色题形状渲染——矩形/圆形/三角形是常规形状；立体方块(cube-top/
// cube-left/cube-right)用最简单的等距投影画法：顶面是个菱形，左右两面
// 各是一个平行四边形，三个面共享同一个中心点(x,y)和边长(w，h不使用)。
// ⚠️ 这套坐标公式前端画布(设计器+学生作答+成绩回看)必须用同一套，不然
// 设计师看到的形状跟学生实际点击的区域会对不上——改这里的话前端三处
// 也要跟着改。
function renderColoringShapeSvg(r: { shape: string; x: number; y: number; w: number; h: number; rotation: number }, fill: string): string {
  const { shape, x, y, w, rotation } = r;
  const rot = rotation ? ` transform="rotate(${rotation} ${x} ${y})"` : "";
  if (shape === "rectangle") {
    return `<rect x="${x - w / 2}" y="${y - r.h / 2}" width="${w}" height="${r.h}" fill="${fill}" stroke="#333" stroke-width="1.5"${rot} />`;
  }
  if (shape === "circle") {
    return `<ellipse cx="${x}" cy="${y}" rx="${w / 2}" ry="${r.h / 2}" fill="${fill}" stroke="#333" stroke-width="1.5"${rot} />`;
  }
  if (shape === "triangle") {
    const points = `${x},${y - r.h / 2} ${x + w / 2},${y + r.h / 2} ${x - w / 2},${y + r.h / 2}`;
    return `<polygon points="${points}" fill="${fill}" stroke="#333" stroke-width="1.5"${rot} />`;
  }
  if (shape === "cube-top" || shape === "cube-left" || shape === "cube-right") {
    const s = w; // 立体方块的"边长"存在w里，h不使用
    let points = "";
    if (shape === "cube-top") points = `${x},${y - s} ${x + s * 0.87},${y - s * 0.5} ${x},${y} ${x - s * 0.87},${y - s * 0.5}`;
    else if (shape === "cube-left") points = `${x - s * 0.87},${y - s * 0.5} ${x},${y} ${x},${y + s} ${x - s * 0.87},${y + s * 0.5}`;
    else points = `${x},${y} ${x + s * 0.87},${y - s * 0.5} ${x + s * 0.87},${y + s * 0.5} ${x},${y + s}`;
    return `<polygon points="${points}" fill="${fill}" stroke="#333" stroke-width="1.5" />`; // 立体方块的三个面不套rotation，整体旋转意义不大，先不支持
  }
  return "";
}

// 生成试卷PDF用的HTML——固定输出中文版面(zh优先，没有zh才退到en)，
// 选择题选项用A/B/C/D标号，填充题把"___"换成一条留白线。答案永远不
// 出现在这份HTML里——这是给学生打印手写作答用的卷子，不是老师用的
// 附答案版本(附答案版本如果以后需要，应该是另一个单独的、权限更严格
// 的接口，不能共用这个)。
function buildPaperHtml(paper: Record<string, unknown>, questions: Array<Record<string, unknown>>, lang: string): string {
  const t = (i18n: Record<string, string> | undefined) => i18n?.[lang] || i18n?.zh || i18n?.en || "";
  const title = t(paper.title_i18n as Record<string, string>) || "试卷";
  const questionsHtml = questions.map((q, i) => {
    const config = q.config as Record<string, unknown>;
    const num = i + 1;
    const marks = q.marks as number;
    if (q.question_type === "multiple_choice") {
      const questionText = t(config.question_i18n as Record<string, string>);
      const options = (config.options as Array<{ id: string; text_i18n: Record<string, string> }>) ?? [];
      const optionsHtml = options.map((o, j) => {
        const label = String.fromCharCode(65 + j); // A, B, C, D...
        const text = t(o.text_i18n);
        return `<div class="option">${label}. ${escapeHtml(text)}</div>`;
      }).join("");
      return `<div class="question">
        <div class="q-head"><span class="q-num">${num}.</span> ${escapeHtml(questionText)} <span class="q-marks">(${marks}分)</span></div>
        <div class="options">${optionsHtml}</div>
      </div>`;
    }
    if (q.question_type === "fill_blank") {
      const sentence = t(config.sentence_i18n as Record<string, string>);
      const filled = escapeHtml(sentence).replace(/___/g, '<span class="blank-line"></span>');
      return `<div class="question">
        <div class="q-head"><span class="q-num">${num}.</span> ${filled} <span class="q-marks">(${marks}分)</span></div>
      </div>`;
    }
    if (q.question_type === "coloring") {
      const regions = (config.regions as Array<{ id: string; shape: string; x: number; y: number; w: number; h: number; rotation: number; colorable: boolean; decoration_color?: string }>) ?? [];
      const canvasW = (config.canvas_width as number) ?? 400, canvasH = (config.canvas_height as number) ?? 300;
      return `<div class="question">
        <div class="q-head"><span class="q-num">${num}.</span> 请按题目要求上色 <span class="q-marks">(${marks}分)</span></div>
        <svg viewBox="0 0 ${canvasW} ${canvasH}" style="width:70%;max-width:320px;border:1px solid #ccc;margin:8px 0 0 24px;">          ${regions.map((r) => renderColoringShapeSvg(r, r.colorable ? "#ffffff" : (r.decoration_color ?? "#eeeeee"))).join("")}
        </svg>
      </div>`;
    }
    return "";
  }).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 20mm 18mm; }
  body { font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 13px; color: #1a1a1a; }
  .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #333; padding-bottom: 14px; }
  .header h1 { font-size: 22px; margin: 0 0 8px; }
  .header .meta { font-size: 12px; color: #555; }
  .name-line { margin: 16px 0; font-size: 13px; }
  .name-line span { display: inline-block; border-bottom: 1px solid #999; min-width: 160px; margin-right: 30px; }
  .question { margin-bottom: 20px; page-break-inside: avoid; }
  .q-head { font-weight: 600; line-height: 1.7; }
  .q-num { margin-right: 4px; }
  .q-marks { font-weight: 400; color: #888; font-size: 11px; }
  .options { margin-top: 6px; margin-left: 20px; }
  .option { margin-bottom: 4px; }
  .blank-line { display: inline-block; min-width: 60px; border-bottom: 1px solid #333; margin: 0 3px; }
</style></head>
<body>
  <div class="header">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">总分：${paper.total_marks}分　时限：${paper.time_limit_minutes}分钟</div>
  </div>
  <div class="name-line">姓名：<span></span>班级：<span></span>考号：<span></span></div>
  ${questionsHtml}
</body></html>`;
}

export async function generateExamPaperPdf(req: AuthRequest, res: Response): Promise<void> {
  try {
    const paper = await getPaperOr404(req.params.paperId);
    if (!paper) { notFound(res, "试卷不存在"); return; }
    const lang = (req.query.lang as string) ?? "zh";
    if (!["zh", "en", "ms"].includes(lang)) { badRequest(res, "lang 必须是 zh/en/ms"); return; }
    const { rows: questions } = await query(
      `SELECT * FROM edu.exam_paper_questions WHERE paper_id = $1 ORDER BY order_index ASC`,
      [req.params.paperId]
    );
    if (questions.length === 0) { badRequest(res, "这份试卷还没有题目"); return; }

    const html = buildPaperHtml(paper, questions, lang);
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "domcontentloaded" }); // setContent的waitUntil类型比goto窄，不支持networkidle0；这份HTML全是内嵌文字+CSS没有外部资源要等，domcontentloaded足够
      // ⚠️ 新版 Puppeteer 的 page.pdf() 返回的是 Uint8Array，不是真正的 Node
      // Buffer——Express 的 res.send() 内部靠 Buffer.isBuffer() 判断"这是不是
      // 二进制内容"，判断为 false 的话会自动退化成 res.json()，把这段二进制
      // 数据当成普通对象做 JSON.stringify()，产出类似 {"0":37,"1":80,...}
      // 这种畸形JSON——这正是之前"生成的PDF文件打不开"的根因，文件名/大小
      // 看起来都正常，但内容其实是一段JSON文字，不是真的PDF二进制。
      // Buffer.from() 显式转换成真正的 Buffer，Express 才能正确识别并原样
      // 发送二进制内容。
      const pdfBuffer = Buffer.from(await page.pdf({ format: "A4", printBackground: true }));
      const title18n = paper.title_i18n as Record<string, string>;
      const title = title18n?.[lang] || title18n?.zh || "exam";
      // Content-Disposition 的 filename="..." 是给纯ASCII用的旧语法，中文标题
      // 直接塞进去(哪怕先 encodeURIComponent)不符合RFC 6266，容易导致部分
      // 浏览器/下载工具解析失败或存出乱码文件名。正确做法是用 filename*=
      // UTF-8''<percent-encoded> 这个专门支持非ASCII文件名的语法，同时保留
      // 一个ASCII fallback文件名(filename=...)给不认 filename* 语法的老客户端。
      const asciiFallback = "exam-paper.pdf";
      const encodedTitle = encodeURIComponent(`${title}.pdf`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedTitle}`);
      res.send(pdfBuffer);
    } finally {
      await page.close(); // 页面用完就关，浏览器进程本身留着复用给下次请求
    }
  } catch (err) { serverError(res, err); }
}