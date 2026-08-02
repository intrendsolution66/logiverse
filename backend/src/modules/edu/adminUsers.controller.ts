// backend/src/modules/edu/adminUsers.controller.ts
//
// 学生管理 / 老师管理 / 家长管理 — three OPERATOR-facing lists, each pulling
// together role-specific context that no single existing endpoint already
// surfaces: a student's class + enrollment type + subscription status in
// one row; a teacher's class/student counts; a parent's children. Gated by
// classes.manage (confirmed granted to OPERATOR) rather than the generic
// users.read/users.update permissions, which — despite being seeded as
// permission rows — aren't actually granted to any role in this dataset.

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { ok, badRequest, notFound, serverError } from "../../utils/response.js";
import { parsePagination } from "../../utils/pagination.js";

const ENROLLMENT_TYPES = ["online_casual", "offline", "online_formal"];

const STUDENT_SORT_COLUMNS: Record<string, string> = {
  name: "p.full_name_zh", username: "u.username", enrollment_type: "COALESCE(sp.enrollment_type, 'online_casual')", created_at: "u.created_at",
};

export async function listStudents(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req, 30);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const enrollmentType = typeof req.query.enrollment_type === "string" ? req.query.enrollment_type : "";
    const sortKey = STUDENT_SORT_COLUMNS[String(req.query.sort)] ? String(req.query.sort) : "created_at";
    const order = req.query.order === "asc" ? "ASC" : "DESC";

    const conditions = [`r.code = 'STUDENT'`, `u.is_deleted = false`];
    const params: unknown[] = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`(lower(u.username) LIKE $${params.length} OR lower(p.full_name_zh) LIKE $${params.length} OR lower(p.full_name_en) LIKE $${params.length})`);
    }
    if (enrollmentType && ENROLLMENT_TYPES.includes(enrollmentType)) {
      params.push(enrollmentType);
      conditions.push(`COALESCE(sp.enrollment_type, 'online_casual') = $${params.length}`);
    }
    const where = conditions.join(" AND ");

    const { rows: countRows } = await query(
      `SELECT count(DISTINCT u.id)::int AS total
       FROM auth.users u
       JOIN rbac.user_roles ur ON ur.user_id = u.id AND ur.is_active = true
       JOIN rbac.roles r ON r.id = ur.role_id
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       LEFT JOIN edu.student_profiles sp ON sp.student_id = u.id
       WHERE ${where}`,
      params
    );
    const total = countRows[0]?.total ?? 0;

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT DISTINCT u.id, u.username, u.status, u.created_at,
              p.full_name_zh, p.full_name_en,
              COALESCE(sp.enrollment_type, 'online_casual') AS enrollment_type,
              (SELECT string_agg(c.name, '、') FROM edu.class_students cs JOIN edu.classes c ON c.id = cs.class_id WHERE cs.student_id = u.id) AS class_names,
              (SELECT p2.full_name_zh FROM edu.guardian_relationships gr JOIN auth.user_profiles p2 ON p2.user_id = gr.parent_user_id WHERE gr.student_user_id = u.id LIMIT 1) AS guardian_name,
              (SELECT sub.status FROM edu.subscriptions sub WHERE sub.student_id = u.id ORDER BY sub.created_at DESC LIMIT 1) AS subscription_status
       FROM auth.users u
       JOIN rbac.user_roles ur ON ur.user_id = u.id AND ur.is_active = true
       JOIN rbac.roles r ON r.id = ur.role_id
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       LEFT JOIN edu.student_profiles sp ON sp.student_id = u.id
       WHERE ${where}
       ORDER BY ${STUDENT_SORT_COLUMNS[sortKey]} ${order} NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.status(200).json({ success: true, message: "Success", data: rows, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) { serverError(res, err); }
}

export async function updateStudentEnrollment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { studentId } = req.params;
    const { enrollment_type } = req.body as Record<string, string>;
    if (!ENROLLMENT_TYPES.includes(enrollment_type)) { badRequest(res, "enrollment_type must be one of: " + ENROLLMENT_TYPES.join(", ")); return; }

    const { rows: userRows } = await query(
      `SELECT 1 FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND r.code = 'STUDENT' AND ur.is_active = true`,
      [studentId]
    );
    if (!userRows.length) { notFound(res, "Student not found"); return; }

    await query(
      `INSERT INTO edu.student_profiles (student_id, enrollment_type, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (student_id) DO UPDATE SET enrollment_type = EXCLUDED.enrollment_type, updated_at = now()`,
      [studentId, enrollment_type]
    );
    ok(res, { student_id: studentId, enrollment_type });
  } catch (err) { serverError(res, err); }
}

