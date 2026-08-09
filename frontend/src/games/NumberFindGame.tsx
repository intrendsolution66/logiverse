// frontend/src/games/NumberFindGame.tsx
//
// 数字大搜寻 — 跟 NumberMazeGame（数字迷宫）是两种完全不同的玩法，不是
// 同一个引擎的变体，所以另开一个文件：迷宫的核心是"沿着一条路一步步
// 走，走到岔路口要选对数字才能继续"，本质是路径+移动；这个游戏没有
// "从哪走到哪"这回事，玩法是"给一整个数字网格，把所有符合条件的格子
// 全部找出来标记掉"，格子跟格子之间没有相邻/路径的限制，纯粹是全网格
// 搜索——本质上更接近"大家来找茬"，只是找的是数字，硬塞进迷宫引擎的
// 路径/分岔点逻辑里会很别扭，两边完全用不上彼此的核心机制。
//
// 两种布局：
//   "grid"   — 纯随机生成，不需要设计师准备任何素材，网格边长跟着1-10
//              级自适应难度增长（越高等级格子越多，找起来越费眼力）。
//   "custom" — 设计师提供背景图 + 纯装饰用的物件（比如图片里的恐龙、
//              铅笔、大大的"1"字装饰），网格本身还是现场随机生成（不是
//              authored内容——每次玩数字都不一样，装饰物件的位置才是
//              authored的），网格摆在设计师指定的一块区域里，不跟装饰
//              物件重叠。
//
// 判定：client端直接核对（正确答案就是"网格里所有数字等于目标数字的
// 格子"，现场算出来的，不是隐藏答案），要求"该标记的全部标记、不该
// 标记的一个都不能标记"才算这一题过关——漏标或者多标都算错，跟"大家
// 来找茬"标准玩法的判定方式一致。
//
// i18n: zh/en/ms 已支持 — 见 frontend/src/lib/gameLocale.ts

import { useState, useEffect, useCallback, useRef } from "react";
import { GAME_CANVAS_W, GAME_CANVAS_H } from "@/lib/gameCanvas";
import { type Locale, type Dict, t, questionProgress } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  find_prompt:    { zh: "找出并标记所有的数字 {targets}", en: "Find and mark every {targets}", ms: "Cari dan tanda setiap {targets}" },
  marked_progress:{ zh: "已标记 {n} 格", en: "{n} marked", ms: "{n} ditanda" },
  submit:         { zh: "✅ 提交", en: "✅ Submit", ms: "✅ Hantar" },
  correct_all:    { zh: "🎉 全部标对了！难度提升一级", en: "🎉 All correct! Level up", ms: "🎉 Semua betul! Naik tahap" },
  wrong_some:     { zh: "有标错或漏标的地方，红色/黄色标出来了（难度降一级）", en: "Some are wrong or missed — shown in red/yellow (level down)", ms: "Ada yang salah atau tertinggal — ditunjukkan merah/kuning (tahap turun)" },
  legend_correct: { zh: "🟩 标对了", en: "🟩 Correctly marked", ms: "🟩 Ditanda dengan betul" },
  legend_wrong:   { zh: "🟥 标错了", en: "🟥 Wrongly marked", ms: "🟥 Ditanda salah" },
  legend_missed:  { zh: "🟨 漏标了", en: "🟨 Missed", ms: "🟨 Tertinggal" },
  next_question:  { zh: "下一题", en: "Next question", ms: "Soalan seterusnya" },
  practice_done:  { zh: "答对 {c} / {n} 题", en: "{c} / {n} correct", ms: "{c} / {n} betul" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

export interface NumberFindDecoration {
  image_url: string; x: number; y: number; w: number; h: number; rotation: number;
  flip_x?: boolean; flip_y?: boolean; opacity?: number;
}
export interface NumberFindConfig {
  layout?: "grid" | "custom"; // 不传视为 "grid"（纯随机，不需要素材）
  // custom 模式专用——纯装饰，不参与判定；网格现场生成，只是摆放的区域
  // 由设计师指定（x,y,w,h 归一化 0-1，对应 GAME_CANVAS_W/H）
  bg_image_url?: string;
  decorations?: NumberFindDecoration[];
  grid_area?: { x: number; y: number; w: number; h: number };
  // 共用
  target_count: number;       // 每题同时要找几个不同的目标数字（比如2＝"标记所有1和5"）
  number_min: number; number_max: number; // 网格里数字的随机范围
  starting_level: number;     // 1-10，网格边长的自适应难度
  total_questions: number;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string; ms?: string };
}
export interface NumberFindResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
  ending_level?: number;
}

