// frontend/src/pages/edu/ExamResultPage.tsx
//
// 交卷后的成绩页面——总分立刻能看，逐题详情(对不对/正确答案)可能被
// 试卷的 review_policy 挡住(见后端 getExamAttemptReview)：练习模式立刻
// 能看，正式比赛模式要等截止时间过了。403的情况这里当成"还不能看"处理，
// 不是报错。

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { examApi } from "@/api";
import { ColoringShapeSvg, getCroppedViewBox, type ColoringConfig } from "@/lib/coloringShapes";
import { IllustrationView, type Illustration } from "@/lib/illustrationShapes";
import { STICKER_CANVAS_SIZE } from "@/lib/gameCanvas";

// 按当前界面语言取文字——取不到就退回中文，再退回英文。
function pickText(i18nObj: Record<string, string> | undefined, locale: string): string {
  return i18nObj?.[locale] || i18nObj?.zh || i18nObj?.en || "";
}

interface ReviewQuestion {
  id: string; order_index: number; question_type: string; marks: number;
  config: Record<string, unknown>; student_answer: unknown; is_correct: boolean;
}

export default function ExamResultPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [basic, setBasic] = useState<{ score?: number; max_score?: number; status: string } | null>(null);
  const [review, setReview] = useState<{ questions: ReviewQuestion[] } | null>(null);
  const [reviewBlockedMsg, setReviewBlockedMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!attemptId) return;
    (async () => {
      try {
        const b = await examApi.getAttempt(attemptId);
        setBasic(b);
      } catch (err) { toast.error(t("exam.result.loadFailed")); setLoading(false); return; }
      try {
        const r = await examApi.getAttemptReview(attemptId);
        setReview(r);
      } catch (err: any) {
        setReviewBlockedMsg(err?.response?.data?.message ?? t("exam.result.reviewBlockedDefault"));
      }
      setLoading(false);
    })();
  }, [attemptId]);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">{t("exam.loading")}</div>;
  if (!basic) return null;

  const questions = review?.questions ?? [];

  return (
    <div className="min-h-screen bg-muted/20 py-8 px-4">
      <div className="max-w-2xl lg:max-w-4xl xl:max-w-6xl 2xl:max-w-7xl mx-auto">
        <button onClick={() => navigate("/my-exams")} className="text-sm text-muted-foreground hover:text-foreground mb-4">{t("exam.result.backToMyExams")}</button>

        <div className="rounded-2xl bg-white border border-border shadow-sm p-6 text-center mb-5">
          <div className="text-5xl mb-2">🎉</div>
          <div className="text-3xl font-bold text-foreground">{basic.score} <span className="text-lg text-muted-foreground font-normal">/ {basic.max_score}</span></div>
          <p className="text-sm text-muted-foreground mt-1">{t("exam.result.submittedLabel")}</p>
        </div>

        {reviewBlockedMsg && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-xl px-4 py-3 text-center mb-5">🔒 {reviewBlockedMsg}</p>
        )}

        {questions.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-3 text-sm">
              <span className="text-muted-foreground">{t("exam.questionOf", { current: currentIndex + 1, total: questions.length })}</span>
            </div>

            <ReviewCard index={currentIndex + 1} question={questions[currentIndex]} />

            <div className="flex items-center justify-between gap-2 mt-4 pb-8">
              <div className="flex gap-1.5">
                <button onClick={() => setCurrentIndex(0)} disabled={currentIndex === 0} className="px-3 py-2 rounded-lg text-sm bg-white border border-border disabled:opacity-30">{t("exam.firstQuestion")}</button>
                <button onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))} disabled={currentIndex === 0} className="px-3 py-2 rounded-lg text-sm bg-white border border-border disabled:opacity-30">{t("exam.prevQuestion")}</button>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))} disabled={currentIndex === questions.length - 1} className="px-3 py-2 rounded-lg text-sm bg-white border border-border disabled:opacity-30">{t("exam.nextQuestion")}</button>
                <button onClick={() => setCurrentIndex(questions.length - 1)} disabled={currentIndex === questions.length - 1} className="px-3 py-2 rounded-lg text-sm bg-white border border-border disabled:opacity-30">{t("exam.lastQuestion")}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewCard({ index, question }: { index: number; question: ReviewQuestion }) {
  const { t } = useTranslation();
  return (
    <div className={`rounded-xl bg-white border-2 shadow-sm p-4 ${question.is_correct ? "border-emerald-300" : "border-red-300"}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">{index}</span>
        <span className={`text-xs font-semibold ${question.is_correct ? "text-emerald-600" : "text-red-600"}`}>
          {question.is_correct ? t("exam.result.correctWithMarks", { marks: question.marks }) : t("exam.result.incorrectLabel")}
        </span>
      </div>
      {question.question_type === "multiple_choice"
        ? <MultipleChoiceReview question={question} />
        : question.question_type === "fill_blank"
        ? <FillBlankReview question={question} />
        : question.question_type === "coloring"
        ? <ColoringReview question={question} />
        : question.question_type === "sudoku"
        ? <SudokuReview question={question} />
        : <StickerGameReview question={question} />}
    </div>
  );
}

function MultipleChoiceReview({ question }: { question: ReviewQuestion }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const config = question.config;
  const questionText = pickText(config.question_i18n as Record<string, string>, locale);
  const illustration = config.illustration as Illustration | undefined;
  const options = (config.options as Array<{ id: string; text_i18n: Record<string, string>; image_url?: string }>) ?? [];
  const correctIds = new Set((config.correct_option_ids as string[]) ?? []);
  const studentIds = new Set((question.student_answer as string[]) ?? []);
  const hasImages = options.some((o) => o.image_url);
  const isShort = !hasImages && options.every((o) => pickText(o.text_i18n, locale).length <= 6);

  return (
    <>
      {illustration && (
        <div className="mb-2 flex justify-center">
          <IllustrationView illustration={illustration} style={{ maxHeight: "38vh", width: "auto", maxWidth: "100%" }} />
        </div>
      )}
      <p className="text-xl sm:text-2xl md:text-3xl font-medium text-foreground mb-3 leading-snug">{questionText}</p>
      <div className={isShort ? "flex flex-wrap gap-1.5" : "space-y-1.5"}>
        {options.map((opt) => {
          const isCorrect = correctIds.has(opt.id);
          const wasSelected = studentIds.has(opt.id);
          return (
            <div
              key={opt.id}
              className={`${isShort ? "min-w-[3.5rem]" : ""} px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
                isCorrect ? "bg-emerald-50 text-emerald-700" : wasSelected ? "bg-red-50 text-red-600" : "text-muted-foreground"
              }`}
            >
              {isCorrect ? "✓" : wasSelected ? "✗" : "·"}
              {opt.image_url && <img src={opt.image_url} alt="" className="w-8 h-8 rounded object-cover" />}
              {pickText(opt.text_i18n, locale)}
              {wasSelected && !isCorrect && <span className="text-xs">{t("exam.result.yourChoice")}</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function FillBlankReview({ question }: { question: ReviewQuestion }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const config = question.config;
  const sentence = pickText(config.sentence_i18n as Record<string, string>, locale);
  const illustration = config.illustration as Illustration | undefined;
  const blanks = (config.blanks as Array<{ accepted_answers: string[] }>) ?? [];
  const segments = sentence.split("___");
  const studentAnswers = (question.student_answer as string[]) ?? [];

  return (
    <>
      {illustration && (
        <div className="mb-2 flex justify-center">
          <IllustrationView illustration={illustration} style={{ maxHeight: "38vh", width: "auto", maxWidth: "100%" }} />
        </div>
      )}
      <p className="text-xl sm:text-2xl md:text-3xl text-foreground leading-relaxed flex flex-wrap items-center gap-x-1.5 gap-y-2">
      {segments.map((seg, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {seg && <span>{seg}</span>}
          {i < blanks.length && (
            <span className="inline-flex items-center gap-1">
              <span className={`px-2 py-0.5 rounded ${studentAnswers[i] && blanks[i].accepted_answers.some((a) => a.trim().toLowerCase() === String(studentAnswers[i]).trim().toLowerCase()) ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600 line-through"}`}>
                {studentAnswers[i] || t("exam.result.emptyAnswer")}
              </span>
              {!(studentAnswers[i] && blanks[i].accepted_answers.some((a) => a.trim().toLowerCase() === String(studentAnswers[i]).trim().toLowerCase())) && (
                <span className="text-emerald-700 text-xs">→ {blanks[i].accepted_answers[0]}</span>
              )}
            </span>
          )}
        </span>
      ))}
    </p>
    </>
  );
}