const TEACHER_SORT_COLUMNS: Record<string, string> = {
  name: "p.full_name_zh", username: "u.username", created_at: "u.created_at",
};

export async function listTeachers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req, 30);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const sortKey = TEACHER_SORT_COLUMNS[String(req.query.sort)] ? String(req.query.sort) : "created_at";
    const order = req.query.order === "asc" ? "ASC" : "DESC";

    const conditions = [`r.code = 'TEACHER'`, `u.is_deleted = false`];
    const params: unknown[] = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`(lower(u.username) LIKE $${params.length} OR lower(p.full_name_zh) LIKE $${params.length} OR lower(u.email) LIKE $${params.length})`);
    }
    const where = conditions.join(" AND ");

    const { rows: countRows } = await query(
      `SELECT count(DISTINCT u.id)::int AS total
       FROM auth.users u
       JOIN rbac.user_roles ur ON ur.user_id = u.id AND ur.is_active = true
       JOIN rbac.roles r ON r.id = ur.role_id
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       WHERE ${where}`,
      params
    );
    const total = countRows[0]?.total ?? 0;

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT DISTINCT u.id, u.username, u.email, u.status, u.created_at,
              p.full_name_zh, p.full_name_en,
              (SELECT count(*)::int FROM edu.classes c WHERE c.teacher_id = u.id) AS class_count,
              (SELECT count(DISTINCT cs.student_id)::int FROM edu.classes c JOIN edu.class_students cs ON cs.class_id = c.id WHERE c.teacher_id = u.id) AS student_count
       FROM auth.users u
       JOIN rbac.user_roles ur ON ur.user_id = u.id AND ur.is_active = true
       JOIN rbac.roles r ON r.id = ur.role_id
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       WHERE ${where}
       ORDER BY ${TEACHER_SORT_COLUMNS[sortKey]} ${order} NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.status(200).json({ success: true, message: "Success", data: rows, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) { serverError(res, err); }
}

const PARENT_SORT_COLUMNS: Record<string, string> = {
  name: "p.full_name_zh", username: "u.username", created_at: "u.created_at",
};

export async function listParents(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req, 30);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const sortKey = PARENT_SORT_COLUMNS[String(req.query.sort)] ? String(req.query.sort) : "created_at";
    const order = req.query.order === "asc" ? "ASC" : "DESC";

    const conditions = [`r.code = 'PARENT'`, `u.is_deleted = false`];
    const params: unknown[] = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`(lower(u.username) LIKE $${params.length} OR lower(p.full_name_zh) LIKE $${params.length} OR lower(u.email) LIKE $${params.length})`);
    }
    const where = conditions.join(" AND ");

    const { rows: countRows } = await query(
      `SELECT count(DISTINCT u.id)::int AS total
       FROM auth.users u
       JOIN rbac.user_roles ur ON ur.user_id = u.id AND ur.is_active = true
       JOIN rbac.roles r ON r.id = ur.role_id
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       WHERE ${where}`,
      params
    );
    const total = countRows[0]?.total ?? 0;

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT DISTINCT u.id, u.username, u.email, u.status, u.created_at,
              p.full_name_zh, p.full_name_en,
              (SELECT string_agg(COALESCE(p2.full_name_zh, u2.username), '、')
               FROM edu.guardian_relationships gr
               JOIN auth.users u2 ON u2.id = gr.student_user_id
               LEFT JOIN auth.user_profiles p2 ON p2.user_id = u2.id
               WHERE gr.parent_user_id = u.id) AS children_names
       FROM auth.users u
       JOIN rbac.user_roles ur ON ur.user_id = u.id AND ur.is_active = true
       JOIN rbac.roles r ON r.id = ur.role_id
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       WHERE ${where}
       ORDER BY ${PARENT_SORT_COLUMNS[sortKey]} ${order} NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.status(200).json({ success: true, message: "Success", data: rows, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) { serverError(res, err); }
}

