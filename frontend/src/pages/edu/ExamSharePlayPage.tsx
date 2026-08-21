// frontend/src/pages/edu/ExamSharePlayPage.tsx
//
// 试卷分享出去的公开答题页面——不需要登录，靠URL里的分享token访问
// (路由类似 /share/exam/:token，需要在 App.tsx 里注册成不套 AppLayout、
// 不需要 RequireAuth 的公开路由，参照 /discovery 那几条的写法)。
//
// 跟 ExamPreviewPage.tsx(运营/设计师本人登录后预览用) 最大的区别：这里
// 拿到的每道题 config 已经被后端 stripAnswers() 处理过、不含正确答案，
// 所以不能像 ExamPreviewPage 那样在浏览器本地算分——判分必须逐题调
// sharePublicApi.checkExamQuestion()，凭 session_id 去后端核对服务器
// 那边单独保留的完整答案。这个组件从头到尾都不知道哪个选项/哪个空的
// 答案是对的，跟 ExamTakePage 对学生隐藏答案是同一个安全原则。
//
// session_id 由 sharePublicApi.startExamSession() 在打开页面时生成——
// 后端把这次要考的题物化成一份快照(固定题直接用，随机抽题槽现场抽)，
// 之后这个页面所有的判分请求都带着这同一个 session_id，保证访客看到
// 的题跟被判分依据的题是同一份，不会因为随机槽重新抽而对不上。

import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { sharePublicApi } from "@/api";
import {
  pickText, MultipleChoiceQuestion, FillBlankQuestion, ColoringQuestion, SudokuQuestion, StickerGameQuestion, DragDropQuestion,
  type TakeQuestion,
} from "./ExamTakePage";
import { ReviewCard, type ReviewQuestion } from "./ExamResultPage";
import type { ColoringConfig } from "@/lib/coloringShapes";

export default function ExamSharePlayPage() {
  const { token } = useParams<{ token: string }>();
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [totalMarks, setTotalMarks] = useState(0);
  const [questions, setQuestions] = useState<TakeQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  // 逐题判分的结果——提交前答过的题会先存一份在这里，交卷时不用重新
  // 全部再判一遍(已经判过的直接复用，只有没答过/没判过的才现场补判)。
  const [correctness, setCorrectness] = useState<Record<string, boolean>>({});
  const [finished, setFinished] = useState(false);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false); // token/分享链接本身无效，跟"加载中"分开显示
  const [currentIndex, setCurrentIndex] = useState(0);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true); setInvalid(false); setFinished(false);
    setAnswers({}); setCorrectness({}); setCurrentIndex(0);
    sharePublicApi.startExamSession(token)
      .then((data) => {
        setSessionId(data.session_id);
        setTitle(pickText(data.title_i18n, locale)); setTotalMarks(data.total_marks);
        setQuestions(data.questions as TakeQuestion[]);
      })
      .catch((err: any) => {
        setInvalid(true);
        toast.error(err?.response?.data?.message ?? t("exam.preview.loadFailed"));
      })
      .finally(() => setLoading(false));
  }, [token, locale]);

  useEffect(() => { load(); }, [load]);

  function setAnswer(questionId: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    // 换了答案，之前判过的结果就作废——交卷时会针对这道题重新判一次，
    // 不会拿旧答案的判分结果冒充新答案的。
    setCorrectness((prev) => {
      if (!(questionId in prev)) return prev;
      const { [questionId]: _drop, ...rest } = prev;
      return rest;
    });
  }

  async function handleSubmit() {
    if (!sessionId) return;
    setSubmitting(true);
    try {
      const results = await Promise.all(
        questions.map(async (q) => {
          if (q.id in correctness) return correctness[q.id]; // 已经判过、答案没变过的题，不用再打一次接口
          const { is_correct } = await sharePublicApi.checkExamQuestion(sessionId, q.id, answers[q.id]);
          return is_correct;
        })
      );
      const newCorrectness: Record<string, boolean> = {};
      let total = 0;
      questions.forEach((q, i) => {
        newCorrectness[q.id] = results[i];
        if (results[i]) total += q.marks;
      });
      setCorrectness(newCorrectness);
      setScore(total);
      setFinished(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? t("exam.preview.loadFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">{t("exam.loading")}</div>;
  if (invalid || questions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-4">
        <div>
          <div className="text-3xl mb-2">🔗</div>
          <p className="text-sm text-muted-foreground">{t("examDesigner.share.invalidLink", "这个分享链接无效、已过期，或者试卷还没有题目")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-muted/20">
      <div className="flex-shrink-0 bg-white border-b border-border px-4 py-3">
        <h1 className="font-semibold text-foreground">{title}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{t("exam.preview.fullMarks", { marks: totalMarks, count: questions.length })}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl lg:max-w-4xl xl:max-w-6xl 2xl:max-w-7xl mx-auto py-6 px-4 lg:px-8 space-y-5">
          {finished && (
            <div className="rounded-2xl bg-white border-2 border-primary/40 shadow-sm p-5 text-center">
              <div className="text-4xl mb-1">🎉</div>
              <div className="text-2xl font-bold text-foreground">{score} <span className="text-base text-muted-foreground font-normal">/ {totalMarks}</span></div>
              <div className="flex gap-2 justify-center mt-3">
                <button onClick={load} className="text-sm font-medium px-4 py-2 rounded-xl bg-primary text-primary-foreground">{t("exam.preview.retry")}</button>
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
                  is_correct: correctness[questions[currentIndex].id] ?? false,
                } as ReviewQuestion}
              />
            ) : (
              <SharePlayQuestionCard
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
          {!finished && (
            <button onClick={handleSubmit} disabled={submitting} className="text-sm font-semibold px-6 py-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-50">
              {submitting ? t("exam.loading") : t("exam.preview.submit")}
            </button>
          )}
          <div className="flex gap-1.5">
            <button onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))} disabled={currentIndex === questions.length - 1} className="px-3 py-2 rounded-lg text-sm bg-white border border-border disabled:opacity-30">{t("exam.nextQuestion")}</button>
            <button onClick={() => setCurrentIndex(questions.length - 1)} disabled={currentIndex === questions.length - 1} className="px-3 py-2 rounded-lg text-sm bg-white border border-border disabled:opacity-30">{t("exam.lastQuestion")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SharePlayQuestionCard({ index, question, value, onChange }: {
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
        : question.question_type === "drag_drop"
        ? <DragDropQuestion config={question.config} value={value as Record<number, { x: number; y: number }> | undefined} onChange={onChange} />
        : <StickerGameQuestion config={question.config} value={value as Record<string, string> | undefined} onChange={onChange} />}
    </div>
  );
}
