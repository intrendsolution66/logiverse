// backend/src/modules/edu/lessons.controller.ts
//
// 课程编排流程 — a lesson is an ordered sequence of steps: video, PPT, or a
// REFERENCE to an existing course_level (any module_type — spot_diff, maze,
// counting, word_problem, whatever). Matches the brief's example: video/PPT
// explanation → curated question-bank steps → interactive practice →
// random-generation steps, all as one ordered lesson a teacher assembled.
//
// Course↔Lesson 现在是真正的多对多（edu.course_lessons）——一个 Lesson
// 可以先独立建（不挂在任何 Course 下面），也可以同时被好几个不同的
// Course 引用，跟 Activity 不需要绑在某个 Course 下面是同一个思路，只是
// Activity↔Lesson 那边靠 lesson_steps 本身的普通外键就够了，Course↔Lesson
// 这边因为要记"同一个 Lesson 在不同 Course 里排第几"这种每个关联自己的
// 顺序信息，所以另外建了这张关联表，不能只靠 lessons.course_id 单一外键
// 解决。
//
// Gated by courses.manage, same permission as everything else in the
// course-authoring toolkit — building a lesson is course design, not a
// separate role.

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { ok, created, badRequest, notFound, serverError } from "../../utils/response.js";
import { gradeQuestion, stripAnswers } from "./examPaper.controller.js";

const STEP_TYPES = ["video", "ppt", "level", "quiz"];

// quiz 步骤的预览文字——只给设计器的步骤列表用来显示"这道题大概是什么"，
// 不带任何正确答案信息(跟 level 步骤只返回 title/module_type、不返回
// 完整config是同一个安全模型；quiz步骤的完整题目内容+判分要等课时播放
// 器实际播放到这一步时，另外走专属的"去掉答案版"接口取，不在这里)。
export function bankQuestionPreview(questionType: string, config: Record<string, unknown>): string {
  if (questionType === "multiple_choice") {
    const q = config.question_i18n as Record<string, string> | undefined;
    return q?.zh ?? q?.en ?? "（选择题）";
  }
  if (questionType === "fill_blank") {
    const s = config.sentence_i18n as Record<string, string> | undefined;
    return s?.zh ?? s?.en ?? "（填充题）";
  }
  return "（题库题目）";
}