// ── View / Edit / Delete — shared across student/teacher/parent management ────
// A student/teacher/parent are all "auth.users with a specific role" under
// the hood, so a single set of endpoints handles all three roster pages'
// view/edit/delete actions rather than tripling the same logic — the role
// check just makes sure this can't be pointed at an OPERATOR account by
// accident (or on purpose) from a page that's only meant to manage the
// other three.
const MANAGEABLE_ROLES = ["STUDENT", "TEACHER", "PARENT"];

export async function getUserDetail(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const { rows } = await query(
      `SELECT u.id, u.username, u.email, u.status, u.created_at, r.code AS role_code,
              p.full_name_zh, p.full_name_en
       FROM auth.users u
       JOIN rbac.user_roles ur ON ur.user_id = u.id AND ur.is_active = true
       JOIN rbac.roles r ON r.id = ur.role_id
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       WHERE u.id = $1 AND u.is_deleted = false AND r.code = ANY($2)`,
      [userId, MANAGEABLE_ROLES]
    );
    if (!rows.length) { notFound(res, "User not found"); return; }
    const user = rows[0];

    // 学生底下带出目前连结的家长；家长底下带出目前连结的孩子——两个
    // 方向都从同一张 edu.guardian_relationships 表查，只是 JOIN 的方向
    // 相反。放进同一个 getUserDetail 回应里，前端编辑弹窗才能在同一个
    // 地方看到、管理这层关系，不用另外呼叫一支API。
    if (user.role_code === "STUDENT") {
      const { rows: guardians } = await query(
        `SELECT u.id, u.username, p.full_name_zh, p.full_name_en
         FROM edu.guardian_relationships gr
         JOIN auth.users u ON u.id = gr.parent_user_id
         LEFT JOIN auth.user_profiles p ON p.user_id = u.id
         WHERE gr.student_user_id = $1
         ORDER BY gr.created_at`,
        [userId]
      );
      ok(res, { ...user, guardians });
    } else if (user.role_code === "PARENT") {
      const { rows: children } = await query(
        `SELECT u.id, u.username, p.full_name_zh, p.full_name_en
         FROM edu.guardian_relationships gr
         JOIN auth.users u ON u.id = gr.student_user_id
         LEFT JOIN auth.user_profiles p ON p.user_id = u.id
         WHERE gr.parent_user_id = $1
         ORDER BY gr.created_at`,
        [userId]
      );
      ok(res, { ...user, children });
    } else {
      ok(res, user);
    }
  } catch (err) { serverError(res, err); }
}

export async function updateUserProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const { full_name_zh, full_name_en, email } = req.body as Record<string, string>;

    const { rows: roleRows } = await query(
      `SELECT r.code FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND ur.is_active = true AND r.code = ANY($2)`,
      [userId, MANAGEABLE_ROLES]
    );
    if (!roleRows.length) { notFound(res, "User not found"); return; }

    if (email !== undefined) await query(`UPDATE auth.users SET email = $2 WHERE id = $1`, [userId, email || null]);
    await query(
      `INSERT INTO auth.user_profiles (user_id, full_name_zh, full_name_en)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         full_name_zh = COALESCE(EXCLUDED.full_name_zh, auth.user_profiles.full_name_zh),
         full_name_en = COALESCE(EXCLUDED.full_name_en, auth.user_profiles.full_name_en)`,
      [userId, full_name_zh ?? null, full_name_en ?? null]
    );
    ok(res, { id: userId }, "Updated");
  } catch (err) { serverError(res, err); }
}

// 软删除 (is_deleted = true) ——学生/老师/家长的账号背后牵着很多东西
// （学生的进度记录、订阅、老师的班级、家长跟孩子的关系），真的从
// auth.users表里硬删除风险太高，而且这几个列表原本查询就已经是
// `WHERE u.is_deleted = false` 在过滤了（这次排序功能测试的时候确认过），
// 软删除跟现有逻辑天然契合——账号被标记删除后，从这些列表消失，但
// 底层历史资料都还在，不会因为一次误删就牵连一大串关联资料。
export async function deactivateUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const { rows: roleRows } = await query(
      `SELECT r.code FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND ur.is_active = true AND r.code = ANY($2)`,
      [userId, MANAGEABLE_ROLES]
    );
    if (!roleRows.length) { notFound(res, "User not found"); return; }
    await query(`UPDATE auth.users SET is_deleted = true WHERE id = $1`, [userId]);
    ok(res, null, "Deleted");
  } catch (err) { serverError(res, err); }
}

