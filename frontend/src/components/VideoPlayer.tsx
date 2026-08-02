// frontend/src/components/VideoPlayer.tsx
//
// 加了 fillHeight 模式（独立播放页用，撑满父容器的可用高度）和原生全屏
// 切换按钮。控制栏从一排零散的文字按钮，改成分组更清楚、图标+文字的
// 深色控制台样式，看起来更像专业播放器而不是一堆散落的按钮。
//
// 定格逐帧看、设起止点、循环播放、重播这些功能本身不变，onProgress依
// 旧选填——素材库预览场景不需要往后端上报播放进度。

import { useRef, useCallback, useState, useEffect } from "react";
import { Maximize, Minimize, SkipBack, SkipForward, RotateCcw, Repeat, Lock, Gauge } from "lucide-react";

interface VideoPlayerProps {
  src: string;
  title?: string;
  onProgress?: (secondsWatched: number, durationSeconds: number, completed: boolean) => void;
  /** 撑满父容器的可用高度（独立播放页用）。默认 false，保持嵌入场景原本的自适应宽度行为。 */
  fillHeight?: boolean;
  /** 家长预览模式——隐藏逐帧/起止点/循环这些给内容设计者用的控制面板，
   *  只留一个干净的播放器。搭配 previewLimitSeconds 使用。 */
  previewMode?: boolean;
  /** 只在 previewMode 下生效：播到这个秒数就自动暂停，盖上"订阅解锁完整内容"
   *  的提示层，并且不让用户把进度条拖到这个点之后。不传=完整播放不截断。 */
  previewLimitSeconds?: number;
}

