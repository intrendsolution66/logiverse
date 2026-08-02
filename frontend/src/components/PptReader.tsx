// frontend/src/components/PptReader.tsx
//
// 加了 fillHeight 模式——嵌在卡片/弹窗里默认还是走原本的 16:9 比例
// (aspect-video)，但独立播放页 (PptViewerPage) 需要"尽量占满屏幕"，
// 就传 fillHeight 撑满父容器给出的可用高度，图片始终按原比例居中显示
// (object-contain，不会被拉伸变形)。
//
// 顺手加了：左右方向键翻页、悬浮箭头(鼠标移过来才出现，不占画面空间)、
// 全屏按钮(Fullscreen API)。舞台背景换成深色卡片，看起来更像专业的
// 演示/阅读工具，而不是网页里普通的一块内容。

import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Maximize, Minimize, ChevronLeft, ChevronRight } from "lucide-react";

interface PptReaderProps {
  slideUrls: string[];
  title?: string;
  initialSlide?: number;
  onProgress?: (currentIndex: number, totalSlides: number, completed: boolean) => void;
  /** 撑满父容器的可用高度（独立播放页用）。默认 false，保持嵌入场景原本的 16:9 比例。 */
  fillHeight?: boolean;
}

export function PptReader({ slideUrls, title, initialSlide = 0, onProgress, fillHeight = false }: PptReaderProps) {
  const [index, setIndex] = useState(Math.min(initialSlide, Math.max(0, slideUrls.length - 1)));
  const total = slideUrls.length;
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const reportProgress = useCallback((i: number) => {
    const completed = i >= total - 1;
    onProgress?.(i, total, completed);
  }, [onProgress, total]);

  useEffect(() => { reportProgress(index); }, [index, reportProgress]);

  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(() => setIndex((i) => Math.min(total - 1, i + 1)), [total]);

  // 左右方向键翻页——PPT这种场景键盘翻页是标配体验，不用逐个点按钮
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goPrev, goNext]);

  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen();
    }
  }

  if (total === 0) {
    return <p className="text-sm text-muted-foreground">这个PPT还没有可显示的内容</p>;
  }

  return (
    <div
      ref={containerRef}
      className={`w-full flex flex-col gap-3 ${fillHeight ? "h-full" : ""} ${isFullscreen ? "bg-[#0B0D12] p-4 justify-center" : ""}`}
    >
      {title && !isFullscreen && <p className="text-sm font-medium text-foreground/90">{title}</p>}

      <div
        className={`relative w-full ${fillHeight ? "flex-1 min-h-0" : "aspect-video"} rounded-xl overflow-hidden bg-[#12141B] border border-white/5 shadow-lg flex items-center justify-center group`}
      >
        <img
          src={slideUrls[index]}
          alt={`第 ${index + 1} 页`}
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
        />

        {index > 0 && (
          <button
            onClick={goPrev}
            aria-label="上一页"
            className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        {index < total - 1 && (
          <button
            onClick={goNext}
            aria-label="下一页"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}

        <button
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? "退出全屏" : "全屏"}
          className="absolute top-2 right-2 w-8 h-8 rounded-md bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/60 transition-all"
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" disabled={index <= 0} onClick={() => setIndex(0)}>首页</Button>
          <Button size="sm" variant="outline" disabled={index <= 0} onClick={goPrev}>上一页</Button>
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">第 {index + 1} / {total} 页</span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" disabled={index >= total - 1} onClick={goNext}>下一页</Button>
          <Button size="sm" variant="outline" disabled={index >= total - 1} onClick={() => setIndex(total - 1)}>末页</Button>
        </div>
      </div>
    </div>
  );
}
