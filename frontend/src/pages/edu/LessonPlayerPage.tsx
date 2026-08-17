// frontend/src/pages/edu/LessonPlayerPage.tsx
//
// Self Guided Learning 第三层——真正播放一课的内容，按 step_type 分流：
//   video -> VideoPlayer
//   ppt   -> PptReader（支持多页——lesson_steps 有 slide_urls 就按顺序
//            翻页显示，没有就把 media_url 当成唯一一页，向后兼容旧数据）
//   level -> 跳转到现有的关卡游玩页面（沿用你项目已有的关卡播放器，不
//            在这里重新做一个游戏播放器）

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { selfGuidedApi, lessonsApi, mediaProgressApi, examApi } from "@/api";
import { Button } from "@/components/ui/button";
import { VideoPlayer } from "@/components/VideoPlayer";
import { PptReader } from "@/components/PptReader";
import {
  MultipleChoiceQuestion, FillBlankQuestion, ColoringQuestion, SudokuQuestion, StickerGameQuestion,
} from "./ExamTakePage";
import type { ColoringConfig } from "@/lib/coloringShapes";

interface Step {
  id: string; order_index: number; step_type: "video" | "ppt" | "level" | "quiz";
  media_url?: string; media_title?: string; slide_urls?: string[];
  course_level_id?: string; level_title_i18n?: Record<string, string>; module_type?: string;
  bank_question_id?: string; bank_category?: string; bank_question_type?: string; bank_question_preview?: string;
}

interface Lesson {
  id: string; course_id: string; title_i18n: Record<string, string>; order_index: number; steps: Step[];
}

// quiz 步骤——取去答案版题目、渲染、提交判分，判分结果通过
// mediaProgressApi 持久化(跟video/ppt的进度记录走同一张表edu.
// media_progress，media_type改成"quiz")。判分只返回对不对，不返回
// 正确答案本身——这里没有"查看正确答案"这个功能，跟考试系统学生端
// 一样，答案永远在服务器手上。
function QuizStep({ step, onProgress }: { step: Step; onProgress: (isCorrect: boolean) => void }) {
  const [question, setQuestion] = useState<{ id: string; category: string; question_type: string; config: Record<string, unknown> } | null>(null);
  const [answer, setAnswer] = useState<unknown>(undefined);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!step.bank_question_id) return;
    setLoading(true); setQuestion(null); setAnswer(undefined); setResult(null);
    examApi.playBankQuestion(step.bank_question_id).then(setQuestion).finally(() => setLoading(false));
  }, [step.bank_question_id]);

  async function handleCheck() {
    if (!step.bank_question_id || checking) return;
    setChecking(true);
    try {
      const r = await examApi.checkBankQuestion(step.bank_question_id, answer);
      setResult(r.is_correct);
      onProgress(r.is_correct);
    } finally {
      setChecking(false);
    }
  }

  if (!step.bank_question_id) {
    return <p className="text-center text-muted-foreground py-12">这道题已经从题库删除了，请联系老师重新选一道</p>;
  }
  if (loading) return <p className="text-center text-muted-foreground py-12">加载中...</p>;
  if (!question) return <p className="text-center text-muted-foreground py-12">这道题已经从题库删除了，请联系老师重新选一道</p>;

  return (
    <div className="rounded-2xl bg-white border border-border shadow-sm p-5 space-y-4">
      {question.question_type === "multiple_choice"
        ? <MultipleChoiceQuestion config={question.config} value={answer as string[] | undefined} onChange={setAnswer} />
        : question.question_type === "fill_blank"
        ? <FillBlankQuestion config={question.config} value={answer as string[] | undefined} onChange={setAnswer} />
        : question.question_type === "coloring"
        ? <ColoringQuestion config={question.config as unknown as ColoringConfig} value={answer as Record<string, string> | undefined} onChange={setAnswer} />
        : question.question_type === "sudoku"
        ? <SudokuQuestion config={question.config} value={answer as Record<string, string> | undefined} onChange={setAnswer} />
        : <StickerGameQuestion config={question.config} value={answer as Record<string, string> | undefined} onChange={setAnswer} />}

      {result === null ? (
        <div className="flex justify-center pt-2">
          <Button onClick={handleCheck} disabled={checking || answer === undefined}>{checking ? "提交中..." : "✅ 提交答案"}</Button>
        </div>
      ) : (
        <p className={`text-center font-semibold ${result ? "text-emerald-600" : "text-red-600"}`}>{result ? "🎉 答对了！" : "✗ 答错了，继续加油"}</p>
      )}
    </div>
  );
}

