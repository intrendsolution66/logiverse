import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { ok, serverError } from "../../utils/response.js";
import { parsePagination } from "../../utils/pagination.js";

export async function getOrgSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT key, value, value_type, updated_at FROM org.org_settings
       WHERE org_id=$1 ORDER BY key`,
      [req.params.orgId]
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}

export async function upsertOrgSetting(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { key } = req.params;
    const { value, value_type = "string" } = req.body as Record<string, string>;
    await query(
      `INSERT INTO org.org_settings (org_id, key, value, value_type, updated_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (org_id, key) DO UPDATE
         SET value=$3, value_type=$4, updated_by=$5, updated_at=now()`,
      [req.params.orgId, key, value, value_type, req.user!.sub]
    );
    ok(res, null, "Setting saved");
  } catch (err) { serverError(res, err); }
}

export async function getOrgAuditLogs(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { limit, offset } = parsePagination(req, 50);
    const action        = String(req.query.action        ?? "");
    const resource_type = String(req.query.resource_type ?? "");

    const params: unknown[] = [req.params.orgId];
    const conds = ["org_id=$1"];
    let i = 2;
    if (action)        { conds.push(`action=$${i++}`);        params.push(action); }
    if (resource_type) { conds.push(`resource_type=$${i++}`); params.push(resource_type); }

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT id, actor_username, actor_ip, action, resource_type,
              resource_label, status, created_at
       FROM org.org_audit_logs
       WHERE ${conds.join(" AND ")}
       ORDER BY created_at DESC LIMIT $${i} OFFSET $${i+1}`,
      params
    );
    ok(res, rows);
  } catch (err) { serverError(res, err); }
}
