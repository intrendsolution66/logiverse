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
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { examApi } from "@/api";
import { ColoringShapeSvg, type ColoringConfig } from "@/lib/coloringShapes";
import { IllustrationView, type Illustration } from "@/lib/illustrationShapes";
import { STICKER_CANVAS_SIZE } from "@/lib/gameCanvas";

// 按当前界面语言取文字——取不到就退回中文，再退回英文。不是hook，
// 因为要在好几个独立组件(不是同一个组件树内)里共用，各组件自己用
// useTranslation()拿locale，传进来。
function pickText(i18nObj: Record<string, string> | undefined, locale: string): string {
  return i18nObj?.[locale] || i18nObj?.zh || i18nObj?.en || "";
}

interface TakeQuestion {
  id: string; order_index: number; question_type: string; marks: number;
  config: Record<string, unknown>;
}
type ColoringAnswer = Record<string, string>; // regionId -> hex颜色

export default function ExamTakePage() {
  const { paperId } = useParams<{ paperId: string }>();
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const locale = i18n.language;

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
        setAttemptId(data.attempt_id); setTitle(pickText(data.title_i18n, locale));
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
    if (q.question_type === "coloring") {
      const regions = ((q.config as unknown as ColoringConfig).regions ?? []).filter((r) => r.colorable);
      const given = (a ?? {}) as ColoringAnswer;
      return regions.every((r) => given[r.id]);
    }
    if (q.question_type === "sudoku") {
      const blankCells = (q.config.blank_cells as Array<{ row: number; col: number }>) ?? [];
      const given = (a ?? {}) as Record<string, string>;
      return blankCells.every((c) => String(given[`${c.row}-${c.col}`] ?? "").trim());
    }
    if (q.question_type === "sticker_game") {
      const objects = (q.config.objects as Array<{ id: string }>) ?? [];
      const given = (a ?? {}) as Record<string, string>;
      return objects.every((o) => given[o.id]);
    }
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
        : question.question_type === "fill_blank"
        ? <FillBlankQuestion config={question.config} value={value as string[] | undefined} onChange={onChange} />
        : question.question_type === "coloring"
        ? <ColoringQuestion config={question.config as unknown as ColoringConfig} value={value as ColoringAnswer | undefined} onChange={onChange} />
        : question.question_type === "sudoku"
        ? <SudokuQuestion config={question.config} value={value as Record<string, string> | undefined} onChange={onChange} />
        : <StickerGameQuestion config={question.config} value={value as Record<string, string> | undefined} onChange={onChange} />}
    </div>
  );
}

