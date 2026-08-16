// frontend/src/pages/edu/ExamPreviewPage.tsx
//
// 运营/设计师"试玩预览"页面——测试自己设计的考卷实际玩起来是什么样，
// 不受白名单/发布状态/开考截止时间限制(草稿也能试玩)，交卷后立刻在
// 本地算分显示结果，完全不写入 exam_attempts 这张表——不会污染真实的
// 排行榜、不会占用任何学生的重考次数。
//
// 判分逻辑是后端 gradeQuestion() 的前端镜像版本，两边必须保持一致——
// 后端那份改了判分规则，这里也要跟着改，不然预览显示的对错会跟正式
// 作答时不一样。

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { examApi } from "@/api";
import {
  pickText, MultipleChoiceQuestion, FillBlankQuestion, ColoringQuestion, SudokuQuestion, StickerGameQuestion,
  type TakeQuestion,
} from "./ExamTakePage";
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
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const locale = i18n.language;

  const [title, setTitle] = useState("");
  const [totalMarks, setTotalMarks] = useState(0);
  const [questions, setQuestions] = useState<TakeQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [finished, setFinished] = useState(false);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!paperId) return;
    setLoading(true); setFinished(false); setAnswers({});
    examApi.getPaperPreview(paperId)
      .then((data) => {
        setTitle(pickText(data.title_i18n, locale)); setTotalMarks(data.total_marks);
        setQuestions(data.questions as TakeQuestion[]);
      })
      .catch((err: any) => toast.error(err?.response?.data?.message ?? "加载预览失败"))
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

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">加载中...</div>;
  if (questions.length === 0) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">这份试卷还没有题目</div>;

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="sticky top-0 z-10 bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-amber-800">
          <span className="font-semibold">🧪 试玩预览模式</span>
          <span className="text-xs text-amber-700">不计入任何真实成绩，仅供测试题目内容</span>
        </div>
        <button onClick={() => navigate(-1)} className="text-xs text-amber-700 hover:text-amber-900 underline">返回编辑器</button>
      </div>

      <div className="bg-white border-b border-border px-4 py-3">
        <h1 className="font-semibold text-foreground">{title}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">满分 {totalMarks} · 共 {questions.length} 题</p>
      </div>

      <div className="max-w-2xl mx-auto py-6 px-4 space-y-5">
        {finished && (
          <div className="rounded-2xl bg-white border-2 border-primary/40 shadow-sm p-5 text-center">
            <div className="text-4xl mb-1">🧪</div>
            <div className="text-2xl font-bold text-foreground">{score} <span className="text-base text-muted-foreground font-normal">/ {totalMarks}</span></div>
            <p className="text-xs text-muted-foreground mt-1">预览结果，不代表任何学生的真实成绩</p>
            <div className="flex gap-2 justify-center mt-3">
              <button onClick={load} className="text-sm font-medium px-4 py-2 rounded-xl bg-primary text-primary-foreground">🔄 重新试玩</button>
              <button onClick={() => navigate(-1)} className="text-sm font-medium px-4 py-2 rounded-xl bg-muted text-foreground">返回编辑器</button>
            </div>
          </div>
        )}

        {questions.map((q, i) => (
          <PreviewQuestionCard key={q.id} index={i + 1} question={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} finished={finished} />
        ))}

        {!finished && (
          <div className="pb-10 flex justify-center">
            <button onClick={handleSubmit} className="text-base font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground">✅ 提交查看结果</button>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewQuestionCard({ index, question, value, onChange, finished }: {
  index: number; question: TakeQuestion; value: unknown; onChange: (v: unknown) => void; finished: boolean;
}) {
  const isCorrect = finished ? gradeQuestionLocally(question.question_type, question.config, value) : null;
  return (
    <div className={`rounded-2xl bg-white border shadow-sm p-5 ${finished ? (isCorrect ? "border-emerald-300" : "border-red-300") : "border-border"}`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold flex-shrink-0">{index}</span>
        <span className="text-xs text-muted-foreground">{question.marks}分</span>
        {finished && <span className={`text-xs font-semibold ml-auto ${isCorrect ? "text-emerald-600" : "text-red-600"}`}>{isCorrect ? "✓ 答对" : "✗ 答错"}</span>}
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
