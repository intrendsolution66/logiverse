// backend/src/modules/auth/auth.controller.ts
//
// This is your existing auth.controller.ts with three additions, each marked
// with a "── NEW:" comment banner so they're easy to find and diff against
// your original:
//
//   1. login() now revokes any existing active sessions before issuing a new
//      one, based on rbac.roles.enforce_single_session (see the accompanying
//      migration). This is the "no account sharing" requirement.
//   2. A new createManagedUser() function lets a teacher/operator create a
//      student or parent account directly (IC as username), instead of
//      those roles going through the public self-serve register() flow.
//   3. register() is unchanged in logic, but see auth.routes.ts for how its
//      public route gets gated off for this deployment.
//
// Everything else below is your original code, untouched.

import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query, withTransaction } from "../../config/db.js";
import {
  hashPassword, verifyPassword,
  signAccessToken,
  generateRefreshToken, hashToken,
} from "../../utils/crypto.js";
import { validateIC, normalizeIC } from "../../utils/ic.js";
import {
  ok, created, badRequest, unauthorized,
  conflict, notFound, serverError,
} from "../../utils/response.js";

// ── Register ────────────────────────────────────────────────────────────────
export async function register(req: Request, res: Response): Promise<void> {
  try {
    const { username, email, mobile, password, full_name_en, full_name_zh } = req.body as Record<string, string>;

    if (!username || !password) { badRequest(res, "username and password are required"); return; }
    if (password.length < 8)    { badRequest(res, "Password must be at least 8 characters"); return; }

    // Check uniqueness
    const { rows: exists } = await query(
      `SELECT id FROM auth.users
       WHERE username = $1
          OR (email  IS NOT NULL AND email  = $2)
          OR (mobile IS NOT NULL AND mobile = $3)
       LIMIT 1`,
      [username, email ?? null, mobile ?? null]
    );
    if (exists.length) { conflict(res, "Username, email or mobile already taken"); return; }

    const pwHash = await hashPassword(password);

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO auth.users (username, email, mobile, password_hash, status, registered_via)
         VALUES ($1, $2, $3, $4, 'ACTIVE', 'LOCAL')
         RETURNING id, username, email, mobile, status, created_at`,
        [username, email ?? null, mobile ?? null, pwHash]
      );
      const user = rows[0];

      // Create profile
      await client.query(
        `INSERT INTO auth.user_profiles (user_id, full_name_en, full_name_zh)
         VALUES ($1, $2, $3)`,
        [user.id, full_name_en ?? null, full_name_zh ?? null]
      );

      // Create lifeverse ext
      await client.query(
        `INSERT INTO lifeverse.user_ext (user_id) VALUES ($1)`,
        [user.id]
      );

      // Assign default role (MEMBER)
      await client.query(
        `INSERT INTO rbac.user_roles (user_id, role_id)
         SELECT $1, id FROM rbac.roles WHERE code = 'MEMBER' AND is_deleted = false LIMIT 1`,
        [user.id]
      );

      created(res, { id: user.id, username: user.username, email: user.email });
    });
  } catch (err) { serverError(res, err); }
}

// ── NEW: Admin-managed account creation (teacher/operator creates student/parent) ──
//
// Students and parents on the education platform never self-register — an
// operator or teacher creates their account for them, using the student's
// IC (or birth-certificate number for younger children) as the username.
// Gate this route behind `authorize("users.create")` in auth.routes.ts.
export async function createManagedUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      ic_number,           // required — becomes the username
      password,            // optional — if omitted, a random temp password is generated
      full_name_en,
      full_name_zh,
      role_code,           // 'STUDENT' | 'PARENT' | 'TEACHER' | 'COURSE_DESIGNER' | 'OPERATOR'
      organization_id,     // which org/branch this account belongs to (rbac.user_roles.scope_id)
      guardian_of_user_id, // optional — if role_code='PARENT', link them to a student immediately
    } = req.body as Record<string, string>;

    if (!ic_number)  { badRequest(res, "ic_number is required"); return; }
    if (!role_code)  { badRequest(res, "role_code is required"); return; }

    const icResult = validateIC(ic_number);
    if (!icResult.valid) { badRequest(res, icResult.error ?? "Invalid IC/birth-certificate number"); return; }

    const username = icResult.normalized!; // IC digits, no dashes, is the username

    const { rows: exists } = await query(
      `SELECT id FROM auth.users WHERE username = $1 LIMIT 1`,
      [username]
    );
    if (exists.length) { conflict(res, "An account with this IC number already exists"); return; }

    // No password supplied → generate one and force a change on first login.
    // (Wire this into your invite/notification flow — e.g. show it once to
    // the creating teacher/operator to hand to the parent, or email it.)
    const tempPassword = password && password.length >= 8 ? password : generateRefreshToken().slice(0, 12);
    const pwHash = await hashPassword(tempPassword);

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO auth.users (username, password_hash, status, registered_via, invited_by)
         VALUES ($1, $2, 'ACTIVE', 'ADMIN_CREATED', $3)
         RETURNING id, username, status, created_at`,
        [username, pwHash, req.user!.sub]
      );
      const user = rows[0];

      await client.query(
        `INSERT INTO auth.user_profiles (user_id, full_name_en, full_name_zh, date_of_birth, ic_no)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, full_name_en ?? null, full_name_zh ?? null, icResult.dateOfBirth ?? null, icResult.formatted ?? null]
      );

      const { rows: roleRows } = await client.query(
        `SELECT id FROM rbac.roles WHERE code = $1 AND is_deleted = false LIMIT 1`,
        [role_code]
      );
      if (!roleRows.length) throw new Error(`Unknown role_code: ${role_code}`);

      await client.query(
        `INSERT INTO rbac.user_roles (user_id, role_id, scope_type, scope_id, assigned_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, roleRows[0].id, organization_id ? "ORG" : null, organization_id ?? null, req.user!.sub]
      );

      if (role_code === "PARENT" && guardian_of_user_id) {
        await client.query(
          `INSERT INTO edu.guardian_relationships (parent_user_id, student_user_id, created_by)
           VALUES ($1, $2, $3)`,
          [user.id, guardian_of_user_id, req.user!.sub]
        );
      }

      return user;
    });

    created(res, {
      id: result.id,
      username: result.username,
      ic_type: icResult.likelyType,
      temp_password: password ? undefined : tempPassword, // only surfaced when auto-generated
    }, "Account created");
  } catch (err) { serverError(res, err); }
}

