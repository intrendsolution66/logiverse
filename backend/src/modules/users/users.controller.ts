import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { ok, notFound, badRequest, serverError, paginated } from "../../utils/response.js";
import { parsePagination } from "../../utils/pagination.js";

export async function listUsers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req);
    const search = String(req.query.search ?? "");
    const status = String(req.query.status ?? "");

    const conditions: string[] = ["u.is_deleted = false"];
    const params: unknown[] = [];
    let i = 1;

    if (search) {
      conditions.push(`(lower(u.username) LIKE $${i} OR lower(u.email) LIKE $${i} OR lower(p.full_name_en) LIKE $${i})`);
      params.push(`%${search.toLowerCase()}%`); i++;
    }
    if (status) { conditions.push(`u.status = $${i}`); params.push(status); i++; }

    const where = conditions.join(" AND ");

    const { rows: countRows } = await query(
      `SELECT COUNT(*) FROM auth.users u LEFT JOIN auth.user_profiles p ON p.user_id = u.id WHERE ${where}`,
      params
    );
    const total = parseInt(countRows[0].count as string, 10);

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT u.id, u.username, u.email, u.mobile, u.status, u.is_verified,
              u.last_login_at, u.created_at,
              p.full_name_en, p.full_name_zh, p.preferred_name, p.avatar_url
       FROM auth.users u
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      params
    );

    paginated(res, rows, total, page, limit);
  } catch (err) { serverError(res, err); }
}

