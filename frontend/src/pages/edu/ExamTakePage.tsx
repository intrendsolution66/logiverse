// frontend/src/pages/edu/ExamTakePage.tsx
//
// 学生作答页面——全屏沉浸式，跟 LevelPlayerPage 一样不套侧边栏(见
// App.tsx 里 /play/:levelId 那种路由写法)。整份试卷在同一页里一次性
// 显示全部题目(不是像单个Activity那样一题一页)，共用一个总计时器，
// 倒计时归零自动交卷。
//
// 安全说明：这里渲染用的 questions 数组来自 examApi.startAttempt()，
// 后端已经用 stripAnswers() 去掉了正确答案——这个组件从头到尾都不知道
// 哪个选项/哪个空的答案是对的，判分完全依赖后端 submitAttempt。

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { examApi } from "@/api";

interface TakeQuestion {
  id: string; order_index: number; question_type: string; marks: number;
  config: Record<string, unknown>;
}

export default function ExamTakePage() {
  const { paperId } = useParams<{ paperId: string }>();
  const navigate = useNavigate();

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<TakeQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false); // 防止倒计时和手动交卷同时触发两次提交

  useEffect(() => {
    if (!paperId) return;
    examApi.startAttempt(paperId)
      .then((data) => {
        setAttemptId(data.attempt_id); setTitle(data.title_i18n?.zh || data.title_i18n?.zh || "");
        setQuestions(data.questions as TakeQuestion[]);
        setRemaining(data.remaining_seconds);
      })
      .catch((err) => {
        toast.error(err?.response?.data?.message ?? "无法开始作答");
        navigate("/my-exams");
      })
      .finally(() => setLoading(false));
  }, [paperId]);

  const handleSubmit = useCallback(async () => {
    if (!attemptId || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      await examApi.submitAttempt(attemptId, answers);
      toast.success("已交卷");
      navigate(`/exam/attempt/${attemptId}/result`);
    } catch (err) {
      toast.error("交卷失败，请重试");
      submittedRef.current = false; // 失败的话允许重试，不锁死
      setSubmitting(false);
    }
  }, [attemptId, answers, navigate]);

  // 倒计时——归零自动交卷，逻辑上跟单个游戏引擎的countdown模式一致
  useEffect(() => {
    if (loading || remaining <= 0) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(id); handleSubmit(); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [loading, handleSubmit]); // remaining 不放进依赖——只在mount时启动一次倒计时循环，避免每秒都重新建定时器

  function setAnswer(questionId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  const allAnswered = questions.length > 0 && questions.every((q) => {
    const a = answers[q.id];
    if (q.question_type === "multiple_choice") return Array.isArray(a) && a.length > 0;
    if (q.question_type === "fill_blank") return Array.isArray(a) && a.every((v) => String(v ?? "").trim());
    return false;
  });

  const timeLow = remaining < 60;
  const minutes = Math.floor(remaining / 60), seconds = remaining % 60;

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">加载中...</div>;

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="sticky top-0 z-10 bg-white border-b border-border px-4 py-3 flex items-center justify-between">
        <h1 className="font-semibold text-foreground truncate">{title}</h1>
        <div className={`font-mono text-lg font-bold px-3 py-1 rounded-lg ${timeLow ? "bg-red-100 text-red-600 animate-pulse" : "bg-muted text-foreground"}`}>
          {minutes}:{seconds.toString().padStart(2, "0")}
        </div>
      </div>

      <div className="max-w-2xl mx-auto py-6 px-4 space-y-5">
        {questions.map((q, i) => (
          <QuestionCard key={q.id} index={i + 1} question={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
        ))}

        <div className="pt-2 pb-10 flex flex-col items-center gap-2">
          {!allAnswered && <p className="text-xs text-amber-600">还有题目没作答完，交卷后没作答的题目算错</p>}
          <button
            onClick={() => { if (confirm("确定要交卷吗？交卷后不能修改。")) handleSubmit(); }}
            disabled={submitting}
            className="text-base font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50"
          >
            {submitting ? "交卷中..." : "✅ 交卷"}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuestionCard({ index, question, value, onChange }: {
  index: number; question: TakeQuestion; value: unknown; onChange: (v: unknown) => void;
}) {
  return (
    <div className="rounded-2xl bg-white border border-border shadow-sm p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold flex-shrink-0">{index}</span>
        <span className="text-xs text-muted-foreground">{question.marks}分</span>
      </div>
      {question.question_type === "multiple_choice"
        ? <MultipleChoiceQuestion config={question.config} value={value as string[] | undefined} onChange={onChange} />
        : <FillBlankQuestion config={question.config} value={value as string[] | undefined} onChange={onChange} />}
    </div>
  );
}

function MultipleChoiceQuestion({ config, value, onChange }: {
  config: Record<string, unknown>; value?: string[]; onChange: (v: string[]) => void;
}) {
  const isMulti = config.answer_mode === "multi";
  const options = (config.options as Array<{ id: string; text_i18n: Record<string, string> }>) ?? [];
  const questionText = (config.question_i18n as Record<string, string>)?.zh ?? "";
  const selected = new Set(value ?? []);

  function toggle(id: string) {
    if (!isMulti) { onChange([id]); return; }
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange([...next]);
  }

  return (
    <>
      <p className="text-base font-medium text-foreground mb-3">{questionText}</p>
      <div className="space-y-2">
        {options.map((opt) => {
          const isSelected = selected.has(opt.id);
          return (
            <button
              key={opt.id} type="button" onClick={() => toggle(opt.id)}
              className={`w-full text-left px-4 py-3 rounded-xl border-2 flex items-center gap-3 transition-colors ${
                isSelected ? "border-primary bg-primary/10" : "border-border bg-white hover:border-primary/40"
              }`}
            >
              <span className={`w-5 h-5 flex-shrink-0 border-2 flex items-center justify-center text-xs ${isMulti ? "rounded-md" : "rounded-full"} ${
                isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
              }`}>
                {isSelected ? "✓" : ""}
              </span>
              <span className="text-sm">{opt.text_i18n?.zh}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function FillBlankQuestion({ config, value, onChange }: {
  config: Record<string, unknown>; value?: string[]; onChange: (v: string[]) => void;
}) {
  const sentence = (config.sentence_i18n as Record<string, string>)?.zh ?? "";
  const segments = sentence.split("___");
  const blankCount = Math.max(0, segments.length - 1);
  const values = value ?? Array.from({ length: blankCount }, () => "");

  function setBlank(i: number, v: string) {
    const next = [...values];
    while (next.length <= i) next.push("");
    next[i] = v;
    onChange(next);
  }

  return (
    <p className="text-base font-medium text-foreground leading-relaxed flex flex-wrap items-center gap-x-1.5 gap-y-2">
      {segments.map((seg, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {seg && <span>{seg}</span>}
          {i < blankCount && (
            <input
              type="text" value={values[i] ?? ""} onChange={(e) => setBlank(i, e.target.value)}
              className="inline-block w-24 px-2 py-1 rounded-lg border-2 border-primary/50 bg-white text-center font-semibold outline-none focus:border-primary"
            />
          )}
        </span>
      ))}
    </p>
  );
}
