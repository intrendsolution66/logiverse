// backend/src/modules/edu/assets.controller.ts
//
// 素材库 — reusable image storage. Upload once, tag with a category, reuse
// across any level in any course instead of every module doing its own
// one-off upload-and-embed. Gated by the same courses.manage permission as
// everything else in the course-authoring toolkit — anyone who can design
// a course can manage the shared asset library, it isn't a separate role.
//
// PPT类素材上传时就转换成幻灯片图片（见 createAsset 里的 category==="ppt"
// 分支）——转换成本放在低频的上传端，不是高频的播放端，学生在Discovery/
// Lesson里打开PPT时能秒开，不用等LibreOffice转换。

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import path from "path";
import { promises as fs } from "fs";
import { query } from "../../config/db.js";
import { ok, created, badRequest, notFound, forbidden, serverError } from "../../utils/response.js";
import { parsePagination } from "../../utils/pagination.js";
import { saveAssetFile, deleteAssetFile } from "../../utils/assetStorage.js";
import { convertPptxToSlideImages } from "../../utils/pptConverter.js";

// 分片上传(assetChunkUpload.controller.ts)合并出来的原始文件都落在这个
// 目录——PPT分片上传完之后拿到的是指向这里某个文件的URL(不是base64)，
// 要转幻灯片图片得先把这份原始文件从磁盘读回来，这里是它的本地路径
// (必须跟 assetChunkUpload.controller.ts 的 FINAL_DIR 完全一致)。
const CHUNK_UPLOAD_DIR = path.join(process.cwd(), "uploads", "assets");

// ppt_interactive——PPT真实动画版，跟普通ppt(转成静态图片，页内动画会
// 丢失)是并存的两种独立类型。这种不走转换，原始pptx文件原样保留在
// 磁盘上，靠Collabora Online(wopi.controller.ts)在浏览器里真实渲染出
// 来，包括点击展开这类页内动画都能保留——代价是没有"秒开"这个优点，
// 要连一个真的LibreOffice内核。
const CATEGORIES = ["background", "object", "icon", "video", "ppt", "ppt_interactive", "other"];

// 素材的"使用场景"——跟 category（图片/视频/PPT这种素材类型）是完全独立
// 的两个维度。多选：同一部影片可能实体课、公开课都在用。
const USAGE_CONTEXTS = ["in_person", "self_guided", "public_course"];

