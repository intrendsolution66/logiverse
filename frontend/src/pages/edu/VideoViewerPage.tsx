// frontend/src/pages/edu/VideoViewerPage.tsx
//
// 独立的视频预览页——两种入口：
//   ?assetId=xxx  → 素材库预览（不上报进度，纯预览/QC用）
//   ?levelId=xxx  → 具体某个 video_lecture 类型的 Activity（学生学习场景）
//
// 跟 PptViewerPage 用同一套布局思路：占满整个视口高度、深色舞台背景，
// 标题挪到顶部条，内容区尽量把可用空间都让给视频。

import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { assetsApi, eduApi } from "@/api";
import { VideoPlayer } from "@/components/VideoPlayer";

export default function VideoViewerPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const assetId = searchParams.get("assetId");
  const levelId = searchParams.get("levelId");

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function handleBack() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    // 同 PptViewerPage：素材库"预览"链接是 target="_blank" 新开标签页打开
    // 的，这种标签页 history.length 天生是1，正确做法是关掉标签页而不是
    // 跳去 /home。
    window.close();
    setTimeout(() => navigate("/home"), 150);
  }

  useEffect(() => {
    if (assetId) {
      assetsApi.getAsset(assetId)
        .then((a) => { setTitle(a.name ?? "视频预览"); setVideoUrl(a.file_data); })
        .catch(() => setError("找不到这个素材"))
        .finally(() => setLoading(false));
    } else if (levelId) {
      eduApi.getLevel(levelId)
        .then((lv) => {
          setTitle(lv.title_i18n?.zh ?? lv.title_i18n?.en ?? "视频");
          const config = lv.config as { video_url?: string };
          setVideoUrl(config.video_url ?? null);
        })
        .catch(() => setError("找不到这个 Activity"))
        .finally(() => setLoading(false));
    } else {
      setError("缺少 assetId 或 levelId 参数");
      setLoading(false);
    }
  }, [assetId, levelId]);

  async function handleProgress(secondsWatched: number, durationSeconds: number, completed: boolean) {
    if (!levelId) return;
    try {
      await eduApi.submitProgress(levelId, {
        module_type: "video_lecture", score: 0, max_score: 0,
        time_spent_seconds: secondsWatched, mistakes: 0, completed,
      });
    } catch { /* 上报失败不打断预览体验 */ }
  }

  return (
    <div className="h-[100dvh] w-full bg-[#0B0D12] flex flex-col overflow-hidden">
      <header className="flex items-center gap-4 px-4 sm:px-6 py-3 border-b border-white/10 shrink-0">
        <button onClick={handleBack} className="text-sm text-white/60 hover:text-white transition-colors shrink-0">
          ← 返回
        </button>
        {title && <p className="text-sm font-medium text-white/90 truncate">{title}</p>}
      </header>

      <div className="flex-1 min-h-0 flex items-center justify-center p-3 sm:p-6">
        {loading ? (
          <p className="text-sm text-white/50">加载中...</p>
        ) : error || !videoUrl ? (
          <p className="text-sm text-white/50">{error ?? "这个内容还没有视频"}</p>
        ) : (
          <VideoPlayer src={videoUrl} onProgress={handleProgress} fillHeight />
        )}
      </div>
    </div>
  );
}
