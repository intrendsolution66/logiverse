// 不受白名单/发布状态/开考截止时间限制(草稿也能试玩)，交卷后立刻在
// 本地算分显示结果，完全不写入 exam_attempts 这张表——不会污染真实的
// 排行榜、不会占用任何学生的重考次数。
//
// 判分逻辑是后端 gradeQuestion() 的前端镜像版本，两边必须保持一致——
// 后端那份改了判分规则，这里也要跟着改，不然预览显示的对错会跟正式
// 作答时不一样。

import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { examApi } from "@/api";
import {
  pickText, MultipleChoiceQuestion, FillBlankQuestion, ColoringQuestion, SudokuQuestion, StickerGameQuestion,
  type TakeQuestion,
} from "./ExamTakePage";
import { ReviewCard, type ReviewQuestion } from "./ExamResultPage";
import type { ColoringConfig } from "@/lib/coloringShapes";

// ── 本地判分——跟后端 gradeQuestion() 一一对应 ────────────────────────────────

function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase();
}

function gradeQuestionLocally(questionType: string, config: Record<string, unknown>, studentAnswer: unknown): boolean {
  if (questionType === "multiple_choice") {
    const correctIds = new Set((config.correct_option_ids as string[]) ?? []);
    const selected = Array.isArray(studentAnswer) ? (studentAnswer as string[]) : [];
    return selected.length === correctIds.size && selected.every((id) => correctIds.has(id));
  }
  if (questionType === "fill_blank") {
    const blanks = (config.blanks as Array<{ accepted_answers: string[] }>) ?? [];
    const values = Array.isArray(studentAnswer) ? (studentAnswer as string[]) : [];
    if (values.length !== blanks.length) return false;
    return blanks.every((b, i) => (b.accepted_answers ?? []).some((a) => normalizeAnswer(a) === normalizeAnswer(String(values[i] ?? ""))));
  }
  if (questionType === "coloring") {
    const regions = (config.regions as Array<{ id: string; colorable: boolean; correct_color?: string }>) ?? [];
    const colorable = regions.filter((r) => r.colorable);
    const submitted = (studentAnswer && typeof studentAnswer === "object" ? studentAnswer : {}) as Record<string, string>;
    if (colorable.length === 0) return false;
    return colorable.every((r) => (submitted[r.id] ?? "").trim().toLowerCase() === (r.correct_color ?? "").trim().toLowerCase());
  }
  if (questionType === "sudoku") {
    const blankCells = (config.blank_cells as Array<{ row: number; col: number; answer: string }>) ?? [];
    const submitted = (studentAnswer && typeof studentAnswer === "object" ? studentAnswer : {}) as Record<string, string>;
    if (blankCells.length === 0) return false;
    return blankCells.every((c) => String(submitted[`${c.row}-${c.col}`] ?? "").trim() === String(c.answer ?? "").trim());
  }
  if (questionType === "sticker_game") {
    const objects = (config.objects as Array<{ id: string; image_url: string }>) ?? [];
    const submitted = (studentAnswer && typeof studentAnswer === "object" ? studentAnswer : {}) as Record<string, string>;
    if (objects.length === 0) return false;
    return objects.every((o) => submitted[o.id] === o.image_url);
  }
  return false;
}

