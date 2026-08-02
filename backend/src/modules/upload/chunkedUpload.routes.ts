// src/modules/upload/chunkedUpload.routes.ts
//
// 分片上传路由。挂载建议：app.use('/api/v1/uploads/chunk', chunkedUploadRouter)
//
// 流程：
//   1) POST /init                     -> 创建上传会话，返回 uploadId
//   2) GET  /:uploadId/status         -> 查询已上传的分片（用于断点续传）
//   3) POST /:uploadId/chunk/:index   -> 上传单个分片
//   4) POST /:uploadId/complete       -> 所有分片到齐后合并成正式文件

import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const router = Router();

// ---- 路径配置：按你项目实际的 storage 目录调整 ----
const TEMP_DIR = path.resolve(process.cwd(), 'storage/temp-chunks');
const FINAL_DIR = path.resolve(process.cwd(), 'storage/uploads/assets');

fs.mkdirSync(TEMP_DIR, { recursive: true });
fs.mkdirSync(FINAL_DIR, { recursive: true });

// 单个分片的大小限制，要 >= 前端设置的 CHUNK_SIZE，留一点余量即可（不是整个文件的大小）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 单片最大 8MB（前端切片建议 5MB）
});

interface InitBody {
  fileName: string;
  fileSize: number;
  totalChunks: number;
  mimeType: string;
}

// 简单的 uploadId 校验，防止路径穿越
function isValidUploadId(id: string): boolean {
  return /^[a-f0-9-]{36}$/i.test(id);
}

// 1) 初始化上传会话
router.post('/init', (req: Request<{}, {}, InitBody>, res: Response) => {
  const { fileName, fileSize, totalChunks, mimeType } = req.body;

  if (!fileName || !fileSize || !totalChunks || totalChunks <= 0) {
    return res.status(400).json({ error: 'fileName, fileSize, totalChunks 为必填项' });
  }

  const uploadId = crypto.randomUUID();
  const sessionDir = path.join(TEMP_DIR, uploadId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const manifest = {
    uploadId,
    fileName,
    fileSize,
    totalChunks,
    mimeType: mimeType || 'application/octet-stream',
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(sessionDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  res.json({ uploadId });
});

// 2) 查询已上传的分片（断点续传用：前端重新连接后先问这个）
router.get('/:uploadId/status', async (req: Request, res: Response) => {
  const { uploadId } = req.params;
  if (!isValidUploadId(uploadId)) {
    return res.status(400).json({ error: 'uploadId 格式不正确' });
  }

  const sessionDir = path.join(TEMP_DIR, uploadId);
  if (!fs.existsSync(sessionDir)) {
    return res.status(404).json({ error: '上传会话不存在，请重新 init' });
  }

  const files = await fsp.readdir(sessionDir);
  const received = files
    .filter((f) => f.startsWith('chunk_'))
    .map((f) => parseInt(f.replace('chunk_', ''), 10))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);

  res.json({ receivedChunks: received });
});

// 3) 上传单个分片
router.post('/:uploadId/chunk/:chunkIndex', upload.single('chunk'), async (req: Request, res: Response) => {
  const { uploadId, chunkIndex } = req.params;

  if (!isValidUploadId(uploadId)) {
    return res.status(400).json({ error: 'uploadId 格式不正确' });
  }

  const idx = parseInt(chunkIndex, 10);
  if (Number.isNaN(idx) || idx < 0) {
    return res.status(400).json({ error: 'chunkIndex 不合法' });
  }

  const sessionDir = path.join(TEMP_DIR, uploadId);
  if (!fs.existsSync(sessionDir)) {
    return res.status(404).json({ error: '上传会话不存在，请重新 init' });
  }
  if (!req.file) {
    return res.status(400).json({ error: '未收到分片数据' });
  }

  const chunkPath = path.join(sessionDir, `chunk_${idx}`);
  await fsp.writeFile(chunkPath, req.file.buffer);

  res.json({ success: true, chunkIndex: idx });
});

// 4) 完成上传：所有分片到齐后合并成最终文件
router.post('/:uploadId/complete', async (req: Request, res: Response) => {
  const { uploadId } = req.params;
  if (!isValidUploadId(uploadId)) {
    return res.status(400).json({ error: 'uploadId 格式不正确' });
  }

  const sessionDir = path.join(TEMP_DIR, uploadId);
  if (!fs.existsSync(sessionDir)) {
    return res.status(404).json({ error: '上传会话不存在' });
  }

  const manifestPath = path.join(sessionDir, 'manifest.json');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf-8'));
  const { totalChunks, fileName, mimeType } = manifest;

  // 校验所有分片是否都已到齐
  for (let i = 0; i < totalChunks; i++) {
    if (!fs.existsSync(path.join(sessionDir, `chunk_${i}`))) {
      return res.status(400).json({ error: `缺少分片 ${i}，无法完成合并` });
    }
  }

  const ext = path.extname(fileName) || '';
  const finalFileName = `${crypto.randomUUID()}${ext}`;
  const finalPath = path.join(FINAL_DIR, finalFileName);

  // 按顺序合并分片写入最终文件
  const writeStream = fs.createWriteStream(finalPath);
  try {
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(sessionDir, `chunk_${i}`);
      const data = await fsp.readFile(chunkPath);
      await new Promise<void>((resolve, reject) => {
        writeStream.write(data, (err) => (err ? reject(err) : resolve()));
      });
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err: any) => (err ? reject(err) : resolve()));
    });
  }

  // 清理临时分片目录
  await fsp.rm(sessionDir, { recursive: true, force: true });

  // TODO: 在这里把资源记录写入 PostgreSQL 的 assets 表
  // 例如：await assetsRepository.create({
  //   fileName: finalFileName,
  //   originalName: fileName,
  //   mimeType,
  //   url: `/uploads/assets/${finalFileName}`,
  // });

  res.json({
    success: true,
    fileName: finalFileName,
    url: `/uploads/assets/${finalFileName}`,
    mimeType,
  });
});

export default router;
