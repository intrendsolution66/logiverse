// frontend/src/pages/edu/LessonPlayerPage.tsx
//
// Self Guided Learning 第三层——真正播放一课的内容，按 step_type 分流：
//   video -> VideoPlayer
//   ppt   -> PptReader（这里的 media_url 假设已经是"第一页图片URL"，
//            如果 lesson_steps 的 ppt 步骤要支持多页翻页，需要额外存一个
//            slide_urls 数组字段到 lesson_steps 表——目前这张表只有单个
//            media_url，是"一课里插入一个视频/一份讲义"的最简形态，多页
//            PPT讲义如果要在Lesson里也能翻页，需要照着 assets.slide_urls
//            的思路给 lesson_steps 也加一列，这个我们可以按需要再补）
//   level -> 跳转到现有的关卡游玩页面（沿用你项目已有的关卡播放器，不
//            在这里重新做一个游戏播放器）

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { selfGuidedApi, mediaProgressApi } from "@/api";
import { Button } from "@/components/ui/button";
import { VideoPlayer } from "@/components/VideoPlayer";
import { PptReader } from "@/components/PptReader";

interface Step {
  id: string; order_index: number; step_type: "video" | "ppt" | "level";
  media_url?: string; media_title?: string;
  course_level_id?: string; level_title_i18n?: Record<string, string>; module_type?: string;
}

interface Lesson {
  id: string; course_id: string; title_i18n: Record<string, string>; order_index: number; steps: Step[];
}

export default function LessonPlayerPage() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!lessonId) return;
    selfGuidedApi.getLesson(lessonId).then(setLesson);
  }, [lessonId]);

  const step = lesson?.steps[stepIndex];
  const isLastStep = lesson ? stepIndex >= lesson.steps.length - 1 : true;

  const handleVideoProgress = useCallback((s: Step, secondsWatched: number, durationSeconds: number, completed: boolean) => {
  mediaProgressApi.submit({
    lesson_step_id: s.id, media_type: "video",
    seconds_watched: secondsWatched, duration_seconds: durationSeconds, completed,
  }).catch(() => {});
}, []);

  const handlePptProgress = useCallback((s: Step, index: number, total: number, completed: boolean) => {
  mediaProgressApi.submit({
    lesson_step_id: s.id, media_type: "ppt",
    last_slide_index: index, total_slides: total, completed,
  }).catch(() => {});
}, []);

  function goNext() {
    if (!lesson) return;
    if (isLastStep) { navigate(`/self-guided/courses/${lesson.course_id}`); return; }
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
      <div>
        <h1 className="text-xl font-bold tracking-tight">{lesson.title_i18n?.zh ?? lesson.title_i18n?.en}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">步骤 {stepIndex + 1} / {lesson.steps.length}</p>
      </div>

      <div className="min-h-[300px]">
        {step.step_type === "video" && step.media_url && (
          <VideoPlayer src={step.media_url} title={step.media_title} onProgress={(sec, dur, completed) => handleVideoProgress(step, sec, dur, completed)} />
        )}

        {step.step_type === "ppt" && step.media_url && (
          // 目前 lesson_steps 只存单张 media_url——先当作单页讲义显示。
          // 如需要多页翻页，需要给 lesson_steps 也加 slide_urls 字段。
          <PptReader slideUrls={[step.media_url]} title={step.media_title} onProgress={(idx, total, completed) => handlePptProgress(step, idx, total, completed)} />
        )}

        {step.step_type === "level" && step.course_level_id && (
          <div className="text-center space-y-4 py-12">
            <p className="text-lg font-medium">🎮 {step.level_title_i18n?.zh ?? step.level_title_i18n?.en ?? "游戏练习"}</p>
            <Button onClick={() => navigate(`/levels/${step.course_level_id}/play`)}>开始游戏</Button>
            <p className="text-xs text-muted-foreground">完成游戏后返回这里，点"下一步"继续这一课</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={stepIndex === 0} onClick={goPrev}>上一步</Button>
        <Button onClick={goNext}>{isLastStep ? "完成这一课" : "下一步"}</Button>
      </div>
    </div>
  );
}