// ── 封锁 / 解封账号 ──────────────────────────────────────────────────────────────
// 跟"删除"(is_deleted)不一样——封锁是可逆的、operator 主动决定的("这个
// 学生先别让他登录，但账号资料都留着"），删除是软删除、代表这个账号不
// 该再出现在名单里了。也跟"登录失败太多次自动锁定"(auth.users.status =
// 'LOCKED'、locked_until 到期会自动解锁)不一样——这里用一个独立的状态值
// 'BLOCKED'，不会因为时间到了就自动恢复，只有 operator 自己解封才会解除。
// auth.controller.ts 登录那边的检查要同步加上这个状态，不然封了也没用，
// 账号还是能登录进去。
export async function blockUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const { rows: roleRows } = await query(
      `SELECT r.code FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND ur.is_active = true AND r.code = ANY($2)`,
      [userId, MANAGEABLE_ROLES]
    );
    if (!roleRows.length) { notFound(res, "User not found"); return; }
    await query(`UPDATE auth.users SET status = 'BLOCKED' WHERE id = $1`, [userId]);
    ok(res, null, "已封锁——这个账号没办法再登录，直到 operator 手动解封");
  } catch (err) { serverError(res, err); }
}

export async function unblockUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const { rows: roleRows } = await query(
      `SELECT r.code, u.status FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id JOIN auth.users u ON u.id = ur.user_id WHERE ur.user_id = $1 AND ur.is_active = true AND r.code = ANY($2)`,
      [userId, MANAGEABLE_ROLES]
    );
    if (!roleRows.length) { notFound(res, "User not found"); return; }
    // 只解除"operator手动封锁"这个状态——如果账号现在是别的状态（比如
    // 还在登录失败自动锁定期间），不会被这个操作误解开，只处理 BLOCKED。
    if (roleRows[0].status !== "BLOCKED") { badRequest(res, "这个账号目前不是被封锁的状态"); return; }
    await query(`UPDATE auth.users SET status = 'ACTIVE' WHERE id = $1`, [userId]);
    ok(res, null, "已解封");
  } catch (err) { serverError(res, err); }
}

