// frontend/src/pages/edu/LevelPlayerPage.tsx
//
// The "习题播放器" from the architecture doc's Phase 1 plan — this is the
// shell every module plugs into. It fetches a level, looks at its
// module_type, and mounts the matching engine component. Right now there's
// only one branch (counting); adding a new module in Phase 2 means adding
// one more `if (level.module_type === '...')` branch here and dropping the
// new engine component into src/games/ — this file doesn't otherwise change.

import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { eduApi } from "@/api/index";
import CountingGame, { type CountingConfig, type CountingResult } from "@/games/CountingGame";
import SpotDiffGame, { type SpotDiffConfig, type SpotDiffResult } from "@/games/SpotDiffGame";
import FocusTapGame, { type FocusTapConfig, type FocusTapResult } from "@/games/FocusTapGame";
import MemoryGame, { type MemoryConfig, type MemoryResult } from "@/games/MemoryGame";
import PatternGame, { type PatternConfig, type PatternResult } from "@/games/PatternGame";
import WordProblemGame, { type WordProblemConfig, type WordProblemResult } from "@/games/WordProblemGame";
import MazeGame, { type MazeConfig, type MazeResult } from "@/games/MazeGame";
import SudokuGame, { type SudokuConfig, type SudokuResult } from "@/games/SudokuGame";
import LineMatchGame, { type LineMatchConfig, type LineMatchResult } from "@/games/LineMatchGame";
import ColoringGame, { type ColoringConfig, type ColoringResult } from "@/games/ColoringGame";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

export default function LevelPlayerPage() {
  const { levelId } = useParams<{ levelId: string }>();
  const navigate = useNavigate();
  const [level, setLevel] = useState<{
    module_type: string; title_i18n?: Record<string,string>; config: Record<string, unknown>;
    explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
    hint_text?: string; audio_url?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<CountingResult | SpotDiffResult | FocusTapResult | MemoryResult | PatternResult | WordProblemResult | MazeResult | SudokuResult | LineMatchResult | ColoringResult | null>(null);
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

  async function handleComplete(r: CountingResult | SpotDiffResult | FocusTapResult | MemoryResult | PatternResult | WordProblemResult | MazeResult | SudokuResult | LineMatchResult | ColoringResult) {
    setResult(r);
    if (!levelId || !level) return;
    try {
      await eduApi.submitProgress(levelId, {
        module_type: level.module_type,
        score: r.score,
        max_score: r.max_score,
        time_spent_seconds: r.time_spent_seconds,
        mistakes: r.mistakes,
        completed: r.completed,
      });
      toast.success("成绩已记录！");
    } catch {
      toast.error("成绩记录失败（网络问题），可以再试一次");
    }
  }

  if (loading) return <div className="p-6 text-center text-muted-foreground">加载中...</div>;
  if (!level) return <div className="p-6 text-center text-muted-foreground">找不到这个 Activity</div>;

  const KNOWN_MODULES = ["counting", "spot_diff", "focus_tap", "memory", "pattern", "word_problem", "maze", "sudoku", "line_match", "coloring"];

  return (
    <div className="max-w-6xl w-full mx-auto px-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">{level.title_i18n?.zh ?? level.title_i18n?.en ?? "Activity"}</h1>
        <Button variant="ghost" size="sm" onClick={() => navigate("/home")}>返回</Button>
      </div>

      {/* 提示栏 — every game gets this, rendered once here rather than in
          each of the 7 engine components, so "每个游戏都要有一个提示栏" is
          true by construction instead of needing to be remembered per
          module. Persistent during play (unlike 讲解, which only shows
          after completion). */}
      {(level.hint_text || level.audio_url) && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 px-4 py-2.5">
          {level.audio_url && (
            <>
              <button
                type="button" onClick={toggleAudio}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-400 hover:bg-amber-500 text-amber-950 text-sm font-medium transition-colors"
              >
                {audioPlaying ? "⏸️ 暂停" : "🔊 听题目"}
              </button>
              <audio
                ref={audioRef} src={level.audio_url}
                onPlay={() => setAudioPlaying(true)}
                onPause={() => setAudioPlaying(false)}
                onEnded={() => setAudioPlaying(false)}
                className="hidden"
              />
            </>
          )}
          {level.hint_text && <p className="text-sm text-amber-900 dark:text-amber-200">💡 {level.hint_text}</p>}
        </div>
      )}

      {level.module_type === "counting" && (
        <CountingGame config={level.config as unknown as CountingConfig} onComplete={handleComplete} />
      )}
      {level.module_type === "spot_diff" && (
        <SpotDiffGame config={level.config as unknown as SpotDiffConfig} onComplete={handleComplete} />
      )}
      {level.module_type === "focus_tap" && (
        <FocusTapGame config={level.config as unknown as FocusTapConfig} onComplete={handleComplete} />
      )}
      {level.module_type === "memory" && (
        <MemoryGame config={level.config as unknown as MemoryConfig} onComplete={handleComplete} />
      )}
      {level.module_type === "pattern" && (
        <PatternGame config={level.config as unknown as PatternConfig} onComplete={handleComplete} />
      )}
      {level.module_type === "word_problem" && levelId && (
        <WordProblemGame levelId={levelId} config={level.config as unknown as WordProblemConfig} onComplete={handleComplete} />
      )}
      {level.module_type === "maze" && (
        <MazeGame config={level.config as unknown as MazeConfig} onComplete={handleComplete} />
      )}
      {level.module_type === "sudoku" && levelId && (
        <SudokuGame levelId={levelId} config={level.config as unknown as SudokuConfig} onComplete={handleComplete} />
      )}
      {level.module_type === "line_match" && levelId && (
        <LineMatchGame levelId={levelId} config={level.config as unknown as LineMatchConfig} onComplete={handleComplete} />
      )}
      {level.module_type === "coloring" && levelId && (
        <ColoringGame levelId={levelId} config={level.config as unknown as ColoringConfig} onComplete={handleComplete} />
      )}
      {!KNOWN_MODULES.includes(level.module_type) && (
        <div className="text-center text-muted-foreground p-6">
          这个模块类型（{level.module_type}）还没有对应的引擎组件——Phase 2 会陆续补上。
        </div>
      )}

      {result && (
        <div className="mt-4 text-center space-x-3">
          {(level.explanation_text || level.explanation_image_url || level.explanation_video_url) && (
            <Button variant="outline" onClick={() => setShowExplanation(true)}>📖 查看讲解</Button>
          )}
          <Button onClick={() => navigate("/home")}>回首页</Button>
        </div>
      )}

      <Modal open={showExplanation} onClose={() => setShowExplanation(false)} title="讲解" size="md">
        <div className="space-y-3">
          {level.explanation_video_url && (
            <video src={level.explanation_video_url} controls loop className="w-full rounded-lg bg-black" />
          )}
          {level.explanation_image_url && (
            <img src={level.explanation_image_url} alt="讲解图" className="w-full rounded-lg border border-border" />
          )}
          {level.explanation_text && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{level.explanation_text}</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
