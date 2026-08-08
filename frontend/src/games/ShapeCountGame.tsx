// frontend/src/games/ShapeCountGame.tsx
//
// 平面数方块 (经典"数格子图里有几个正方形/长方形") — pure procedural, no
// authored assets at all: the "image" is just an SVG grid drawn from N
// rows × M cols, and the answer is a closed-form formula, so correctness
// is guaranteed by construction rather than by counting shapes in a
// pre-made picture. Same 10-level adaptive difficulty curve family style
// as the CubeStack modules (correct → harder grid, wrong → easier), kept
// self-contained per this codebase's convention rather than sharing code
// with those files even though the curve shape is conceptually similar.
//
// 正方形 (squares): only literal squares, all sizes k=1..min(rows,cols).
//   count = Σ (rows-k+1)(cols-k+1) for k=1..min(rows,cols)
// 长方形 (rectangles): ALL axis-aligned rectangles, chosen by picking any
//   2 of the (rows+1) horizontal lines and any 2 of the (cols+1) vertical
//   lines — this INCLUDES every square as a special case (standard
//   mathematical convention: a square is a rectangle), so the 长方形
//   question explicitly reminds the student of that rather than silently
//   assuming they already know the convention.
//   count = C(rows+1, 2) × C(cols+1, 2)
//
// i18n: zh/en/ms 已支持(界面文字) — 见 frontend/src/lib/gameLocale.ts。
// 这是最后一个接入试点的游戏文件——12个游戏至此全部完成。
// question_i18n 现在CourseDesignerPage.tsx已经支持三语言输入了(zh/en/ms)，
// 运行时读取顺序是"当前locale优先，没填再退回zh，还没填再退回en"。
// object_type 标签不在这次范围内——那是分类用的匹配key，不是给人看的
// 展示文字，翻译它会连带需要改判定逻辑。

import { useState, useEffect, useCallback, useRef } from "react";
import { GAME_CANVAS_W, GAME_CANVAS_H } from "@/lib/gameCanvas";
import { type Locale, type Dict, t, questionProgress } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  practice_done:   { zh: "答对 {c} / {n} 题", en: "{c} / {n} correct", ms: "{c} / {n} betul" },
  ask_square:      { zh: "这张图里一共有多少个正方形？", en: "How many squares are there in this picture?", ms: "Berapakah jumlah segi empat sama dalam gambar ini?" },
  ask_rectangle:   { zh: "这张图里一共有多少个长方形？", en: "How many rectangles are there in this picture?", ms: "Berapakah jumlah segi empat tepat dalam gambar ini?" },
  rect_note:       { zh: "（正方形也是长方形的一种，也要数进去哦）", en: "(A square counts as a rectangle too — include those)", ms: "(Segi empat sama juga dikira sebagai segi empat tepat — kira sekali)" },
  enter_answer:    { zh: "输入答案", en: "Enter answer", ms: "Masukkan jawapan" },
  correct_level_up:{ zh: "🎉 答对了！难度提升一级", en: "🎉 Correct! Level up", ms: "🎉 Betul! Naik tahap" },
  answer_level_down:{ zh: "答案是 {n} 个（难度降一级）", en: "The answer is {n} (level down)", ms: "Jawapannya ialah {n} (tahap turun)" },
  all_correct:     { zh: "全部答对了！", en: "All correct!", ms: "Semua betul!" },
  correct_kinds:   { zh: "答对 {n} / 3 种", en: "{n} / 3 correct", ms: "{n} / 3 betul" },
  wrong_answer_was:{ zh: "✗ (答案{n})", en: "✗ (answer: {n})", ms: "✗ (jawapan: {n})" },
  count_prompt:    { zh: "数一数，每种图形各有多少个？", en: "Count how many of each shape there are", ms: "Kira berapa banyak setiap bentuk" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}
const SHAPE_KIND_LABEL_LOCAL: Record<string, Dict> = {
  square:   { zh: "正方形", en: "Square", ms: "Segi empat sama" },
  circle:   { zh: "圆形", en: "Circle", ms: "Bulatan" },
  triangle: { zh: "三角形", en: "Triangle", ms: "Segi tiga" },
};

