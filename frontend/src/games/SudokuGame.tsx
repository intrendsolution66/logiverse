// frontend/src/games/SudokuGame.tsx
//
// 数独 — authored content，两种模式并存：
//
//   "photo"（旧，默认）—— 一张拍好/找好的真实数独图片，设计师标出哪些
//   格子是空的(cells:{x,y}[])。正确答案从不发到前端，靠 eduApi.
//   checkSudoku 服务器端核对（见 courses.controller.ts 的 getLevel sudoku
//   分支）——发下来的话，学生开始答题前答案就已经躺在 network tab 里了。
//
//   "grid"（新，SceneEditor 里"自己画网格"那个新功能存出来的）—— 没有
//   照片了，整个网格是前端自己画的，所以"给定的数字"(given_cells)必须
//   发给前端才能画出来（这些数字本来就是明摆着给学生看的，不是要藏的
//   答案）；但"该留空、要学生填"的格子(blank_cells)只送位置，不送答案，
//   跟 photo 模式同一套"答案只在服务器端"的安全模型，一样靠
//   checkSudoku 核对——blank_cells 数组的顺序 = 提交答案数组的顺序，跟
//   旧模式 cells 数组是同一个约定，这样 checkSudoku 那支 API 不用大改，
//   只是服务器端要多认得"这个 Activity 存的是 grid 结构而不是 cells
//   位置"这件事（这部分需要后端配合，这个文件这边只负责发对格式）。
//
// Input works with keyboard, mouse, AND touch the same way any standard
// HTML form input does — each blank cell is a real <input type="tel">
// (numeric-only via inputMode/pattern), so a physical keyboard just works,
// and mobile browsers show their native numeric keypad automatically.
// No custom virtual keyboard needed to satisfy "键盘+鼠标、触控".
//
// i18n: zh/en/ms 已支持(界面文字) — 见 frontend/src/lib/gameLocale.ts。
// question_i18n 是designer自己填的authored题目文字，这次没扩展它加ms。

import { useState, useRef, useEffect, useMemo } from "react";
import { eduApi } from "@/api";
import { Button } from "@/components/ui/button";
import { type Locale, type Dict, t } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  checking:       { zh: "检查中...", en: "Checking...", ms: "Menyemak..." },
  submit_answer:  { zh: "✅ 提交答案", en: "✅ Submit answer", ms: "✅ Hantar jawapan" },
  all_correct:    { zh: "🎉 全部正确！", en: "🎉 All correct!", ms: "🎉 Semua betul!" },
  correct_count:  { zh: "对了 {a} / {b} 个", en: "{a} / {b} correct", ms: "{a} / {b} betul" },
  view_answer:    { zh: "👀 查看答案", en: "👀 View answer", ms: "👀 Lihat jawapan" },
  time_filled:    { zh: "⏱️ 用时 {s}s · 已填 {a}/{b}", en: "⏱️ Time {s}s · Filled {a}/{b}", ms: "⏱️ Masa {s}s · Diisi {a}/{b}" },
  sudoku_title:   { zh: "🔢 数独", en: "🔢 Sudoku", ms: "🔢 Sudoku" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}
const DIFFICULTY_LABELS_LOCAL: Record<string, Dict> = {
  easy:   { zh: "😊 简单", en: "😊 Easy", ms: "😊 Mudah" },
  medium: { zh: "🙂 中等", en: "🙂 Medium", ms: "🙂 Sederhana" },
  hard:   { zh: "😤 困难", en: "😤 Hard", ms: "😤 Sukar" },
  custom: { zh: "🎯 自定义", en: "🎯 Custom", ms: "🎯 Tersuai" },
};

// grid 模式的给定数字——row/col 是 0 起算的格子坐标，value 是要显示的数字/内容
export interface SudokuGivenCell { row: number; col: number; value: string }
// grid 模式要学生填的格子——只有位置，没有答案（答案在服务器）
export interface SudokuBlankCell { row: number; col: number }