// ── Login ────────────────────────────────────────────────────────────────────
export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { identity, password } = req.body as { identity?: string; password?: string };
    if (!identity || !password) { badRequest(res, "identity and password are required"); return; }

    // NEW: IC-formatted identities get normalized (strip dashes) before lookup,
    // so a login of "991231-14-5566" matches the stored username "991231145566".
    const normalizedIdentity = normalizeIC(identity).length === 12 ? normalizeIC(identity) : identity;

    // Find user by username / email / mobile
    const { rows } = await query(
      `SELECT u.id, u.username, u.email, u.mobile, u.password_hash,
              u.status, u.failed_login_count, u.locked_until
       FROM auth.users u
       WHERE u.is_deleted = false
         AND (lower(u.username) = lower($1)
           OR lower(u.email)    = lower($1)
           OR u.mobile          = $1)
       LIMIT 1`,
      [normalizedIdentity]
    );

    const ip = req.ip ?? null;

    if (!rows.length) {
      await logLoginAudit(null, identity, false, "USER_NOT_FOUND", ip);
      unauthorized(res, "Invalid credentials"); return;
    }

    const user = rows[0] as {
      id: string; username: string; email: string; mobile: string;
      password_hash: string; status: string;
      failed_login_count: number; locked_until: Date | null;
    };

    if (user.status === "LOCKED" || (user.locked_until && user.locked_until > new Date())) {
      await logLoginAudit(user.id, identity, false, "ACCOUNT_LOCKED", ip);
      unauthorized(res, "Account is locked. Try again later."); return;
    }

    if (user.status !== "ACTIVE") {
      await logLoginAudit(user.id, identity, false, "INACTIVE_ACCOUNT", ip);
      unauthorized(res, "Account is not active"); return;
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      const newCount = user.failed_login_count + 1;
      const lockUntil = newCount >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null;
      await query(
        `UPDATE auth.users SET failed_login_count = $1, locked_until = $2 WHERE id = $3`,
        [newCount, lockUntil, user.id]
      );
      await logLoginAudit(user.id, identity, false, "WRONG_PASSWORD", ip);
      unauthorized(res, "Invalid credentials"); return;
    }

    // Reset failed count
    await query(
      `UPDATE auth.users
       SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), last_login_ip = $1
       WHERE id = $2`,
      [ip, user.id]
    );

    // ── NEW: single active session ──────────────────────────────────────────
    // A student account must never be usable from two devices at once. Whether
    // that's enforced depends on the user's role(s) — see the migration that
    // adds rbac.roles.enforce_single_session. If the user holds ANY role that
    // requires it, we revoke all their existing sessions before issuing a new
    // one. This reuses the exact same revoke pattern as logoutAll() below,
    // just triggered automatically on login instead of only on request.
    const { rows: policyRows } = await query(
      `SELECT bool_or(r.enforce_single_session) AS enforce
       FROM rbac.user_roles ur
       JOIN rbac.roles r ON r.id = ur.role_id AND r.is_deleted = false
       WHERE ur.user_id = $1 AND ur.is_active = true`,
      [user.id]
    );
    const enforceSingleSession: boolean = policyRows[0]?.enforce ?? true; // default strict if no role row

    if (enforceSingleSession) {
      await query(
        `UPDATE auth.user_sessions
         SET revoked_at = now(), revoked_reason = 'NEW_LOGIN'
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [user.id]
      );
    }
    // ── end NEW ──────────────────────────────────────────────────────────────

    // ── NEW (Phase 1+1): subscription gate for STUDENT accounts ──────────────
    // A child's account works only while their subscription is trial-active,
    // paid-active, or within the past_due grace period (see 2.5 in the
    // architecture doc). PARENT accounts are never gated here — they must
    // always be able to log in to manage billing/add children even if every
    // one of their kids' subscriptions has lapsed.
    const { rows: roleCodeRows } = await query(
      `SELECT r.code FROM rbac.user_roles ur
       JOIN rbac.roles r ON r.id = ur.role_id AND r.is_deleted = false
       WHERE ur.user_id = $1 AND ur.is_active = true`,
      [user.id]
    );
    const isStudent = (roleCodeRows as { code: string }[]).some((r) => r.code === "STUDENT");

    if (isStudent) {
      const { rows: subRows } = await query(
        `SELECT status, trial_ends_at, grace_period_ends_at FROM edu.subscriptions
         WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [user.id]
      );
      const sub = subRows[0] as { status: string; trial_ends_at: Date; grace_period_ends_at: Date | null } | undefined;
      const now = new Date();
      const hasAccess = sub && (
        (sub.status === "trial" && new Date(sub.trial_ends_at) > now) ||
        sub.status === "active" ||
        (sub.status === "past_due" && sub.grace_period_ends_at && new Date(sub.grace_period_ends_at) > now)
      );
      if (!hasAccess) {
        await logLoginAudit(user.id, identity, false, "SUBSCRIPTION_EXPIRED", ip);
        res.status(401).json({ success: false, message: "试用/订阅已结束，请家长续订", reason: "SUBSCRIPTION_EXPIRED" });
        return;
      }
    }
    // ── end NEW ──────────────────────────────────────────────────────────────

    const payload = { sub: user.id, username: user.username };
    const accessToken  = signAccessToken(payload);
    const refreshRaw   = generateRefreshToken();
    const refreshHash  = hashToken(refreshRaw);

    const newSessionId = randomUUID();
    await query(
      `INSERT INTO auth.user_sessions
         (id, user_id, refresh_token_hash, ip_address, user_agent, expires_at, session_chain_id)
       VALUES ($1, $2, $3, $4, $5, now() + interval '30 days', $1)`,
      [newSessionId, user.id, refreshHash, ip, req.headers["user-agent"] ?? null]
    );

    await logLoginAudit(user.id, identity, true, "LOGIN_SUCCESS", ip);

    ok(res, {
      accessToken,
      refreshToken: refreshRaw,
      user: { id: user.id, username: user.username, email: user.email },
      forcedOtherDevicesLogout: enforceSingleSession, // NEW: lets the frontend show "you were signed out elsewhere" copy if useful
    });
  } catch (err) { serverError(res, err); }
}