// 某门课底下的 Lesson 列表——现在查的是 course_lessons 这张关联表，不是
// lessons.course_id。排序用的是"这个 Lesson 在这门课底下"的 order_index，
// 同一个 Lesson 挂在别的课下面顺序可以不一样。
export async function listLessons(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { courseId } = req.params;
    const { rows } = await query(
      `SELECT l.id, l.title_i18n, cl.order_index, l.created_at,
              (SELECT count(*)::int FROM edu.lesson_steps ls WHERE ls.lesson_id = l.id) AS step_count
       FROM edu.course_lessons cl
       JOIN edu.lessons l ON l.id = cl.lesson_id
       WHERE cl.course_id = $1
       ORDER BY cl.order_index ASC, l.created_at ASC`,
      [courseId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// 建一个全新的 Lesson，同时直接把它挂进这门课底下——这是最常见的用法
// （在某门课的编排页面点"新建课时"）。course_id 顺带写进 lessons 那个旧
// 栏位（当"最初在哪门课底下建的"历史记录），真正决定"这个 Lesson 现在
// 出现在哪些课程里"的是下面那笔 INSERT INTO course_lessons。
export async function createLesson(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { courseId } = req.params;
    const { title_i18n, order_index } = req.body as { title_i18n?: object; order_index?: number };
    if (!title_i18n) { badRequest(res, "title_i18n is required"); return; }

    const { rows } = await query(
      `INSERT INTO edu.lessons (course_id, title_i18n, order_index, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title_i18n, created_at`,
      [courseId, JSON.stringify(title_i18n), order_index ?? 0, req.user!.sub]
    );
    const lesson = rows[0];
    await query(
      `INSERT INTO edu.course_lessons (course_id, lesson_id, order_index) VALUES ($1,$2,$3)`,
      [courseId, lesson.id, order_index ?? 0]
    );
    created(res, { ...lesson, order_index: order_index ?? 0 });
  } catch (err) { serverError(res, err); }
}

// 新增：独立建 Lesson，不挂在任何 Course 底下——路由挂 POST /lessons。
// 跟 createActivity 是同一个思路：course_id 从路由参数或请求体读都行，
// 两个都没有就是 null，也就不会写进 course_lessons（没有 courseId 就没
// 什么好关联的）。
export async function createStandaloneLesson(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { title_i18n } = req.body as { title_i18n?: object };
    if (!title_i18n) { badRequest(res, "title_i18n is required"); return; }
    const { rows } = await query(
      `INSERT INTO edu.lessons (course_id, title_i18n, order_index, created_by)
       VALUES (NULL, $1, 0, $2)
       RETURNING id, title_i18n, created_at`,
      [JSON.stringify(title_i18n), req.user!.sub]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

// 把一个已经存在的 Lesson 引用进另一门课——这就是"复用"的实际动作：不复
// 制一份新的 Lesson，只是在关联表里加一行。同一个 lesson_id 不能在同一
// 个 course_id 底下重复挂两次（course_lessons 的主键就是 (course_id,
// lesson_id)），重复挂会被数据库拦下来，这里转成好读的错误信息。
export async function linkLessonToCourse(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { courseId, lessonId } = req.params;
    const { order_index } = req.body as { order_index?: number };

    const { rows: lessonRows } = await query(`SELECT id FROM edu.lessons WHERE id = $1`, [lessonId]);
    if (!lessonRows.length) { notFound(res, "Lesson not found"); return; }

    let idx = order_index;
    if (idx == null) {
      const { rows: maxRows } = await query(`SELECT COALESCE(MAX(order_index), -1) + 1 AS next_index FROM edu.course_lessons WHERE course_id = $1`, [courseId]);
      idx = maxRows[0].next_index;
    }

    try {
      await query(`INSERT INTO edu.course_lessons (course_id, lesson_id, order_index) VALUES ($1,$2,$3)`, [courseId, lessonId, idx]);
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === "23505") { badRequest(res, "这个课时已经在这门课里了，不能重复加"); return; }
      throw err;
    }
    ok(res, null, "已加入这门课");
  } catch (err) { serverError(res, err); }
}

// 把一个 Lesson 从某门课里移除——只解除关联，Lesson 本身、它底下的步骤
// 都不会被删掉（万一它还被别的课程引用，或者只是暂时不想放在这门课里）。
// 真的要把 Lesson 整个删掉（连同步骤、连同它在所有课程里的关联）用下面
// 的 deleteLesson。
export async function unlinkLessonFromCourse(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { courseId, lessonId } = req.params;
    const { rowCount } = await query(`DELETE FROM edu.course_lessons WHERE course_id = $1 AND lesson_id = $2`, [courseId, lessonId]);
    if (!rowCount) { notFound(res, "这门课里没有这个课时"); return; }
    ok(res, null, "已从这门课移除（课时本身还在，如果没有别的课程用到，可以去单独删除）");
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
      `SELECT id, course_id, title_i18n FROM edu.lessons WHERE id = $1`,
      [lessonId]
    );
    if (!lessonRows.length) { notFound(res, "Lesson not found"); return; }

    // 这个 Lesson 现在挂在哪些课程底下——多对多之后一个 Lesson 可能同时
    // 属于好几门课，编辑页面需要知道这件事（比如提醒"这个课时也被别的课
    // 程用到，改动会影响所有引用它的地方"）。
    const { rows: courseRows } = await query(
      `SELECT c.id, c.title_i18n FROM edu.course_lessons cl JOIN edu.courses c ON c.id = cl.course_id WHERE cl.lesson_id = $1`,
      [lessonId]
    );

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
      [lessonId]
    );
    // quiz 步骤——把预览文字算出来，同时去掉 bank_config(不该带着完整
    // config、更不该带着正确答案离开这个函数），只留分类/题型/预览三样
    // 够设计器步骤列表显示用的信息。
    const cleanedSteps = steps.map((s) => {
      if (s.step_type !== "quiz" || !s.bank_config) return s;
      const { bank_config, ...rest } = s;
      return { ...rest, bank_question_preview: bankQuestionPreview(s.bank_question_type, bank_config) };
    });
    ok(res, { ...lessonRows[0], courses: courseRows, steps: cleanedSteps });
  } catch (err) { serverError(res, err); }
}

