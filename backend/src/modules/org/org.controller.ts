import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query, withTransaction } from "../../config/db.js";
import {
  ok, created, notFound, conflict, badRequest, forbidden, serverError
} from "../../utils/response.js";
import { parsePagination } from "../../utils/pagination.js";

// ── List / Get Orgs ──────────────────────────────────────────────────────────
export async function listOrgs(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { limit, offset } = parsePagination(req, 20);
    const search   = String(req.query.search   ?? "");
    const category = String(req.query.category ?? "");
    const org_type = String(req.query.org_type ?? "");

    const params: unknown[] = [];
    const conds = ["o.is_deleted=false", "o.status='active'", "o.visibility IN ('PUBLIC','LOGGED_IN')"];
    let i = 1;
    if (search)   { conds.push(`(lower(o.name) LIKE $${i} OR lower(o.tagline) LIKE $${i})`); i++; params.push(`%${search.toLowerCase()}%`); }
    if (category) { conds.push(`o.category_code=$${i++}`); params.push(category); }
    if (org_type) { conds.push(`o.org_type=$${i++}`);      params.push(org_type); }

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT o.id, o.slug, o.name, o.name_zh, o.tagline, o.logo_url, o.cover_url,
              o.org_type, o.category_code, o.tags, o.members_count,
              o.is_verified_org, o.join_mode, o.require_verification,
              o.visibility, o.landing_enabled, o.created_at
       FROM org.organizations o
       WHERE ${conds.join(" AND ")}
       ORDER BY o.is_verified_org DESC, o.members_count DESC
       LIMIT $${i} OFFSET $${i+1}`,
      params
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function getOrg(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT o.*,
              CASE WHEN $2::uuid IS NOT NULL THEN
                (SELECT status FROM org.org_members WHERE org_id=o.id AND user_id=$2)
              ELSE NULL END AS my_membership_status,
              CASE WHEN $2::uuid IS NOT NULL THEN
                (SELECT r.code FROM org.org_members m
                 JOIN org.org_roles r ON r.id=m.role_id
                 WHERE m.org_id=o.id AND m.user_id=$2)
              ELSE NULL END AS my_role
       FROM org.organizations o
       WHERE (o.slug=$1 OR o.id::text=$1) AND o.is_deleted=false`,
      [req.params.orgId, req.user?.sub ?? null]
    );
    if (!rows.length) { notFound(res); return; }
    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function createOrg(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      slug, name, name_en, name_zh, tagline, description,
      logo_url, cover_url, org_type = "community", category_code, tags = [],
      email, phone, website_url, address, state_code, country_code = "MY",
      visibility = "PUBLIC", join_mode = "apply",
      require_verification = false, landing_enabled = true,
      registration_no, registration_body, registration_date, registration_doc_url,
    } = req.body as Record<string, unknown>;

    if (!slug || !name) { badRequest(res, "slug and name required"); return; }

    const { rows: exists } = await query(`SELECT id FROM org.organizations WHERE slug=$1`, [slug]);
    if (exists.length) { conflict(res, "Slug already taken"); return; }

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO org.organizations
           (created_by, owner_user_id, slug, name, name_en, name_zh, tagline, description,
            logo_url, cover_url, org_type, category_code, tags,
            email, phone, website_url, address, state_code, country_code,
            visibility, join_mode, require_verification, landing_enabled,
            registration_no, registration_body, registration_date, registration_doc_url,
            members_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,1)
         RETURNING id, slug`,
        [req.user!.sub, req.user!.sub, slug, name, name_en ?? null, name_zh ?? null,
         tagline ?? null, description ?? null, logo_url ?? null, cover_url ?? null,
         org_type, category_code ?? null, Array.isArray(tags) ? tags : [],
         email ?? null, phone ?? null, website_url ?? null, address ?? null,
         state_code ?? null, country_code, visibility, join_mode,
         require_verification, landing_enabled,
         registration_no ?? null, registration_body ?? null,
         registration_date ?? null, registration_doc_url ?? null]
      );
      const orgId = rows[0].id as string;

      // Copy permission templates from config
      const { rows: tmpl } = await client.query(
        `SELECT value FROM config.settings WHERE key='lifeverse.org_permission_templates'`
      );
      if (tmpl.length) {
        const perms = JSON.parse(tmpl[0].value as string) as Array<{code:string;group:string;name_en:string;name_zh:string}>;
        for (const p of perms) {
          await client.query(
            `INSERT INTO org.org_permissions (org_id, code, name, name_en, group_code, is_system)
             VALUES ($1,$2,$3,$4,$5,true)`,
            [orgId, p.code, p.name_zh ?? p.name_en, p.name_en, p.group]
          );
        }
      }

      // Copy role templates
      const { rows: rtmpl } = await client.query(
        `SELECT value FROM config.settings WHERE key='lifeverse.org_role_templates'`
      );
      if (rtmpl.length) {
        const roleTemplates = JSON.parse(rtmpl[0].value as string) as Array<{
          code:string; level:number; is_system:boolean; is_default:boolean;
          name_en:string; name_zh:string; permissions?: string[] | "all"
        }>;
        for (const r of roleTemplates) {
          const { rows: roleRows } = await client.query(
            `INSERT INTO org.org_roles (org_id, code, name, name_en, level, is_system, is_default)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [orgId, r.code, r.name_zh ?? r.name_en, r.name_en, r.level, r.is_system, r.is_default]
          );
          const roleId = roleRows[0].id as string;

          if (r.permissions === "all") {
            await client.query(
              `INSERT INTO org.org_role_permissions (org_id, role_id, permission_id)
               SELECT $1, $2, id FROM org.org_permissions WHERE org_id=$1`,
              [orgId, roleId]
            );
          } else if (Array.isArray(r.permissions)) {
            for (const pcode of r.permissions) {
              await client.query(
                `INSERT INTO org.org_role_permissions (org_id, role_id, permission_id)
                 SELECT $1, $2, id FROM org.org_permissions WHERE org_id=$1 AND code=$3
                 ON CONFLICT DO NOTHING`,
                [orgId, roleId, pcode]
              );
            }
          }
        }
      }

      // Add creator as OWNER member
      const { rows: ownerRole } = await client.query(
        `SELECT id FROM org.org_roles WHERE org_id=$1 AND code='OWNER'`, [orgId]
      );
      if (ownerRole.length) {
        await client.query(
          `INSERT INTO org.org_members
             (org_id, user_id, role_id, status, joined_via, joined_at)
           VALUES ($1,$2,$3,'active','direct',now())`,
          [orgId, req.user!.sub, ownerRole[0].id]
        );
      }

      // Create default landing sections
      for (const [idx, stype] of ["hero","about","announcements","events"].entries()) {
        await client.query(
          `INSERT INTO org.landing_sections (org_id, section_type, title, sort_order, visibility, is_enabled)
           VALUES ($1,$2,$3,$4,'PUBLIC',true)`,
          [orgId, stype, stype.charAt(0).toUpperCase()+stype.slice(1), idx]
        );
      }

      created(res, rows[0]);
    });
  } catch (err) { serverError(res, err); }
}