function ColoringReview({ question }: { question: ReviewQuestion }) {
  const { t } = useTranslation();
  const config = question.config as unknown as ColoringConfig;
  const given = (question.student_answer ?? {}) as Record<string, string>;

  return (
    <>
      <svg viewBox={getCroppedViewBox(config)} className="w-full border border-border rounded-xl bg-white" style={{ maxWidth: 380 }}>
        {config.bg_image_url && <image href={config.bg_image_url} x={0} y={0} width={config.canvas_width} height={config.canvas_height} preserveAspectRatio="xMidYMid meet" />}
        {(config.regions ?? []).map((r) => {
          const studentColor = given[r.id];
          const fill = r.colorable ? (studentColor ?? "#f8fafc") : (r.decoration_color ?? "#e2e8f0");
          return <ColoringShapeSvg key={r.id} region={r} fill={fill} />;
        })}
      </svg>
      {!question.is_correct && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {(config.regions ?? []).filter((r) => r.colorable).map((r) => {
            const studentColor = given[r.id];
            const isRegionCorrect = studentColor?.toLowerCase() === r.correct_color?.toLowerCase();
            if (isRegionCorrect) return null;
            return (
              <span key={r.id} className="text-xs bg-red-50 text-red-700 rounded-lg px-2 py-1 flex items-center gap-1.5">
                {t("exam.result.shouldBe")}
                <span className="w-3.5 h-3.5 rounded inline-block border border-border" style={{ backgroundColor: r.correct_color }} />
              </span>
            );
          })}
        </div>
      )}
    </>
  );
}

