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

import { useState, useEffect, useCallback, useRef } from "react";

export type ShapeAskType = "square" | "rectangle";
export interface ShapeCountConfig {
  ask_type: ShapeAskType | "both"; // "both" = 每题随机问正方形或长方形
  starting_level: number;          // 1-10，网格大小的自适应难度
  total_questions: number;
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

export default function ShapeCountGame({ config, onComplete }: {
  config: ShapeCountConfig; onComplete: (r: ShapeCountResult) => void;
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

  const timerLabel = config.timer_mode === "countdown" ? "剩余" : "用时";
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const accuracy = correctCount + mistakeCount > 0 ? Math.round((correctCount / (correctCount + mistakeCount)) * 100) : 0;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🔲</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          练习完成！答对 {correctCount} / {config.total_questions} 题
        </div>
        <div className="text-sm text-muted-foreground mt-1">最长连对 {bestStreak} 题　结束时等级 Lv.{level}</div>
      </div>
    );
  }

  if (!puzzle) return null;

  return (
    <div className="max-w-xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3 flex-wrap gap-1">
        <span>第 {qIndex} / {config.total_questions} 题　Lv.{level}</span>
        <span>✅ 正确率 {accuracy}%　🔥 连对 {streak}　⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      <div className="bg-white dark:bg-card rounded-2xl p-4 mb-4 shadow-lg ring-1 ring-black/5">
        <GridSvg rows={puzzle.rows} cols={puzzle.cols} />
      </div>

      <p className="text-center text-lg font-semibold text-foreground mb-1">
        这张图里一共有多少个{puzzle.askType === "square" ? "正方形" : "长方形"}？
      </p>
      {puzzle.askType === "rectangle" && (
        <p className="text-center text-xs text-muted-foreground mb-3">（正方形也是长方形的一种，也要数进去哦）</p>
      )}

      {!answered ? (
        <div className="flex items-center justify-center gap-3 mt-3">
          <input
            type="tel" inputMode="numeric" value={answerText}
            onChange={(e) => setAnswerText(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && submitAnswer()}
            placeholder="输入答案"
            className="w-32 text-center text-2xl font-bold px-3 py-2 rounded-xl border-2 border-border bg-card"
          />
          <span className="text-lg text-muted-foreground">个</span>
          <button
            onClick={submitAnswer}
            disabled={answerText === ""}
            className="text-lg font-semibold px-6 py-2.5 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
          >
            ✅ 提交
          </button>
        </div>
      ) : (
        <div className="space-y-4 mt-3">
          <div className={`text-center text-lg font-medium px-4 py-3 rounded-xl ${
            correct ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
            : "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
          }`}>
            {correct ? "🎉 答对了！难度提升一级" : `答案是 ${puzzle.answer} 个（难度降一级）`}
          </div>
          <div className="flex justify-center">
            <button
              onClick={nextQuestion}
              className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors"
            >
              下一题
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
