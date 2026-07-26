import type { Request, Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { ok, created, notFound, badRequest, serverError } from "../../utils/response.js";

export async function getLookupOptions(req: Request, res: Response): Promise<void> {
  try {
    const category = String(req.query.category ?? "");
    const lang     = String(req.query.lang ?? "en");
    const params: unknown[] = [];
    let where = "";
    if (category) { where = "WHERE category = $1"; params.push(category); }

    const { rows } = await query(
      `SELECT category, code,
              CASE $${params.length + 1}::text
                WHEN 'zh' THEN COALESCE(label_zh, label_en)
                WHEN 'ms' THEN COALESCE(label_ms, label_en)
                ELSE label_en
              END AS label,
              sort_order
       FROM public.v_lookup_options
       ${where}
       ORDER BY category, sort_order`,
      [...params, lang]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function getSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const publicOnly = !req.user;
    const { rows } = await query(
      `SELECT key, value, value_type, description, is_public FROM config.settings
       ${publicOnly ? "WHERE is_public = true" : ""}
       ORDER BY key`,
      []
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function upsertSetting(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { key } = req.params;
    const { value, value_type = "string", description } = req.body as Record<string, string>;
    await query(
      `INSERT INTO config.settings (key, value, value_type, description, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, value_type = EXCLUDED.value_type,
             description = COALESCE(EXCLUDED.description, config.settings.description),
             updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, value, value_type, description ?? null, req.user!.sub]
    );
    ok(res, null, "Setting saved");
  } catch (err) { serverError(res, err); }
}

export async function listIdentityProviders(_req: Request, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT code, label_en, label_zh, provider_type,
              is_enabled, allow_login, allow_register, require_verification, sort_order
       FROM config.identity_providers ORDER BY sort_order`
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function updateIdentityProvider(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { code } = req.params;
    const { is_enabled, allow_login, allow_register, require_verification,
            client_id, client_secret, extra_config } = req.body as Record<string, unknown>;
    await query(
      `UPDATE config.identity_providers
       SET is_enabled          = COALESCE($1, is_enabled),
           allow_login         = COALESCE($2, allow_login),
           allow_register      = COALESCE($3, allow_register),
           require_verification= COALESCE($4, require_verification),
           client_id           = COALESCE($5, client_id),
           client_secret       = COALESCE($6, client_secret),
           extra_config        = COALESCE($7, extra_config),
           updated_at          = now()
       WHERE code = $8`,
      [is_enabled ?? null, allow_login ?? null, allow_register ?? null,
       require_verification ?? null, client_id ?? null, client_secret ?? null,
       extra_config ? JSON.stringify(extra_config) : null, code]
    );
    ok(res, null, "Provider updated");
  } catch (err) { serverError(res, err); }
}

export async function listTranslations(req: Request, res: Response): Promise<void> {
  try {
    const lang  = String(req.query.lang  ?? "en");
    const group = String(req.query.group ?? "");
    const params: unknown[] = [lang];
    let extra = "";
    if (group) { extra = "AND tk.group_code = $2"; params.push(group); }

    const { rows } = await query(
      `SELECT tk.key, t.value, tk.group_code
       FROM i18n.translation_keys tk
       JOIN i18n.translations t ON t.key_id = tk.id
       WHERE t.language_code = $1 ${extra}
       ORDER BY tk.key`,
      params
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function upsertTranslation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { key } = req.params;
    const { lang, value } = req.body as { lang?: string; value?: string };
    if (!lang || !value) { badRequest(res, "lang and value required"); return; }

    // Ensure key exists
    await query(
      `INSERT INTO i18n.translation_keys (key, default_value)
       VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
    const { rows } = await query(
      `SELECT id FROM i18n.translation_keys WHERE key = $1`, [key]
    );
    if (!rows.length) { notFound(res, "Translation key not found"); return; }

    await query(
      `INSERT INTO i18n.translations (key_id, language_code, value, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key_id, language_code) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [rows[0].id, lang, value, req.user!.sub]
    );
    ok(res, null, "Translation saved");
  } catch (err) { serverError(res, err); }
}

export async function listGlobalRoles(_req: Request, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT r.id, r.code, r.name_en, r.name_zh, r.role_type, r.level,
              r.is_system, r.is_active,
              COUNT(DISTINCT ur.user_id) AS user_count
       FROM rbac.roles r
       LEFT JOIN rbac.user_roles ur ON ur.role_id = r.id AND ur.is_active = true
       WHERE r.is_deleted = false
       GROUP BY r.id ORDER BY r.level`
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function createRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { code, name_en, name_zh, description, level = 50 } = req.body as Record<string, unknown>;
    if (!code || !name_en) { badRequest(res, "code and name_en required"); return; }
    const { rows } = await query(
      `INSERT INTO rbac.roles (code, name_en, name_zh, description, level)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, code, name_en`,
      [code, name_en, name_zh ?? null, description ?? null, level]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function updateRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { name_en, name_zh, description, level, is_active } = req.body as Record<string, unknown>;
    const { rowCount } = await query(
      `UPDATE rbac.roles SET
         name_en     = COALESCE($1, name_en),
         name_zh     = COALESCE($2, name_zh),
         description = COALESCE($3, description),
         level       = COALESCE($4, level),
         is_active   = COALESCE($5, is_active),
         updated_at  = now()
       WHERE id = $6 AND is_deleted = false AND is_system = false`,
      [name_en ?? null, name_zh ?? null, description ?? null, level ?? null, is_active ?? null, req.params.id]
    );
    if (!rowCount) { notFound(res, "Role not found or is a system role"); return; }
    ok(res, null, "Role updated");
  } catch (err) { serverError(res, err); }
}

export async function deleteRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rowCount } = await query(
      `UPDATE rbac.roles SET is_deleted = true, deleted_at = now()
       WHERE id = $1 AND is_system = false AND is_deleted = false`,
      [req.params.id]
    );
    if (!rowCount) { notFound(res, "Role not found or is a system role"); return; }
    ok(res, null, "Role deleted");
  } catch (err) { serverError(res, err); }
}

export async function listPermissions(_req: Request, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT id, code, name_en, name_zh, group_code, group_name_en, is_active
       FROM rbac.permissions ORDER BY group_code, code`
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function assignRoleToUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const { role_id, expires_at } = req.body as { role_id?: string; expires_at?: string };
    if (!role_id) { badRequest(res, "role_id required"); return; }
    await query(
      `INSERT INTO rbac.user_roles (user_id, role_id, expires_at, assigned_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, role_id, scope_type, scope_id) DO UPDATE
         SET is_active = true, expires_at = EXCLUDED.expires_at, revoked_at = NULL`,
      [userId, role_id, expires_at ?? null, req.user!.sub]
    );
    ok(res, null, "Role assigned");
  } catch (err) { serverError(res, err); }
}

export async function removeRoleFromUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId, roleId } = req.params;
    const { rowCount } = await query(
      `UPDATE rbac.user_roles SET is_active = false, revoked_at = now(), revoked_by = $1
       WHERE user_id = $2 AND role_id = $3 AND is_active = true`,
      [req.user!.sub, userId, roleId]
    );
    if (!rowCount) { notFound(res, "User role assignment not found"); return; }
    ok(res, null, "Role removed");
  } catch (err) { serverError(res, err); }
}
