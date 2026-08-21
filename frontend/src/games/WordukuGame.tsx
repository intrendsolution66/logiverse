// frontend/src/games/WordukuGame.tsx
//
// Worduku — 数独的文字版。行/列/宫规则完全跟数独一样(每个字母各出现
// 一次)，多一条"揭晓单词"的路径——designer在编辑器里挑了N个格子标上
// 顺序(1..N，N=目标单词字母数)，这几个格子按顺序连起来正好拼出一个
// 单词。这个组件只知道"哪些格子是这条路径、第几步"(path_step)，不
// 知道目标单词本身是什么——那是要藏起来的谜底，答案只在服务器端核对
// (见 checkWorduku)，跟数独同一个安全模型。
//
// 网格渲染/宫线/响应式尺寸这几块直接照抄 SudokuGame.tsx 已经修好的版本
// (aspect-ratio用cols/rows、box_rows/box_cols画粗分隔线、iPad响应式
// 高度计算)，只是数字输入换成单个字母(A-Z)，外加"揭晓路径"格子的特殊
// 高亮样式。

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
  worduku_title:  { zh: "🔤 Worduku", en: "🔤 Worduku", ms: "🔤 Worduku" },
  reveal_hint:    { zh: "彩色格子连起来会拼出一个单词", en: "The highlighted cells spell a hidden word", ms: "Petak berwarna mengeja satu perkataan" },
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

export interface WordukuGivenCell { row: number; col: number; value: string; path_step?: number }
export interface WordukuBlankCell { row: number; col: number; path_step?: number } // 没有answer——见文件头说明

export interface WordukuConfig {
  language: "en" | "bm"; // 出题语言——影响哪套字母/单词，不是界面文字的zh/en/ms那套三语言系统
  rows: number; cols: number;
  box_rows?: number; box_cols?: number;
  given_cells: WordukuGivenCell[];
  blank_cells: WordukuBlankCell[]; // 顺序 = 提交答案数组的顺序
  line_color?: string; given_color?: string; blank_bg?: string;
  difficulty: "easy" | "medium" | "hard" | "custom";
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string; ms?: string };
}
export interface WordukuResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