export type ShapeAskType = "square" | "rectangle"; // 只有 grid 模式用得到——问正方形还是长方形
// custom 模式下画的形状——跟 SceneEditor.tsx 的 StructuredSceneOutput.shapes
// 是同一个数据形状。坐标约定沿用这个项目其它自定义场景游戏(focus_tap/
// counting)的老规矩：x/y 存的是"占画布宽高的比例"(0~1，已经除过
// GAME_CANVAS_W/H)，w/h 存的是原始画布像素值(还没除)，渲染的时候才
// 换算成百分比——两种单位混着存是这个项目的既有约定，不是我这次新发明的。
export interface ShapeCountShapeItem {
  shape: "rect" | "ellipse" | "line" | "triangle";
  x: number; y: number; w: number; h: number; rotation: number;
  fillColor: string; fillEnabled: boolean; borderColor: string; borderEnabled: boolean; borderWidth: number;
  radius?: number; opacity?: number;
}
// custom 模式下摆的图片物件——同样对齐 SceneEditor 的 objects 输出，
// object_type 是设计师自己打的标签(不是固定"square"/"circle"/"triangle"
// 三选一，因为设计师可能想用一张自己画的"歪歪的正方形"图片，一样能
// 靠打标签算进对应类型)。坐标单位约定跟 ShapeCountShapeItem 一样。
export interface ShapeCountObjectItem {
  image_url: string; x: number; y: number; w: number; h: number; rotation: number;
  object_type?: string; flip_x?: boolean; flip_y?: boolean; opacity?: number;
}
export interface ShapeCountConfig {
  layout?: "grid" | "custom"; // 不传视为 "grid"(旧数据兼容)——现场生成网格数正方形/长方形那个模式
  // grid 模式专用
  ask_type: ShapeAskType | "both";
  starting_level: number;
  total_questions: number;
  // custom 模式专用——设计师自己画/摆的场景，单题(不是多题循环)，答案
  // 靠数shapes+objects里各类型有几个，不是公式算出来的
  bg_image_url?: string;
  shapes?: ShapeCountShapeItem[];
  objects?: ShapeCountObjectItem[];
  question_i18n?: { zh?: string; en?: string; ms?: string };
  // 共用
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
}
export interface ShapeCountResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
  ending_level?: number;
}

const LEVEL_MAX = 10;

// 网格边长随等级增长——2×2(最简单) 一路到 6×7(数量已经不少，得仔细数)
function levelGridSize(level: number): { rows: number; cols: number } {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  const base = 2 + Math.floor((L - 1) / 2); // 2,2,3,3,4,4,5,5,6,6
  const uneven = L >= 7 && L % 2 === 1;      // 高等级偶尔用非正方形网格，长方形数起来更有意思
  return { rows: base, cols: uneven ? base + 1 : base };
}

function choose2(n: number): number { return (n * (n - 1)) / 2; }

function countSquares(rows: number, cols: number): number {
  let total = 0;
  const maxK = Math.min(rows, cols);
  for (let k = 1; k <= maxK; k++) total += (rows - k + 1) * (cols - k + 1);
  return total;
}
function countRectangles(rows: number, cols: number): number {
  return choose2(rows + 1) * choose2(cols + 1);
}

interface Puzzle {
  rows: number; cols: number; askType: ShapeAskType; answer: number;
}

function genPuzzle(level: number, configAsk: ShapeAskType | "both"): Puzzle {
  const { rows, cols } = levelGridSize(level);
  const askType: ShapeAskType = configAsk === "both" ? (Math.random() < 0.5 ? "square" : "rectangle") : configAsk;
  const answer = askType === "square" ? countSquares(rows, cols) : countRectangles(rows, cols);
  return { rows, cols, askType, answer };
}

// 纯SVG画网格线——没有素材图，格线本身就是题目内容
function GridSvg({ rows, cols }: { rows: number; cols: number }) {
  const cell = 48;
  const w = cols * cell, h = rows * cell;
  const lines = [];
  for (let r = 0; r <= rows; r++) {
    lines.push(<line key={`h${r}`} x1={0} y1={r * cell} x2={w} y2={r * cell} stroke="#334155" strokeWidth={r === 0 || r === rows ? 3 : 2} />);
  }
  for (let c = 0; c <= cols; c++) {
    lines.push(<line key={`v${c}`} x1={c * cell} y1={0} x2={c * cell} y2={h} stroke="#334155" strokeWidth={c === 0 || c === cols ? 3 : 2} />);
  }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mx-auto" style={{ maxWidth: "100%", height: "auto", maxHeight: 320 }}>
      <rect x={0} y={0} width={w} height={h} fill="#f8fafc" />
      {lines}
    </svg>
  );
}