const LEVEL_MAX = 10;

function randInt(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 等级 → 网格边长：3×3(最简单) 一路到 7×7(格子多、找起来更费眼力)。这个
// 游戏的难度天然就来自"在多少格子里找"，不需要像迷宫那样另外设计岔路
// 复杂度，网格越大越难是最直接的难度曲线。
function levelGridSize(level: number): { rows: number; cols: number } {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  const base = 3 + Math.floor((L - 1) / 2); // 3,3,4,4,5,5,6,6,7,7
  return { rows: base, cols: base };
}

interface Puzzle {
  rows: number; cols: number;
  grid: number[][];
  targets: number[];             // 这一题要找的目标数字
  targetCells: Set<string>;      // "r-c" 格式，正确答案(网格里数字属于targets的格子)
}

function genPuzzle(level: number, config: NumberFindConfig): Puzzle {
  const { rows, cols } = levelGridSize(level);
  const min = config.number_min, max = config.number_max;
  const rangeSize = max - min + 1;
  const targetCount = Math.max(1, Math.min(config.target_count, rangeSize));

  const allNumbers = Array.from({ length: rangeSize }, (_, i) => min + i);
  const targets = shuffle(allNumbers).slice(0, targetCount);
  const targetSet = new Set(targets);

  const grid: number[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => randInt(min, max))
  );

  // 保底——每个目标数字至少出现一次，不然有的题目可能因为运气不好，某
  // 个目标数字压根没在网格里出现，学生怎么找都找不到、题目变得无解。
  targets.forEach((target) => {
    const alreadyPresent = grid.some((row) => row.includes(target));
    if (!alreadyPresent) {
      const r = randInt(0, rows - 1), c = randInt(0, cols - 1);
      grid[r][c] = target;
    }
  });

  const targetCells = new Set<string>();
  grid.forEach((row, r) => row.forEach((v, c) => { if (targetSet.has(v)) targetCells.add(`${r}-${c}`); }));

  return { rows, cols, grid, targets, targetCells };
}

