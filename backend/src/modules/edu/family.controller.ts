// backend/src/modules/edu/family.controller.ts
//
// The family journey from architecture doc 2.5, actually implemented:
//   registerParent  → public, no auth. Parent signs up with email+password
//                      (not IC — see 2.2's amendment: parents are the one
//                      role that gets public self-serve registration).
//   addChild        → authenticated as parent. Creates the child's STUDENT
//                      account (IC as username, same convention as
//                      operator-created accounts), links it via
//                      edu.guardian_relationships, and starts a 3-day trial
//                      subscription for that child.
//   subscribeChild   → authenticated as parent. Manually activates a
//                      subscription at the current Early Bird rate — no
//                      real payment gateway yet, this is the same
//                      "record it, verify manually" pattern used for
//                      tuition/points elsewhere in this project (see 3.5 /
//                      3.11 in the architecture doc). Locks in the rate at
//                      time of activation, independent of the plan's future
//                      listed price.
//   listMyChildren   → authenticated as parent. Every child + their latest
//                      subscription status, for the parent dashboard.
//   getChildProgress → authenticated as parent. A specific child's progress
//                      records — but ONLY if a guardian_relationships row
//                      actually links this parent to that child.
//
// NOT in this file (deferred, see conversation): referral commissions,
// payment-gateway webhooks, past_due/grace-period cron job.

import type { Response } from "express";
import type { Request } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query, withTransaction } from "../../config/db.js";
import { hashPassword } from "../../utils/crypto.js";
import { validateIC, normalizeIC } from "../../utils/ic.js";
import { ok, created, badRequest, notFound, forbidden, conflict, serverError } from "../../utils/response.js";

const TRIAL_DAYS = 3;

