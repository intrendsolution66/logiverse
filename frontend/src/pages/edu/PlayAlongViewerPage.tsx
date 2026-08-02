// frontend/src/pages/edu/PlayAlongViewerPage.tsx
//
// 独立的跟弹练习播放页——只支持 ?levelId=xxx 这一种入口（不像 Ppt/Video
// 那两个 ViewerPage 还支持 ?assetId= 素材库预览：跟弹练习不是"一份素材"，
// 是乐谱+音频+同步标记三样东西合在一起的一个 Activity，脱离 Activity
// 单独预览没有意义，所以没有素材库预览这条路）。
//
// 音频引擎——变速和变调是两条不同的路，故意不用同一套机制处理：
//   变速：<audio> 元素原生 playbackRate（preservesPitch默认开），浏览器
//         免费给的功能，零自定义代码，边下载边播也是它原生就有的。
//   变调：浏览器没有对应的原生功能（Web Audio API 的 detune 会连带影响
//         实际播放速度，做不到"音高变、速度不变"），这部分接一个自定义
//         的 AudioWorkletNode（frontend/src/worklets/
//         playAlongPitchProcessor.js），跑在专门的音频渲染线程上，只做
//         纯变调这一件事，不碰变速。
// 这样自定义DSP的范围降到最小——能用浏览器原生功能顶的地方(变速、边下
// 载边播)完全不碰自己写的代码，只有真正没有原生方案的变调才走自定义
// worklet，出问题的地方也就只集中在那一小块。
//
// 需要 `npm install soundtouchjs`（worklet 文件内部用它的核心算法）。
// 播放链路：<audio> 元素 → createMediaElementSource → AudioWorkletNode
// (变调) → destination。
//
// 已知需要在实际环境验证/调优的地方（这几点在 worklet 文件本身的注释
// 里也写了，这里再提一遍，因为都是要在这个页面配合测试才看得出来的）：
//   1. worklet 内部缓冲策略——如果听感上有卡顿/延迟，通常要调
//      playAlongPitchProcessor.js 里的 SOURCE_BUFFER_FRAMES
//   2. 跳转播放位置(seekTo)时会给 worklet 发一个 'reset' 消息清空内部
//      残留状态，避免跳转前后的声音叠在一起——实际效果要测
//   3. new URL('../worklets/playAlongPitchProcessor.js', import.meta.url)
//      这个 worklet 模块加载写法是 Vite 官方支持的方式，但没在这个项目
//      实跑过，需要确认能正常 build、addModule 不报错
//   4. audioContext.createMediaElementSource() 每个 <audio> 元素只能调用
//      一次——用了 ref 标记防止 React 严格模式下的重复调用报错，如果
//      还是遇到 "already connected" 之类的报错，多半是这个页面被重复
//      挂载导致的，需要排查