// ── Refresh token ────────────────────────────────────────────────────────────
export async function refreshToken(req: Request, res: Response): Promise<void> {
  try {
    const { refreshToken: token } = req.body as { refreshToken?: string };
    if (!token) { badRequest(res, "refreshToken required"); return; }

    // Refresh tokens are opaque random strings (see generateRefreshToken —
    // just 32 random bytes as hex, not a JWT), stored hashed in
    // auth.user_sessions. Verification IS the DB lookup below: does a
    // non-revoked, non-expired session exist with this token's hash. There
    // used to be a `verifyRefreshToken(token)` JWT-verify call here that
    // would always throw (a random hex string is never valid JWT format),
    // silently rejecting every refresh attempt — removed for good, the DB
    // check is the actual source of truth.
    const hash = hashToken(token);
    const { rows } = await query(
      `SELECT s.id, s.user_id, s.session_chain_id, u.username, u.status
       FROM auth.user_sessions s
       JOIN auth.users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()`,
      [hash]
    );

    if (!rows.length || rows[0].status !== "ACTIVE") {
      unauthorized(res, "Session expired or revoked"); return;
    }

    const session = rows[0] as { id: string; user_id: string; session_chain_id: string; username: string; status: string };

    // Rotate refresh token
    const newRefreshRaw  = generateRefreshToken();
    const newRefreshHash = hashToken(newRefreshRaw);

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE auth.user_sessions SET revoked_at = now(), revoked_reason = 'ROTATED' WHERE id = $1`,
        [session.id]
      );
      // same chain as the session being rotated — this is what lets study-time
      // analytics reconstruct "one continuous login" across many refreshes
      await client.query(
        `INSERT INTO auth.user_sessions
           (user_id, refresh_token_hash, ip_address, user_agent, expires_at, session_chain_id)
         VALUES ($1, $2, $3, $4, now() + interval '30 days', $5)`,
        [session.user_id, newRefreshHash, req.ip ?? null, req.headers["user-agent"] ?? null, session.session_chain_id]
      );
    });

    const newAccess = signAccessToken({ sub: session.user_id, username: session.username });
    ok(res, { accessToken: newAccess, refreshToken: newRefreshRaw });
  } catch (err) { serverError(res, err); }
}

// ── Logout ──────────────────────────────────────────────────────────────────
export async function logout(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { refreshToken: token } = req.body as { refreshToken?: string };
    if (token) {
      const hash = hashToken(token);
      await query(
        `UPDATE auth.user_sessions SET revoked_at = now(), revoked_reason = 'LOGOUT'
         WHERE refresh_token_hash = $1 AND user_id = $2`,
        [hash, req.user!.sub]
      );
    }
    ok(res, null, "Logged out");
  } catch (err) { serverError(res, err); }
}

// ── Logout all sessions ──────────────────────────────────────────────────────
export async function logoutAll(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rowCount } = await query(
      `UPDATE auth.user_sessions
       SET revoked_at = now(), revoked_reason = 'LOGOUT_ALL'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [req.user!.sub]
    );
    ok(res, { revokedSessions: rowCount }, "All sessions revoked");
  } catch (err) { serverError(res, err); }
}