export async function updateLesson(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { lessonId } = req.params;
    const { title_i18n } = req.body as { title_i18n?: object };

    const { rows } = await query(
      `UPDATE edu.lessons SET title_i18n = COALESCE($2, title_i18n)
       WHERE id = $1
       RETURNING id, title_i18n`,
      [lessonId, title_i18n ? JSON.stringify(title_i18n) : null]
    );
    if (!rows.length) { notFound(res, "Lesson not found"); return; }
    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

// 删除课时——连带删掉它底下的步骤（步骤脱离课时没有意义，不像课程底下的
// Activity还能独立存在被别的课时复用，所以这里直接级联删，不用像
// deleteCourse那样先拦一手）。course_lessons 里所有引用这个 Lesson 的关
// 联也会跟着没（外键 ON DELETE CASCADE），也就是说：真的删除会把这个
// Lesson 从"所有"引用过它的课程里一起拿掉，不是只影响某一门课——只想
// 从某一门课移除、Lesson本身留着，用上面的 unlinkLessonFromCourse。
export async function deleteLesson(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { lessonId } = req.params;
    await query(`DELETE FROM edu.lesson_steps WHERE lesson_id = $1`, [lessonId]);
    const { rowCount } = await query(`DELETE FROM edu.lessons WHERE id = $1`, [lessonId]);
    if (!rowCount) { notFound(res, "Lesson not found"); return; }
    ok(res, null, "Deleted");
  } catch (err) { serverError(res, err); }
}

// 在某门课底下调整 Lesson 顺序——只影响这门课里的 order_index，不影响
// 这个 Lesson 在"别的"课程里的顺序（多对多之后，同一个 Lesson 在不同课
// 程里排第几可以不一样，这也是为什么排序信息存在 course_lessons 而不是
// lessons 表本身）。逻辑跟 moveStep 一样，交换相邻两个的 order_index。
export async function moveLessonInCourse(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { courseId, lessonId } = req.params;
    const { direction } = req.body as { direction?: "up" | "down" };
    if (direction !== "up" && direction !== "down") { badRequest(res, "direction must be 'up' or 'down'"); return; }

    const { rows: rows1 } = await query(
      `SELECT order_index FROM edu.course_lessons WHERE course_id = $1 AND lesson_id = $2`, [courseId, lessonId]
    );
    if (!rows1.length) { notFound(res, "这门课里没有这个课时"); return; }
    const currentIndex = rows1[0].order_index;

    const { rows: neighborRows } = await query(
      direction === "up"
        ? `SELECT lesson_id, order_index FROM edu.course_lessons WHERE course_id = $1 AND order_index < $2 ORDER BY order_index DESC LIMIT 1`
        : `SELECT lesson_id, order_index FROM edu.course_lessons WHERE course_id = $1 AND order_index > $2 ORDER BY order_index ASC LIMIT 1`,
      [courseId, currentIndex]
    );
    if (!neighborRows.length) { ok(res, null, "Already at the edge — nothing to swap with"); return; }
    const neighbor = neighborRows[0];

    // 两两互换：邻居挪到"我"原本的位置，"我"挪到邻居原本的位置。
    await query(`UPDATE edu.course_lessons SET order_index = $1 WHERE course_id = $2 AND lesson_id = $3`, [currentIndex, courseId, neighbor.lesson_id]);
    await query(`UPDATE edu.course_lessons SET order_index = $1 WHERE course_id = $2 AND lesson_id = $3`, [neighbor.order_index, courseId, lessonId]);
    ok(res, null, "Reordered");
  } catch (err) { serverError(res, err); }
}