export interface SudokuConfig {
  layout?: "photo" | "grid"; // 不传视为 "photo"（旧数据兼容）
  // photo 模式专用
  bg_image_url?: string;
  cells?: { x: number; y: number }[]; // 没有 answer——见文件头说明
  // grid 模式专用
  rows?: number; cols?: number;
  given_cells?: SudokuGivenCell[];
  blank_cells?: SudokuBlankCell[]; // 顺序 = 提交答案数组的顺序
  line_color?: string; given_color?: string; blank_bg?: string;
  difficulty: "easy" | "medium" | "hard" | "custom";
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string };
}
export interface SudokuResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

export default function SudokuGame({ levelId, config, onComplete, locale = "zh" }: {
  levelId: string; config: SudokuConfig; onComplete: (r: SudokuResult) => void; locale?: Locale;
}) {
  const isGrid = config.layout === "grid";
  // 两种模式统一成同一份"要填的格子"清单——photo模式是 config.cells，
  // grid模式是 config.blank_cells，下面的填值/提交/计分逻辑完全共用，
  // 不用分两套。只有"怎么画出格子的位置"这件事，两种模式不一样。
  const activeCells = isGrid ? (config.blank_cells ?? []) : (config.cells ?? []);
  const rows = config.rows ?? 1, cols = config.cols ?? 1;
  const givenCells = config.given_cells ?? [];

  const [values, setValues] = useState<string[]>(() => activeCells.map(() => ""));
  const [correctness, setCorrectness] = useState<boolean[] | null>(null); // null = not checked yet
  const [solution, setSolution] = useState<number[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  function updateValue(i: number, raw: string) {
    const digit = raw.replace(/[^1-9]/g, "").slice(-1); // one digit, 1-9 only — 0 isn't a valid sudoku digit
    setValues((vs) => vs.map((v, idx) => (idx === i ? digit : v)));
    if (digit && i < activeCells.length - 1) inputRefs.current[i + 1]?.focus(); // auto-advance, handy for keyboard entry
  }

  async function handleSubmit() {
    if (checking) return;
    setChecking(true);
    try {
      const numericValues = values.map((v) => (v ? parseInt(v, 10) : null));
      const result = await eduApi.checkSudoku(levelId, numericValues);
      setCorrectness(result.correct);
      setSolution(result.solution);
      const mistakes = result.correct.filter((c) => !c).length;
      setFinished(true);
      onComplete({
        score: result.allCorrect ? 1 : Math.max(0, (activeCells.length - mistakes) / activeCells.length),
        max_score: 1,
        time_spent_seconds: (Date.now() - startRef.current) / 1000,
        mistakes, completed: true,
      });
    } finally {
      setChecking(false);
    }
  }

  function revealAnswer() {
    if (!solution) return;
    setValues(solution.map(String));
  }

  const filledCount = values.filter(Boolean).length;

  // grid 模式的格子中心位置（0-1比例）——行/列换算成百分比，跟 photo
  // 模式的 c.x/c.y 是同一套坐标约定，下面渲染的时候两种模式能共用同一
  // 段 style={{ left, top }} 逻辑。
  const blankCellPositions = useMemo(() => {
    if (!isGrid) return [];
    // isGrid 为真的时候 activeCells 实际上就是 config.blank_cells（见上面
    // activeCells 的定义），但 TS 没法从 isGrid 这个变量反推出 activeCells
    // 的具体类型（两者只是我们逻辑上知道相关，类型系统看不出这层关系），
    // 这里显式转型告诉它。
    const gridCells = activeCells as SudokuBlankCell[];
    return gridCells.map((c) => ({ x: (c.col + 0.5) / cols, y: (c.row + 0.5) / rows }));
  }, [isGrid, activeCells, rows, cols]);

  return (
    <div className="max-w-5xl mx-auto w-full">
      <div className="flex justify-between items-center text-base font-medium text-muted-foreground mb-3 flex-wrap gap-2">
        <span>{lt("sudoku_title", locale)} <span className="text-xs">{(DIFFICULTY_LABELS_LOCAL[config.difficulty]?.[locale]) ?? config.difficulty}</span></span>
        <span>{lt("time_filled", locale, { s: elapsed.toFixed(1), a: filledCount, b: activeCells.length })}</span>
      </div>
      {(config.question_i18n?.zh || config.question_i18n?.en) && (
        <p className="text-center text-lg font-semibold text-foreground mb-3">{config.question_i18n?.zh || config.question_i18n?.en}</p>
      )}

      <div
        className="relative w-full aspect-[11/7] rounded-2xl mb-4 bg-white overflow-hidden shadow-lg ring-1 ring-black/5"
        style={isGrid ? undefined : { backgroundImage: `url(${config.bg_image_url})`, backgroundSize: "100% 100%", backgroundPosition: "center" }}
      >
        {/* grid 模式——自己画网格线 + 给定数字，photo 模式这一块完全没有（线/数字都在照片里） */}
        {isGrid && (
          <svg viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
            {Array.from({ length: rows + 1 }, (_, r) => (
              <line key={`r${r}`} x1={0} y1={r} x2={cols} y2={r} stroke={config.line_color ?? "#333"} strokeWidth={r === 0 || r === rows ? 0.06 : 0.02} vectorEffect="non-scaling-stroke" />
            ))}
            {Array.from({ length: cols + 1 }, (_, c) => (
              <line key={`c${c}`} x1={c} y1={0} x2={c} y2={rows} stroke={config.line_color ?? "#333"} strokeWidth={c === 0 || c === cols ? 0.06 : 0.02} vectorEffect="non-scaling-stroke" />
            ))}
            {givenCells.map((c, i) => (
              <text
                key={i} x={c.col + 0.5} y={c.row + 0.5} textAnchor="middle" dominantBaseline="central"
                fontSize={0.55} fontWeight="bold" fill={config.given_color ?? "#222"}
              >
                {c.value}
              </text>
            ))}
          </svg>
        )}

        {activeCells.map((c, i) => {
          const isCorrect = correctness?.[i];
          const showColor = correctness !== null;
          const pos = isGrid ? blankCellPositions[i] : (c as { x: number; y: number });
          return (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="tel" inputMode="numeric" pattern="[1-9]" maxLength={1}
              value={values[i]}
              disabled={finished}
              onChange={(e) => updateValue(i, e.target.value)}
              className={`absolute -translate-x-1/2 -translate-y-1/2 text-center font-bold rounded border-2 outline-none transition-colors ${
                showColor
                  ? isCorrect ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-red-500 bg-red-50 text-red-600"
                  : "border-sky-400 bg-white/95 text-sky-900 focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
              }`}
              style={{
                left: `${pos.x * 100}%`, top: `${pos.y * 100}%`,
                width: isGrid ? `${(1 / cols) * 100 * 0.8}%` : "6.5%",
                aspectRatio: "1 / 1", fontSize: "clamp(12px, 2.2vw, 22px)",
              }}
            />
          );
        })}
      </div>

      {!finished ? (
        <div className="flex justify-center">
          <Button onClick={handleSubmit} disabled={checking || filledCount === 0}>
            {checking ? lt("checking", locale) : lt("submit_answer", locale)}
          </Button>
        </div>
      ) : (
        <div className="text-center space-y-3">
          <p className={`text-lg font-semibold ${correctness?.every(Boolean) ? "text-emerald-600" : "text-amber-600"}`}>
            {correctness?.every(Boolean) ? lt("all_correct", locale) : lt("correct_count", locale, { a: correctness?.filter(Boolean).length ?? 0, b: activeCells.length })}
          </p>
          {!correctness?.every(Boolean) && (
            <Button variant="outline" onClick={revealAnswer}>{lt("view_answer", locale)}</Button>
          )}
        </div>
      )}
    </div>
  );
}