export default function ExamPreviewPage() {
  const { paperId } = useParams<{ paperId: string }>();
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const [title, setTitle] = useState("");
  const [totalMarks, setTotalMarks] = useState(0);
  const [questions, setQuestions] = useState<TakeQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [finished, setFinished] = useState(false);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0); // 一题一页——答题阶段用；交卷后的回看阶段一次性全部显示，方便整体检查

  const load = useCallback(() => {
    if (!paperId) return;
    setLoading(true); setFinished(false); setAnswers({}); setCurrentIndex(0);
    examApi.getPaperPreview(paperId)
      .then((data) => {
        setTitle(pickText(data.title_i18n, locale)); setTotalMarks(data.total_marks);
        setQuestions(data.questions as TakeQuestion[]);
      })
      .catch((err: any) => toast.error(err?.response?.data?.message ?? t("exam.preview.loadFailed")))
      .finally(() => setLoading(false));
  }, [paperId, locale]);

  useEffect(() => { load(); }, [load]);

  function setAnswer(questionId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  function handleSubmit() {
    let total = 0;
    for (const q of questions) {
      if (gradeQuestionLocally(q.question_type, q.config, answers[q.id])) total += q.marks;
    }
    setScore(total);
    setFinished(true);
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">{t("exam.loading")}</div>;
  if (questions.length === 0) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">{t("exam.noQuestions")}</div>;

  return (
    <div className="h-screen flex flex-col bg-muted/20">
      <div className="flex-shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-amber-800">
          <span className="font-semibold">{t("exam.preview.badge")}</span>
          <span className="text-xs text-amber-700">{t("exam.preview.notice")}</span>
        </div>
        <button onClick={() => window.close()} className="text-xs text-amber-700 hover:text-amber-900 underline">{t("exam.preview.backToEditor")}</button>
      </div>

      <div className="flex-shrink-0 bg-white border-b border-border px-4 py-3">
        <h1 className="font-semibold text-foreground">{title}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{t("exam.preview.fullMarks", { marks: totalMarks, count: questions.length })}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl lg:max-w-4xl xl:max-w-6xl 2xl:max-w-7xl mx-auto py-6 px-4 lg:px-8 space-y-5">
          {finished && (
            <div className="rounded-2xl bg-white border-2 border-primary/40 shadow-sm p-5 text-center">
              <div className="text-4xl mb-1">🧪</div>
              <div className="text-2xl font-bold text-foreground">{score} <span className="text-base text-muted-foreground font-normal">/ {totalMarks}</span></div>
              <p className="text-xs text-muted-foreground mt-1">{t("exam.preview.resultNote")}</p>
              <div className="flex gap-2 justify-center mt-3">
                <button onClick={load} className="text-sm font-medium px-4 py-2 rounded-xl bg-primary text-primary-foreground">{t("exam.preview.retry")}</button>
                <button onClick={() => window.close()} className="text-sm font-medium px-4 py-2 rounded-xl bg-muted text-foreground">{t("exam.preview.backToEditor")}</button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mb-3 text-sm">
            <span className="text-muted-foreground">{t("exam.questionOf", { current: currentIndex + 1, total: questions.length })}</span>
            {!finished && <span className="text-xs text-muted-foreground">{t("exam.answered", { count: Object.keys(answers).length, total: questions.length })}</span>}
          </div>

          {questions[currentIndex] && (
            finished ? (
              <ReviewCard
                key={questions[currentIndex].id} index={currentIndex + 1}
                question={{
                  id: questions[currentIndex].id, order_index: questions[currentIndex].order_index,
                  question_type: questions[currentIndex].question_type, marks: questions[currentIndex].marks,
                  config: questions[currentIndex].config, student_answer: answers[questions[currentIndex].id],
                  is_correct: gradeQuestionLocally(questions[currentIndex].question_type, questions[currentIndex].config, answers[questions[currentIndex].id]),
                } as ReviewQuestion}
              />
            ) : (
              <PreviewQuestionCard
                key={questions[currentIndex].id} index={currentIndex + 1}
                question={questions[currentIndex]} value={answers[questions[currentIndex].id]}
                onChange={(v) => setAnswer(questions[currentIndex].id, v)}
              />
            )
          )}
        </div>
      </div>

      <div className="flex-shrink-0 bg-white border-t border-border px-4 py-3">
        <div className="max-w-2xl lg:max-w-4xl xl:max-w-6xl 2xl:max-w-7xl mx-auto flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            <button onClick={() => setCurrentIndex(0)} disabled={currentIndex === 0} className="px-3 py-2 rounded-lg text-sm bg-white border border-border disabled:opacity-30">{t("exam.firstQuestion")}</button>
            <button onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))} disabled={currentIndex === 0} className="px-3 py-2 rounded-lg text-sm bg-white border border-border disabled:opacity-30">{t("exam.prevQuestion")}</button>
          </div>
          {!finished && <button onClick={handleSubmit} className="text-sm font-semibold px-6 py-2 rounded-xl bg-primary text-primary-foreground">{t("exam.preview.submit")}</button>}
          <div className="flex gap-1.5">
            <button onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))} disabled={currentIndex === questions.length - 1} className="px-3 py-2 rounded-lg text-sm bg-white border border-border disabled:opacity-30">{t("exam.nextQuestion")}</button>
            <button onClick={() => setCurrentIndex(questions.length - 1)} disabled={currentIndex === questions.length - 1} className="px-3 py-2 rounded-lg text-sm bg-white border border-border disabled:opacity-30">{t("exam.lastQuestion")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewQuestionCard({ index, question, value, onChange }: {
  index: number; question: TakeQuestion; value: unknown; onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl bg-white border border-border shadow-sm p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold flex-shrink-0">{index}</span>
        <span className="text-xs text-muted-foreground">{t("exam.marksUnit", { n: question.marks })}</span>
      </div>
      {question.question_type === "multiple_choice"
        ? <MultipleChoiceQuestion config={question.config} value={value as string[] | undefined} onChange={onChange} />
        : question.question_type === "fill_blank"
        ? <FillBlankQuestion config={question.config} value={value as string[] | undefined} onChange={onChange} />
        : question.question_type === "coloring"
        ? <ColoringQuestion config={question.config as unknown as ColoringConfig} value={value as Record<string, string> | undefined} onChange={onChange} />
        : question.question_type === "sudoku"
        ? <SudokuQuestion config={question.config} value={value as Record<string, string> | undefined} onChange={onChange} />
        : <StickerGameQuestion config={question.config} value={value as Record<string, string> | undefined} onChange={onChange} />}
    </div>
  );
}