export async function createStep(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { lessonId } = req.params;
    const { step_type, media_url, media_title, course_level_id, bank_question_id, slide_urls } = req.body as Record<string, unknown>;
    if (!step_type || !STEP_TYPES.includes(step_type as string)) {
      badRequest(res, `step_type must be one of: ${STEP_TYPES.join(", ")}`); return;
    }
    if ((step_type === "video" || step_type === "ppt") && !media_url) {
      badRequest(res, `media_url is required for ${step_type} steps`); return;
    }
    if (step_type === "level" && !course_level_id) {
      badRequest(res, "course_level_id is required for level steps"); return;
    }
    if (step_type === "quiz") {
      if (!bank_question_id) { badRequest(res, "bank_question_id is required for quiz steps"); return; }
      const { rows: bankRows } = await query(`SELECT id FROM edu.exam_question_bank WHERE id = $1`, [bank_question_id]);
      if (!bankRows.length) { badRequest(res, "题库里找不到这道题——可能已经被删除了，请重新选一道"); return; }
    }
    // slide_urls 只对 ppt 步骤有意义——多页幻灯片图片URL数组，前端PPT
    // 上传时会自动带上(见 assets.controller.ts#createAsset 转换出来的
    // slide_urls)；没传就是单页(只有 media_url 那一页)，向后兼容旧数据。
    const cleanSlideUrls = step_type === "ppt" && Array.isArray(slide_urls)
      ? slide_urls.filter((u): u is string => typeof u === "string")
      : null;

    // Always append at the end — order_index is never taken from the
    // client, so "add a step" and "reorder steps" (moveStep, below) are the
    // only two ways order_index ever changes, and they can't conflict.
    const { rows: maxRows } = await query(
      `SELECT COALESCE(MAX(order_index), -1) + 1 AS next_index FROM edu.lesson_steps WHERE lesson_id = $1`,
      [lessonId]
    );
    const nextIndex = maxRows[0].next_index;

    const { rows } = await query(
      `INSERT INTO edu.lesson_steps (lesson_id, order_index, step_type, media_url, media_title, course_level_id, bank_question_id, slide_urls)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, order_index, step_type, media_url, media_title, course_level_id, bank_question_id, slide_urls`,
      [
        lessonId, nextIndex, step_type, media_url ?? null, media_title ?? null, course_level_id ?? null, bank_question_id ?? null,
        cleanSlideUrls && cleanSlideUrls.length > 0 ? JSON.stringify(cleanSlideUrls) : null,
      ]
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

// ── quiz 步骤——学生播放/判分 (authenticate only) ────────────────────────────
//
// 只要求登录，不额外做权限校验：能拿到这个 bank_question_id，说明前面
// 已经通过了 lesson 本身的访问门槛(Self Guided Learning 那层的订阅/年级
// 校验，见 selfGuidedApi.getLesson)——跟 level 步骤直接导去
// /levels/:levelId/play、复用那边自己的门槛检查是同一个信任模型，这里
// 不重新校验一遍"这个学生是否真的有权限上这堂课"。

// 播放这道quiz步骤——去答案版内容，学生浏览器永远看不到正确答案。
export async function playBankQuestion(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { questionId } = req.params;
    const { rows } = await query(`SELECT id, category, question_type, config FROM edu.exam_question_bank WHERE id = $1`, [questionId]);
    if (!rows.length) { notFound(res, "题目不存在——可能已经从题库删除了"); return; }
    const q = rows[0];
    ok(res, { id: q.id, category: q.category, question_type: q.question_type, config: stripAnswers(q.question_type, q.config) });
  } catch (err) { serverError(res, err); }
}

// 提交这道quiz步骤的答案——服务器端判分，跟考试系统共用同一套
// gradeQuestion() 判分逻辑，只返回对不对，不返回config/正确答案本身。
export async function checkBankQuestion(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { questionId } = req.params;
    const { answer } = req.body as { answer?: unknown };
    const { rows } = await query(`SELECT question_type, config FROM edu.exam_question_bank WHERE id = $1`, [questionId]);
    if (!rows.length) { notFound(res, "题目不存在——可能已经从题库删除了"); return; }
    const q = rows[0];
    const isCorrect = gradeQuestion(q.question_type, q.config, answer);
    ok(res, { is_correct: isCorrect });
  } catch (err) { serverError(res, err); }
}