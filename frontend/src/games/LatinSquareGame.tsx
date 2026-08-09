// frontend/src/games/LatinSquareGame.tsx
//
// 图形排排看 — 经典"每行每列图形都不能重复"练习(拉丁方阵，跟数独同一
// 个数学结构，但没有"宫"这个额外限制，只要行+列不重复就行)。1-10级
// 自适应难度，等级决定网格边长N(4×4起步，最高到8×8)。
//
// 生成方式：先造一个"循环位移"的基础拉丁方阵(第r行 = icons整体位移r
// 格)，这个结构天生保证每行每列都不重复；再把行的顺序、列的顺序各自
// 随机打乱一次——打乱整行/整列的顺序不会破坏"每行每列不重复"这个性质
// (这是拉丁方阵的一个基本事实)，这样出来的题目看起来不会一眼看出规律。
// 图标本身用哪几个、指派给哪个位置也是随机的，纯生成参数、没有素材图。
//
// 判定：直接跟生成时留存的这份完整方阵比对(不是"任何合法拉丁方阵都算
// 对"，是"必须填出跟生成的这一份一样")，逻辑最简单，小孩子的练习也
// 不需要真的做"多解验证"。
//
// i18n: zh/en/ms 已支持 — 见 frontend/src/lib/gameLocale.ts

import { useState, useEffect, useCallback, useRef } from "react";
import { type Locale, type Dict, t, questionProgress } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  no_repeat_hint: { zh: "每一行、每一列的图形都不能重复哦", en: "No shape can repeat in any row or column", ms: "Tiada bentuk boleh berulang dalam mana-mana baris atau lajur" },
  pick_prompt:    { zh: "选一个图形放进去", en: "Pick a shape to place here", ms: "Pilih bentuk untuk diletakkan di sini" },
  submit:         { zh: "✅ 提交", en: "✅ Submit", ms: "✅ Hantar" },
  next_question:  { zh: "下一题", en: "Next question", ms: "Soalan seterusnya" },
  correct_level_up: { zh: "🎉 全部排对了！难度提升一级", en: "🎉 All correct! Level up", ms: "🎉 Semua betul! Naik tahap" },
  wrong_level_down: { zh: "有几格不对哦，红色标出来了（难度降一级）", en: "Some cells are wrong — shown in red (level down)", ms: "Ada sel yang salah — ditunjukkan merah (tahap turun)" },
  practice_done:  { zh: "练习完成！答对 {c} / {n} 题", en: "Practice complete! {c} / {n} correct", ms: "Latihan selesai! {c} / {n} betul" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

export type LatinTheme = "shape" | "animal" | "fruit" | "emotion";
export interface LatinSquareConfig {
  starting_level: number; // 1-10，网格边长的自适应难度
  total_questions: number;
  theme: LatinTheme;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
}
export interface LatinSquareResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
  ending_level?: number;
}

const LEVEL_MAX = 10;

const THEME_ICONS: Record<LatinTheme, string[]> = {
  shape:   ["🟦", "🔶", "❤️", "⭐", "🟢", "🔺", "🔵", "🟪"],
  animal:  ["🐶", "🐱", "🐰", "🐻", "🦊", "🐼", "🐨", "🦁"],
  fruit:   ["🍎", "🍌", "🍇", "🍓", "🍑", "🍍", "🥝", "🍉"],
  emotion: ["😀", "😢", "😡", "😱", "😴", "😍", "🤔", "😎"],
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 等级 → 网格边长：4×4起步，每2级加1，最高8×8(再大格子会太挤，touchscreen
// 操作也会变得吃力，这个年龄段没必要做到更大)
function levelSize(level: number): number {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  return 4 + Math.floor((L - 1) / 2); // 4,4,5,5,6,6,7,7,8,8
}

interface Puzzle {
  n: number;
  icons: string[];             // 这一题用到的n个图标(已经打乱过顺序)
  solution: number[][];        // n×n，值是icons数组的index
  blanks: Set<string>;         // "r-c" 格式，标记哪些格子是空的(需要学生填)
}

function genPuzzle(level: number, theme: LatinTheme): Puzzle {
  const n = levelSize(level);
  const pool = THEME_ICONS[theme] ?? THEME_ICONS.shape;
  const icons = shuffle(pool).slice(0, n);

  // 循环位移基础方阵(indices 0..n-1)，天生满足行列不重复
  let grid: number[][] = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (r + c) % n));

  // 打乱行顺序 + 打乱列顺序——整行/整列一起挪动，不破坏"不重复"这个性质
  const rowOrder = shuffle(Array.from({ length: n }, (_, i) => i));
  grid = rowOrder.map((r) => grid[r]);
  const colOrder = shuffle(Array.from({ length: n }, (_, i) => i));
  grid = grid.map((row) => colOrder.map((c) => row[c]));

  // 大约留一半格子当空格，每行至少留1个空格(不然有的行变成"整行都给好
  // 了"，没什么可练的)
  const blanks = new Set<string>();
  for (let r = 0; r < n; r++) {
    const cols = shuffle(Array.from({ length: n }, (_, i) => i));
    const blankCount = Math.max(1, Math.round(n * 0.5));
    for (let i = 0; i < blankCount; i++) blanks.add(`${r}-${cols[i]}`);
  }

  return { n, icons, solution: grid, blanks };
}