export async function listAssets(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { page, limit, offset } = parsePagination(req, 24);
    const category = typeof req.query.category === "string" ? req.query.category : "";
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const moduleType = typeof req.query.module_type === "string" ? req.query.module_type : "";
    const tag = typeof req.query.tag === "string" ? req.query.tag.trim() : "";
    const usageContext = typeof req.query.usage_context === "string" ? req.query.usage_context : "";
    // ?parent_preview=true —— 家长端 / operator 挑选预览素材时用，只看
    // 已经开放预览的素材；不传这个参数就是原本行为，不受影响。
    const parentPreviewOnly = req.query.parent_preview === "true";

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
    if (usageContext && USAGE_CONTEXTS.includes(usageContext)) {
      params.push(usageContext);
      conditions.push(`$${params.length} = ANY(a.usage_contexts)`);
    }
    if (parentPreviewOnly) {
      conditions.push(`a.parent_preview_enabled = true`);
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
              a.module_type, a.grade_tier_id, a.language, gt.code AS grade_tier_code,
              a.usage_contexts, a.parent_preview_enabled, a.parent_preview_seconds
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
      `SELECT id, category, name, file_data, slide_urls, width, height, created_at, module_type, grade_tier_id, language, tags,
              usage_contexts, parent_preview_enabled, parent_preview_seconds
       FROM edu.assets WHERE id = $1`,
      [assetId]
    );
    if (!rows.length) { notFound(res, "Asset not found"); return; }
    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

function normalizeUsageContexts(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const cleaned = input.filter((c): c is string => typeof c === "string" && USAGE_CONTEXTS.includes(c));
  return Array.from(new Set(cleaned)); // 去重，不限数量（最多也就3个可选值）
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
    const { category, name, file_data, width, height, module_type, grade_tier_id, language, tags,
            usage_contexts, parent_preview_enabled, parent_preview_seconds } = req.body as Record<string, unknown>;
    if (!file_data || typeof file_data !== "string") { badRequest(res, "file_data is required"); return; }
    const cat = typeof category === "string" && CATEGORIES.includes(category) ? category : "other";
    const cleanTags = normalizeTags(tags);
    const cleanUsageContexts = normalizeUsageContexts(usage_contexts);
    const previewEnabled = parent_preview_enabled === true;
    // 预览秒数只对视频有意义——其他类型即使传了这个栏位也直接忽略，不
    // 让前端的疏忽变成资料库里一个没意义的数字。
    const previewSeconds = cat === "video" && Number.isInteger(parent_preview_seconds) && (parent_preview_seconds as number) > 0
      ? (parent_preview_seconds as number)
      : null;

    const isDataUrl = file_data.startsWith("data:");
    let fileUrl: string;
    let slideUrls: string[] | null = null;

    if (cat === "ppt" && isDataUrl) {
      // PPT上传时就转换成幻灯片图片，不等学生打开时才转。file_data 存
      // 第一页的URL，方便素材库网格直接显示真实封面；slide_urls 存完整
      // 的按顺序排列的图片URL数组，给学生端的翻页阅读器用。
      const match = file_data.match(/^data:([\w/+.-]+);base64,(.+)$/);
      if (!match) throw new Error("PPT file_data must be a base64 data URL");
      const pptxBuffer = Buffer.from(match[2], "base64");

      const slides = await convertPptxToSlideImages(pptxBuffer);
      if (!slides.length) { badRequest(res, "PPT转换后没有产生任何幻灯片，文件可能已损坏"); return; }

      slideUrls = [];
      for (const slide of slides) {
        const dataUrl = `data:${slide.mimeType};base64,${slide.buffer.toString("base64")}`;
        const { url } = await saveAssetFile(dataUrl);
        slideUrls.push(url);
      }
      fileUrl = slideUrls[0];
    } else if (cat === "ppt" && !isDataUrl) {
      // PPT走分片上传(体积可能较大，转base64容易撞反向代理的请求体大小
      // 限制，跟视频一样先原样落盘)——这时 file_data 是分片合并完成后
      // 拿到的URL，指向磁盘上一份还没转换的原始pptx文件，这里要先读回来
      // 才能转成幻灯片图片，逻辑跟上面base64那支完全一样，只是输入源从
      // "请求体里的base64"换成"磁盘上已经写好的文件"。
      const rawFileName = file_data.split("/").pop();
      if (!rawFileName) { badRequest(res, "无法识别上传的文件"); return; }
      const rawFilePath = path.join(CHUNK_UPLOAD_DIR, rawFileName);
      let pptxBuffer: Buffer;
      try {
        pptxBuffer = await fs.readFile(rawFilePath);
      } catch {
        badRequest(res, "找不到刚才上传的文件，可能上传还没完成或者已经过期，请重新上传"); return;
      }

      const slides = await convertPptxToSlideImages(pptxBuffer);
      // 不管转换成功与否，原始pptx文件都不用再留着——只保留转换出来的
      // 幻灯片图片，跟base64那条路径的最终产物是一致的，不会在磁盘上
      // 多出一份没人引用的原始文件占空间。
      await fs.rm(rawFilePath, { force: true }).catch(() => {});
      if (!slides.length) { badRequest(res, "PPT转换后没有产生任何幻灯片，文件可能已损坏"); return; }

      slideUrls = [];
      for (const slide of slides) {
        const dataUrl = `data:${slide.mimeType};base64,${slide.buffer.toString("base64")}`;
        const { url } = await saveAssetFile(dataUrl);
        slideUrls.push(url);
      }
      fileUrl = slideUrls[0];
    } else if (isDataUrl) {
      // 素材库不再把图片整个塞进数据库 — file_data is base64 (a fresh
      // upload), it gets written to disk and only the resulting URL is
      // stored.
      fileUrl = (await saveAssetFile(file_data)).url;
    } else {
      // 已经是URL了（比如分片上传合并完的视频、或直接粘贴的远端URL），
      // 原样存，不重复处理。
      fileUrl = file_data;
    }

    const { rows } = await query(
      `INSERT INTO edu.assets (uploaded_by, category, name, file_data, slide_urls, width, height, module_type, grade_tier_id, language, tags,
                                usage_contexts, parent_preview_enabled, parent_preview_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, category, name, file_data, slide_urls, width, height, created_at, module_type, grade_tier_id, language, tags,
                 usage_contexts, parent_preview_enabled, parent_preview_seconds`,
      [req.user!.sub, cat, name ?? null, fileUrl, slideUrls ? JSON.stringify(slideUrls) : null, width ?? null, height ?? null,
       module_type ?? null, grade_tier_id ?? null, language ?? "universal", cleanTags,
       cleanUsageContexts, previewEnabled, previewSeconds]
    );
    created(res, rows[0]);
  } catch (err) {
    if (err instanceof Error && err.message.includes("base64 data URL")) { badRequest(res, "文件格式看起来不对，麻烦重新选一个文件再试一次"); return; }
    serverError(res, err);
  }
}