export async function getUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT u.id, u.username, u.email, u.mobile, u.status, u.is_verified,
              u.last_login_at, u.registered_via, u.created_at, u.updated_at,
              p.full_name_en, p.full_name_zh, p.preferred_name, p.avatar_url, p.cover_url,
              p.bio, p.gender_code, p.date_of_birth, p.nationality_code,
              p.religion_code, p.ethnicity_code, p.ancestry_code,
              p.marital_status_code, p.education_level_code, p.occupation_code,
              p.language_code, p.timezone
       FROM auth.users u
       LEFT JOIN auth.user_profiles p ON p.user_id = u.id
       WHERE u.id = $1 AND u.is_deleted = false`,
      [req.params.id]
    );
    if (!rows.length) { notFound(res); return; }
    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function updateMyProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.method === "GET") {
      const { rows } = await query(
        `SELECT p.*, e.bio_emoji, e.location_label, e.website_url,
                e.default_post_visibility, e.default_diary_visibility,
                e.default_goal_visibility, e.default_family_visibility, e.is_profile_public
         FROM auth.user_profiles p
         LEFT JOIN lifeverse.user_ext e ON e.user_id = p.user_id
         WHERE p.user_id = $1`,
        [req.user!.sub]
      );
      ok(res, rows[0] ?? null); return;
    }

    const {
      full_name_en, full_name_zh, preferred_name, bio,
      avatar_url, cover_url, gender_code, date_of_birth,
      nationality_code, religion_code, ethnicity_code, ancestry_code,
      marital_status_code, education_level_code, occupation_code,
      language_code, timezone,
      // ext fields
      bio_emoji, location_label, website_url,
      default_post_visibility, default_diary_visibility,
      default_goal_visibility, default_family_visibility, is_profile_public,
    } = req.body as Record<string, string | boolean>;

    await query(
      `INSERT INTO auth.user_profiles (user_id, full_name_en, full_name_zh, preferred_name, bio,
         avatar_url, cover_url, gender_code, date_of_birth, nationality_code,
         religion_code, ethnicity_code, ancestry_code, marital_status_code,
         education_level_code, occupation_code, language_code, timezone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (user_id) DO UPDATE SET
         full_name_en        = EXCLUDED.full_name_en,
         full_name_zh        = EXCLUDED.full_name_zh,
         preferred_name      = EXCLUDED.preferred_name,
         bio                 = EXCLUDED.bio,
         avatar_url          = EXCLUDED.avatar_url,
         cover_url           = EXCLUDED.cover_url,
         gender_code         = EXCLUDED.gender_code,
         date_of_birth       = EXCLUDED.date_of_birth,
         nationality_code    = EXCLUDED.nationality_code,
         religion_code       = EXCLUDED.religion_code,
         ethnicity_code      = EXCLUDED.ethnicity_code,
         ancestry_code       = EXCLUDED.ancestry_code,
         marital_status_code = EXCLUDED.marital_status_code,
         education_level_code= EXCLUDED.education_level_code,
         occupation_code     = EXCLUDED.occupation_code,
         language_code       = EXCLUDED.language_code,
         timezone            = EXCLUDED.timezone,
         updated_at          = now()`,
      [req.user!.sub, full_name_en ?? null, full_name_zh ?? null, preferred_name ?? null,
       bio ?? null, avatar_url ?? null, cover_url ?? null, gender_code ?? null,
       date_of_birth ?? null, nationality_code ?? null, religion_code ?? null,
       ethnicity_code ?? null, ancestry_code ?? null, marital_status_code ?? null,
       education_level_code ?? null, occupation_code ?? null, language_code ?? null, timezone ?? null]
    );

    await query(
      `INSERT INTO lifeverse.user_ext (user_id, bio_emoji, location_label, website_url,
         default_post_visibility, default_diary_visibility,
         default_goal_visibility, default_family_visibility, is_profile_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (user_id) DO UPDATE SET
         bio_emoji                = EXCLUDED.bio_emoji,
         location_label           = EXCLUDED.location_label,
         website_url              = EXCLUDED.website_url,
         default_post_visibility  = COALESCE(EXCLUDED.default_post_visibility,  lifeverse.user_ext.default_post_visibility),
         default_diary_visibility = COALESCE(EXCLUDED.default_diary_visibility, lifeverse.user_ext.default_diary_visibility),
         default_goal_visibility  = COALESCE(EXCLUDED.default_goal_visibility,  lifeverse.user_ext.default_goal_visibility),
         default_family_visibility= COALESCE(EXCLUDED.default_family_visibility,lifeverse.user_ext.default_family_visibility),
         is_profile_public        = COALESCE(EXCLUDED.is_profile_public,        lifeverse.user_ext.is_profile_public),
         updated_at               = now()`,
      [req.user!.sub, bio_emoji ?? null, location_label ?? null, website_url ?? null,
       default_post_visibility ?? null, default_diary_visibility ?? null,
       default_goal_visibility ?? null, default_family_visibility ?? null,
       is_profile_public ?? null]
    );

    ok(res, null, "Profile updated");
  } catch (err) { serverError(res, err); }
}

export async function updateProfile(req: AuthRequest, res: Response): Promise<void> {
  req.params.id = req.params.id;
  // Reuse updateMyProfile logic but for target user
  await updateMyProfile(req, res);
}

export async function listSessions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT id, ip_address, user_agent, device_name, last_used_at, expires_at, created_at
       FROM auth.user_sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY last_used_at DESC`,
      [req.user!.sub]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function revokeSession(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rowCount } = await query(
      `UPDATE auth.user_sessions SET revoked_at = now(), revoked_reason = 'MANUAL'
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user!.sub]
    );
    if (!rowCount) { notFound(res, "Session not found"); return; }
    ok(res, null, "Session revoked");
  } catch (err) { serverError(res, err); }
}

export async function listVerifications(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req);
    const status = String(req.query.status ?? "PENDING");

    const { rows: countRows } = await query(
      `SELECT COUNT(*) FROM auth.user_verifications WHERE is_deleted = false AND status = $1`,
      [status]
    );
    const total = parseInt(countRows[0].count as string, 10);

    const { rows } = await query(
      `SELECT v.*, u.username, p.full_name_en, p.full_name_zh
       FROM auth.user_verifications v
       JOIN auth.users u ON u.id = v.user_id
       LEFT JOIN auth.user_profiles p ON p.user_id = v.user_id
       WHERE v.is_deleted = false AND v.status = $1
       ORDER BY v.created_at ASC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );
    paginated(res, rows, total, page, limit);
  } catch (err) { serverError(res, err); }
}

export async function reviewVerification(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { action, reject_reason } = req.body as { action?: string; reject_reason?: string };
    if (!["approve", "reject"].includes(action ?? "")) {
      badRequest(res, "action must be 'approve' or 'reject'"); return;
    }

    const status = action === "approve" ? "VERIFIED" : "REJECTED";
    const { rowCount } = await query(
      `UPDATE auth.user_verifications
       SET status = $1, verified_by = $2, verified_at = now(), rejected_reason = $3
       WHERE id = $4 AND status = 'PENDING' AND is_deleted = false`,
      [status, req.user!.sub, reject_reason ?? null, req.params.id]
    );

    if (!rowCount) { notFound(res, "Verification not found or already processed"); return; }

    if (action === "approve") {
      // Get user_id and mark verified
      const { rows } = await query(
        `SELECT user_id FROM auth.user_verifications WHERE id = $1`, [req.params.id]
      );
      if (rows.length) {
        await query(
          `UPDATE auth.users SET is_verified = true WHERE id = $1`, [rows[0].user_id]
        );
      }
    }

    ok(res, null, `Verification ${status.toLowerCase()}`);
  } catch (err) { serverError(res, err); }
}
