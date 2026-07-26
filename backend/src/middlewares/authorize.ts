import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./authenticate.js";
import { query } from "../config/db.js";
import { forbidden } from "../utils/response.js";

/**
 * Global permission check using rbac.v_user_effective_permissions
 * Usage: router.get("/admin", authenticate, authorize("users.manage"), handler)
 */
export function authorize(...codes: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) { forbidden(res); return; }
    try {
      const { rows } = await query(
        `SELECT 1 FROM public.v_user_permissions
         WHERE user_id = $1 AND permission_code = ANY($2::text[])
         LIMIT 1`,
        [req.user.sub, codes]
      );
      if (!rows.length) { forbidden(res, `Requires: ${codes.join(" | ")}`); return; }
      next();
    } catch (err) {
      console.error("authorize error:", err);
      forbidden(res);
    }
  };
}
