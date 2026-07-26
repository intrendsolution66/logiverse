// src/modules/auth/profile-extras.controller.ts
// Education history + group/organisation affiliations for a member's profile.
import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { ok, created, notFound, badRequest, serverError } from "../../utils/response.js";

// ── Education ─────────────────────────────────────────────────────────────────
export async function listMyEducation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT * FROM auth.user_education WHERE user_id = $1 ORDER BY sort_order ASC, start_year DESC`,
      [req.user!.sub]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

// Read-only view of someone else's education (for viewing other members' profiles)
export async function listUserEducation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT * FROM auth.user_education WHERE user_id = $1 ORDER BY sort_order ASC, start_year DESC`,
      [req.params.userId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function addEducation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      level, institution, field_of_study, start_year, end_year,
      is_current = false, sort_order = 0,
    } = req.body as Record<string, unknown>;
    if (!level || !institution) { badRequest(res, "level and institution are required"); return; }

    const { rows } = await query(
      `INSERT INTO auth.user_education
         (user_id, level, institution, field_of_study, start_year, end_year, is_current, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [req.user!.sub, level, institution, field_of_study ?? null,
       start_year ?? null, is_current ? null : (end_year ?? null), is_current, sort_order]
    );
    created(res, rows[0], "Education added");
  } catch (err) { serverError(res, err); }
}

export async function updateEducation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    const allowed = ["level", "institution", "field_of_study", "start_year", "end_year", "is_current", "sort_order"];
    const sets: string[] = []; const vals: unknown[] = []; let i = 1;
    for (const key of allowed) {
      if (body[key] !== undefined) { sets.push(`${key}=$${i++}`); vals.push(body[key]); }
    }
    // Studying now → clear end_year so it doesn't show a stale graduation year
    if (body.is_current === true) { sets.push(`end_year=$${i++}`); vals.push(null); }
    if (!sets.length) { badRequest(res, "Nothing to update"); return; }
    vals.push(req.params.id, req.user!.sub);

    const { rows } = await query(
      `UPDATE auth.user_education SET ${sets.join(",")}, updated_at = now()
       WHERE id = $${i} AND user_id = $${i+1}
       RETURNING *`,
      vals
    );
    if (!rows.length) { notFound(res, "Education record not found"); return; }
    ok(res, rows[0], "Education updated");
  } catch (err) { serverError(res, err); }
}

export async function deleteEducation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rowCount } = await query(
      `DELETE FROM auth.user_education WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user!.sub]
    );
    if (!rowCount) { notFound(res, "Education record not found"); return; }
    ok(res, null, "Education removed");
  } catch (err) { serverError(res, err); }
}

// ── Affiliations (groups / organisations participated in) ─────────────────────
export async function listMyAffiliations(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT a.*, o.name AS org_name, o.name_zh AS org_name_zh, o.slug AS org_slug, o.logo_url AS org_logo_url
       FROM auth.user_affiliations a
       LEFT JOIN org.organizations o ON o.id = a.org_id
       WHERE a.user_id = $1
       ORDER BY a.sort_order ASC, a.created_at DESC`,
      [req.user!.sub]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function listUserAffiliations(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT a.*, o.name AS org_name, o.name_zh AS org_name_zh, o.slug AS org_slug, o.logo_url AS org_logo_url
       FROM auth.user_affiliations a
       LEFT JOIN org.organizations o ON o.id = a.org_id
       WHERE a.user_id = $1
       ORDER BY a.sort_order ASC, a.created_at DESC`,
      [req.params.userId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function addAffiliation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { org_id, org_name_text, role_label, sort_order = 0 } = req.body as Record<string, unknown>;
    if (!org_id && !org_name_text) { badRequest(res, "Either org_id (linked) or org_name_text (unregistered group) is required"); return; }

    const { rows } = await query(
      `INSERT INTO auth.user_affiliations (user_id, org_id, org_name_text, role_label, sort_order)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [req.user!.sub, org_id ?? null, org_id ? null : (org_name_text ?? null), role_label ?? null, sort_order]
    );
    created(res, rows[0], "Affiliation added");
  } catch (err) { serverError(res, err); }
}

export async function updateAffiliation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>;
    // Switching to a linked org clears the free-text name, and vice versa —
    // a row should never have both set at once.
    if (body.org_id !== undefined && body.org_id) { body.org_name_text = null; }
    if (body.org_name_text !== undefined && body.org_name_text) { body.org_id = null; }

    const allowed = ["org_id", "org_name_text", "role_label", "sort_order"];
    const sets: string[] = []; const vals: unknown[] = []; let i = 1;
    for (const key of allowed) {
      if (body[key] !== undefined) { sets.push(`${key}=$${i++}`); vals.push(body[key]); }
    }
    if (!sets.length) { badRequest(res, "Nothing to update"); return; }
    vals.push(req.params.id, req.user!.sub);

    const { rows } = await query(
      `UPDATE auth.user_affiliations SET ${sets.join(",")}
       WHERE id = $${i} AND user_id = $${i+1}
       RETURNING *`,
      vals
    );
    if (!rows.length) { notFound(res, "Affiliation not found"); return; }
    ok(res, rows[0], "Affiliation updated");
  } catch (err) { serverError(res, err); }
}

export async function deleteAffiliation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rowCount } = await query(
      `DELETE FROM auth.user_affiliations WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user!.sub]
    );
    if (!rowCount) { notFound(res, "Affiliation not found"); return; }
    ok(res, null, "Affiliation removed");
  } catch (err) { serverError(res, err); }
}

// ── Lightweight org search, for the "link to a registered org" autocomplete ───
// GET /orgs/search-lite?q=xxx
export async function searchOrgsLite(req: AuthRequest, res: Response): Promise<void> {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 1) { ok(res, []); return; }
    const { rows } = await query(
      `SELECT id, name, name_zh, slug, logo_url, org_type
       FROM org.organizations
       WHERE status = 'active' AND is_deleted = false
         AND (lower(name) LIKE $1 OR lower(name_zh) LIKE $1)
       ORDER BY name ASC
       LIMIT 10`,
      [`%${q.toLowerCase()}%`]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}
