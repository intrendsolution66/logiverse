// backend/src/modules/edu/assetChunkUpload.controller.ts
//
// 大文件（目前主要是视频）分片上传。跟 assetStorage.ts 的 saveAssetFile
// 共用同一个最终存储目录（process.cwd()/uploads/assets）和同一套 URL
// 拼接规则（asset_base_url + /uploads/assets/filename），这样合并后的
// 文件跟一般图片上传出来的资源在数据库/删除逻辑上完全一致，deleteAsset
// 也能正常删掉它。
//
// 用法：complete 接口只负责把分片合并成一个文件并返回 URL，不负责写
// edu.assets 表——前端拿到这个 URL 后，用它当作 file_data（纯URL，不是
// data: 开头）调用现有的 POST /assets（createAsset），走一模一样的
// 分类/名称/标签/数据库写入流程。两条路径最终汇合到同一张表。

import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import multer from "multer";
import { promises as fs, existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { ok, badRequest, notFound, serverError } from "../../utils/response.js";
import { getAssetBaseUrl } from "../../utils/systemSettings.js";

// 最终文件目录——必须跟 assetStorage.ts 里的 UPLOAD_DIR 完全一致
const FINAL_DIR = path.join(process.cwd(), "uploads", "assets");
// 临时分片目录——特意放在 uploads/ 之外，避免被 express.static("/uploads", ...)
// 直接公开访问到还没合并完的半成品分片
const TEMP_DIR = path.join(process.cwd(), "tmp", "chunk-uploads");

mkdirSync(FINAL_DIR, { recursive: true });
mkdirSync(TEMP_DIR, { recursive: true });

// 目前只开放视频走分片上传（图片走原本的 base64 一次性上传就够了）；
// 以后如果 PPT 之类的也要支持大文件分片，在这里加后缀即可
const ALLOWED_EXTENSIONS = new Set(["mp4", "webm"]);

// 单个分片的大小上限，需 >= 前端切片大小（5MB），留一点余量
const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});
export const chunkUploadMiddleware = chunkUpload.single("chunk");

function isValidUploadId(id: string): boolean {
  return /^[a-f0-9-]{36}$/i.test(id);
}

function sessionDirFor(uploadId: string): string {
  return path.join(TEMP_DIR, uploadId);
}

export async function initChunkUpload(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { fileName, fileSize, totalChunks, mimeType } = req.body as Record<string, unknown>;

    if (typeof fileName !== "string" || !fileName) { badRequest(res, "fileName is required"); return; }
    if (typeof fileSize !== "number" || fileSize <= 0) { badRequest(res, "fileSize is required"); return; }
    if (typeof totalChunks !== "number" || totalChunks <= 0) { badRequest(res, "totalChunks is required"); return; }

    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.has(ext)) { badRequest(res, "只支持 mp4 / webm 视频文件的分片上传"); return; }

    const uploadId = randomUUID();
    const sessionDir = sessionDirFor(uploadId);
    await fs.mkdir(sessionDir, { recursive: true });

    const manifest = {
      uploadId, fileName, fileSize, totalChunks,
      mimeType: typeof mimeType === "string" ? mimeType : "application/octet-stream",
      ext, uploadedBy: req.user!.sub, createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(sessionDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    ok(res, { uploadId });
  } catch (err) { serverError(res, err); }
}

export async function getChunkUploadStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { uploadId } = req.params;
    if (!isValidUploadId(uploadId)) { badRequest(res, "uploadId 格式不正确"); return; }

    const sessionDir = sessionDirFor(uploadId);
    if (!existsSync(sessionDir)) { notFound(res, "上传会话不存在，请重新 init"); return; }

    const files = await fs.readdir(sessionDir);
    const receivedChunks = files
      .filter((f) => f.startsWith("chunk_"))
      .map((f) => parseInt(f.replace("chunk_", ""), 10))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);

    ok(res, { receivedChunks });
  } catch (err) { serverError(res, err); }
}

export async function uploadChunk(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { uploadId, chunkIndex } = req.params;
    if (!isValidUploadId(uploadId)) { badRequest(res, "uploadId 格式不正确"); return; }

    const idx = parseInt(chunkIndex, 10);
    if (Number.isNaN(idx) || idx < 0) { badRequest(res, "chunkIndex 不合法"); return; }

    const sessionDir = sessionDirFor(uploadId);
    if (!existsSync(sessionDir)) { notFound(res, "上传会话不存在，请重新 init"); return; }
    if (!req.file) { badRequest(res, "未收到分片数据"); return; }

    await fs.writeFile(path.join(sessionDir, `chunk_${idx}`), req.file.buffer);
    ok(res, { chunkIndex: idx });
  } catch (err) { serverError(res, err); }
}

export async function completeChunkUpload(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { uploadId } = req.params;
    if (!isValidUploadId(uploadId)) { badRequest(res, "uploadId 格式不正确"); return; }

    const sessionDir = sessionDirFor(uploadId);
    if (!existsSync(sessionDir)) { notFound(res, "上传会话不存在"); return; }

    const manifestRaw = await fs.readFile(path.join(sessionDir, "manifest.json"), "utf-8");
    const manifest = JSON.parse(manifestRaw) as { totalChunks: number; ext: string; mimeType: string };

    for (let i = 0; i < manifest.totalChunks; i++) {
      if (!existsSync(path.join(sessionDir, `chunk_${i}`))) {
        badRequest(res, `缺少分片 ${i}，无法完成合并`);
        return;
      }
    }

    const finalFileName = `${randomUUID()}.${manifest.ext}`;
    const finalPath = path.join(FINAL_DIR, finalFileName);

    const handle = await fs.open(finalPath, "w");
    try {
      for (let i = 0; i < manifest.totalChunks; i++) {
        const chunkData = await fs.readFile(path.join(sessionDir, `chunk_${i}`));
        await handle.write(chunkData);
      }
    } finally {
      await handle.close();
    }

    await fs.rm(sessionDir, { recursive: true, force: true });

    const baseUrl = await getAssetBaseUrl();
    const url = `${baseUrl}/uploads/assets/${finalFileName}`;

    ok(res, { url, mimeType: manifest.mimeType });
  } catch (err) { serverError(res, err); }
}