export async function updateOrg(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      name, name_zh, tagline, description, logo_url, cover_url,
      email, phone, website_url, address, visibility, join_mode,
      require_verification, landing_enabled, landing_theme,
    } = req.body as Record<string, unknown>;
    await query(
      `UPDATE org.organizations SET
         name                 = COALESCE($1,  name),
         name_zh              = COALESCE($2,  name_zh),
         tagline              = COALESCE($3,  tagline),
         description          = COALESCE($4,  description),
         logo_url             = COALESCE($5,  logo_url),
         cover_url            = COALESCE($6,  cover_url),
         email                = COALESCE($7,  email),
         phone                = COALESCE($8,  phone),
         website_url          = COALESCE($9,  website_url),
         address              = COALESCE($10, address),
         visibility           = COALESCE($11, visibility),
         join_mode            = COALESCE($12, join_mode),
         require_verification = COALESCE($13, require_verification),
         landing_enabled      = COALESCE($14, landing_enabled),
         landing_theme        = COALESCE($15, landing_theme),
         updated_at           = now()
       WHERE id=$16 AND is_deleted=false`,
      [name ?? null, name_zh ?? null, tagline ?? null, description ?? null,
       logo_url ?? null, cover_url ?? null, email ?? null, phone ?? null,
       website_url ?? null, address ?? null, visibility ?? null, join_mode ?? null,
       require_verification ?? null, landing_enabled ?? null, landing_theme ?? null,
       req.params.orgId]
    );
    ok(res, null, "Organization updated");
  } catch (err) { serverError(res, err); }
}

