import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./authenticate.js";
import { query } from "../config/db.js";
import { forbidden, notFound } from "../utils/response.js";

/**
 * Org-scoped permission check using org.v_member_permissions
 * Requires :orgId param in route.
 * Usage: router.post("/:orgId/events", authenticate, orgAuthorize("events.manage"), handler)
 */
export function orgAuthorize(...codes: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { forbidden(res); return; }

    const orgId = req.params.orgId;
    if (!orgId) { notFound(res, "orgId param required"); return; }

    try {
      // Check org exists and is active
      const { rows: orgRows } = await query(
        `SELECT id FROM org.organizations WHERE id = $1 AND is_deleted = false AND status = 'active'`,
        [orgId]
      );
      if (!orgRows.length) { notFound(res, "Organization not found"); return; }

      // Check permission
      const { rows } = await query(
        `SELECT 1 FROM org.v_member_permissions
         WHERE org_id = $1 AND user_id = $2 AND permission_code = ANY($3::text[])
         LIMIT 1`,
        [orgId, req.user.sub, codes]
      );
      if (!rows.length) {
        forbidden(res, `Requires org permission: ${codes.join(" | ")}`);
        return;
      }
      next();
    } catch (err) {
      console.error("orgAuthorize error:", err);
      forbidden(res);
    }
  };
}

/** Check org membership (any active member) */
export function requireOrgMember() {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { forbidden(res); return; }
    const orgId = req.params.orgId;
    try {
      const { rows } = await query(
        `SELECT 1 FROM org.org_members
         WHERE org_id = $1 AND user_id = $2 AND status = 'active' AND is_deleted = false
         LIMIT 1`,
        [orgId, req.user.sub]
      );
      if (!rows.length) { forbidden(res, "Not a member of this Organization"); return; }
      next();
    } catch (err) {
      console.error("requireOrgMember error:", err);
      forbidden(res);
    }
  };
}