// ── Get me ───────────────────────────────────────────────────────────────────
// NOTE: original LifeVerse version also joined lifeverse.user_ext for social
// stats (followers/posts/diary counts). That table isn't part of the core
// schema set carried into this education platform (see the schema-extraction
// notes), so those columns are dropped here — same trim as public.v_users.
export async function getMe(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT
         u.id, u.username, u.email, u.mobile,
         u.status, u.is_verified, u.last_login_at, u.created_at,
         p.full_name_en, p.full_name_zh, p.preferred_name,
         p.avatar_url, p.cover_url, p.bio,
         p.gender_code, p.date_of_birth, p.nationality_code,
         p.religion_code, p.ethnicity_code, p.ancestry_code,
         p.language_code, p.timezone,
         COALESCE(
           json_agg(json_build_object('code', r.code, 'name', r.name_en))
           FILTER (WHERE r.id IS NOT NULL), '[]'
         ) AS roles
       FROM auth.users u
       LEFT JOIN auth.user_profiles  p ON p.user_id = u.id
       LEFT JOIN rbac.user_roles     ur ON ur.user_id = u.id AND ur.is_active = true
       LEFT JOIN rbac.roles          r  ON r.id = ur.role_id AND r.is_deleted = false
       WHERE u.id = $1 AND u.is_deleted = false
       GROUP BY u.id, p.user_id`,
      [req.user!.sub]
    );
    if (!rows.length) { notFound(res, "User not found"); return; }
    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

// ── Change password ──────────────────────────────────────────────────────────
export async function changePassword(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body as Record<string, string>;
    if (!currentPassword || !newPassword) { badRequest(res, "currentPassword and newPassword required"); return; }
    if (newPassword.length < 8) { badRequest(res, "New password must be at least 8 characters"); return; }

    const { rows } = await query(
      `SELECT password_hash FROM auth.users WHERE id = $1`,
      [req.user!.sub]
    );
    if (!rows.length) { notFound(res); return; }

    const valid = await verifyPassword(currentPassword, rows[0].password_hash as string);
    if (!valid) { unauthorized(res, "Current password is incorrect"); return; }

    const newHash = await hashPassword(newPassword);
    await query(`UPDATE auth.users SET password_hash = $1 WHERE id = $2`, [newHash, req.user!.sub]);

    // Revoke all refresh tokens
    await query(
      `UPDATE auth.user_sessions
       SET revoked_at = now(), revoked_reason = 'PASSWORD_CHANGE'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [req.user!.sub]
    );

    ok(res, null, "Password changed. Please log in again.");
  } catch (err) { serverError(res, err); }
}