// ── Members ──────────────────────────────────────────────────────────────────
export async function listMembers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { limit, offset } = parsePagination(req, 20);
    const status = String(req.query.status ?? "active");
    const { rows } = await query(
      `SELECT m.id, m.member_no, m.status, m.joined_at, m.membership_end,
              m.is_verified, m.applied_at,
              u.id AS user_id, u.username, u.email,
              p.full_name_en, p.full_name_zh, p.avatar_url,
              r.code AS role_code, r.name AS role_name
       FROM org.org_members m
       JOIN auth.users u ON u.id=m.user_id
       LEFT JOIN auth.user_profiles p ON p.user_id=u.id
       LEFT JOIN org.org_roles r ON r.id=m.role_id
       WHERE m.org_id=$1 AND m.is_deleted=false AND m.status=$2
       ORDER BY m.joined_at DESC
       LIMIT $3 OFFSET $4`,
      [req.params.orgId, status, limit, offset]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function getMember(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT m.*, u.username, u.email, p.full_name_en, p.full_name_zh, p.avatar_url,
              r.code AS role_code, r.name AS role_name
       FROM org.org_members m
       JOIN auth.users u ON u.id=m.user_id
       LEFT JOIN auth.user_profiles p ON p.user_id=u.id
       LEFT JOIN org.org_roles r ON r.id=m.role_id
       WHERE m.id=$1 AND m.org_id=$2`,
      [req.params.memberId, req.params.orgId]
    );
    if (!rows.length) { notFound(res); return; }
    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function applyToOrg(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { apply_message } = req.body as { apply_message?: string };

    const { rows: orgRow } = await query(
      `SELECT join_mode, require_verification FROM org.organizations WHERE id=$1 AND is_deleted=false`,
      [req.params.orgId]
    );
    if (!orgRow.length) { notFound(res, "Organization not found"); return; }

    if (orgRow[0].join_mode === "invite_only" || orgRow[0].join_mode === "closed") {
      forbidden(res, "This organization is not accepting applications"); return;
    }

    if (orgRow[0].require_verification) {
      const { rows: verif } = await query(
        `SELECT id FROM auth.user_verifications WHERE user_id=$1 AND status='VERIFIED'`,
        [req.user!.sub]
      );
      if (!verif.length) { forbidden(res, "Real-name verification required to join"); return; }
    }

    const { rows: existing } = await query(
      `SELECT status FROM org.org_members WHERE org_id=$1 AND user_id=$2`,
      [req.params.orgId, req.user!.sub]
    );
    if (existing.length && ["active","pending"].includes(existing[0].status as string)) {
      conflict(res, "Already a member or application pending"); return;
    }

    const status = orgRow[0].join_mode === "open" ? "active" : "pending";
    const { rows: defaultRole } = await query(
      `SELECT id FROM org.org_roles WHERE org_id=$1 AND is_default=true LIMIT 1`,
      [req.params.orgId]
    );

    await query(
      `INSERT INTO org.org_members
         (org_id, user_id, role_id, status, joined_via, applied_at, apply_message,
          joined_at)
       VALUES ($1,$2,$3,$4,'apply',now(),$5,
               CASE WHEN $4='active' THEN now() ELSE NULL END)
       ON CONFLICT (org_id, user_id) DO UPDATE
         SET status=$4, applied_at=now(), apply_message=$5`,
      [req.params.orgId, req.user!.sub,
       defaultRole.length ? defaultRole[0].id : null,
       status, apply_message ?? null]
    );

    if (status === "active") {
      await query(
        `UPDATE org.organizations SET members_count=members_count+1 WHERE id=$1`,
        [req.params.orgId]
      );
    }
    ok(res, { status }, status === "active" ? "Joined organization" : "Application submitted");
  } catch (err) { serverError(res, err); }
}

export async function reviewApplication(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { action, reject_reason } = req.body as { action?: string; reject_reason?: string };
    if (!["approve","reject"].includes(action ?? "")) {
      badRequest(res, "action must be approve or reject"); return;
    }
    const newStatus = action === "approve" ? "active" : "rejected";
    const { rowCount } = await query(
      `UPDATE org.org_members SET
         status=$1, reviewed_by=$2, reviewed_at=now(), reject_reason=$3,
         joined_at=CASE WHEN $1='active' THEN now() ELSE NULL END
       WHERE id=$4 AND org_id=$5 AND status='pending'`,
      [newStatus, req.user!.sub, reject_reason ?? null,
       req.params.memberId, req.params.orgId]
    );
    if (!rowCount) { notFound(res, "Application not found"); return; }
    if (action === "approve") {
      await query(
        `UPDATE org.organizations SET members_count=members_count+1 WHERE id=$1`,
        [req.params.orgId]
      );
    }
    ok(res, null, `Application ${newStatus}`);
  } catch (err) { serverError(res, err); }
}

export async function updateMemberRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { role_id } = req.body as { role_id?: string };
    if (!role_id) { badRequest(res, "role_id required"); return; }
    await query(
      `UPDATE org.org_members SET role_id=$1, updated_at=now()
       WHERE id=$2 AND org_id=$3 AND is_deleted=false`,
      [role_id, req.params.memberId, req.params.orgId]
    );
    ok(res, null, "Role updated");
  } catch (err) { serverError(res, err); }
}

export async function removeMember(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rowCount } = await query(
      `UPDATE org.org_members SET status='removed', is_deleted=true, deleted_at=now()
       WHERE id=$1 AND org_id=$2 AND status='active'`,
      [req.params.memberId, req.params.orgId]
    );
    if (!rowCount) { notFound(res); return; }
    await query(
      `UPDATE org.organizations SET members_count=GREATEST(members_count-1,0) WHERE id=$1`,
      [req.params.orgId]
    );
    ok(res, null, "Member removed");
  } catch (err) { serverError(res, err); }
}

// ── Org RBAC ─────────────────────────────────────────────────────────────────
export async function listOrgRoles(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT r.id, r.code, r.name, r.name_en, r.level, r.is_system,
              r.is_default, r.color_hex, r.icon_emoji,
              COUNT(DISTINCT m.user_id) AS member_count
       FROM org.org_roles r
       LEFT JOIN org.org_members m ON m.role_id=r.id AND m.status='active'
       WHERE r.org_id=$1 AND r.is_deleted=false
       GROUP BY r.id ORDER BY r.level`,
      [req.params.orgId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function createOrgRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { code, name, name_en, level = 50, color_hex, icon_emoji } = req.body as Record<string, unknown>;
    if (!code || !name) { badRequest(res, "code and name required"); return; }
    const { rows } = await query(
      `INSERT INTO org.org_roles (org_id, code, name, name_en, level, color_hex, icon_emoji)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, code`,
      [req.params.orgId, code, name, name_en ?? null, level, color_hex ?? null, icon_emoji ?? null]
    );
    created(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function updateOrgRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { name, name_en, level, color_hex, icon_emoji } = req.body as Record<string, unknown>;
    const { rowCount } = await query(
      `UPDATE org.org_roles SET
         name       = COALESCE($1, name),
         name_en    = COALESCE($2, name_en),
         level      = COALESCE($3, level),
         color_hex  = COALESCE($4, color_hex),
         icon_emoji = COALESCE($5, icon_emoji),
         updated_at = now()
       WHERE id=$6 AND org_id=$7 AND is_system=false AND is_deleted=false`,
      [name ?? null, name_en ?? null, level ?? null, color_hex ?? null,
       icon_emoji ?? null, req.params.roleId, req.params.orgId]
    );
    if (!rowCount) { notFound(res, "Role not found or is a system role"); return; }
    ok(res, null, "Role updated");
  } catch (err) { serverError(res, err); }
}

export async function deleteOrgRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rowCount } = await query(
      `UPDATE org.org_roles SET is_deleted=true
       WHERE id=$1 AND org_id=$2 AND is_system=false`,
      [req.params.roleId, req.params.orgId]
    );
    if (!rowCount) { notFound(res, "Role not found or is a system role"); return; }
    ok(res, null, "Role deleted");
  } catch (err) { serverError(res, err); }
}