// ── 延长学生订阅 ──────────────────────────────────────────────────────────────
// "延长 N 天"统一走"宽限期"(past_due + grace_period_ends_at)这个机制来
// 实现，不管学生原本订阅状态是什么（试用中/已过期/被取消/从来没订阅
// 过）——这是系统里唯一"状态+到期日"两者都会被检查、能保证效果精确是
// "从现在起N天后到期"的机制。特意不用 status='active'：那个状态在现有
// 判断逻辑里完全不检查任何到期日，设成 active 会变成永久有效，不是
// "N天"。唯一的例外：如果学生的试用期本来就还没过，直接在原本的试用期
// 上累加天数（延长试用期本身），比切成宽限期更符合直觉。
export async function extendStudentSubscription(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { studentId } = req.params;
    const { days } = req.body as { days?: number };
    if (!days || !Number.isFinite(days) || days <= 0) { badRequest(res, "days 必须是正数"); return; }

    const { rows: roleRows } = await query(
      `SELECT 1 FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND ur.is_active = true AND r.code = 'STUDENT'`,
      [studentId]
    );
    if (!roleRows.length) { notFound(res, "Student not found"); return; }

    const { rows: subRows } = await query(
      `SELECT id, status, trial_ends_at, grace_period_ends_at FROM edu.subscriptions WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [studentId]
    );
    const sub = subRows[0] as { id: string; status: string; trial_ends_at: Date | null; grace_period_ends_at: Date | null } | undefined;
    const now = new Date();
    const dayMs = days * 24 * 60 * 60 * 1000;

    if (sub && sub.status === "trial" && sub.trial_ends_at && new Date(sub.trial_ends_at) > now) {
      const newEnd = new Date(new Date(sub.trial_ends_at).getTime() + dayMs);
      await query(`UPDATE edu.subscriptions SET trial_ends_at = $2 WHERE id = $1`, [sub.id, newEnd]);
      ok(res, { extended_to: newEnd, mode: "trial" }, `试用期延长了 ${days} 天`);
      return;
    }

    const newGraceEnd = new Date(now.getTime() + dayMs);
    if (sub) {
      await query(`UPDATE edu.subscriptions SET status = 'past_due', grace_period_ends_at = $2 WHERE id = $1`, [sub.id, newGraceEnd]);
    } else {
      await query(
        `INSERT INTO edu.subscriptions (student_id, status, grace_period_ends_at, created_at) VALUES ($1, 'past_due', $2, now())`,
        [studentId, newGraceEnd]
      );
    }
    ok(res, { extended_to: newGraceEnd, mode: "grace" }, `已经给这个学生开通 ${days} 天的使用权限`);
  } catch (err) { serverError(res, err); }
}

// 跟延长订阅正好相反——operator 主动把一个"正在订阅中"的学生标记成过期。
// 不管现在是 trial/active/past_due 哪个状态，统一设成 'expired'，这个
// 状态不在 subscriptionGate.ts#hasActiveSub 判断为"有效"的三种情况
// （trial未过期 / active / past_due但宽限期内）里，所以设完之后不管
// 学生登录、玩游戏都会立刻被当成没有有效订阅。宽限期日期也顺便清掉，
// 避免留着一个未来的日期造成"明明是expired却还在宽限期内"这种自相
// 矛盾的状态。
export async function expireStudentSubscription(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { studentId } = req.params;
    const { rows: roleRows } = await query(
      `SELECT 1 FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND ur.is_active = true AND r.code = 'STUDENT'`,
      [studentId]
    );
    if (!roleRows.length) { notFound(res, "Student not found"); return; }

    const { rows: subRows } = await query(
      `SELECT id FROM edu.subscriptions WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [studentId]
    );
    if (!subRows.length) { badRequest(res, "这个学生还没有任何订阅记录，没有什么好设成过期的"); return; }

    await query(`UPDATE edu.subscriptions SET status = 'expired', grace_period_ends_at = NULL WHERE id = $1`, [subRows[0].id]);
    ok(res, null, "已经把这个学生的订阅设成过期");
  } catch (err) { serverError(res, err); }
}

// ── 家长/学生关联管理 (admin) ────────────────────────────────────────────────
// edu.guardian_relationships already exists and is used by the parent's
// own self-service "add a child" flow (family.controller.ts#addChild) —
// this is the admin-side equivalent: an operator linking/unlinking an
// EXISTING parent and student pair after the fact, from either the
// Student or Parent management page's edit view, not just at the moment
// a new account is created (which was the only place this could
// previously happen, via managedUserApi.create's guardian_of_user_id).
export async function linkGuardian(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { parent_user_id, student_user_id } = req.body as Record<string, string>;
    if (!parent_user_id || !student_user_id) { badRequest(res, "parent_user_id and student_user_id are required"); return; }

    const { rows: roleCheck } = await query(
      `SELECT
         (SELECT 1 FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND ur.is_active = true AND r.code = 'PARENT') AS is_parent,
         (SELECT 1 FROM rbac.user_roles ur JOIN rbac.roles r ON r.id = ur.role_id WHERE ur.user_id = $2 AND ur.is_active = true AND r.code = 'STUDENT') AS is_student`,
      [parent_user_id, student_user_id]
    );
    if (!roleCheck[0]?.is_parent) { badRequest(res, "指定的家长帐号不是 PARENT 角色"); return; }
    if (!roleCheck[0]?.is_student) { badRequest(res, "指定的学生帐号不是 STUDENT 角色"); return; }

    await query(
      `INSERT INTO edu.guardian_relationships (parent_user_id, student_user_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [parent_user_id, student_user_id, req.user!.sub]
    );
    ok(res, null, "Linked");
  } catch (err) { serverError(res, err); }
}

export async function unlinkGuardian(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { parentUserId, studentUserId } = req.params;
    await query(`DELETE FROM edu.guardian_relationships WHERE parent_user_id = $1 AND student_user_id = $2`, [parentUserId, studentUserId]);
    ok(res, null, "Unlinked");
  } catch (err) { serverError(res, err); }
}