export default function LessonPlayerPage() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // 预览模式——课程设计师用"试玩课时"进来的，跳过学生端订阅校验(用
  // courses.manage权限校验的设计师视角接口)，进度也不上报，不污染真实
  // 学生的学习记录。跟考试系统"试玩预览不写入exam_attempts"是同一个
  // 原则。之前"试玩课时"链接直接指向学生专用的 selfGuidedApi.getLesson，
  // 设计师账号没有订阅记录，一进来就被后端的订阅校验拦成403——这就是
  // 之前"视频上传成功但播不出来"报错的真正原因，根本没走到播放视频那
  // 一步，是页面本身先被403拦住了。
  const isPreview = searchParams.get("preview") === "true";
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!lessonId) return;
    const loader = isPreview ? lessonsApi.getLesson(lessonId) : selfGuidedApi.getLesson(lessonId);
    loader.then(setLesson);
  }, [lessonId, isPreview]);

  const step = lesson?.steps[stepIndex];
  const isLastStep = lesson ? stepIndex >= lesson.steps.length - 1 : true;

  const handleVideoProgress = useCallback((s: Step, secondsWatched: number, durationSeconds: number, completed: boolean) => {
  if (isPreview) return; // 试玩预览不上报进度，不污染真实学生的学习记录
  mediaProgressApi.submit({
    lesson_step_id: s.id, media_type: "video",
    seconds_watched: secondsWatched, duration_seconds: durationSeconds, completed,
  }).catch(() => {});
}, [isPreview]);

  const handlePptProgress = useCallback((s: Step, index: number, total: number, completed: boolean) => {
  if (isPreview) return;
  mediaProgressApi.submit({
    lesson_step_id: s.id, media_type: "ppt",
    last_slide_index: index, total_slides: total, completed,
  }).catch(() => {});
}, [isPreview]);

  const handleQuizProgress = useCallback((s: Step, isCorrect: boolean) => {
  if (isPreview) return;
  mediaProgressApi.submit({
    lesson_step_id: s.id, media_type: "quiz",
    is_correct: isCorrect, marks_earned: isCorrect ? 1 : 0, marks_total: 1, completed: true,
  }).catch(() => {});
}, [isPreview]);

  function goNext() {
    if (!lesson) return;
    if (isLastStep) {
      // 预览模式没有"回到自学课程列表"这回事(那也是学生端订阅校验的
      // 页面)，直接关掉这个试玩标签页，跟考试系统试玩预览完事后
      // window.close()是同一个模式。
      if (isPreview) { window.close(); return; }
      navigate(`/self-guided/courses/${lesson.course_id}`);
      return;
    }
    setStepIndex((i) => i + 1);
  }

  function goPrev() {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  if (!lesson || !step) {
    return <div className="max-w-3xl mx-auto py-12 text-center text-muted-foreground">加载中...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">
      {isPreview && (
        <div className="sticky top-0 z-10 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 flex items-center gap-2 text-sm text-amber-800">
          <span className="font-semibold">🧪 试玩预览模式</span>
          <span className="text-xs text-amber-700">不计入任何真实学习记录，仅供测试课时内容</span>
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold tracking-tight">{lesson.title_i18n?.zh ?? lesson.title_i18n?.en}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">步骤 {stepIndex + 1} / {lesson.steps.length}</p>
      </div>

      <div className="min-h-[300px]">
        {step.step_type === "video" && step.media_url && (
          <VideoPlayer src={step.media_url} title={step.media_title} onProgress={(sec, dur, completed) => handleVideoProgress(step, sec, dur, completed)} />
        )}

        {step.step_type === "ppt" && step.media_url && (
          // 有 slide_urls 就是多页讲义，按顺序翻页；没有(旧数据，或者
          // 手动贴的外部链接没走AssetPicker上传转换)就当单页显示，向后
          // 兼容不会因为缺这个字段而空白/报错。
          <PptReader
            slideUrls={step.slide_urls && step.slide_urls.length > 0 ? step.slide_urls : [step.media_url]}
            title={step.media_title} onProgress={(idx, total, completed) => handlePptProgress(step, idx, total, completed)}
          />
        )}

        {step.step_type === "level" && step.course_level_id && (
          <div className="text-center space-y-4 py-12">
            <p className="text-lg font-medium">🎮 {step.level_title_i18n?.zh ?? step.level_title_i18n?.en ?? "游戏练习"}</p>
            <Button onClick={() => navigate(`/levels/${step.course_level_id}/play`)}>开始游戏</Button>
            <p className="text-xs text-muted-foreground">完成游戏后返回这里，点"下一步"继续这一课</p>
          </div>
        )}

        {step.step_type === "quiz" && (
          <QuizStep key={step.id} step={step} onProgress={(isCorrect) => handleQuizProgress(step, isCorrect)} />
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={stepIndex === 0} onClick={goPrev}>上一步</Button>
        <Button onClick={goNext}>{isLastStep ? (isPreview ? "完成试玩（关闭标签页）" : "完成这一课") : "下一步"}</Button>
      </div>
    </div>
  );
}