// 编辑已上传素材的元数据——目前只开放这几个"分类/标注"性质的栏位可改：
// name、tags、module_type/grade_tier_id/language、usage_contexts、
// parent_preview_enabled、parent_preview_seconds。不允许改 category 或
// file_data 本身（换文件/换类型本质是删掉重传，不是编辑），也不走
// createAsset 那套PPT转换逻辑，单纯是一次元数据更新。
export async function updateAsset(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { assetId } = req.params;
    const { rows: existingRows } = await query(`SELECT uploaded_by, category FROM edu.assets WHERE id = $1`, [assetId]);
    if (!existingRows.length) { notFound(res, "Asset not found"); return; }
    if (existingRows[0].uploaded_by !== req.user!.sub) { forbidden(res, "You didn't upload this asset"); return; }

    const { name, module_type, grade_tier_id, language, tags, usage_contexts, parent_preview_enabled, parent_preview_seconds } =
      req.body as Record<string, unknown>;
    const category = existingRows[0].category as string;
    const cleanTags = tags !== undefined ? normalizeTags(tags) : null;
    const cleanUsageContexts = usage_contexts !== undefined ? normalizeUsageContexts(usage_contexts) : null;
    const previewEnabled = typeof parent_preview_enabled === "boolean" ? parent_preview_enabled : null;
    const previewSeconds = category === "video" && Number.isInteger(parent_preview_seconds) && (parent_preview_seconds as number) > 0
      ? (parent_preview_seconds as number)
      : (parent_preview_seconds === null ? null : undefined); // undefined = 没传，COALESCE保留原值；null = 显式清空（比如取消秒数限制）

    const { rows } = await query(
      `UPDATE edu.assets SET
         name = COALESCE($2, name),
         module_type = COALESCE($3, module_type),
         grade_tier_id = COALESCE($4, grade_tier_id),
         language = COALESCE($5, language),
         tags = COALESCE($6, tags),
         usage_contexts = COALESCE($7, usage_contexts),
         parent_preview_enabled = COALESCE($8, parent_preview_enabled),
         parent_preview_seconds = CASE WHEN $9::boolean THEN $10 ELSE parent_preview_seconds END
       WHERE id = $1
       RETURNING id, category, name, file_data, slide_urls, width, height, created_at, module_type, grade_tier_id, language, tags,
                 usage_contexts, parent_preview_enabled, parent_preview_seconds`,
      [assetId, name ?? null, module_type ?? null, grade_tier_id ?? null, language ?? null, cleanTags,
       cleanUsageContexts, previewEnabled, previewSeconds !== undefined, previewSeconds ?? null]
    );
    ok(res, rows[0]);
  } catch (err) { serverError(res, err); }
}

export async function deleteAsset(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { assetId } = req.params;
    const { rows } = await query(`SELECT uploaded_by, file_data, slide_urls FROM edu.assets WHERE id = $1`, [assetId]);
    if (!rows.length) { notFound(res, "Asset not found"); return; }
    // only the uploader can delete their own asset — keeps this simple
    // (no separate "admin can delete anyone's assets" path for now; an
    // operator wanting that is a small extension, not a redesign)
    if (rows[0].uploaded_by !== req.user!.sub) { forbidden(res, "You didn't upload this asset"); return; }

    await query(`DELETE FROM edu.assets WHERE id = $1`, [assetId]);

    // best-effort cleanup — a stale DB row is worse than a stale file
    await deleteAssetFile(rows[0].file_data as string);
    const slideUrls = rows[0].slide_urls as string[] | null;
    if (slideUrls) {
      for (const url of slideUrls) {
        await deleteAssetFile(url); // file_data(=slideUrls[0]) 会被删两次，deleteAssetFile对不存在的文件是no-op，无所谓
      }
    }

    ok(res, null, "Deleted");
  } catch (err) { serverError(res, err); }
}

// ── PPT讲义: 上传 pptx → 后端转成一张一张的幻灯片图片 ──────────────────────────
// This is a standalone conversion step for the course-authoring "explanation
// PPT" flow (building an Activity), separate from the asset-library PPT
// upload above (which now does its own conversion inline in createAsset).
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