export async function listOrgPermissions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT id, code, name, name_en, group_code, group_name, is_system, sort_order
       FROM org.org_permissions WHERE org_id=$1 ORDER BY group_code, sort_order, code`,
      [req.params.orgId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function upsertOrgPermission(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { code } = req.params;
    const { name, name_en, group_code, group_name } = req.body as Record<string, string>;
    await query(
      `INSERT INTO org.org_permissions (org_id, code, name, name_en, group_code, group_name)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (org_id, code) DO UPDATE
         SET name=$3, name_en=$4,
             group_code  = COALESCE($5, org.org_permissions.group_code),
             group_name  = COALESCE($6, org.org_permissions.group_name)`,
      [req.params.orgId, code, name, name_en ?? null, group_code ?? null, group_name ?? null]
    );
    ok(res, null, "Permission saved");
  } catch (err) { serverError(res, err); }
}

export async function deleteOrgPermission(req: AuthRequest, res: Response): Promise<void> {
  try {
    await query(
      `DELETE FROM org.org_permissions
       WHERE org_id=$1 AND code=$2 AND is_system=false`,
      [req.params.orgId, req.params.code]
    );
    ok(res, null, "Permission deleted");
  } catch (err) { serverError(res, err); }
}

export async function assignOrgRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { role_id } = req.body as { role_id?: string };
    if (!role_id) { badRequest(res, "role_id required"); return; }
    const { rowCount } = await query(
      `UPDATE org.org_members SET role_id=$1, updated_at=now()
       WHERE id=$2 AND org_id=$3`,
      [role_id, req.params.memberId, req.params.orgId]
    );
    if (!rowCount) { notFound(res); return; }
    ok(res, null, "Role assigned");
  } catch (err) { serverError(res, err); }
}

export async function revokeOrgRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows: defaultRole } = await query(
      `SELECT id FROM org.org_roles WHERE org_id=$1 AND is_default=true LIMIT 1`,
      [req.params.orgId]
    );
    await query(
      `UPDATE org.org_members SET role_id=$1, updated_at=now()
       WHERE id=$2 AND org_id=$3`,
      [defaultRole.length ? defaultRole[0].id : null,
       req.params.memberId, req.params.orgId]
    );
    ok(res, null, "Role revoked, member returned to default role");
  } catch (err) { serverError(res, err); }
}
