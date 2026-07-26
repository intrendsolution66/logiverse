// frontend/src/pages/edu/LessonPlayerPage.tsx
//
// Steps a student through a 课时/教案 in order: video/PPT steps just show
// the embed with a "下一步" button (no scoring), level steps mount the same
// game engine LevelPlayerPage would (same module_type switch — duplicated
// here rather than extracted into a shared component, a deliberate small
// trade-off: each game engine is already a clean, independent export, so
// repeating this ~10-line switch is cheaper than a premature shared-wrapper
// abstraction). Completing a level step submits progress AND auto-advances,
// same as a bare level does today — a lesson doesn't change how playing a
// level works, it just sequences several of them (plus media) together.

import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { eduApi, lessonsApi } from "@/api/index";
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

type AnyResult = CountingResult | SpotDiffResult | FocusTapResult | MemoryResult | PatternResult | WordProblemResult | MazeResult | SudokuResult | LineMatchResult | ColoringResult;

interface LevelStepPlayerProps { levelId: string; onDone: () => void }

function LevelStepPlayer({ levelId, onDone }: LevelStepPlayerProps) {
  const [level, setLevel] = useState<{
    id: string; module_type: string; config: Record<string, unknown>;
    explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);

  useEffect(() => {
    setLoading(true); setDone(false);
    eduApi.getLevel(levelId).then(setLevel).catch(() => toast.error("Activity 加载失败")).finally(() => setLoading(false));
  }, [levelId]);

  async function handleComplete(r: AnyResult) {
    if (!level) return;
    try {
      await eduApi.submitProgress(levelId, {
        module_type: level.module_type, score: r.score, max_score: r.max_score,
        time_spent_seconds: r.time_spent_seconds, mistakes: r.mistakes, completed: r.completed,
      });
    } catch { /* non-fatal — still let them move on */ }
    // pause here instead of auto-advancing — if there's an explanation
    // authored for this level, the student should get a chance to see it
    // before the lesson sweeps them into the next step
    setDone(true);
  }

  if (loading) return <div className="p-6 text-center text-muted-foreground">加载中...</div>;
  if (!level) return <div className="p-6 text-center text-muted-foreground">找不到这个 Activity</div>;

  if (done) {
    return (
      <div className="text-center py-10 space-y-4">
        <div className="text-5xl">✅</div>
        <p className="text-lg font-semibold">这一步完成了</p>
        <div className="space-x-3">
          {(level.explanation_text || level.explanation_image_url || level.explanation_video_url) && (
            <Button variant="outline" onClick={() => setShowExplanation(true)}>📖 查看讲解</Button>
          )}
          <Button onClick={onDone}>下一步</Button>
        </div>
        <Modal open={showExplanation} onClose={() => setShowExplanation(false)} title="讲解" size="md">
          <div className="space-y-3">
            {level.explanation_video_url && <video src={level.explanation_video_url} controls loop className="w-full rounded-lg bg-black" />}
            {level.explanation_image_url && <img src={level.explanation_image_url} alt="讲解图" className="w-full rounded-lg border border-border" />}
            {level.explanation_text && <p className="text-sm leading-relaxed whitespace-pre-wrap">{level.explanation_text}</p>}
          </div>
        </Modal>
      </div>
    );
  }

  switch (level.module_type) {
    case "counting": return <CountingGame config={level.config as unknown as CountingConfig} onComplete={handleComplete} />;
    case "spot_diff": return <SpotDiffGame config={level.config as unknown as SpotDiffConfig} onComplete={handleComplete} />;
    case "focus_tap": return <FocusTapGame config={level.config as unknown as FocusTapConfig} onComplete={handleComplete} />;
    case "memory": return <MemoryGame config={level.config as unknown as MemoryConfig} onComplete={handleComplete} />;
    case "pattern": return <PatternGame config={level.config as unknown as PatternConfig} onComplete={handleComplete} />;
    case "word_problem": return <WordProblemGame levelId={level.id} config={level.config as unknown as WordProblemConfig} onComplete={handleComplete} />;
    case "maze": return <MazeGame config={level.config as unknown as MazeConfig} onComplete={handleComplete} />;
    case "sudoku": return <SudokuGame levelId={level.id} config={level.config as unknown as SudokuConfig} onComplete={handleComplete} />;
    case "line_match": return <LineMatchGame levelId={level.id} config={level.config as unknown as LineMatchConfig} onComplete={handleComplete} />;
    case "coloring": return <ColoringGame levelId={level.id} config={level.config as unknown as ColoringConfig} onComplete={handleComplete} />;
    default: return <div className="text-center text-muted-foreground p-6">这个模块类型（{level.module_type}）还没有对应的引擎组件。</div>;
  }
}

export default function LessonPlayerPage() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const [lesson, setLesson] = useState<Awaited<ReturnType<typeof lessonsApi.getLesson>> | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!lessonId) return;
    lessonsApi.getLesson(lessonId).then(setLesson).catch(() => toast.error("课时加载失败")).finally(() => setLoading(false));
  }, [lessonId]);

  if (loading) return <div className="p-6 text-center text-muted-foreground">加载中...</div>;
  if (!lesson) return <div className="p-6 text-center text-muted-foreground">找不到这个课时</div>;

  const step = lesson.steps[stepIndex];
  const isLast = stepIndex === lesson.steps.length - 1;

  function goNext() {
    if (isLast) { toast.success("这个课时完成了！"); navigate("/home"); return; }
    setStepIndex((i) => i + 1);
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{lesson.title_i18n?.zh ?? lesson.title_i18n?.en}</h1>
          <p className="text-sm text-muted-foreground">第 {stepIndex + 1} / {lesson.steps.length} 步</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/home")}>退出</Button>
      </div>

      {!step ? (
        <div className="text-center text-muted-foreground p-6">这个课时还没有任何步骤</div>
      ) : step.step_type === "level" && step.course_level_id ? (
        <LevelStepPlayer key={step.id} levelId={step.course_level_id} onDone={goNext} />
      ) : (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-center">{step.media_title || (step.step_type === "video" ? "视频" : "PPT")}</h2>
          {step.step_type === "video" ? (
            <video src={step.media_url} controls className="w-full rounded-2xl bg-black" />
          ) : (
            <iframe src={step.media_url} className="w-full aspect-video rounded-2xl border border-border" title={step.media_title || "PPT"} />
          )}
          <Button className="block mx-auto" onClick={goNext}>{isLast ? "完成课时" : "下一步"}</Button>
        </div>
      )}
    </div>
  );
}