export default function NumberFindGame({ config, onComplete, locale = "zh" }: {
  config: NumberFindConfig; onComplete: (r: NumberFindResult) => void; locale?: Locale;
}) {
  const isCustom = config.layout === "custom" && !!config.bg_image_url;
  const gridArea = config.grid_area ?? { x: 0.5, y: 0.5, w: 0.9, h: 0.7 };

  const [qIndex, setQIndex] = useState(0);
  const [level, setLevel] = useState(() => Math.min(LEVEL_MAX, Math.max(1, config.starting_level || 1)));
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [answered, setAnswered] = useState(false);
  const [cellResults, setCellResults] = useState<Record<string, "correct" | "wrong" | "missed"> | null>(null);
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
    setPuzzle(genPuzzle(levelRef.current, config));
    setMarked(new Set());
    setAnswered(false);
    setCellResults(null);
    setStatus({ msg: "", kind: "" });
    setQIndex((i) => i + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, config.target_count, config.number_min, config.number_max]);

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

  function toggleCell(key: string) {
    if (answered) return;
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function submitAnswer() {
    if (answered || !puzzle) return;
    setAnswered(true);
    const results: Record<string, "correct" | "wrong" | "missed"> = {};
    let allCorrect = true;
    puzzle.grid.forEach((row, r) => row.forEach((_, c) => {
      const key = `${r}-${c}`;
      const shouldMark = puzzle.targetCells.has(key);
      const isMarked = marked.has(key);
      if (shouldMark && isMarked) results[key] = "correct";
      else if (!shouldMark && isMarked) { results[key] = "wrong"; allCorrect = false; }
      else if (shouldMark && !isMarked) { results[key] = "missed"; allCorrect = false; }
    }));
    setCellResults(results);
    if (allCorrect) {
      setCorrectCount((c) => c + 1);
      setStreak((s) => { const next = s + 1; setBestStreak((b) => Math.max(b, next)); return next; });
      setLevel((lv) => Math.min(LEVEL_MAX, lv + 1));
      setStatus({ msg: lt("correct_all", locale), kind: "good" });
    } else {
      setMistakeCount((m) => m + 1);
      setStreak(0);
      setLevel((lv) => Math.max(1, lv - 1));
      setStatus({ msg: lt("wrong_some", locale), kind: "bad" });
    }
  }

  const timerLabel = config.timer_mode === "countdown" ? t("time_left", locale) : t("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const accuracy = correctCount + mistakeCount > 0 ? Math.round((correctCount / (correctCount + mistakeCount)) * 100) : 0;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🔎</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {t("practice_complete", locale)}{lt("practice_done", locale, { c: correctCount, n: config.total_questions })}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{t("best_streak", locale)} {bestStreak}　{t("ending_level", locale)} Lv.{level}</div>
      </div>
    );
  }

  if (!puzzle) return null;

  const gridTable = (
    <div
      className="inline-grid border-2 border-slate-700 rounded-lg overflow-hidden bg-white"
      style={{ gridTemplateColumns: `repeat(${puzzle.cols}, minmax(0, 1fr))` }}
    >
      {puzzle.grid.map((row, r) => row.map((val, c) => {
        const key = `${r}-${c}`;
        const isMarked = marked.has(key);
        const result = cellResults?.[key];
        let cls = "border border-slate-300 bg-white hover:bg-primary/5";
        if (result === "correct") cls = "border border-emerald-400 bg-emerald-100";
        else if (result === "wrong") cls = "border border-red-400 bg-red-100";
        else if (result === "missed") cls = "border border-amber-400 bg-amber-100";
        else if (isMarked) cls = "border border-primary bg-primary/15";
        return (
          <button
            key={key} type="button" onClick={() => toggleCell(key)} disabled={answered}
            className={`w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center text-xl sm:text-2xl font-bold text-slate-800 transition-colors ${cls}`}
          >
            {val}
          </button>
        );
      }))}
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3 flex-wrap gap-1">
        <span>{questionProgress(qIndex, config.total_questions, locale)}　Lv.{level}</span>
        <span>✅ {t("accuracy", locale)} {accuracy}%　🔥 {t("streak", locale)} {streak}　⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      <p className="text-center text-lg font-semibold text-foreground mb-3">
        {config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en || lt("find_prompt", locale, { targets: puzzle.targets.join("、") })}
      </p>

      {isCustom ? (
        <div
          className="relative w-full aspect-[11/7] rounded-2xl mb-4 overflow-hidden shadow-lg ring-1 ring-black/5"
          style={{ backgroundImage: `url(${config.bg_image_url})`, backgroundSize: "100% 100%", backgroundPosition: "center" }}
        >
          {(config.decorations ?? []).map((d, i) => (
            <img
              key={i} src={d.image_url} alt=""
              className="absolute object-contain -translate-x-1/2 -translate-y-1/2 pointer-events-none drop-shadow"
              style={{
                left: `${d.x * 100}%`, top: `${d.y * 100}%`,
                width: `${(d.w / GAME_CANVAS_W) * 100}%`, height: `${(d.h / GAME_CANVAS_H) * 100}%`,
                opacity: (d.opacity ?? 100) / 100,
                transform: `translate(-50%, -50%) rotate(${d.rotation ?? 0}deg) scale(${d.flip_x ? -1 : 1}, ${d.flip_y ? -1 : 1})`,
              }}
            />
          ))}
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
            style={{ left: `${gridArea.x * 100}%`, top: `${gridArea.y * 100}%`, width: `${gridArea.w * 100}%`, height: `${gridArea.h * 100}%` }}
          >
            {gridTable}
          </div>
        </div>
      ) : (
        <div className="flex justify-center bg-slate-50 dark:bg-slate-900/20 rounded-2xl p-4 mb-4 shadow-lg ring-1 ring-black/5">
          {gridTable}
        </div>
      )}

      <div className="flex justify-between items-center text-xs text-muted-foreground mb-4">
        <span>{lt("marked_progress", locale, { n: marked.size })}</span>
        {cellResults && (
          <span className="flex gap-3">
            <span>{lt("legend_correct", locale)}</span>
            <span>{lt("legend_wrong", locale)}</span>
            <span>{lt("legend_missed", locale)}</span>
          </span>
        )}
      </div>

      <div className="flex justify-center">
        {!answered ? (
          <button
            onClick={submitAnswer}
            disabled={marked.size === 0}
            className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
          >
            {lt("submit", locale)}
          </button>
        ) : (
          <button
            onClick={nextQuestion}
            className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors"
          >
            {lt("next_question", locale)}
          </button>
        )}
      </div>

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