export default function WordukuGame({ levelId, config, onComplete, locale = "zh" }: {
  levelId: string; config: WordukuConfig; onComplete: (r: WordukuResult) => void; locale?: Locale;
}) {
  const rows = config.rows, cols = config.cols;
  const boxRows = config.box_rows ?? rows, boxCols = config.box_cols ?? cols;
  const activeCells = config.blank_cells;
  const givenCells = config.given_cells;

  const [values, setValues] = useState<string[]>(() => activeCells.map(() => ""));
  const [correctness, setCorrectness] = useState<boolean[] | null>(null);
  const [solution, setSolution] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const [cellPx, setCellPx] = useState(0);
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCellPx(w / cols);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [cols]);

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  function updateValue(i: number, raw: string) {
    // 只留一个英文字母，自动转大写——玩家可能大小写混着打，统一大写
    // 方便显示，判分那边(checkWorduku)也是大小写不敏感比对。
    const letter = raw.replace(/[^a-zA-Z]/g, "").slice(-1).toUpperCase();
    setValues((vs) => vs.map((v, idx) => (idx === i ? letter : v)));
    if (letter && i < activeCells.length - 1) inputRefs.current[i + 1]?.focus();
  }

  async function handleSubmit() {
    if (checking) return;
    setChecking(true);
    try {
      const submitValues = values.map((v) => v || null);
      const result = await eduApi.checkWorduku(levelId, submitValues);
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
    setValues(solution);
  }

  const filledCount = values.filter(Boolean).length;

  const blankCellPositions = useMemo(
    () => activeCells.map((c) => ({ x: (c.col + 0.5) / cols, y: (c.row + 0.5) / rows })),
    [activeCells, rows, cols]
  );

  return (
    <div className="max-w-5xl mx-auto w-full">
      <div className="flex justify-between items-center text-base font-medium text-muted-foreground mb-3 flex-wrap gap-2">
        <span>{lt("worduku_title", locale)} <span className="text-xs">{(DIFFICULTY_LABELS_LOCAL[config.difficulty]?.[locale]) ?? config.difficulty}</span></span>
        <span>{lt("time_filled", locale, { s: elapsed.toFixed(1), a: filledCount, b: activeCells.length })}</span>
      </div>
      {(config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en) ? (
        <p className="text-center text-lg font-semibold text-foreground mb-1">{config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en}</p>
      ) : (
        <p className="text-center text-sm text-muted-foreground mb-1">{lt("reveal_hint", locale)}</p>
      )}

      {/* 棋盘尺寸同时被容器宽度和可用视口高度两头卡住(min())——照抄
          SudokuGame.tsx 修过的写法，避免在iPad这种宽而矮的屏幕上棋盘
          比屏幕还高，逼着往下滚动才看得到"提交答案"按钮。 */}
      <div
        ref={boardRef}
        className="relative mx-auto rounded-2xl mb-4 bg-white overflow-hidden shadow-lg ring-1 ring-black/5"
        style={{ aspectRatio: `${cols} / ${rows}`, width: `min(100%, calc((100dvh - 280px) * ${cols / rows}))` }}
      >
        <svg viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
          {/* 揭晓路径——给这条路径上每个格子(不分给定/留空)画一块半透明
              的高亮底色，学生能看出"这几格连起来会拼出一个单词"，但看
              不出单词本身是什么(只有已经填对/给定的字母才看得到实际
              内容，留空的格子填对之前只看到高亮框，不会提前泄漏)。 */}
          {[...givenCells, ...activeCells].filter((c) => c.path_step).map((c, i) => (
            <rect key={`path${i}`} x={c.col + 0.04} y={c.row + 0.04} width={0.92} height={0.92} rx={0.08}
              fill="#fbbf2433" stroke="#f59e0b" strokeWidth={0.03} />
          ))}
          {Array.from({ length: rows + 1 }, (_, r) => (
            <line key={`r${r}`} x1={0} y1={r} x2={cols} y2={r} stroke={config.line_color ?? "#333"} strokeWidth={r === 0 || r === rows || r % boxRows === 0 ? 0.08 : 0.012} />
          ))}
          {Array.from({ length: cols + 1 }, (_, c) => (
            <line key={`c${c}`} x1={c} y1={0} x2={c} y2={rows} stroke={config.line_color ?? "#333"} strokeWidth={c === 0 || c === cols || c % boxCols === 0 ? 0.08 : 0.012} />
          ))}
          {givenCells.map((c, i) => (
            <text key={i} x={c.col + 0.5} y={c.row + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={0.5} fontWeight="bold" fill={config.given_color ?? "#222"}>
              {c.value}
            </text>
          ))}
        </svg>

        {activeCells.map((c, i) => {
          const isCorrect = correctness?.[i];
          const showColor = correctness !== null;
          const pos = blankCellPositions[i];
          const onPath = !!c.path_step;
          return (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text" inputMode="text" maxLength={1}
              value={values[i]}
              disabled={finished}
              onChange={(e) => updateValue(i, e.target.value)}
              className={`absolute -translate-x-1/2 -translate-y-1/2 text-center font-bold uppercase rounded border-2 outline-none transition-colors ${
                showColor
                  ? isCorrect ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-red-500 bg-red-50 text-red-600"
                  : onPath ? "border-amber-500 bg-amber-50/70 text-amber-900 focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
                  : "border-sky-400 bg-white/95 text-sky-900 focus:border-sky-600 focus:ring-2 focus:ring-sky-200"
              }`}
              style={{
                left: `${pos.x * 100}%`, top: `${pos.y * 100}%`,
                width: `${(1 / cols) * 100 * 0.8}%`,
                aspectRatio: "1 / 1",
                fontSize: cellPx ? `${cellPx * 0.5}px` : "clamp(12px, 2.2vw, 22px)",
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
