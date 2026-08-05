// frontend/src/pages/edu/LevelPlayerPage.tsx
//
// 视觉上跟后台管理页面用同一套配色（青蓝主色调、圆角卡片），但保持全屏
// 沉浸式布局，不套 AdminLayout 侧边栏——游戏/视频播放需要专注，侧边栏
// 导航会打断学习节奏。
//
// 顺便修了一个之前发现的bug：KNOWN_MODULES 之前没包含 ppt_lecture /
// video_lecture，导致从 /play/:id 直接打开视频/PPT讲义类型的Activity会
// 显示"还没有对应引擎"。现在补上，复用 Discovery 那边已经写好的
// VideoPlayer / PptReader 组件，不用重新做播放器。

import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { eduApi } from "@/api";
import CountingGame, { type CountingConfig, type CountingResult } from "@/games/CountingGame";
import SpotDiffGame, { type SpotDiffConfig, type SpotDiffResult } from "@/games/SpotDiffGame";
import FocusTapGame, { type FocusTapConfig, type FocusTapResult } from "@/games/FocusTapGame";
import MemoryGame, { type MemoryConfig, type MemoryResult } from "@/games/MemoryGame";
import PatternGame, { type PatternConfig, type PatternResult } from "@/games/PatternGame";
import WordProblemGame, { type WordProblemConfig, type WordProblemResult } from "@/games/WordProblemGame";
import MazeGame, { type MazeConfig, type MazeResult } from "@/games/MazeGame";
import NumberMazeGame, { type NumberMazeConfig, type NumberMazeResult } from "@/games/NumberMazeGame";
import SudokuGame, { type SudokuConfig, type SudokuResult } from "@/games/SudokuGame";
import LineMatchGame, { type LineMatchConfig, type LineMatchResult } from "@/games/LineMatchGame";
import ColoringGame, { type ColoringConfig, type ColoringResult } from "@/games/ColoringGame";
import StickerGame, { type StickerGameConfig, type StickerGameResult } from "@/games/StickerGame";
import { VideoPlayer } from "@/components/VideoPlayer";
import { PptReader } from "@/components/PptReader";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

type GameResult = CountingResult | SpotDiffResult | FocusTapResult | MemoryResult | PatternResult | WordProblemResult | MazeResult | NumberMazeResult | SudokuResult | LineMatchResult | ColoringResult | StickerGameResult;