function SudokuReview({ question }: { question: ReviewQuestion }) {
  const config = question.config;
  const rows = (config.rows as number) ?? 3, cols = (config.cols as number) ?? 3;
  const givenCells = (config.given_cells as Array<{ row: number; col: number; value: string }>) ?? [];
  const blankCells = (config.blank_cells as Array<{ row: number; col: number; answer: string }>) ?? [];
  const givenMap = new Map(givenCells.map((c) => [`${c.row}-${c.col}`, c.value]));
  const studentAnswers = (question.student_answer ?? {}) as Record<string, string>;

  return (
    <div className="grid gap-1.5 w-fit mx-auto" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => {
          const key = `${r}-${c}`;
          const isGiven = givenMap.has(key);
          const blank = blankCells.find((b) => b.row === r && b.col === c);
          if (isGiven) {
            return <div key={key} className="w-10 h-10 border border-border rounded-lg flex items-center justify-center bg-muted/30 text-base font-bold">{givenMap.get(key)}</div>;
          }
          if (!blank) return <div key={key} className="w-10 h-10" />;
          const studentValue = studentAnswers[key];
          const isRight = studentValue === blank.answer;
          return (
            <div key={key} className={`w-10 h-10 border-2 rounded-lg flex items-center justify-center text-base font-bold ${isRight ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-red-400 bg-red-50 text-red-600"}`}>
              {studentValue || "?"}
              {!isRight && <span className="text-[10px] text-emerald-700 ml-0.5">({blank.answer})</span>}
            </div>
          );
        })
      )}
    </div>
  );
}

function StickerGameReview({ question }: { question: ReviewQuestion }) {
  const config = question.config;
  const objects = (config.objects as Array<{ id: string; x: number; y: number; w: number; h: number; image_url: string }>) ?? [];
  const studentAnswers = (question.student_answer ?? {}) as Record<string, string>;
  const canvasW = STICKER_CANVAS_SIZE, canvasH = STICKER_CANVAS_SIZE;

  return (
    <div
      className="relative w-full rounded-xl overflow-hidden bg-white border border-border"
      style={{ aspectRatio: `${canvasW} / ${canvasH}`, maxWidth: 320, backgroundImage: config.bg_image_url ? `url(${config.bg_image_url})` : undefined, backgroundSize: "100% 100%" }}
    >
      {objects.map((o) => {
        const placed = studentAnswers[o.id];
        const isRight = placed === o.image_url;
        return (
          <div
            key={o.id}
            className={`absolute -translate-x-1/2 -translate-y-1/2 border-2 rounded-lg overflow-hidden ${isRight ? "border-emerald-400" : "border-red-400"}`}
            style={{ left: `${(o.x / canvasW) * 100}%`, top: `${(o.y / canvasH) * 100}%`, width: `${(o.w / canvasW) * 100}%`, height: `${(o.h / canvasH) * 100}%` }}
          >
            {placed ? <img src={placed} alt="" className="w-full h-full object-contain" /> : null}
            {!isRight && (
              <img src={o.image_url} alt="" className="absolute bottom-0 right-0 w-1/2 h-1/2 object-contain opacity-60 border-t border-l border-emerald-400 bg-white/80" />
            )}
          </div>
        );
      })}
    </div>
  );
}


