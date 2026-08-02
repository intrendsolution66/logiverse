// src/modules/upload/cleanupStaleUploads.ts
//
// 定期清理长时间未完成的分片上传会话（比如用户上传到一半就关闭了页面，
// temp-chunks 目录里的分片会一直留着占用磁盘空间）。
//
// 建议在 app 启动时调用一次，并用 setInterval 或 node-cron 定期执行。
// 用法示例（在 app.ts / server.ts 里）：
//   import { cleanupStaleUploads } from './modules/upload/cleanupStaleUploads';
//   setInterval(() => cleanupStaleUploads(), 60 * 60 * 1000); // 每小时跑一次

import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';

const TEMP_DIR = path.resolve(process.cwd(), 'storage/temp-chunks');
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 超过24小时未完成的会话视为过期

export async function cleanupStaleUploads(): Promise<void> {
  if (!fssync.existsSync(TEMP_DIR)) return;

  const sessions = await fs.readdir(TEMP_DIR);

  for (const sessionId of sessions) {
    const sessionDir = path.join(TEMP_DIR, sessionId);
    const manifestPath = path.join(sessionDir, 'manifest.json');

    try {
      const stat = await fs.stat(sessionDir);
      const age = Date.now() - stat.mtimeMs;

      if (age > MAX_AGE_MS) {
        await fs.rm(sessionDir, { recursive: true, force: true });
        console.log(`[cleanupStaleUploads] 已清理过期上传会话: ${sessionId}`);
      }
    } catch (err) {
      // 目录可能在读取过程中被并发删除，忽略即可
      console.warn(`[cleanupStaleUploads] 跳过 ${sessionId}:`, err);
    }
  }
}