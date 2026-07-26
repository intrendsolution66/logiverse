// frontend/src/games/SudokuGame.tsx
//
// 数独 — authored content: a puzzle IMAGE with marked blank cells, not a
// procedurally generated/solved sudoku. The correct digit for each cell
// never reaches this component until AFTER submitting (eduApi.checkSudoku
// does the comparison server-side) — see courses.controller.ts's getLevel
// sudoku branch for why: sending the answer down front would put the
// solution in the browser's network tab before the student even starts.
//
// Input works with keyboard, mouse, AND touch the same way any standard
// HTML form input does — each blank cell is a real <input type="tel">
// (numeric-only via inputMode/pattern), so a physical keyboard just works,
// and mobile browsers show their native numeric keypad automatically.
// No custom virtual keyboard needed to satisfy "键盘+鼠标、触控".

import { useState, useRef, useEffect } from "react";
import { eduApi } from "@/api/index";
import { Button } from "@/components/ui/button";

export interface SudokuConfig {
  bg_image_url: string;
  cells: { x: number; y: number }[]; // no `answer` here — deliberately, see file header
  difficulty: "easy" | "medium" | "hard" | "custom";
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
}
export interface SudokuResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

const DIFFICULTY_LABELS: Record<string, string> = { easy: "😊 简单", medium: "🙂 中等", hard: "😤 困难", custom: "🎯 自定义" };

export default function SudokuGame({ levelId, config, onComplete }: {
  levelId: string; config: SudokuConfig; onComplete: (r: SudokuResult) => void;
}) {
  const cells = config.cells ?? [];
  const [values, setValues] = useState<string[]>(() => cells.map(() => ""));
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
    if (digit && i < cells.length - 1) inputRefs.current[i + 1]?.focus(); // auto-advance, handy for keyboard entry
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
        score: result.allCorrect ? 1 : Math.max(0, (cells.length - mistakes) / cells.length),
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

  return (
    <div className="max-w-5xl mx-auto w-full">
      <div className="flex justify-between items-center text-base font-medium text-muted-foreground mb-3 flex-wrap gap-2">
        <span>🔢 数独 <span className="text-xs">{DIFFICULTY_LABELS[config.difficulty] ?? config.difficulty}</span></span>
        <span>⏱️ 用时 {elapsed.toFixed(1)}s · 已填 {filledCount}/{cells.length}</span>
      </div>

      <div className="relative w-full aspect-[11/7] rounded-2xl mb-4 bg-white overflow-hidden shadow-lg ring-1 ring-black/5" style={{ backgroundImage: `url(${config.bg_image_url})`, backgroundSize: "100% 100%", backgroundPosition: "center" }}>
        {cells.map((c, i) => {
          const isCorrect = correctness?.[i];
          const showColor = correctness !== null;
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
              style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: "6.5%", aspectRatio: "1 / 1", fontSize: "clamp(12px, 2.2vw, 22px)" }}
            />
          );
        })}
      </div>

      {!finished ? (
        <div className="flex justify-center">
          <Button onClick={handleSubmit} disabled={checking || filledCount === 0}>
            {checking ? "检查中..." : "✅ 提交答案"}
          </Button>
        </div>
      ) : (
        <div className="text-center space-y-3">
          <p className={`text-lg font-semibold ${correctness?.every(Boolean) ? "text-emerald-600" : "text-amber-600"}`}>
            {correctness?.every(Boolean) ? "🎉 全部正确！" : `对了 ${correctness?.filter(Boolean).length ?? 0} / ${cells.length} 个`}
          </p>
          {!correctness?.every(Boolean) && (
            <Button variant="outline" onClick={revealAnswer}>👀 查看答案</Button>
          )}
        </div>
      )}
    </div>
  );
}
