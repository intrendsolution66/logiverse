// backend/src/modules/edu/wopi.controller.ts
//
// WOPI(Web Application Open Platform Interface)协议——Collabora Online
// 靠这套协议向我们要"这份文件的信息"(CheckFileInfo)和"这份文件的内容"
// (GetFile)，是Collabora服务器进程直接发的请求，不是用户浏览器发的，
// 所以不走LogiVerse自己的登录态(authenticate中间件)，而是靠专门签发的
// 短期access_token(edu.wopi_sessions表)。
//
// 现在只做查看，不做在线编辑/保存——UserCanWrite恒为false，Collabora
// 看到这个会自动切成只读模式，不会尝试调用PutFile，所以这里也没实现
// PutFile这个接口(WOPI协议规定的"保存"动作)。

import type { Request, Response } from "express";
import type { AuthRequest } from "../../middlewares/authenticate.js";
import { randomBytes } from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { query } from "../../config/db.js";
import { ok, notFound, badRequest, forbidden, serverError } from "../../utils/response.js";

const SESSION_TTL_MS = 60 * 60 * 1000; // 1小时——够看完一份PPT了，过期就要重新打开
const ASSETS_DIR = path.join(process.cwd(), "uploads", "assets"); // 必须跟assetStorage.ts/assetChunkUpload.controller.ts的存储目录一致

function assetFilePath(fileUrl: string): string {
  const fileName = fileUrl.split("/").pop() ?? "";
  return path.join(ASSETS_DIR, fileName);
}

const MIME_BY_EXT: Record<string, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
};

// ── LogiVerse 这边——登录用户请求"我要看这份PPT"，换一个短期WOPI令牌 ─────────────
// 前端拿到这个之后才能拼出Collabora的iframe网址。要求登录(跟平常看
// 素材/视频是同一个权限等级，不额外限制只有courses.manage能看)。
export async function createWopiSession(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { assetId } = req.params;
    const { rows } = await query(`SELECT id, category, name, file_data FROM edu.assets WHERE id = $1`, [assetId]);
    if (!rows.length) { notFound(res, "素材不存在"); return; }
    if (rows[0].category !== "ppt_interactive") { badRequest(res, "这份素材不是「PPT真实动画版」类型，没办法用这个方式打开"); return; }

    // auth.users 表本身只有 username，没有 full_name_zh/full_name_en 这种
    // 中英文全名字段(那是另一张独立的用户资料表才有的，这里没必要为了
    // 一个纯展示用的名字额外联表)——UserFriendlyName 只是Collabora界面
    // 上显示的名字，用username完全够用。
    const { rows: userRows } = await query(`SELECT username FROM auth.users WHERE id = $1`, [req.user!.sub]);
    const u = userRows[0];
    const userName = u?.username ?? "访客";

    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    await query(
      `INSERT INTO edu.wopi_sessions (token, asset_id, user_id, user_name, can_write, expires_at)
       VALUES ($1, $2, $3, $4, false, $5)`,
      [token, assetId, req.user!.sub, userName, expiresAt]
    );

    const apiBaseUrl = process.env.BASE_URL ?? "http://localhost:4000";
    const officeBaseUrl = process.env.COLLABORA_URL ?? "https://office.mybriw.com";
    ok(res, {
      wopiSrc: `${apiBaseUrl}/api/v1/wopi/files/${assetId}`,
      accessToken: token,
      officeUrl: `${officeBaseUrl}/browser/dist/cool.html`,
    });
  } catch (err) { serverError(res, err); }
}

// 两个WOPI标准接口共用的token校验——确认token没过期、确实是给这个
// fileId(=asset id)用的。
async function getValidSession(token: string | undefined, fileId: string) {
  if (!token) return null;
  const { rows } = await query(
    `SELECT * FROM edu.wopi_sessions WHERE token = $1 AND asset_id = $2 AND expires_at > now()`,
    [token, fileId]
  );
  return rows[0] ?? null;
}

// ── WOPI CheckFileInfo ───────────────────────────────────────────────────────
export async function checkFileInfo(req: Request, res: Response): Promise<void> {
  try {
    const { fileId } = req.params;
    const token = req.query.access_token as string | undefined;
    const session = await getValidSession(token, fileId);
    if (!session) { forbidden(res, "无效或已过期的access_token"); return; }

    const { rows } = await query(`SELECT name, file_data FROM edu.assets WHERE id = $1`, [fileId]);
    if (!rows.length) { notFound(res, "文件不存在"); return; }
    const asset = rows[0];

    const filePath = assetFilePath(asset.file_data);
    let size = 0;
    try { size = (await fs.stat(filePath)).size; } catch { notFound(res, "文件已经不在磁盘上了，可能被删除了"); return; }

    const ext = (asset.file_data as string).split(".").pop()?.toLowerCase() ?? "pptx";
    const baseFileName = asset.name ? `${asset.name}.${ext}` : `document.${ext}`;

    // WOPI CheckFileInfo 是个字段很多的标准JSON，这里只填Collabora真正
    // 需要的必填项+几个常用的显示类栏位，没有实现完整规范(比如版本历史
    // 相关的那些)，够"打开查看"这个用途就行。
    res.json({
      BaseFileName: baseFileName,
      Size: size,
      OwnerId: "logiverse",
      UserId: session.user_id ?? "guest",
      UserFriendlyName: session.user_name ?? "访客",
      UserCanWrite: session.can_write,
      Version: "1",
      SupportsUpdate: false,
      ReadOnly: true,
    });
  } catch (err) { serverError(res, err); }
}

// ── WOPI GetFile ─────────────────────────────────────────────────────────────
export async function getFile(req: Request, res: Response): Promise<void> {
  try {
    const { fileId } = req.params;
    const token = req.query.access_token as string | undefined;
    const session = await getValidSession(token, fileId);
    if (!session) { forbidden(res, "无效或已过期的access_token"); return; }

    const { rows } = await query(`SELECT file_data FROM edu.assets WHERE id = $1`, [fileId]);
    if (!rows.length) { notFound(res, "文件不存在"); return; }

    const filePath = assetFilePath(rows[0].file_data);
    const ext = (rows[0].file_data as string).split(".").pop()?.toLowerCase() ?? "pptx";
    let fileBuffer: Buffer;
    try { fileBuffer = await fs.readFile(filePath); }
    catch { notFound(res, "文件已经不在磁盘上了，可能被删除了"); return; }

    res.setHeader("Content-Type", MIME_BY_EXT[ext] ?? "application/octet-stream");
    res.send(fileBuffer);
  } catch (err) { serverError(res, err); }
}