// backend/src/modules/edu/dataCleanup.controller.ts
//
// 系统初期专用的"清场"工具——强制删除已经被学生玩过/被排课引用的
// Activity 以及它牵涉到的所有数据，绕开 deleteLevel 里"只要有人玩过就
// 拒绝删除"的安全机制。deleteLevel 那个安全机制本身不动，这里是刻意
// 分开的另一条路径，只给"清空测试数据重新开始"这种场景用，权限gate跟
// courses.manage一样但要求额外一次性确认（前端处理），不是日常操作。

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { ok, notFound, serverError } from "../../utils/response.js";

// module_type -> 对应的 config 表名，跟 courses.controller.ts 里
// createLevel/updateLevel/getLevel 用的是同一份映射。
const CONFIG_TABLE_BY_MODULE: Record<string, string> = {
  counting: "counting_configs",
  spot_diff: "spot_diff_configs",
  focus_tap: "focus_tap_configs",
  memory: "memory_configs",
  pattern: "pattern_configs",
  word_problem: "word_problem_configs",
  maze: "maze_configs",
  coloring: "coloring_configs",
  line_match: "line_match_configs",
  ppt_lecture: "ppt_lecture_configs",
  video_lecture: "video_lecture_configs",
  sudoku: "sudoku_configs",
};

// 列出全部 Activity，给操作者一个总览来 review 再决定强制删哪些——不管
// 有没有游玩记录/排课引用/被排课用过，统统列出来，方便开发测试阶段
// "想删哪个就删哪个"。有没有关联数据只是表格里的一栏信息，不再是"能不
// 能出现在这个列表里"的门槛。
export async function listActivitiesWithData(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT cl.id, cl.module_type, cl.title_i18n, cl.exercise_number,
              COALESCE(pr.play_count, 0)::int AS play_count,
              COALESCE(pr.student_count, 0)::int AS student_count,
              pr.last_played_at,
              COALESCE(asg.assignment_count, 0)::int AS assignment_count,
              COALESCE(ls.lesson_step_count, 0)::int AS lesson_step_count,
              COALESCE(tl.topic_count, 0)::int AS topic_count
       FROM edu.course_levels cl
       LEFT JOIN LATERAL (
         SELECT count(*) AS play_count, count(DISTINCT student_id) AS student_count, max(played_at) AS last_played_at
         FROM edu.progress_records WHERE course_level_id = cl.id
       ) pr ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS assignment_count FROM edu.assignments WHERE course_level_id = cl.id
       ) asg ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS lesson_step_count FROM edu.lesson_steps WHERE course_level_id = cl.id
       ) ls ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS topic_count FROM edu.activity_topic_links WHERE course_level_id = cl.id
       ) tl ON true
       ORDER BY pr.last_played_at DESC NULLS LAST, cl.created_at DESC`,
      []
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// 强制删除一个Activity + 所有相关数据，绕开FK拦截。
async function purgeOne(levelId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { rows: levelRows } = await query(
    `SELECT module_type, module_config_id FROM edu.course_levels WHERE id = $1`,
    [levelId]
  );
  if (!levelRows.length) return { ok: false, reason: "not_found" };
  const { module_type, module_config_id } = levelRows[0];

  // 顺序：先删引用这个level的记录，再删level本身，最后删它专属的config行。
  // activity_topic_links 那张表本身在建表时设了 ON DELETE CASCADE（删掉
  // course_levels 那一行时会自动跟着清），这里还是明确写出来手动删一次
  // ——强制清理工具求的是"确定删干净"，不依赖"记得当初有没有设对级联"
  // 这种容易出错的默契。
  await query(`DELETE FROM edu.activity_topic_links WHERE course_level_id = $1`, [levelId]);
  await query(`DELETE FROM edu.lesson_steps WHERE course_level_id = $1`, [levelId]);
  await query(`DELETE FROM edu.assignments WHERE course_level_id = $1`, [levelId]);
  await query(`DELETE FROM edu.progress_records WHERE course_level_id = $1`, [levelId]);
  await query(`DELETE FROM edu.course_levels WHERE id = $1`, [levelId]);

  const configTable = CONFIG_TABLE_BY_MODULE[module_type];
  if (configTable && module_config_id) {
    await query(`DELETE FROM edu.${configTable} WHERE id = $1`, [module_config_id]);
  }
  return { ok: true };
}

export async function purgeActivity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { levelId } = req.params;
    const result = await purgeOne(levelId);
    if (!result.ok) { notFound(res, "Activity not found"); return; }
    ok(res, null, "Deleted");
  } catch (err) { serverError(res, err); }
}

// 批量删除——前端checkbox多选后一次性提交一批id
export async function purgeActivitiesBulk(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { level_ids } = req.body as { level_ids?: string[] };
    if (!Array.isArray(level_ids) || level_ids.length === 0) {
      res.status(400).json({ success: false, message: "level_ids is required" });
      return;
    }
    let deleted = 0;
    const failed: string[] = [];
    for (const id of level_ids) {
      const result = await purgeOne(id);
      if (result.ok) deleted++; else failed.push(id);
    }
    ok(res, { deleted, failed, total: level_ids.length });
  } catch (err) { serverError(res, err); }
}