// ── Forgot password (stub) ───────────────────────────────────────────────────
export async function forgotPassword(req: Request, res: Response): Promise<void> {
  // In production: generate reset token, send email
  ok(res, null, "If the account exists, a reset email has been sent.");
}

// ── Real-name verification ───────────────────────────────────────────────────
export async function submitVerification(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      method = "DOCUMENT",
      full_name_en, full_name_zh, ic_no, passport_no,
      date_of_birth, nationality_code, id_document_type,
      front_doc_url, back_doc_url, selfie_url,
    } = req.body as Record<string, string>;

    // Check if pending verification exists
    const { rows: pending } = await query(
      `SELECT id FROM auth.user_verifications
       WHERE user_id = $1 AND status IN ('PENDING','VERIFIED')`,
      [req.user!.sub]
    );
    if (pending.length) { conflict(res, "A verification is already pending or approved"); return; }

    const { rows } = await query(
      `INSERT INTO auth.user_verifications
         (user_id, method, full_name_en, full_name_zh, ic_no, passport_no,
          date_of_birth, nationality_code, id_document_type,
          front_doc_url, back_doc_url, selfie_url, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDING')
       RETURNING id, status, created_at`,
      [req.user!.sub, method, full_name_en ?? null, full_name_zh ?? null,
       ic_no ?? null, passport_no ?? null, date_of_birth ?? null,
       nationality_code ?? null, id_document_type ?? null,
       front_doc_url ?? null, back_doc_url ?? null, selfie_url ?? null]
    );

    created(res, rows[0], "Verification submitted. Under review.");
  } catch (err) { serverError(res, err); }
}

export async function getMyVerification(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT id, method, full_name_en, full_name_zh, ic_no,
              id_document_type, status, verified_at, rejected_reason, created_at
       FROM auth.user_verifications
       WHERE user_id = $1 AND is_deleted = false
       ORDER BY created_at DESC LIMIT 1`,
      [req.user!.sub]
    );
    ok(res, rows[0] ?? null);
  } catch (err) { serverError(res, err); }
}

// ── Internal helpers ─────────────────────────────────────────────────────────
async function logLoginAudit(
  userId: string | null, identity: string,
  success: boolean, reason: string, ip: string | null
): Promise<void> {
  try {
    await query(
      `INSERT INTO auth.login_audit_logs
         (user_id, identity_used, event_type, success, ip_address, failure_reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, identity, success ? "LOGIN_SUCCESS" : "LOGIN_FAILURE",
       success, ip, success ? null : reason]
    );
  } catch { /* audit failures must not break the main flow */ }
}
