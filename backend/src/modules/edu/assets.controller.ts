// backend/src/modules/edu/assets.controller.ts
//
// 素材库 — reusable image storage. Upload once, tag with a category, reuse
// across any level in any course instead of every module doing its own
// one-off upload-and-embed. Gated by the same courses.manage permission as
// everything else in the course-authoring toolkit — anyone who can design
// a course can manage the shared asset library, it isn't a separate role.

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { query } from "../../config/db.js";
import { ok, created, badRequest, notFound, forbidden, serverError } from "../../utils/response.js";
import { parsePagination } from "../../utils/pagination.js";
import { saveAssetFile, deleteAssetFile } from "../../utils/assetStorage.js";
import { convertPptxToSlideImages } from "../../utils/pptConverter.js";

const CATEGORIES = ["background", "object", "icon", "video", "ppt", "other"];

export async function listAssets(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req, 24);
    const category = typeof req.query.category === "string" ? req.query.category : "";
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const moduleType = typeof req.query.module_type === "string" ? req.query.module_type : "";
    const tag = typeof req.query.tag === "string" ? req.query.tag.trim() : "";

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (category && CATEGORIES.includes(category)) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`name ILIKE $${params.length}`);
    }
    if (moduleType) {
      params.push(moduleType);
      conditions.push(`module_type = $${params.length}`);
    }
    if (tag) {
      params.push(tag);
      conditions.push(`$${params.length} = ANY(tags)`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows: countRows } = await query(`SELECT count(*)::int AS total FROM edu.assets ${whereClause}`, params);
    const total = countRows[0]?.total ?? 0;

    // file_data is deliberately excluded from the LIST response — these are
    // base64 blobs, potentially large; a grid of 24 thumbnails doesn't need
    // the full payload for each one. getAsset returns the full file_data
    // when a specific asset is actually selected.
    params.push(limit, offset);
    const { rows } = await query(
      `SELECT a.id, a.category, a.name, a.width, a.height, a.created_at, a.tags,
              a.module_type, a.grade_tier_id, a.language, gt.code AS grade_tier_code
       FROM edu.assets a
       LEFT JOIN edu.grade_tiers gt ON gt.id = a.grade_tier_id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.status(200).json({
      success: true, message: "Success", data: rows,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) { serverError(res, err); }
}

// Every distinct tag currently in use, for an autocomplete-style picker —
// otherwise every designer invents their own spelling/wording for "the
// same" tag and search stops being useful.
export async function listAllTags(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const { rows } = await query(
      `SELECT DISTINCT unnest(tags) AS tag FROM edu.assets WHERE array_length(tags, 1) > 0 ORDER BY tag`
    );
    ok(res, (rows as { tag: string }[]).map((r) => r.tag));
  } catch (err) { serverError(res, err); }
}

export async function getAsset(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { assetId } = req.params;
    const { rows } = await query(
      `SELECT id, category, name, file_data, width, height, created_at, module_type, grade_tier_id, language, tags
       FROM edu.assets WHERE id = $1`,
      [assetId]
    );
    if (!rows.length) { notFound(res, "Asset not found"); return; }
    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const cleaned = input
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim().slice(0, 20)); // keep tags short — this is a label, not a description
  return Array.from(new Set(cleaned)).slice(0, 3); // max 3, per the brief, de-duplicated
}

export async function createAsset(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { category, name, file_data, width, height, module_type, grade_tier_id, language, tags } = req.body as Record<string, unknown>;
    if (!file_data || typeof file_data !== "string") { badRequest(res, "file_data is required"); return; }
    const cat = typeof category === "string" && CATEGORIES.includes(category) ? category : "other";
    const cleanTags = normalizeTags(tags);

    // 素材库不再把图片整个塞进数据库 — file_data is base64 (a fresh
    // upload), it gets written to disk and only the resulting URL is
    // stored; if it's already a URL (pasted directly, or points at
    // wherever a remote storage engine put it), it's stored as-is. Either
    // way, what lands in the database from here on is just a URL string —
    // see assetStorage.ts for where the bytes actually go.
    const isDataUrl = file_data.startsWith("data:");
    const fileUrl = isDataUrl ? (await saveAssetFile(file_data)).url : file_data;

    const { rows } = await query(
      `INSERT INTO edu.assets (uploaded_by, category, name, file_data, width, height, module_type, grade_tier_id, language, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, category, name, file_data, width, height, created_at, module_type, grade_tier_id, language, tags`,
      [req.user!.sub, cat, name ?? null, fileUrl, width ?? null, height ?? null,
       module_type ?? null, grade_tier_id ?? null, language ?? "universal", cleanTags]
    );
    created(res, rows[0]);
  } catch (err) {
    if (err instanceof Error && err.message.includes("base64 data URL")) { badRequest(res, "图片格式看起来不对，麻烦重新选一张图片再试一次"); return; }
    serverError(res, err);
  }
}

export async function deleteAsset(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { assetId } = req.params;
    const { rows } = await query(`SELECT uploaded_by, file_data FROM edu.assets WHERE id = $1`, [assetId]);
    if (!rows.length) { notFound(res, "Asset not found"); return; }
    // only the uploader can delete their own asset — keeps this simple
    // (no separate "admin can delete anyone's assets" path for now; an
    // operator wanting that is a small extension, not a redesign)
    if (rows[0].uploaded_by !== req.user!.sub) { forbidden(res, "You didn't upload this asset"); return; }

    await query(`DELETE FROM edu.assets WHERE id = $1`, [assetId]);
    await deleteAssetFile(rows[0].file_data as string); // best-effort — a stale DB row is worse than a stale file
    ok(res, null, "Deleted");
  } catch (err) { serverError(res, err); }
}

// ── PPT讲义: 上传 pptx → 后端转成一张一张的幻灯片图片 ──────────────────────────
// This is a standalone conversion step, not part of createLevel — the
// designer uploads the pptx here FIRST, sees a preview of the resulting
// slide images, and only THEN builds the actual Activity (picking
// Programme/Subject/Topic, naming it, etc.) using the URLs this returns.
// Same two-step shape as picking an image from AssetPicker before it goes
// into a module's config — conversion and classification are separate
// concerns, doesn't make sense to redo a 10-30 second LibreOffice
// conversion just because the designer changed their mind about which
// Topic this belongs to.
export async function convertPptToSlides(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { file_data, filename } = req.body as { file_data?: string; filename?: string };
    if (!file_data) { badRequest(res, "file_data is required"); return; }

    const match = file_data.match(/^data:([\w/+.-]+);base64,(.+)$/);
    if (!match) { badRequest(res, "file_data 要是 base64 data URL 格式"); return; }
    const pptxBuffer = Buffer.from(match[2], "base64");

    const slides = await convertPptxToSlideImages(pptxBuffer);
    const slideUrls: string[] = [];
    for (const slide of slides) {
      const dataUrl = `data:${slide.mimeType};base64,${slide.buffer.toString("base64")}`;
      const { url } = await saveAssetFile(dataUrl);
      slideUrls.push(url);
    }

    ok(res, { slide_image_urls: slideUrls, slide_count: slideUrls.length, original_filename: filename ?? null });
  } catch (err) {
    if (err instanceof Error) { badRequest(res, err.message); return; }
    serverError(res, err);
  }
}