// ── Parent registration (public) ──────────────────────────────────────────────
export async function registerParent(req: Request, res: Response): Promise<void> {
  try {
    const { email, mobile, password, full_name_en, full_name_zh } = req.body as Record<string, string>;
    const identity = email ?? mobile;
    if (!identity || !password) { badRequest(res, "email (or mobile) and password are required"); return; }
    if (password.length < 8) { badRequest(res, "Password must be at least 8 characters"); return; }

    const { rows: exists } = await query(
      `SELECT id FROM auth.users
       WHERE (email IS NOT NULL AND email = $1) OR (mobile IS NOT NULL AND mobile = $2)
          OR username = $1
       LIMIT 1`,
      [email ?? null, mobile ?? null]
    );
    if (exists.length) { conflict(res, "An account with this email or mobile already exists"); return; }

    const pwHash = await hashPassword(password);
    const username = email ?? mobile; // parents identify by email/mobile, not IC

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO auth.users (username, email, mobile, password_hash, status, registered_via)
         VALUES ($1, $2, $3, $4, 'ACTIVE', 'PUBLIC_PARENT')
         RETURNING id, username, email, mobile, created_at`,
        [username, email ?? null, mobile ?? null, pwHash]
      );
      const user = rows[0];

      await client.query(
        `INSERT INTO auth.user_profiles (user_id, full_name_en, full_name_zh)
         VALUES ($1, $2, $3)`,
        [user.id, full_name_en ?? null, full_name_zh ?? null]
      );

      const { rows: roleRows } = await client.query(
        `SELECT id FROM rbac.roles WHERE code = 'PARENT' AND is_deleted = false LIMIT 1`
      );
      if (!roleRows.length) throw new Error("PARENT role not found — has 001_education_roles_and_session_policy.sql been run?");
      await client.query(
        `INSERT INTO rbac.user_roles (user_id, role_id) VALUES ($1, $2)`,
        [user.id, roleRows[0].id]
      );

      return user;
    });

    created(res, { id: result.id, username: result.username }, "Account created — now add your child to start a free trial");
  } catch (err) { serverError(res, err); }
}

// ── Add a child (creates their STUDENT account + trial subscription) ─────────
// Subscriptions are scoped to a grade tier (L1-L4) — subscribing unlocks
// every course tagged with that tier, not everything in the system. The
// parent picks the tier when adding the child (they know roughly how old
// their kid is / what level is appropriate); it's locked onto the trial
// subscription right away, same "decide once at signup" pattern as the
// locked_monthly_fee.
export async function addChild(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { ic_number, password, full_name_zh, full_name_en, grade_tier_id } = req.body as Record<string, string>;
    if (!ic_number) { badRequest(res, "ic_number is required"); return; }
    if (!grade_tier_id) { badRequest(res, "grade_tier_id is required — pick which level to start the trial in"); return; }

    const { rows: tierRows } = await query(`SELECT id FROM edu.grade_tiers WHERE id = $1 AND is_active = true`, [grade_tier_id]);
    if (!tierRows.length) { badRequest(res, "Invalid grade_tier_id"); return; }

    const icResult = validateIC(ic_number);
    if (!icResult.valid) { badRequest(res, icResult.error ?? "Invalid IC/birth-certificate number"); return; }
    const username = icResult.normalized!;

    const { rows: exists } = await query(`SELECT id FROM auth.users WHERE username = $1 LIMIT 1`, [username]);
    if (exists.length) { conflict(res, "An account with this IC number already exists"); return; }

    const { rows: planRows } = await query(
      `SELECT id, monthly_fee, currency FROM edu.subscription_plans WHERE code = 'early_bird' AND is_active = true LIMIT 1`
    );
    if (!planRows.length) { serverError(res, new Error("No active subscription plan found")); return; }
    const plan = planRows[0];

    // No password from the parent? Generate one and hand it back in the
    // response (same pattern as auth.controller.ts#createManagedUser) —
    // the parent sees it once and can pass it along to their child.
    const tempPassword = password && password.length >= 8 ? password : Math.random().toString(36).slice(2, 10);
    const pwHash = await hashPassword(tempPassword);

    const result = await withTransaction(async (client) => {
      const { rows: userRows } = await client.query(
        `INSERT INTO auth.users (username, password_hash, status, registered_via)
         VALUES ($1, $2, 'ACTIVE', 'ADMIN_CREATED')
         RETURNING id, username`,
        [username, pwHash]
      );
      const child = userRows[0];

      await client.query(
        `INSERT INTO auth.user_profiles (user_id, full_name_en, full_name_zh, date_of_birth, ic_no)
         VALUES ($1, $2, $3, $4, $5)`,
        [child.id, full_name_en ?? null, full_name_zh ?? null, icResult.dateOfBirth ?? null, icResult.formatted ?? null]
      );

      const { rows: roleRows } = await client.query(
        `SELECT id FROM rbac.roles WHERE code = 'STUDENT' AND is_deleted = false LIMIT 1`
      );
      await client.query(`INSERT INTO rbac.user_roles (user_id, role_id) VALUES ($1, $2)`, [child.id, roleRows[0].id]);

      await client.query(
        `INSERT INTO edu.guardian_relationships (parent_user_id, student_user_id, created_by)
         VALUES ($1, $2, $1)`,
        [req.user!.sub, child.id]
      );

      const { rows: subRows } = await client.query(
        `INSERT INTO edu.subscriptions
           (student_id, parent_user_id, plan_id, locked_monthly_fee, currency, status, trial_ends_at, grade_tier_id)
         VALUES ($1, $2, $3, $4, $5, 'trial', now() + interval '${TRIAL_DAYS} days', $6)
         RETURNING id, status, trial_ends_at, grade_tier_id`,
        [child.id, req.user!.sub, plan.id, plan.monthly_fee, plan.currency, grade_tier_id]
      );

      return { child, subscription: subRows[0] };
    });

    created(res, {
      student_id: result.child.id,
      username: result.child.username,
      temp_password: password ? undefined : tempPassword,
      subscription: result.subscription,
    }, "Child added — 3-day free trial started");
  } catch (err) { serverError(res, err); }
}

// ── Subscribe a child (manual activation, no payment gateway yet) ────────────
export async function subscribeChild(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { studentId } = req.params;

    const { rows: guardRows } = await query(
      `SELECT 1 FROM edu.guardian_relationships WHERE parent_user_id = $1 AND student_user_id = $2`,
      [req.user!.sub, studentId]
    );
    if (!guardRows.length) { forbidden(res, "You are not this student's guardian"); return; }

    const { rows: subRows } = await query(
      `SELECT id, status, locked_monthly_fee, currency, current_period_end FROM edu.subscriptions
       WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [studentId]
    );
    if (!subRows.length) { notFound(res, "No subscription record found for this student"); return; }
    const sub = subRows[0];

    // 光看 status==='active' 不够——这次付费周期(current_period_end)可能
    // 早就过了，但没有任何东西会自动把状态改回去，status 字面上永远停
    // 在 'active'。真正该拦的是"这次付费周期还没结束、还在有效期内"，
    // 不是"状态字段写着 active"这四个字本身。周期已经过了的话，即使
    // status 还是 active，也该当成"到期了、可以续订"处理，不能因为一
    // 个从没被更新过的字段就把家长卡死在"已经订阅"这个死结里。
    const stillWithinPaidPeriod = sub.status === "active" && (!sub.current_period_end || new Date(sub.current_period_end) > new Date());
    if (stillWithinPaidPeriod) { conflict(res, "This subscription is already active"); return; }

    const { rows: updated } = await query(
      `UPDATE edu.subscriptions
       SET status = 'active', current_period_start = now(), current_period_end = now() + interval '1 month',
           grace_period_ends_at = NULL, updated_at = now()
       WHERE id = $1
       RETURNING id, status, locked_monthly_fee, currency, current_period_start, current_period_end`,
      [sub.id]
    );

    created(res, updated[0], `Subscribed at ${sub.currency} ${sub.locked_monthly_fee}/month`);
  } catch (err) { serverError(res, err); }
}