const PROGRESS_REPORT_INTERVAL_MS = 5000;
const COMPLETED_THRESHOLD = 0.95;
const FRAME_STEP = 1 / 30; // 按30fps估算的单帧时长，没有精确帧率信息时的合理近似
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatTime(t: number): string {
  if (!Number.isFinite(t)) return "--:--";
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoPlayer({ src, title, onProgress, fillHeight = false, previewMode = false, previewLimitSeconds }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastReportRef = useRef(0);

  const [duration, setDuration] = useState(0);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [trimStart, setTrimStart] = useState<number | null>(null);
  const [trimEnd, setTrimEnd] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [previewLocked, setPreviewLocked] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  // 换速度只是设 video 元素的 playbackRate 属性，浏览器原生支持，不需要
  // 换视频源。src 换掉（比如以后真的接了多分辨率切换）时元素会重置成
  // 1x，所以 onLoadedMetadata 里也把当前选的倍速重新套一次。
  function setPlaybackRate(rate: number) {
    const video = videoRef.current;
    if (video) video.playbackRate = rate;
    setPlaybackRateState(rate);
    setShowSpeedMenu(false);
  }

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.duration) return;

    // 家长预览时长上限——到点就暂停定格，不是"播完了"，是"免费能看的部分到这了"
    if (previewMode && previewLimitSeconds !== undefined && video.currentTime >= previewLimitSeconds) {
      video.pause();
      video.currentTime = previewLimitSeconds;
      setPreviewLocked(true);
      return; // 预览模式下不走下面的起止点/进度上报逻辑——那些是给内容设计者用的
    }

    // 起止点控制：到了终点——循环开着就跳回起点继续放，循环关着就停在终点（"定格看"）
    if (trimEnd !== null && video.currentTime >= trimEnd) {
      if (loopEnabled) {
        video.currentTime = trimStart ?? 0;
      } else {
        video.pause();
        video.currentTime = trimEnd;
      }
    }

    const now = Date.now();
    if (now - lastReportRef.current < PROGRESS_REPORT_INTERVAL_MS) return;
    lastReportRef.current = now;
    const completed = video.currentTime / video.duration >= COMPLETED_THRESHOLD;
    onProgress?.(Math.floor(video.currentTime), Math.floor(video.duration), completed);
  }, [onProgress, trimEnd, trimStart, loopEnabled, previewMode, previewLimitSeconds]);

  const handleEnded = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (loopEnabled && trimEnd === null) {
      video.currentTime = trimStart ?? 0;
      video.play();
      return;
    }
    onProgress?.(Math.floor(video.duration), Math.floor(video.duration), true);
  }, [onProgress, loopEnabled, trimEnd, trimStart]);

  function setStartHere() {
    const t = videoRef.current?.currentTime ?? 0;
    setTrimStart(t);
    if (trimEnd !== null && t >= trimEnd) setTrimEnd(null);
  }
  function setEndHere() {
    const t = videoRef.current?.currentTime ?? 0;
    setTrimEnd(t);
    if (trimStart !== null && t <= trimStart) setTrimStart(null);
  }
  function clearTrim() { setTrimStart(null); setTrimEnd(null); }

  function replay() {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = trimStart ?? 0;
    video.play();
  }

  function stepFrame(dir: -1 | 1) {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = Math.max(0, Math.min(duration, video.currentTime + dir * FRAME_STEP));
  }

  function clampPreviewSeek() {
    const video = videoRef.current;
    if (!video || !previewMode || previewLimitSeconds === undefined) return;
    if (video.currentTime > previewLimitSeconds) {
      video.currentTime = previewLimitSeconds;
      video.pause();
      setPreviewLocked(true);
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen();
    }
  }

  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`w-full flex flex-col gap-2 ${fillHeight ? "h-full" : ""} ${isFullscreen ? "bg-black p-4 justify-center" : ""}`}
    >
      {title && !isFullscreen && <p className="text-sm font-medium text-foreground/90 mb-0.5">{title}</p>}

      <div className={`relative w-full ${fillHeight ? "flex-1 min-h-0" : ""} rounded-xl overflow-hidden bg-black shadow-lg group`}>
        <video
          ref={videoRef}
          src={src}
          controls
          className={`w-full ${fillHeight ? "h-full" : ""} object-contain bg-black`}
          onTimeUpdate={handleTimeUpdate}
          onSeeking={clampPreviewSeek}
          onEnded={handleEnded}
          onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration); e.currentTarget.playbackRate = playbackRate; }}
          onPlay={() => setIsPaused(false)}
          onPause={() => setIsPaused(true)}
        />
        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          <div className="relative">
            <button
              onClick={() => setShowSpeedMenu((v) => !v)}
              aria-label="播放速度"
              className={`h-8 px-2 rounded-md bg-black/40 text-white text-xs font-medium flex items-center gap-1 transition-all hover:bg-black/60 ${
                showSpeedMenu ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              }`}
            >
              <Gauge className="w-3.5 h-3.5" />{playbackRate}x
            </button>
            {showSpeedMenu && (
              <div className="absolute top-full right-0 mt-1 bg-black/85 rounded-md overflow-hidden shadow-lg min-w-[64px] z-10">
                {SPEED_OPTIONS.map((r) => (
                  <button
                    key={r} onClick={() => setPlaybackRate(r)}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors ${
                      r === playbackRate ? "text-primary font-semibold" : "text-white"
                    }`}
                  >
                    {r}x{r === 1 ? "（正常）" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "退出全屏" : "全屏"}
            className="w-8 h-8 rounded-md bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/60 transition-all"
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
        </div>

        {previewLocked && (
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-2 text-center px-4">
            <Lock className="w-7 h-7 text-white/90" />
            <p className="text-white text-sm font-medium">预览到这里就结束啦</p>
            <p className="text-white/60 text-xs">订阅后可以看完整内容</p>
          </div>
        )}
      </div>

      {!previewMode && (
        <div className={`rounded-lg border border-border bg-muted/40 px-3 py-2 flex flex-col gap-2 shrink-0 ${isFullscreen ? "hidden" : ""}`}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button onClick={() => stepFrame(-1)} disabled={!isPaused} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
            <SkipBack className="w-3.5 h-3.5" />逐帧
          </button>
          <button onClick={() => stepFrame(1)} disabled={!isPaused} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed">
            逐帧<SkipForward className="w-3.5 h-3.5" />
          </button>
          <span className="text-muted-foreground">（暂停时可用，退格/前进约1帧，方便定格细看）</span>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs border-t border-border pt-2">
          <button onClick={setStartHere} className="px-2 py-1 rounded border border-border hover:bg-muted">设起点</button>
          <button onClick={setEndHere} className="px-2 py-1 rounded border border-border hover:bg-muted">设终点</button>
          <span className="text-muted-foreground tabular-nums">
            起点 {trimStart !== null ? formatTime(trimStart) : "—"} ・ 终点 {trimEnd !== null ? formatTime(trimEnd) : "—"}
          </span>
          {(trimStart !== null || trimEnd !== null) && (
            <button onClick={clearTrim} className="px-2 py-1 rounded border border-border hover:bg-muted text-muted-foreground">清除</button>
          )}

          <label className="flex items-center gap-1.5 cursor-pointer select-none ml-auto">
            <input type="checkbox" checked={loopEnabled} onChange={(e) => setLoopEnabled(e.target.checked)} />
            <Repeat className="w-3.5 h-3.5" />循环播放
          </label>
          <button onClick={replay} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90">
            <RotateCcw className="w-3.5 h-3.5" />重播
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
