// frontend/src/pages/edu/ExamResultPage.tsx
//
// 交卷后的成绩页面——总分立刻能看，逐题详情(对不对/正确答案)可能被
// 试卷的 review_policy 挡住(见后端 getExamAttemptReview)：练习模式立刻
// 能看，正式比赛模式要等截止时间过了。403的情况这里当成"还不能看"处理，
// 不是报错。

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { examApi } from "@/api";

interface ReviewQuestion {
  id: string; order_index: number; question_type: string; marks: number;
  config: Record<string, unknown>; student_answer: unknown; is_correct: boolean;
}

export default function ExamResultPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const [basic, setBasic] = useState<{ score?: number; max_score?: number; status: string } | null>(null);
  const [review, setReview] = useState<{ questions: ReviewQuestion[] } | null>(null);
  const [reviewBlockedMsg, setReviewBlockedMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!attemptId) return;
    (async () => {
      try {
        const b = await examApi.getAttempt(attemptId);
        setBasic(b);
      } catch (err) { toast.error("加载成绩失败"); setLoading(false); return; }
      try {
        const r = await examApi.getAttemptReview(attemptId);
        setReview(r);
      } catch (err: any) {
        setReviewBlockedMsg(err?.response?.data?.message ?? "逐题详情暂时还看不了");
      }
      setLoading(false);
    })();
  }, [attemptId]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">加载中...</div>;
  if (!basic) return null;

  return (
    <div className="min-h-screen bg-muted/20 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <button onClick={() => navigate("/my-exams")} className="text-sm text-muted-foreground hover:text-foreground mb-4">← 返回我的试卷</button>

        <div className="rounded-2xl bg-white border border-border shadow-sm p-6 text-center mb-5">
          <div className="text-5xl mb-2">🎉</div>
          <div className="text-3xl font-bold text-foreground">{basic.score} <span className="text-lg text-muted-foreground font-normal">/ {basic.max_score}</span></div>
          <p className="text-sm text-muted-foreground mt-1">已交卷</p>
        </div>

        {reviewBlockedMsg && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-xl px-4 py-3 text-center mb-5">🔒 {reviewBlockedMsg}</p>
        )}

        {review && (
          <div className="space-y-3">
            {review.questions.map((q, i) => (
              <ReviewCard key={q.id} index={i + 1} question={q} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewCard({ index, question }: { index: number; question: ReviewQuestion }) {
  return (
    <div className={`rounded-xl bg-white border-2 shadow-sm p-4 ${question.is_correct ? "border-emerald-300" : "border-red-300"}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">{index}</span>
        <span className={`text-xs font-semibold ${question.is_correct ? "text-emerald-600" : "text-red-600"}`}>
          {question.is_correct ? `✓ 答对 +${question.marks}` : "✗ 答错"}
        </span>
      </div>
      {question.question_type === "multiple_choice"
        ? <MultipleChoiceReview question={question} />
        : <FillBlankReview question={question} />}
    </div>
  );
}

function MultipleChoiceReview({ question }: { question: ReviewQuestion }) {
  const config = question.config;
  const questionText = (config.question_i18n as Record<string, string>)?.zh ?? "";
  const options = (config.options as Array<{ id: string; text_i18n: Record<string, string> }>) ?? [];
  const correctIds = new Set((config.correct_option_ids as string[]) ?? []);
  const studentIds = new Set((question.student_answer as string[]) ?? []);

  return (
    <>
      <p className="text-sm font-medium text-foreground mb-2">{questionText}</p>
      <div className="space-y-1.5">
        {options.map((opt) => {
          const isCorrect = correctIds.has(opt.id);
          const wasSelected = studentIds.has(opt.id);
          return (
            <div
              key={opt.id}
              className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
                isCorrect ? "bg-emerald-50 text-emerald-700" : wasSelected ? "bg-red-50 text-red-600" : "text-muted-foreground"
              }`}
            >
              {isCorrect ? "✓" : wasSelected ? "✗" : "·"} {opt.text_i18n?.zh}
              {wasSelected && !isCorrect && <span className="text-xs">(你选的)</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function FillBlankReview({ question }: { question: ReviewQuestion }) {
  const config = question.config;
  const sentence = (config.sentence_i18n as Record<string, string>)?.zh ?? "";
  const blanks = (config.blanks as Array<{ accepted_answers: string[] }>) ?? [];
  const segments = sentence.split("___");
  const studentAnswers = (question.student_answer as string[]) ?? [];

  return (
    <p className="text-sm text-foreground leading-relaxed flex flex-wrap items-center gap-x-1 gap-y-2">
      {segments.map((seg, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {seg && <span>{seg}</span>}
          {i < blanks.length && (
            <span className="inline-flex items-center gap-1">
              <span className={`px-2 py-0.5 rounded ${studentAnswers[i] && blanks[i].accepted_answers.some((a) => a.trim().toLowerCase() === String(studentAnswers[i]).trim().toLowerCase()) ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600 line-through"}`}>
                {studentAnswers[i] || "(空白)"}
              </span>
              {!(studentAnswers[i] && blanks[i].accepted_answers.some((a) => a.trim().toLowerCase() === String(studentAnswers[i]).trim().toLowerCase())) && (
                <span className="text-emerald-700 text-xs">→ {blanks[i].accepted_answers[0]}</span>
              )}
            </span>
          )}
        </span>
      ))}
    </p>
  );
}
