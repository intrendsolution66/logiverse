// frontend/src/pages/edu/PptViewerPage.tsx
//
// 独立的PPT预览页——两种入口：
//   ?assetId=xxx  → 素材库预览（不上报进度，纯预览/QC用）
//   ?levelId=xxx  → 具体某个 ppt_lecture 类型的 Activity（学生学习场景，
//                   会照常上报进度，跟嵌在 LevelPlayerPage 里的行为一致）
//
// 布局改成占满整个视口高度（100dvh，兼容移动端地址栏收起展开时的视口
// 变化）+ 深色舞台背景，不再是居中一小块卡在 max-w-4xl 里——PPT/视频这
// 种"看内容"的场景，屏幕越大越好，不需要给它设上限。标题挪到顶部条，
// 不跟内容区抢位置。

import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { assetsApi, eduApi } from "@/api";
import { PptReader } from "@/components/PptReader";

export default function PptViewerPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const assetId = searchParams.get("assetId");
  const levelId = searchParams.get("levelId");

  const [slideUrls, setSlideUrls] = useState<string[] | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function handleBack() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    // 这个页面大概率是素材库"预览"链接用 target="_blank" 新开的标签页——
    // 这种标签页 history.length 天生就是1，不代表这是唯一入口。这时候
    // "返回"应该关掉这个标签页，让用户回到原本还开着的素材库标签页，
    // 而不是在这个标签页里跳去 /home（那样反而是打开了个新地方）。
    // 浏览器只允许关闭"历史记录只有一条"的标签页，正好是这个场景。
    window.close();
    // 万一浏览器拒绝关闭（比如极少数情况下没有关闭权限），退回首页兜底
    setTimeout(() => navigate("/home"), 150);
  }

  useEffect(() => {
    if (assetId) {
      assetsApi.getAsset(assetId)
        .then((a) => {
          setTitle(a.name ?? "PPT预览");
          setSlideUrls(a.slide_urls && a.slide_urls.length > 0 ? a.slide_urls : [a.file_data]);
        })
        .catch(() => setError("找不到这个素材"))
        .finally(() => setLoading(false));
    } else if (levelId) {
      eduApi.getLevel(levelId)
        .then((lv) => {
          setTitle(lv.title_i18n?.zh ?? lv.title_i18n?.en ?? "PPT");
          const config = lv.config as { slide_image_urls?: string[] };
          setSlideUrls(config.slide_image_urls ?? []);
        })
        .catch(() => setError("找不到这个 Activity"))
        .finally(() => setLoading(false));
    } else {
      setError("缺少 assetId 或 levelId 参数");
      setLoading(false);
    }
  }, [assetId, levelId]);

  async function handleProgress(index: number, total: number, completed: boolean) {
    if (!levelId) return; // 素材库预览不上报进度
    try {
      await eduApi.submitProgress(levelId, {
        module_type: "ppt_lecture", score: 0, max_score: 0,
        time_spent_seconds: 0, mistakes: 0, completed,
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
        ) : error ? (
          <p className="text-sm text-white/50">{error}</p>
        ) : (
          <PptReader slideUrls={slideUrls ?? []} onProgress={handleProgress} fillHeight />
        )}
      </div>
    </div>
  );
}
