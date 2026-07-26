// backend/src/utils/assetStorage.ts
//
// Storage for uploaded asset FILES (the actual image bytes), separate from
// edu.assets (the database ROW describing an asset — name, category, tags,
// and now just a URL pointing at wherever the file actually lives).
//
// This file is the ONE place that decides where bytes physically go.
// Right now that's local disk under uploads/assets/, served back out via
// the express.static("/uploads", ...) mount already set up in app.ts. If
// this later needs to point at a remote object store instead (S3, a CDN,
// another server entirely), `saveAssetFile` is the only function that
// needs a different implementation — everything upstream (the assets
// controller, every frontend consumer) only ever deals with the URL
// string this returns, never with how/where the bytes are actually
// stored. That's the whole point of routing every asset write through
// here instead of writing files ad-hoc wherever they're needed.
//
// ASSET_BASE_URL is what makes the URL itself point at "local" vs
// "remote": in dev this defaults to the backend's own origin
// (http://localhost:4000), so files round-trip through this same
// process's static file server. Pointed at a different value (a real
// storage engine's public base URL), the SAME relative path scheme below
// would resolve there instead — no code change needed elsewhere, just
// updating the setting, once an actual remote saveAssetFile
// implementation replaces the local-disk one.
//
// This value now comes from edu.system_settings (key: asset_base_url),
// editable from the 设置 page at runtime — no server restart needed. The
// ASSET_BASE_URL env var still works as the fallback default if nothing's
// been set in the DB, so an existing .env-based deployment keeps working
// exactly as before until someone actually changes it through the UI.

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getAssetBaseUrl } from "./systemSettings.js";

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "assets");

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "ppt",
};

// Writes the EXACT bytes from the data URL to disk — no recompression, no
// re-encoding, no flattening. A PNG's alpha channel (transparent
// background — 物件图片需要保留透明背景) survives untouched because this
// never decodes the image as pixels, it just base64-decodes the payload
// straight to a file. JPG, WEBP, GIF, SVG all pass through the same way.
export async function saveAssetFile(dataUrl: string): Promise<{ url: string; sizeBytes: number }> {
  const match = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!match) throw new Error("saveAssetFile expects a base64 data URL (data:<mime>;base64,<payload>)");
  const [, mimeType, base64Payload] = match;
  const ext = EXT_BY_MIME[mimeType] ?? mimeType.split("/")[1]?.split("+")[0] ?? "bin";

  const buffer = Buffer.from(base64Payload, "base64");
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR, filename), buffer);

  const baseUrl = await getAssetBaseUrl();
  return { url: `${baseUrl}/uploads/assets/${filename}`, sizeBytes: buffer.length };
}

// Best-effort cleanup when an asset row is deleted — only removes files
// this server actually stored locally (URLs under its own /uploads/assets
// path); a remote-storage URL or an old base64 data URL just gets left
// alone, since this process has no business deleting something it didn't
// write and doesn't own.
export async function deleteAssetFile(url: string): Promise<void> {
  if (!url.includes("/uploads/assets/")) return;
  const filename = url.split("/uploads/assets/")[1]?.split("?")[0];
  if (!filename) return;
  try { await fs.unlink(path.join(UPLOAD_DIR, filename)); } catch { /* already gone, or never existed — fine either way */ }
}