export default function LevelPlayerPage() {
  const { levelId } = useParams<{ levelId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // "试玩"现在是同一个分页内跳转过来的（课程设计器那边已经拿掉了
  // target="_blank"），所以真的有"上一页"能退——直接用浏览器历史返回，
  // 会自然带回点"试玩"之前的那个网址（比如 /course-designer?type=maze，
  // 设计器那边把第二层状态记在网址上了，退回去状态也跟着还原，不用
  // 这里额外传参数）。history.length<=1 这种情况（比如有人直接把这个
  // 播放链接分享出去、没有从站内导航过来）没有上一页可退，才退回首页
  // 兜底——跟 PptViewerPage/VideoViewerPage 那几个播放页是同一个逻辑。
  function goBack() {
    if (window.history.length > 1) { navigate(-1); return; }
    navigate("/home");
  }
  const cameFromDesigner = searchParams.get("from") === "designer";
  const [level, setLevel] = useState<{
    module_type: string; title_i18n?: Record<string,string>; config: Record<string, unknown>;
    explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
    hint_text?: string; audio_url?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<GameResult | null>(null);
  const [lectureDone, setLectureDone] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function toggleAudio() {
    const el = audioRef.current;
    if (!el) return;
    if (audioPlaying) { el.pause(); } else { el.currentTime = 0; el.play(); }
  }

  useEffect(() => {
    if (!levelId) return;
    eduApi.getLevel(levelId)
      .then(setLevel)
      .catch(() => toast.error("Activity 加载失败"))
      .finally(() => setLoading(false));
  }, [levelId]);

  async function handleComplete(r: GameResult) {
    setResult(r);
    if (!levelId || !level) return;
    try {
      await eduApi.submitProgress(levelId, {
        module_type: level.module_type, score: r.score, max_score: r.max_score,
        time_spent_seconds: r.time_spent_seconds, mistakes: r.mistakes, completed: r.completed,
      });
      toast.success("成绩已记录！");
    } catch { toast.error("成绩记录失败（网络问题），可以再试一次"); }
  }

  async function handleLectureProgress(secondsWatchedOrIndex: number, durationOrTotal: number, completed: boolean) {
    if (!levelId || !level) return;
    if (completed && !lectureDone) {
      setLectureDone(true);
      try {
        await eduApi.submitProgress(levelId, {
          module_type: level.module_type, score: 0, max_score: 0,
          time_spent_seconds: level.module_type === "video_lecture" ? secondsWatchedOrIndex : 0,
          mistakes: 0, completed: true,
        });
      } catch { /* 讲义类进度记录失败不打断观看体验，静默忽略 */ }
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">加载中...</div>;
  if (!level) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">找不到这个 Activity</div>;

  const KNOWN_GAME_MODULES = ["counting", "spot_diff", "focus_tap", "memory", "pattern", "word_problem", "maze", "number_maze", "sudoku", "line_match", "coloring", "sticker_game"];
  const isLecture = level.module_type === "video_lecture" || level.module_type === "ppt_lecture";
  const isKnown = KNOWN_GAME_MODULES.includes(level.module_type) || isLecture;
  const config = level.config as { video_url?: string; slide_image_urls?: string[] };

  return (
    <div className="min-h-screen bg-[#F4F6FA]">
      <div className="max-w-6xl w-full mx-auto px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-[#0B1526]">{level.title_i18n?.zh ?? level.title_i18n?.en ?? "Activity"}</h1>
          <Button variant="ghost" size="sm" onClick={goBack}>{cameFromDesigner ? "← 返回设计器" : "返回"}</Button>
        </div>

        {/* 提示栏 */}
        {(level.hint_text || level.audio_url) && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-teal-100 bg-teal-50 px-4 py-2.5">
            {level.audio_url && (
              <>
                <button
                  type="button" onClick={toggleAudio}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-teal-500 to-blue-600 text-white text-sm font-medium transition-opacity hover:opacity-90"
                >
                  {audioPlaying ? "⏸️ 暂停" : "🔊 听题目"}
                </button>
                <audio ref={audioRef} src={level.audio_url} onPlay={() => setAudioPlaying(true)} onPause={() => setAudioPlaying(false)} onEnded={() => setAudioPlaying(false)} className="hidden" />
              </>
            )}
            {level.hint_text && <p className="text-sm text-teal-900">💡 {level.hint_text}</p>}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-border p-6">
          {level.module_type === "counting" && <CountingGame config={level.config as unknown as CountingConfig} onComplete={handleComplete} />}
          {level.module_type === "spot_diff" && <SpotDiffGame config={level.config as unknown as SpotDiffConfig} onComplete={handleComplete} />}
          {level.module_type === "focus_tap" && <FocusTapGame config={level.config as unknown as FocusTapConfig} onComplete={handleComplete} />}
          {level.module_type === "memory" && <MemoryGame config={level.config as unknown as MemoryConfig} onComplete={handleComplete} />}
          {level.module_type === "pattern" && <PatternGame config={level.config as unknown as PatternConfig} onComplete={handleComplete} />}
          {level.module_type === "word_problem" && levelId && <WordProblemGame levelId={levelId} config={level.config as unknown as WordProblemConfig} onComplete={handleComplete} />}
          {level.module_type === "maze" && <MazeGame config={level.config as unknown as MazeConfig} onComplete={handleComplete} />}
          {level.module_type === "number_maze" && <NumberMazeGame config={level.config as unknown as NumberMazeConfig} onComplete={handleComplete} />}
          {level.module_type === "sudoku" && levelId && <SudokuGame levelId={levelId} config={level.config as unknown as SudokuConfig} onComplete={handleComplete} />}
          {level.module_type === "line_match" && levelId && <LineMatchGame levelId={levelId} config={level.config as unknown as LineMatchConfig} onComplete={handleComplete} />}
          {level.module_type === "coloring" && levelId && <ColoringGame levelId={levelId} config={level.config as unknown as ColoringConfig} onComplete={handleComplete} />}
          {level.module_type === "sticker_game" && <StickerGame config={level.config as unknown as StickerGameConfig} onComplete={handleComplete} />}

          {level.module_type === "video_lecture" && (
            <VideoPlayer src={config.video_url ?? ""} onProgress={(sec, dur, completed) => handleLectureProgress(sec, dur, completed)} />
          )}
          {level.module_type === "ppt_lecture" && (
            <PptReader slideUrls={config.slide_image_urls ?? []} onProgress={(idx, total, completed) => handleLectureProgress(idx, total, completed)} />
          )}

          {!isKnown && (
            <div className="text-center text-muted-foreground p-6">
              这个模块类型（{level.module_type}）还没有对应的引擎组件——Phase 2 会陆续补上。
            </div>
          )}
        </div>

        {(result || (isLecture && lectureDone)) && (
          <div className="mt-4 text-center space-x-3">
            {(level.explanation_text || level.explanation_image_url || level.explanation_video_url) && (
              <Button variant="outline" onClick={() => setShowExplanation(true)}>📖 查看讲解</Button>
            )}
            <Button onClick={goBack}>{cameFromDesigner ? "← 返回设计器" : "回首页"}</Button>
          </div>
        )}

        <Modal open={showExplanation} onClose={() => setShowExplanation(false)} title="讲解" size="md">
          <div className="space-y-3">
            {level.explanation_video_url && <video src={level.explanation_video_url} controls loop className="w-full rounded-lg bg-black" />}
            {level.explanation_image_url && <img src={level.explanation_image_url} alt="讲解图" className="w-full rounded-lg border border-border" />}
            {level.explanation_text && <p className="text-sm leading-relaxed whitespace-pre-wrap">{level.explanation_text}</p>}
          </div>
        </Modal>
      </div>
    </div>
  );
}