// ── Reset a child's password (parent-initiated) ───────────────────────────────
// There's no real "forgot password" flow yet (auth.controller.ts#forgotPassword
// is a stub — see its comment). For a child's account specifically, the
// practical path is simpler anyway: their guardian can just set a new one,
// no email round-trip needed. Same guardian_relationships check as every
// other family.controller.ts endpoint that touches a specific child.
export async function resetChildPassword(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { studentId } = req.params;
    const { password } = req.body as Record<string, string>;

    const { rows: guardRows } = await query(
      `SELECT 1 FROM edu.guardian_relationships WHERE parent_user_id = $1 AND student_user_id = $2`,
      [req.user!.sub, studentId]
    );
    if (!guardRows.length) { forbidden(res, "You are not this student's guardian"); return; }

    const newPassword = password && password.length >= 8 ? password : Math.random().toString(36).slice(2, 10);
    const pwHash = await hashPassword(newPassword);

    await withTransaction(async (client) => {
      await client.query(`UPDATE auth.users SET password_hash = $1 WHERE id = $2`, [pwHash, studentId]);
      // same "password changed → sign out everywhere" pattern as
      // auth.controller.ts#changePassword — an old session shouldn't
      // silently keep working with a password nobody remembers anymore
      await client.query(
        `UPDATE auth.user_sessions SET revoked_at = now(), revoked_reason = 'PASSWORD_RESET'
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [studentId]
      );
    });

    ok(res, { temp_password: password ? undefined : newPassword }, "Password reset");
  } catch (err) { serverError(res, err); }
}

// ── Study time (登入/登出时长统计) ──────────────────────────────────────────────
// Reconstructs real login sessions from the session_chain_id groups (see
// 016_session_chain_tracking.sql) rather than raw user_sessions rows —
// otherwise this would report a new "session" every ~15 minutes whenever
// the access token silently refreshes, badly undercounting actual study
// time. A chain's end time is its terminal revoke (explicit logout / kicked
// by a new login elsewhere / password reset) if one happened, or its most
// recent last_used_at if the session is still technically active — the
// best available approximation for "closed the tab without logging out".
export async function queryStudyTime(studentId: string) {
  const { rows: sessions } = await query(
    `WITH chains AS (
       SELECT session_chain_id,
              MIN(created_at) AS login_at,
              MAX(CASE WHEN revoked_reason IN ('LOGOUT','LOGOUT_ALL','NEW_LOGIN','PASSWORD_RESET')
                       THEN revoked_at ELSE last_used_at END) AS ended_at
       FROM auth.user_sessions
       WHERE user_id = $1
       GROUP BY session_chain_id
     )
     SELECT session_chain_id, login_at, ended_at,
            GREATEST(0, EXTRACT(EPOCH FROM (ended_at - login_at)))::int AS duration_seconds
     FROM chains
     ORDER BY login_at DESC
     LIMIT 50`,
    [studentId]
  );

  const { rows: daily } = await query(
    `WITH chains AS (
       SELECT session_chain_id,
              MIN(created_at) AS login_at,
              MAX(CASE WHEN revoked_reason IN ('LOGOUT','LOGOUT_ALL','NEW_LOGIN','PASSWORD_RESET')
                       THEN revoked_at ELSE last_used_at END) AS ended_at
       FROM auth.user_sessions
       WHERE user_id = $1
       GROUP BY session_chain_id
     )
     SELECT date_trunc('day', login_at)::date AS study_date,
            SUM(GREATEST(0, EXTRACT(EPOCH FROM (ended_at - login_at))))::int AS total_seconds,
            count(*)::int AS session_count
     FROM chains
     GROUP BY study_date
     ORDER BY study_date DESC
     LIMIT 14`,
    [studentId]
  );

  return { sessions, daily };
}

export async function getChildStudyTime(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { studentId } = req.params;
    const { rows: guardRows } = await query(
      `SELECT 1 FROM edu.guardian_relationships WHERE parent_user_id = $1 AND student_user_id = $2`,
      [req.user!.sub, studentId]
    );
    if (!guardRows.length) { forbidden(res, "You are not this student's guardian"); return; }

    ok(res, await queryStudyTime(studentId));
  } catch (err) { serverError(res, err); }
}


// ── Parent dashboard ─────────────────────────────────────────────────────────
export async function listMyChildren(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT u.id AS student_id, u.username, p.full_name_zh, p.full_name_en,
              s.id AS subscription_id, s.status AS subscription_status,
              s.trial_ends_at, s.current_period_end, s.locked_monthly_fee, s.currency,
              gt.id AS grade_tier_id, gt.code AS grade_tier_code, gt.name_i18n AS grade_tier_name_i18n
       FROM edu.guardian_relationships gr
       JOIN auth.users u ON u.id = gr.student_user_id
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT * FROM edu.subscriptions
         WHERE student_id = u.id ORDER BY created_at DESC LIMIT 1
       ) s ON true
       LEFT JOIN edu.grade_tiers gt ON gt.id = s.grade_tier_id
       WHERE gr.parent_user_id = $1
       ORDER BY u.created_at DESC`,
      [req.user!.sub]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function getChildProgress(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { studentId } = req.params;

    const { rows: guardRows } = await query(
      `SELECT 1 FROM edu.guardian_relationships WHERE parent_user_id = $1 AND student_user_id = $2`,
      [req.user!.sub, studentId]
    );
    if (!guardRows.length) { forbidden(res, "You are not this student's guardian"); return; }

    const { rows } = await query(
      `SELECT pr.id, pr.course_level_id, pr.module_type, pr.score, pr.max_score,
              pr.time_spent_seconds, pr.mistakes, pr.completed, pr.attempt_number, pr.played_at,
              cl.title_i18n AS level_title_i18n, ec.name_zh AS topic_name_zh
       FROM edu.progress_records pr
       JOIN edu.course_levels cl ON cl.id = pr.course_level_id
       LEFT JOIN edu.exercise_categories ec ON ec.id = cl.category_id
       WHERE pr.student_id = $1
       ORDER BY pr.played_at DESC
       LIMIT 50`,
      [studentId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// ── 按 Topic 汇总的进展分析 (parent-facing) ─────────────────────────────────────
// getChildProgress above is a flat chronological list — useful for "what
// did they just play", but doesn't answer "which Topics is this kid
// actually strong or weak in overall". This aggregates the same
// edu.progress_records rows by Topic instead of by individual attempt:
// average score%, completion rate, attempt count, most recent attempt per
// Topic. Deliberately uses the BEST attempt per level per Topic for the
// score average rather than every single attempt equally — a kid who
// retried a hard level 5 times before getting it right shouldn't look
// weaker than one who nailed an easy level on the first try; what matters
// for "are they strong at this Topic" is closer to their best
// demonstrated performance, not a raw average across every retry.
export async function getChildTopicBreakdown(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { studentId } = req.params;

    const { rows: guardRows } = await query(
      `SELECT 1 FROM edu.guardian_relationships WHERE parent_user_id = $1 AND student_user_id = $2`,
      [req.user!.sub, studentId]
    );
    if (!guardRows.length) { forbidden(res, "You are not this student's guardian"); return; }

    const { rows } = await query(
      `WITH best_per_level AS (
         SELECT DISTINCT ON (pr.course_level_id)
                pr.course_level_id, pr.score, pr.max_score, pr.completed, pr.played_at,
                cl.category_id
         FROM edu.progress_records pr
         JOIN edu.course_levels cl ON cl.id = pr.course_level_id
         WHERE pr.student_id = $1
         ORDER BY pr.course_level_id, pr.score DESC NULLS LAST
       ),
       attempt_counts AS (
         SELECT cl.category_id, count(*)::int AS total_attempts
         FROM edu.progress_records pr
         JOIN edu.course_levels cl ON cl.id = pr.course_level_id
         WHERE pr.student_id = $1
         GROUP BY cl.category_id
       )
       SELECT
         ec.id AS topic_id, ec.name_zh AS topic_name_zh,
         count(bpl.course_level_id)::int AS levels_played,
         COALESCE(ac.total_attempts, 0) AS total_attempts,
         round(avg(CASE WHEN bpl.max_score > 0 THEN bpl.score::numeric / bpl.max_score * 100 END), 1) AS avg_score_pct,
         round(100.0 * sum(CASE WHEN bpl.completed THEN 1 ELSE 0 END) / NULLIF(count(bpl.course_level_id), 0), 1) AS completion_rate_pct,
         max(bpl.played_at) AS last_played_at
       FROM best_per_level bpl
       LEFT JOIN edu.exercise_categories ec ON ec.id = bpl.category_id
       LEFT JOIN attempt_counts ac ON ac.category_id IS NOT DISTINCT FROM bpl.category_id
       GROUP BY ec.id, ec.name_zh, ac.total_attempts
       ORDER BY avg_score_pct ASC NULLS LAST`,
      [studentId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}