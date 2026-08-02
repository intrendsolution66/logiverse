// frontend/src/hooks/useChunkedUpload.ts
//
// 大文件（目前主要是视频素材）分片上传。走 assetChunkUploadApi
// （init / status / uploadChunk / complete），跟项目里其他 *Api 一样用
// api/index.ts 里配置好的 axios 实例，认证 header 会自动带上，不用
// 额外处理 token。

import { useState, useCallback } from "react";
import { assetChunkUploadApi } from "@/api";

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB 每片，需 <= 后端 multer 单片限制（8MB）

interface UploadProgress {
  uploadedChunks: number;
  totalChunks: number;
  percent: number;
}

interface ChunkUploadResult {
  url: string;
  mimeType: string;
}

function getErrorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return msg ?? (err instanceof Error ? err.message : fallback);
}

export function useChunkedUpload() {
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadFile = useCallback(async (file: File): Promise<ChunkUploadResult | null> => {
    setIsUploading(true);
    setError(null);
    setProgress(null);

    try {
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      // 1) 初始化上传会话
      const { uploadId } = await assetChunkUploadApi.init({
        fileName: file.name,
        fileSize: file.size,
        totalChunks,
        mimeType: file.type,
      });

      // 2) 查询已上传的分片（断点续传：网络中断重试时能跳过已传的部分）
      let alreadyUploaded: number[] = [];
      try {
        const statusData = await assetChunkUploadApi.status(uploadId);
        alreadyUploaded = statusData.receivedChunks ?? [];
      } catch {
        // 刚 init 完，还没有任何分片是正常情况，忽略
      }

      // 3) 依次上传缺失的分片
      for (let i = 0; i < totalChunks; i++) {
        if (alreadyUploaded.includes(i)) {
          setProgress({ uploadedChunks: i + 1, totalChunks, percent: Math.round(((i + 1) / totalChunks) * 100) });
          continue;
        }

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunkBlob = file.slice(start, end);

        // 每片最多重试3次，失败后做退避等待
        let lastErr: unknown;
        let ok = false;
        for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
          try {
            await assetChunkUploadApi.uploadChunk(uploadId, i, chunkBlob);
            ok = true;
          } catch (err) {
            lastErr = err;
            if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
        }
        if (!ok) throw new Error(getErrorMessage(lastErr, `分片 ${i} 上传失败`));

        setProgress({ uploadedChunks: i + 1, totalChunks, percent: Math.round(((i + 1) / totalChunks) * 100) });
      }

      // 4) 通知后端合并所有分片，拿到最终 URL
      const result = await assetChunkUploadApi.complete(uploadId);

      setIsUploading(false);
      return result;
    } catch (err) {
      setError(getErrorMessage(err, "上传失败"));
      setIsUploading(false);
      return null;
    }
  }, []);

  return { uploadFile, progress, isUploading, error };
}