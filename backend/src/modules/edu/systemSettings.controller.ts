// backend/src/modules/edu/systemSettings.controller.ts
//
// Backend for the 设置 (Settings) page — right now just asset_base_url,
// but built as a generic get/set-by-key API so more settings can be added
// later without a new endpoint each time.

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { getSetting, setSetting, getAssetBaseUrl } from "../../utils/systemSettings.js";
import { ok, badRequest, serverError } from "../../utils/response.js";

export async function getSettings(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const assetBaseUrl = await getAssetBaseUrl();
    ok(res, { asset_base_url: assetBaseUrl });
  } catch (err) { serverError(res, err); }
}

export async function updateSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { asset_base_url } = req.body as { asset_base_url?: string };
    if (asset_base_url !== undefined) {
      const trimmed = asset_base_url.trim().replace(/\/+$/, ""); // no trailing slash — saveAssetFile always joins with a leading /
      if (!/^https?:\/\/.+/.test(trimmed)) { badRequest(res, "网址要用 http:// 或 https:// 开头，比如 http://localhost:4000 或 https://api.yourschool.com"); return; }
      await setSetting("asset_base_url", trimmed, req.user!.sub);
    }
    const assetBaseUrl = await getSetting("asset_base_url", process.env.ASSET_BASE_URL ?? "");
    ok(res, { asset_base_url: assetBaseUrl });
  } catch (err) { serverError(res, err); }
}