export default function LatinSquareGame({ config, onComplete, locale = "zh" }: {
  config: LatinSquareConfig; onComplete: (r: LatinSquareResult) => void; locale?: Locale;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [level, setLevel] = useState(() => Math.min(LEVEL_MAX, Math.max(1, config.starting_level || 1)));
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [filled, setFilled] = useState<Record<string, number>>({}); // "r-c" -> icon index，只记录学生填的那些空格
  const [pickerCell, setPickerCell] = useState<string | null>(null); // 当前弹出图形选择面板的是哪个格子
  const [answered, setAnswered] = useState(false);
  const [cellResults, setCellResults] = useState<Record<string, boolean> | null>(null);
  const [status, setStatus] = useState<{ msg: string; kind: "" | "good" | "bad" }>({ msg: "", kind: "" });
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
    setPuzzle(genPuzzle(levelRef.current, config.theme ?? "shape"));
    setFilled({});
    setPickerCell(null);
    setAnswered(false);
    setCellResults(null);
    setStatus({ msg: "", kind: "" });
    setQIndex((i) => i + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, config.theme]);

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

  function handleCellClick(key: string) {
    if (answered || !puzzle?.blanks.has(key)) return; // 只有空格能点，题目给好的格子不能改
    setPickerCell(key);
  }

  function placeIcon(key: string, iconIdx: number) {
    setFilled((prev) => ({ ...prev, [key]: iconIdx }));
    setPickerCell(null);
  }

  const allBlanksFilled = puzzle ? [...puzzle.blanks].every((k) => filled[k] !== undefined) : false;

  function submitAnswer() {
    if (answered || !puzzle || !allBlanksFilled) return;
    setAnswered(true);
    const results: Record<string, boolean> = {};
    let allCorrect = true;
    puzzle.blanks.forEach((key) => {
      const [r, c] = key.split("-").map(Number);
      const ok = filled[key] === puzzle.solution[r][c];
      results[key] = ok;
      if (!ok) allCorrect = false;
    });
    setCellResults(results);
    if (allCorrect) {
      setCorrectCount((c) => c + 1);
      setStreak((s) => { const next = s + 1; setBestStreak((b) => Math.max(b, next)); return next; });
      setLevel((lv) => Math.min(LEVEL_MAX, lv + 1));
      setStatus({ msg: lt("correct_level_up", locale), kind: "good" });
    } else {
      setMistakeCount((m) => m + 1);
      setStreak(0);
      setLevel((lv) => Math.max(1, lv - 1));
      setStatus({ msg: lt("wrong_level_down", locale), kind: "bad" });
    }
  }

  const timerLabel = config.timer_mode === "countdown" ? t("time_left", locale) : t("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const accuracy = correctCount + mistakeCount > 0 ? Math.round((correctCount / (correctCount + mistakeCount)) * 100) : 0;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🧩</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {lt("practice_done", locale, { c: correctCount, n: config.total_questions })}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{t("best_streak", locale)} {bestStreak}　{t("ending_level", locale)} Lv.{level}</div>
      </div>
    );
  }

  if (!puzzle) return null;

  return (
    <div className="max-w-xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3 flex-wrap gap-1">
        <span>{questionProgress(qIndex, config.total_questions, locale)}　Lv.{level}　{puzzle.n}×{puzzle.n}</span>
        <span>✅ {t("accuracy", locale)} {accuracy}%　🔥 {t("streak", locale)} {streak}　⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      <p className="text-center text-sm text-muted-foreground mb-3">{lt("no_repeat_hint", locale)}</p>

      <div className="bg-white dark:bg-card rounded-2xl p-3 mb-4 shadow-lg ring-1 ring-black/5">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${puzzle.n}, minmax(0, 1fr))` }}>
          {Array.from({ length: puzzle.n }, (_, r) => Array.from({ length: puzzle.n }, (_, c) => {
            const key = `${r}-${c}`;
            const isBlank = puzzle.blanks.has(key);
            const iconIdx = isBlank ? filled[key] : puzzle.solution[r][c];
            const result = cellResults?.[key];
            const showColor = cellResults !== null && isBlank;
            let cls = "border-border bg-muted/30";
            if (!isBlank) cls = "border-transparent bg-transparent";
            else if (showColor) cls = result ? "border-emerald-400 bg-emerald-50" : "border-red-400 bg-red-50";
            else if (iconIdx !== undefined) cls = "border-primary/50 bg-primary/10";
            else cls = "border-dashed border-muted-foreground/40 bg-muted/20";
            return (
              <button
                key={key}
                type="button"
                disabled={!isBlank || answered}
                onClick={() => handleCellClick(key)}
                className={`aspect-square rounded-lg border-2 flex items-center justify-center text-xl sm:text-2xl transition-colors ${cls}`}
              >
                {iconIdx !== undefined ? puzzle.icons[iconIdx] : ""}
              </button>
            );
          }))}
        </div>
      </div>

      {/* 图形选择面板——点了空格子才弹出来 */}
      {pickerCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setPickerCell(null)}>
          <div className="bg-card rounded-2xl p-4 shadow-xl max-w-xs w-full" onClick={(e) => e.stopPropagation()}>
            <p className="text-center text-sm font-medium text-muted-foreground mb-3">{lt("pick_prompt", locale)}</p>
            <div className="grid grid-cols-4 gap-2">
              {puzzle.icons.map((icon, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => placeIcon(pickerCell, idx)}
                  className="aspect-square rounded-xl border-2 border-border bg-muted/30 flex items-center justify-center text-2xl hover:border-primary/50 transition-colors"
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!answered ? (
        <div className="flex justify-center mt-4">
          <button
            onClick={submitAnswer}
            disabled={!allBlanksFilled}
            className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
          >
            {lt("submit", locale)}
          </button>
        </div>
      ) : (
        <div className="flex justify-center mt-4">
          <button
            onClick={nextQuestion}
            className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors"
          >
            {lt("next_question", locale)}
          </button>
        </div>
      )}

      {status.msg && (
        <div className={`text-center text-lg font-medium px-4 py-3 rounded-xl mt-4 ${
          status.kind === "good" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
          : "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
        }`}>
          {status.msg}
        </div>
      )}
    </div>
  );
}