function GridShapeCountGame({ config, onComplete, locale }: {
  config: ShapeCountConfig; onComplete: (r: ShapeCountResult) => void; locale: Locale;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [level, setLevel] = useState(() => Math.min(LEVEL_MAX, Math.max(1, config.starting_level || 1)));
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [answered, setAnswered] = useState(false);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);

  const startRef = useRef(Date.now());
  const levelRef = useRef(level);
  levelRef.current = level;

  const finish = useCallback((completed: boolean) => {
    setFinished(true);
    onComplete({
      score: correctCount, max_score: config.total_questions,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes: mistakeCount, completed, ending_level: levelRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correctCount, mistakeCount, config.total_questions]);

  const nextQuestion = useCallback(() => {
    if (qIndex >= config.total_questions) { finish(true); return; }
    setPuzzle(genPuzzle(levelRef.current, config.ask_type ?? "both"));
    setAnswerText("");
    setAnswered(false);
    setCorrect(null);
    setQIndex((i) => i + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, config.ask_type]);

  useEffect(() => {
    startRef.current = Date.now();
    nextQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  useEffect(() => {
    if (config.timer_mode !== "countdown" || !config.time_limit || finished) return;
    if (elapsed >= config.time_limit) finish(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  function submitAnswer() {
    if (answered || !puzzle || answerText === "") return;
    setAnswered(true);
    const val = parseInt(answerText, 10);
    const isCorrect = val === puzzle.answer;
    setCorrect(isCorrect);
    if (isCorrect) {
      setCorrectCount((c) => c + 1);
      setStreak((s) => { const next = s + 1; setBestStreak((b) => Math.max(b, next)); return next; });
      setLevel((lv) => Math.min(LEVEL_MAX, lv + 1));
    } else {
      setMistakeCount((m) => m + 1);
      setStreak(0);
      setLevel((lv) => Math.max(1, lv - 1));
    }
  }

  const timerLabel = config.timer_mode === "countdown" ? t("time_left", locale) : t("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const accuracy = correctCount + mistakeCount > 0 ? Math.round((correctCount / (correctCount + mistakeCount)) * 100) : 0;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🔲</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {t("practice_complete", locale)}{lt("practice_done", locale, { c: correctCount, n: config.total_questions })}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{t("best_streak", locale)} {bestStreak}　{t("ending_level", locale)} Lv.{level}</div>
      </div>
    );
  }

  if (!puzzle) return null;

  return (
    <div className="max-w-xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3 flex-wrap gap-1">
        <span>{questionProgress(qIndex, config.total_questions, locale)}　Lv.{level}</span>
        <span>✅ {t("accuracy", locale)} {accuracy}%　🔥 {t("streak", locale)} {streak}　⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      <div className="bg-white dark:bg-card rounded-2xl p-4 mb-4 shadow-lg ring-1 ring-black/5">
        <GridSvg rows={puzzle.rows} cols={puzzle.cols} />
      </div>

      <p className="text-center text-lg font-semibold text-foreground mb-1">
        {puzzle.askType === "square" ? lt("ask_square", locale) : lt("ask_rectangle", locale)}
      </p>
      {puzzle.askType === "rectangle" && (
        <p className="text-center text-xs text-muted-foreground mb-3">{lt("rect_note", locale)}</p>
      )}

      {!answered ? (
        <div className="flex items-center justify-center gap-3 mt-3">
          <input
            type="tel" inputMode="numeric" value={answerText}
            onChange={(e) => setAnswerText(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && submitAnswer()}
            placeholder={lt("enter_answer", locale)}
            className="w-32 text-center text-2xl font-bold px-3 py-2 rounded-xl border-2 border-border bg-card"
          />
          <button
            onClick={submitAnswer}
            disabled={answerText === ""}
            className="text-lg font-semibold px-6 py-2.5 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
          >
            ✅ {t("submit", locale)}
          </button>
        </div>
      ) : (
        <div className="space-y-4 mt-3">
          <div className={`text-center text-lg font-medium px-4 py-3 rounded-xl ${
            correct ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
            : "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
          }`}>
            {correct ? lt("correct_level_up", locale) : lt("answer_level_down", locale, { n: puzzle.answer })}
          </div>
          <div className="flex justify-center">
            <button
              onClick={nextQuestion}
              className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors"
            >
              {t("next_question", locale)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── custom 模式：设计师自己画/摆的场景 ──────────────────────────────────────────
// 单题，不循环——跟 CountingGame 的 custom_scene 模式同一个定位，这是
// authored内容不是程序生成的题目，没有"下一题"这回事。判定走客户端直接
// 比较(shapes/objects数组本身就在前端手上)，不是server端核对隐藏答案——
// 跟贴纸游戏/点点数数自定义场景同一个"休闲游戏"安全等级，形状数量不是
// 需要防作弊的考题。
//
// 类型换算：shape:"rect"→正方形、shape:"ellipse"→圆形、shape:"triangle"→
// 三角形；再加上 objects 里 object_type 打了对应标签("square"/"circle"/
// "triangle")的那些一起算进同一个类型的总数——这样设计师不管是用画笔画
// 的、还是上传一张图片摆上去的，只要类型标签/形状种类对得上，都会被
// 数进同一个类别里，不用关心背后到底是哪种物件。
function countByKind(shapes: ShapeCountShapeItem[], objects: ShapeCountObjectItem[]) {
  const shapeKindOf: Record<string, string> = { rect: "square", ellipse: "circle", triangle: "triangle" };
  const counts: Record<string, number> = { square: 0, circle: 0, triangle: 0 };
  shapes.forEach((s) => {
    const kind = shapeKindOf[s.shape];
    if (kind) counts[kind] = (counts[kind] ?? 0) + 1;
  });
  objects.forEach((o) => {
    if (o.object_type && o.object_type in counts) counts[o.object_type] = (counts[o.object_type] ?? 0) + 1;
  });
  return counts;
}

// 跟 SceneEditor 画布上完全一样的几何——正方形/长方形(圆角可选)、椭圆、
// 三角形，用 SVG 画(不是 canvas)，方便直接用 DOM 事件、不用管坐标转换。
// x/y 是比例(0~1)，w/h 是原始画布像素值——外层容器换算成百分比再定位，
// 跟 CountingGame 自定义场景渲染物件用的是同一套单位约定。
function ShapeSvg({ s }: { s: ShapeCountShapeItem }) {
  const commonProps = {
    fill: s.fillEnabled ? s.fillColor : "none",
    stroke: s.borderEnabled ? s.borderColor : "none",
    strokeWidth: s.borderEnabled ? s.borderWidth : 0,
  };
  return (
    <svg
      viewBox={`0 0 ${s.w} ${s.h}`}
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${s.x * 100}%`, top: `${s.y * 100}%`,
        width: `${(s.w / GAME_CANVAS_W) * 100}%`, height: `${(s.h / GAME_CANVAS_H) * 100}%`,
        transform: `translate(-50%, -50%) rotate(${s.rotation ?? 0}deg)`,
        opacity: (s.opacity ?? 100) / 100,
        overflow: "visible",
      }}
    >
      {s.shape === "ellipse" ? (
        <ellipse cx={s.w / 2} cy={s.h / 2} rx={s.w / 2} ry={s.h / 2} {...commonProps} />
      ) : s.shape === "triangle" ? (
        <polygon points={`${s.w / 2},0 ${s.w},${s.h} 0,${s.h}`} {...commonProps} />
      ) : s.shape === "line" ? (
        <line x1={0} y1={s.h / 2} x2={s.w} y2={s.h / 2} stroke={s.borderColor} strokeWidth={Math.max(1, s.borderWidth)} strokeLinecap="round" />
      ) : (
        <rect x={0} y={0} width={s.w} height={s.h} rx={s.radius ?? 0} ry={s.radius ?? 0} {...commonProps} />
      )}
    </svg>
  );
}

function CustomShapeCountGame({ config, onComplete, locale }: {
  config: ShapeCountConfig; onComplete: (r: ShapeCountResult) => void; locale: Locale;
}) {
  const shapes = config.shapes ?? [];
  const objects = config.objects ?? [];
  const trueCounts = countByKind(shapes, objects);

  const [inputs, setInputs] = useState<Record<string, string>>({ square: "", circle: "", triangle: "" });
  const [answered, setAnswered] = useState(false);
  const [results, setResults] = useState<Record<string, boolean> | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  const allFilled = Object.values(inputs).every((v) => v !== "");

  function submitAnswer() {
    if (answered || !allFilled) return;
    setAnswered(true);
    const r: Record<string, boolean> = {};
    (["square", "circle", "triangle"] as const).forEach((k) => { r[k] = parseInt(inputs[k], 10) === trueCounts[k]; });
    setResults(r);
    const correctCount = Object.values(r).filter(Boolean).length;
    setFinished(true);
    onComplete({
      score: correctCount, max_score: 3,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes: 3 - correctCount, completed: true,
    });
  }

  const questionText = config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en || lt("count_prompt", locale);

  if (finished && results) {
    const allCorrect = Object.values(results).every(Boolean);
    return (
      <div className="text-center py-10">
        <div className="text-6xl">{allCorrect ? "🎉" : "🔲"}</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {allCorrect ? lt("all_correct", locale) : lt("correct_kinds", locale, { n: Object.values(results).filter(Boolean).length })}
        </div>
        <div className="text-sm text-muted-foreground mt-2 space-x-3">
          {(["square", "circle", "triangle"] as const).map((k) => (
            <span key={k} className={results[k] ? "text-emerald-600" : "text-red-500"}>
              {SHAPE_KIND_LABEL_LOCAL[k][locale]} {results[k] ? "✓" : lt("wrong_answer_was", locale, { n: trueCounts[k] })}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="flex justify-end text-base font-medium text-muted-foreground mb-3">
        <span>⏱️ {t("time_used", locale)} {elapsed.toFixed(1)}s</span>
      </div>

      <div
        className="relative w-full aspect-[11/7] rounded-2xl mb-5 bg-sky-50 dark:bg-sky-950/20 overflow-hidden shadow-lg ring-1 ring-black/5"
        style={config.bg_image_url ? { backgroundImage: `url(${config.bg_image_url})`, backgroundSize: "100% 100%", backgroundPosition: "center" } : undefined}
      >
        {shapes.map((s, i) => <ShapeSvg key={`shape-${i}`} s={s} />)}
        {objects.map((o, i) => {
          const flipX = o.flip_x ? -1 : 1, flipY = o.flip_y ? -1 : 1;
          return (
            <img
              key={`obj-${i}`} src={o.image_url} alt=""
              className="absolute object-contain -translate-x-1/2 -translate-y-1/2 drop-shadow"
              style={{
                left: `${o.x * 100}%`, top: `${o.y * 100}%`,
                width: `${(o.w / GAME_CANVAS_W) * 100}%`, height: `${(o.h / GAME_CANVAS_H) * 100}%`,
                opacity: (o.opacity ?? 100) / 100,
                transform: `translate(-50%, -50%) rotate(${o.rotation ?? 0}deg) scale(${flipX}, ${flipY})`,
              }}
            />
          );
        })}
      </div>

      <p className="text-center text-lg font-semibold text-foreground mb-4">{questionText}</p>

      <div className="flex flex-wrap gap-4 justify-center mb-4">
        {(["square", "circle", "triangle"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 bg-muted/40 rounded-xl px-4 py-2.5">
            <span className="text-base font-medium text-foreground">{SHAPE_KIND_LABEL_LOCAL[k][locale]}</span>
            <input
              type="tel" inputMode="numeric" value={inputs[k]}
              disabled={answered}
              onChange={(e) => setInputs((prev) => ({ ...prev, [k]: e.target.value.replace(/[^0-9]/g, "") }))}
              className="w-16 text-center text-xl font-bold px-2 py-1.5 rounded-lg border-2 border-border bg-card focus:border-primary outline-none"
              placeholder="?"
            />
          </label>
        ))}
      </div>

      <div className="flex justify-center">
        <button
          onClick={submitAnswer}
          disabled={!allFilled}
          className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
        >
          ✅ {t("submit", locale)}
        </button>
      </div>
    </div>
  );
}

export default function ShapeCountGame({ config, onComplete, locale = "zh" }: {
  config: ShapeCountConfig; onComplete: (r: ShapeCountResult) => void; locale?: Locale;
}) {
  if (config.layout === "custom") {
    return <CustomShapeCountGame config={config} onComplete={onComplete} locale={locale} />;
  }
  return <GridShapeCountGame config={config} onComplete={onComplete} locale={locale} />;
}