function MultipleChoiceQuestion({ config, value, onChange }: {
  config: Record<string, unknown>; value?: string[]; onChange: (v: string[]) => void;
}) {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const isMulti = config.answer_mode === "multi";
  const options = (config.options as Array<{ id: string; text_i18n: Record<string, string>; image_url?: string }>) ?? [];
  const questionText = pickText(config.question_i18n as Record<string, string>, locale);
  const illustration = config.illustration as Illustration | undefined;
  const selected = new Set(value ?? []);

  function toggle(id: string) {
    if (!isMulti) { onChange([id]); return; }
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange([...next]);
  }

  return (
    <>
      {illustration && <div className="mb-3"><IllustrationView illustration={illustration} /></div>}
      <p className="text-base font-medium text-foreground mb-3">{questionText}</p>
      <div className="space-y-2">
        {options.map((opt) => {
          const isSelected = selected.has(opt.id);
          const optText = pickText(opt.text_i18n, locale);
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
              {opt.image_url && <img src={opt.image_url} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />}
              {optText && <span className="text-sm">{optText}</span>}
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
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const sentence = pickText(config.sentence_i18n as Record<string, string>, locale);
  const illustration = config.illustration as Illustration | undefined;
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
    <>
      {illustration && <div className="mb-3"><IllustrationView illustration={illustration} /></div>}
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
    </>
  );
}

function ColoringQuestion({ config, value, onChange }: {
  config: ColoringConfig; value?: ColoringAnswer; onChange: (v: ColoringAnswer) => void;
}) {
  const [activeColor, setActiveColor] = useState(config.palette?.[0] ?? "#EF4444");
  const given = value ?? {};

  function paintRegion(regionId: string) {
    onChange({ ...given, [regionId]: activeColor });
  }

  return (
    <>
      <p className="text-sm text-muted-foreground mb-2">先选一个颜色，再点画布上要上色的区域</p>
      <div className="flex gap-1.5 mb-3">
        {(config.palette ?? []).map((c) => (
          <button
            key={c} type="button" onClick={() => setActiveColor(c)}
            className={`w-8 h-8 rounded-lg border-2 ${activeColor === c ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <svg viewBox={`0 0 ${config.canvas_width} ${config.canvas_height}`} className="w-full border border-border rounded-xl bg-white" style={{ maxWidth: 420 }}>
        {config.bg_image_url && <image href={config.bg_image_url} x={0} y={0} width={config.canvas_width} height={config.canvas_height} preserveAspectRatio="xMidYMid slice" />}
        {(config.regions ?? []).map((r) => {
          const fill = r.colorable ? (given[r.id] ?? "#f8fafc") : (r.decoration_color ?? "#e2e8f0");
          return (
            <ColoringShapeSvg
              key={r.id} region={r} fill={fill}
              onClick={r.colorable ? () => paintRegion(r.id) : undefined}
            />
          );
        })}
      </svg>
    </>
  );
}

// 数独——简化渲染，不复用SudokuGame.tsx(那个组件内建前端判分，跟考试
// 系统的后端判分模式不兼容)。给定数字直接显示，留空的格子用输入框，
// 答案key用"row-col"拼字符串。
function SudokuQuestion({ config, value, onChange }: {
  config: Record<string, unknown>; value?: Record<string, string>; onChange: (v: Record<string, string>) => void;
}) {
  const rows = (config.rows as number) ?? 3, cols = (config.cols as number) ?? 3;
  const givenCells = (config.given_cells as Array<{ row: number; col: number; value: string }>) ?? [];
  const blankCells = (config.blank_cells as Array<{ row: number; col: number }>) ?? [];
  const givenMap = new Map(givenCells.map((c) => [`${c.row}-${c.col}`, c.value]));
  const given = value ?? {};

  function setCell(row: number, col: number, v: string) {
    onChange({ ...given, [`${row}-${col}`]: v.replace(/[^1-9]/g, "").slice(0, 1) });
  }

  return (
    <div className="grid gap-1.5 w-fit mx-auto" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => {
          const key = `${r}-${c}`;
          const isGiven = givenMap.has(key);
          const isBlank = blankCells.some((b) => b.row === r && b.col === c);
          return (
            <div key={key} className="w-11 h-11 border border-border rounded-lg flex items-center justify-center bg-white">
              {isGiven ? (
                <span className="text-lg font-bold text-foreground">{givenMap.get(key)}</span>
              ) : isBlank ? (
                <input
                  type="text" inputMode="numeric" maxLength={1} value={given[key] ?? ""}
                  onChange={(e) => setCell(r, c, e.target.value)}
                  className="w-full h-full text-center text-lg font-semibold outline-none rounded-lg focus:bg-primary/5"
                />
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

// 贴纸游戏——简化成"点选式"而不是拖拽：先点贴纸盘里一张贴纸(选中)，
// 再点画布上要贴的槽位，就把这张贴纸分配给那个槽位。这个跟原本
// Activity版本的拖拽手感不一样，但更适合考试场景(判分本来就是离散
// 匹配，不是像素位置，点选式交互更贴合这个判定模型)。
function StickerGameQuestion({ config, value, onChange }: {
  config: Record<string, unknown>; value?: Record<string, string>; onChange: (v: Record<string, string>) => void;
}) {
  const objects = (config.objects as Array<{ id: string; x: number; y: number; w: number; h: number; rotation: number }>) ?? [];
  const tray = (config.tray as string[]) ?? [];
  // 贴纸游戏的画布不是存在config里的字段，是全局固定常量(见
  // frontend/src/lib/gameCanvas.ts 的 STICKER_CANVAS_SIZE，之前重构贴纸
  // 游戏时改成的正方形坐标系)，这里直接用同一个常量，不从config读。
  const canvasW = STICKER_CANVAS_SIZE, canvasH = STICKER_CANVAS_SIZE;
  const [pickedSticker, setPickedSticker] = useState<string | null>(null);
  const given = value ?? {};
  const usedStickers = new Set(Object.values(given));

  function placeSticker(objectId: string) {
    if (!pickedSticker) return;
    onChange({ ...given, [objectId]: pickedSticker });
    setPickedSticker(null);
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-2">先点下面要用的贴纸，再点画布上对应的位置</p>
      <div
        className="relative w-full rounded-xl overflow-hidden bg-white border border-border mb-3"
        style={{ aspectRatio: `${canvasW} / ${canvasH}`, backgroundImage: config.bg_image_url ? `url(${config.bg_image_url})` : undefined, backgroundSize: "100% 100%" }}
      >
        {objects.map((o) => {
          const placed = given[o.id];
          return (
            <button
              key={o.id} type="button" onClick={() => placeSticker(o.id)}
              className="absolute -translate-x-1/2 -translate-y-1/2 border-2 border-dashed border-primary/50 rounded-lg bg-white/60 flex items-center justify-center overflow-hidden"
              style={{ left: `${(o.x / canvasW) * 100}%`, top: `${(o.y / canvasH) * 100}%`, width: `${(o.w / canvasW) * 100}%`, height: `${(o.h / canvasH) * 100}%` }}
            >
              {placed && <img src={placed} alt="" className="w-full h-full object-contain" />}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        {tray.map((url, i) => {
          const isUsed = usedStickers.has(url);
          return (
            <button
              key={i} type="button" onClick={() => !isUsed && setPickedSticker(url)}
              disabled={isUsed}
              className={`w-14 h-14 rounded-lg border-2 bg-white p-1 ${
                isUsed ? "opacity-30" : pickedSticker === url ? "border-primary ring-2 ring-primary/30" : "border-border"
              }`}
            >
              <img src={url} alt="" className="w-full h-full object-contain" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