import { useEffect, useState, useRef, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { eduApi } from "@/api";
import { Play, Pause, Gauge, Repeat, Music3 } from "lucide-react";

interface PlayAlongMarker { time: number; page: number; x: number; y: number }
interface PlayAlongConfig {
  sheet_image_urls?: string[];
  audio_url?: string;
  markers?: PlayAlongMarker[];
  original_bpm?: number;
}

const RATE_MIN = 0.25;
const RATE_MAX = 2;
const BPM_PRESETS = [45, 80, 100, 120];

// 转调范围——上下一个八度(±1200 cent = ±12半音)，cent级精度(step=1)。
const TRANSPOSE_MIN_CENTS = -1200;
const TRANSPOSE_MAX_CENTS = 1200;

const COMPLETED_THRESHOLD = 0.95;
const PROGRESS_REPORT_INTERVAL_MS = 5000;

function formatTime(t: number): string {
  if (!Number.isFinite(t)) return "0:00";
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatSemitones(cents: number): string {
  const st = cents / 100;
  const sign = st > 0 ? "+" : "";
  return `${sign}${st.toFixed(2)} 半音`;
}

// x 匀速反映稳定节奏，y 用 smoothstep 只在中间段过渡、两头贴住行高——
// 模拟真实读谱：一行内基本水平移动，换行才有一下快速的上下位移，不是
// 从头到尾都在斜着走那种生硬直线。
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export default function PlayAlongViewerPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const levelId = searchParams.get("levelId");

  const [pages, setPages] = useState<string[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [markers, setMarkers] = useState<PlayAlongMarker[]>([]);
  const [originalBpm, setOriginalBpm] = useState(120);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const pitchNodeRef = useRef<AudioWorkletNode | null>(null);
  const graphSetupRef = useRef(false); // 防止 createMediaElementSource 被调用第二次
  const startRef = useRef(Date.now());
  const lastReportRef = useRef(0);
  const reportedCompleteRef = useRef(false);
  const seekBarRef = useRef<HTMLDivElement>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [transposeCents, setTransposeCentsState] = useState(0);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showTransposeMenu, setShowTransposeMenu] = useState(false);
  const [loopRange, setLoopRange] = useState<{ start: number; end: number } | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<"start" | "end" | null>(null);
  const [workletReady, setWorkletReady] = useState(false);

  function handleBack() {
    if (window.history.length > 1) { navigate(-1); return; }
    window.close();
    setTimeout(() => navigate("/home"), 150);
  }

  useEffect(() => {
    if (!levelId) { setError("缺少 levelId 参数"); setLoading(false); return; }
    eduApi.getLevel(levelId)
      .then((lv) => {
        setTitle(lv.title_i18n?.zh ?? lv.title_i18n?.en ?? "跟弹练习");
        const config = lv.config as PlayAlongConfig;
        setPages(config.sheet_image_urls ?? []);
        setAudioUrl(config.audio_url ?? null);
        setMarkers([...(config.markers ?? [])].sort((a, b) => a.time - b.time));
        setOriginalBpm(config.original_bpm && config.original_bpm > 0 ? config.original_bpm : 120);
      })
      .catch(() => setError("找不到这个 Activity"))
      .finally(() => setLoading(false));
  }, [levelId]);

  // 接变调用的 Web Audio 音频图——<audio>元素本身该怎么播放(下载/缓冲/
  // 播放/暂停/进度)完全不受影响，这一段只是在它的输出上再接一段"经过
  // 变调处理"的旁路。只在 audio 元素真正准备好(canplay)之后才接线，
  // 且只接一次(graphSetupRef 挡重复调用)。
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl || !audioUrl || graphSetupRef.current) return;

    async function setupGraph() {
      try {
        const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioContextCtor();
        const workletUrl = new URL("../worklets/playAlongPitchProcessor.js", import.meta.url);
        await ctx.audioWorklet.addModule(workletUrl);

        const source = ctx.createMediaElementSource(audioEl!);
        const pitchNode = new AudioWorkletNode(ctx, "play-along-pitch-processor", {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        });
        source.connect(pitchNode);
        pitchNode.connect(ctx.destination);

        audioContextRef.current = ctx;
        pitchNodeRef.current = pitchNode;
        graphSetupRef.current = true;
        setWorkletReady(true);
      } catch (err) {
        // 变调链路接不上不该拦住基本播放——退化成"能播放、只是变调没
        // 效果"，比整个播放器打不开好
        console.error("跟弹练习变调链路初始化失败，变调功能将不可用：", err);
      }
    }

    audioEl.addEventListener("canplay", setupGraph, { once: true });
    return () => audioEl.removeEventListener("canplay", setupGraph);
  }, [audioUrl]);

  useEffect(() => {
    return () => {
      pitchNodeRef.current?.disconnect();
      audioContextRef.current?.close();
    };
  }, []);

  // 找 currentTime 前后最近的两个标记，同页就把 x/y 都插值出来，跨页就
  // 直接跳到下一页对应的位置——翻页本来就是瞬间的事，不用做视觉过渡。
  const { page: currentPage, x: highlightX, y: highlightY } = useMemo(() => {
    if (markers.length === 0) return { page: 0, x: 0.5, y: 0 };
    let prev = markers[0];
    let next: PlayAlongMarker | null = null;
    for (const m of markers) {
      if (m.time <= currentTime) prev = m;
      else { next = m; break; }
    }
    if (!next) return { page: prev.page, x: prev.x, y: prev.y };
    if (next.page !== prev.page) return currentTime >= next.time ? { page: next.page, x: next.x, y: next.y } : { page: prev.page, x: prev.x, y: prev.y };
    const span = next.time - prev.time;
    const ratio = span > 0 ? (currentTime - prev.time) / span : 0;
    const yRatio = smoothstep(0.25, 0.75, ratio);
    return { page: prev.page, x: prev.x + (next.x - prev.x) * ratio, y: prev.y + (next.y - prev.y) * yRatio };
  }, [markers, currentTime]);

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);

    if (loopRange && audio.currentTime >= loopRange.end) {
      audio.currentTime = loopRange.start;
      pitchNodeRef.current?.port.postMessage({ type: "reset" });
    }

    if (!levelId) return;
    const now = Date.now();
    if (now - lastReportRef.current >= PROGRESS_REPORT_INTERVAL_MS) {
      lastReportRef.current = now;
      const completed = audio.duration ? audio.currentTime / audio.duration >= COMPLETED_THRESHOLD : false;
      eduApi.submitProgress(levelId, {
        module_type: "play_along", score: 0, max_score: 0,
        time_spent_seconds: Math.floor((Date.now() - startRef.current) / 1000), mistakes: 0, completed,
      }).catch(() => { /* 上报失败不打断播放体验 */ });
      if (completed) reportedCompleteRef.current = true;
    }
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    // 大部分浏览器的自动播放策略下，AudioContext 建好之后是挂起状态，
    // 要在用户点击这个手势里 resume，不然变调链路听不到声音（<audio>
    // 元素本身倒是能播，因为它走的是普通媒体播放路径，不受这个策略限制
    // ——所以这行漏了不会整个播放器坏掉，只会变调没声音，不太好排查，
    // 这里保险起见每次点播放都顺手 resume 一下）。
    audioContextRef.current?.resume();
    if (audio.paused) audio.play(); else audio.pause();
  }

  function setPlaybackRate(rate: number) {
    const clamped = Math.max(RATE_MIN, Math.min(RATE_MAX, rate));
    if (audioRef.current) audioRef.current.playbackRate = clamped;
    setPlaybackRateState(clamped);
  }

  function rateFromBpm(bpm: number) { return bpm / originalBpm; }
  function bpmFromRate(rate: number) { return Math.round(rate * originalBpm); }
  function setBpm(bpm: number) { setPlaybackRate(rateFromBpm(bpm)); }
  function nudgeBpm(delta: number) { setBpm(bpmFromRate(playbackRate) + delta); }

  const currentBpm = bpmFromRate(playbackRate);
  const bpmSliderMin = Math.max(1, Math.round(originalBpm * RATE_MIN));
  const bpmSliderMax = Math.round(originalBpm * RATE_MAX);

  function setTransposeCents(cents: number) {
    const clamped = Math.max(TRANSPOSE_MIN_CENTS, Math.min(TRANSPOSE_MAX_CENTS, Math.round(cents)));
    pitchNodeRef.current?.port.postMessage({ type: "setPitchCents", cents: clamped });
    setTransposeCentsState(clamped);
  }
  function nudgeTranspose(delta: number) { setTransposeCents(transposeCents + delta); }

  function seekTo(time: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(duration, time));
    pitchNodeRef.current?.port.postMessage({ type: "reset" });
  }

  function handleSeekBarClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!seekBarRef.current || duration === 0) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    seekTo(((e.clientX - rect.left) / rect.width) * duration);
  }

  function toggleLoop() {
    if (loopRange) { setLoopRange(null); return; }
    const start = Math.max(0, currentTime - 1);
    setLoopRange({ start, end: Math.min(duration || start + 4, start + 4) });
  }

  useEffect(() => {
    if (!draggingHandle) return;
    function onMove(e: MouseEvent) {
      if (!seekBarRef.current || duration === 0) return;
      const rect = seekBarRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const time = ratio * duration;
      setLoopRange((r) => {
        if (!r) return r;
        if (draggingHandle === "start") return { start: Math.min(time, r.end - 0.2), end: r.end };
        return { start: r.start, end: Math.max(time, r.start + 0.2) };
      });
    }
    function onUp() { setDraggingHandle(null); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [draggingHandle, duration]);

  const pageUrl = pages[Math.min(currentPage, Math.max(0, pages.length - 1))];

  return (
    <div className="h-[100dvh] w-full bg-[#0B0D12] flex flex-col overflow-hidden">
      <header className="flex items-center gap-4 px-4 sm:px-6 py-3 border-b border-white/10 shrink-0">
        <button onClick={handleBack} className="text-sm text-white/60 hover:text-white transition-colors shrink-0">
          ← 返回
        </button>
        {title && <p className="text-sm font-medium text-white/90 truncate">{title}</p>}
      </header>

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-3 sm:p-6 gap-3 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-white/50">加载中...</p>
        ) : error || pages.length === 0 || !audioUrl ? (
          <p className="text-sm text-white/50">{error ?? "这个内容还没有乐谱或音频"}</p>
        ) : (
          <div className="w-full max-w-3xl">
            <div className="relative rounded-2xl overflow-hidden bg-white shadow-lg">
              <img src={pageUrl} alt={`第${currentPage + 1}页`} className="w-full h-auto block" />
              <div
                className="absolute top-0 bottom-0 w-px bg-fuchsia-400/40 pointer-events-none transition-[left] duration-100 ease-linear"
                style={{ left: `${highlightX * 100}%` }}
              />
              <div
                className="absolute w-3.5 h-3.5 rounded-full bg-fuchsia-500 shadow-[0_0_8px_rgba(217,70,239,0.8)] border-2 border-white pointer-events-none -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-100 ease-linear"
                style={{ left: `${highlightX * 100}%`, top: `${highlightY * 100}%` }}
              />
            </div>
            <p className="text-center text-xs text-white/50 mt-1.5">第 {currentPage + 1} / {pages.length} 页</p>

            <div className="mt-3 rounded-xl bg-white/5 text-white px-4 py-3 space-y-2.5">
              <div className="flex items-center gap-3">
                <button onClick={togglePlay} className="w-9 h-9 rounded-full bg-fuchsia-500 flex items-center justify-center shrink-0 hover:opacity-90">
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                </button>
                <span className="text-xs tabular-nums text-white/70 shrink-0">{formatTime(currentTime)}</span>

                <div ref={seekBarRef} onClick={handleSeekBarClick} className="relative flex-1 h-2 bg-white/15 rounded-full cursor-pointer">
                  <div className="absolute inset-y-0 left-0 bg-fuchsia-500 rounded-full" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
                  {loopRange && duration > 0 && (
                    <>
                      <div
                        className="absolute inset-y-0 bg-amber-400/30 rounded-full pointer-events-none"
                        style={{ left: `${(loopRange.start / duration) * 100}%`, right: `${100 - (loopRange.end / duration) * 100}%` }}
                      />
                      <div
                        onMouseDown={(e) => { e.stopPropagation(); setDraggingHandle("start"); }}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-amber-400 border-2 border-white cursor-ew-resize"
                        style={{ left: `${(loopRange.start / duration) * 100}%` }}
                      />
                      <div
                        onMouseDown={(e) => { e.stopPropagation(); setDraggingHandle("end"); }}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-amber-400 border-2 border-white cursor-ew-resize"
                        style={{ left: `${(loopRange.end / duration) * 100}%` }}
                      />
                    </>
                  )}
                </div>
                <span className="text-xs tabular-nums text-white/70 shrink-0">{formatTime(duration)}</span>
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <button
                  onClick={toggleLoop}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    loopRange ? "bg-amber-400 text-black" : "bg-white/10 text-white/80 hover:bg-white/20"
                  }`}
                >
                  <Repeat className="w-3.5 h-3.5" />
                  {loopRange ? `循环 ${formatTime(loopRange.start)}–${formatTime(loopRange.end)}` : "圈选循环"}
                </button>

                <div className="flex items-center gap-2">
                  <div className="relative">
                    <button
                      onClick={() => { setShowSpeedMenu((v) => !v); setShowTransposeMenu(false); }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-white/10 text-white/80 hover:bg-white/20"
                    >
                      <Gauge className="w-3.5 h-3.5" />{currentBpm} BPM
                    </button>
                    {showSpeedMenu && (
                      <div className="absolute bottom-full right-0 mb-1 bg-[#1a1d24] rounded-lg shadow-lg z-10 p-3 w-64">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-white/60">播放速度（原速 {originalBpm} BPM）</span>
                          <span className="text-sm font-semibold text-fuchsia-400 tabular-nums">{currentBpm} BPM</span>
                        </div>
                        <div className="flex items-center gap-2 mb-3">
                          <button onClick={() => nudgeBpm(-1)} className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 text-white text-sm flex items-center justify-center shrink-0">−</button>
                          <input
                            type="range" min={bpmSliderMin} max={bpmSliderMax} step={1} value={currentBpm}
                            onChange={(e) => setBpm(+e.target.value)}
                            className="flex-1 accent-fuchsia-500"
                          />
                          <button onClick={() => nudgeBpm(1)} className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 text-white text-sm flex items-center justify-center shrink-0">+</button>
                        </div>
                        <div className="flex items-center gap-1 flex-wrap">
                          <button
                            onClick={() => setPlaybackRate(1)}
                            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                              currentBpm === originalBpm ? "bg-fuchsia-500 text-white" : "bg-white/10 text-white/70 hover:bg-white/20"
                            }`}
                          >
                            原速 {originalBpm}
                          </button>
                          {BPM_PRESETS.map((bpm) => (
                            <button
                              key={bpm} onClick={() => setBpm(bpm)}
                              disabled={bpm < bpmSliderMin || bpm > bpmSliderMax}
                              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                                currentBpm === bpm ? "bg-fuchsia-500 text-white" : "bg-white/10 text-white/70 hover:bg-white/20"
                              }`}
                            >
                              {bpm}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <button
                      onClick={() => { setShowTransposeMenu((v) => !v); setShowSpeedMenu(false); }}
                      disabled={!workletReady}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-white/10 text-white/80 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
                      title={workletReady ? undefined : "变调功能加载中或初始化失败"}
                    >
                      <Music3 className="w-3.5 h-3.5" />{transposeCents === 0 ? "原调" : formatSemitones(transposeCents)}
                    </button>
                    {showTransposeMenu && (
                      <div className="absolute bottom-full right-0 mb-1 bg-[#1a1d24] rounded-lg shadow-lg z-10 p-3 w-64">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs text-white/60">转调（音高变，速度不变）</span>
                          <span className="text-sm font-semibold text-fuchsia-400 tabular-nums">{transposeCents === 0 ? "原调" : formatSemitones(transposeCents)}</span>
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                          <button onClick={() => nudgeTranspose(-100)} className="px-2 h-6 rounded bg-white/10 hover:bg-white/20 text-white text-[11px] flex items-center justify-center shrink-0">−半音</button>
                          <input
                            type="range" min={TRANSPOSE_MIN_CENTS} max={TRANSPOSE_MAX_CENTS} step={1} value={transposeCents}
                            onChange={(e) => setTransposeCents(+e.target.value)}
                            className="flex-1 accent-fuchsia-500"
                          />
                          <button onClick={() => nudgeTranspose(100)} className="px-2 h-6 rounded bg-white/10 hover:bg-white/20 text-white text-[11px] flex items-center justify-center shrink-0">+半音</button>
                        </div>
                        <div className="flex items-center gap-2 mb-3">
                          <button onClick={() => nudgeTranspose(-1)} className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 text-white text-sm flex items-center justify-center shrink-0">−</button>
                          <span className="flex-1 text-center text-[11px] text-white/50 tabular-nums">{transposeCents} cent 精细微调</span>
                          <button onClick={() => nudgeTranspose(1)} className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 text-white text-sm flex items-center justify-center shrink-0">+</button>
                        </div>
                        <button
                          onClick={() => setTransposeCents(0)}
                          className={`w-full px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                            transposeCents === 0 ? "bg-fuchsia-500 text-white" : "bg-white/10 text-white/70 hover:bg-white/20"
                          }`}
                        >
                          原调（还原）
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <audio
              ref={audioRef} src={audioUrl} crossOrigin="anonymous"
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={(e) => { setDuration(e.currentTarget.duration); e.currentTarget.playbackRate = playbackRate; }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              className="hidden"
            />
          </div>
        )}
      </div>
    </div>
  );
}
