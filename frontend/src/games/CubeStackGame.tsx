// frontend/src/games/CubeStackGame.tsx
//
// 立体方块计数 — Stage 1 of a planned six-stage 3D spatial reasoning
// curriculum (see README for the full roadmap: 数方块 → 逐层计数 →
// 找隐藏方块 → 自由旋转观察 → 自己搭积木 → 三视图). This file is Stage 1
// only, built to spec:
//   ✅ 360° rotate + zoom (OrbitControls)
//   ✅ 点击高亮方块 (click a cube to toggle a highlight — a counting aid)
//   ✅ 难度自动调整 (a real 10-level adaptive curve: correct → level up,
//      wrong → level down, not just 3 fixed designer-picked tiers)
// Stages 2–6 are deliberately NOT here — each is a different interaction
// (layer-switching UI, structural-inference reasoning, free-exploration
// mode, drag-to-build, orthographic-view reconstruction), not a variation
// on this file's rendering. Building them here would mean shipping five
// more untested things instead of the one thing this file does well.

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Edges } from "@react-three/drei";

export interface CubeStackConfig {
  starting_level: number;      // 1-10, where the adaptive curve begins (see LEVEL_MAX)
  total_questions: number;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
}
export interface CubeStackResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
  ending_level?: number; // where the adaptive curve landed — useful for seeding next session's starting_level later
}

const LEVEL_MAX = 10;

// The 10-level adaptive curve: level 1 is a single flat layer (nothing can
// ever be occluded — you can always see the whole structure without
// rotating), ramping up through taller/wider/gappier structures so that by
// level 10 rotation is genuinely necessary to be sure of the count.
function levelParams(level: number) {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  const size = 2 + Math.floor((L - 1) / 3);       // 2,2,2,3,3,3,4,4,4,5
  const maxHeight = 1 + Math.floor((L - 1) / 2);   // 1,1,2,2,3,3,4,4,5,5
  const emptyProb = L <= 2 ? 0.1 : L <= 6 ? 0.25 : 0.4;
  return { rows: size, cols: size, maxHeight, emptyProb };
}

function randInt(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }

// ── Puzzle generation ──────────────────────────────────────────────────────────
interface Puzzle {
  heightMap: number[][];
  total: number;
  layerCounts: number[];
}

function genPuzzle(level: number): Puzzle {
  const { rows, cols, maxHeight, emptyProb } = levelParams(level);
  const heightMap: number[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (Math.random() < emptyProb ? 0 : randInt(1, maxHeight)))
  );
  let anyCube = false;
  for (const row of heightMap) for (const h of row) if (h > 0) anyCube = true;
  if (!anyCube) {
    const r: number = randInt(0, rows - 1);
    const c: number = randInt(0, cols - 1);
    heightMap[r][c] = randInt(1, maxHeight);
  }

  const layerCounts: number[] = [];
  for (let lvl = 1; lvl <= maxHeight; lvl++) {
    let count = 0;
    heightMap.forEach((row) => row.forEach((h) => { if (h >= lvl) count++; }));
    layerCounts.push(count);
  }
  const total = layerCounts.reduce((a, b) => a + b, 0);
  return { heightMap, total, layerCounts };
}

// ── 3D scene ─────────────────────────────────────────────────────────────────
const CUBE_SIZE = 0.88;

function CubeStackScene({ heightMap, highlighted, onToggleHighlight }: {
  heightMap: number[][];
  highlighted: Set<string>;
  onToggleHighlight: (key: string) => void;
}) {
  const rows = heightMap.length, cols = heightMap[0]?.length ?? 0;
  const offsetX = (cols - 1) / 2, offsetZ = (rows - 1) / 2;

  const cubes = useMemo(() => {
    const list: { x: number; y: number; z: number; key: string }[] = [];
    heightMap.forEach((row, r) => row.forEach((h, c) => {
      for (let level = 0; level < h; level++) {
        list.push({ x: c - offsetX, y: level, z: r - offsetZ, key: `${r}-${c}-${level}` });
      }
    }));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightMap]);

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 5]} intensity={0.9} />
      <directionalLight position={[-4, 4, -4]} intensity={0.3} />

      {cubes.map((cube) => {
        const isHi = highlighted.has(cube.key);
        return (
          <mesh
            key={cube.key}
            position={[cube.x, cube.y, cube.z]}
            onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onToggleHighlight(cube.key); }}
          >
            <boxGeometry args={[CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]} />
            <meshStandardMaterial color={isHi ? "#4fb06d" : "#e8a33d"} />
            <Edges color={isHi ? "#1e6b39" : "#8a5a1e"} />
          </mesh>
        );
      })}

      <mesh position={[0, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[cols + 2, rows + 2]} />
        <meshStandardMaterial color="#f5f0e6" />
      </mesh>

      <OrbitControls enablePan={false} minDistance={3} maxDistance={16} />
    </>
  );
}

// ── Component ────────────────────────────────────────────────────────────────
export default function CubeStackGame({ config, onComplete }: {
  config: CubeStackConfig; onComplete: (r: CubeStackResult) => void;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [level, setLevel] = useState(() => Math.min(LEVEL_MAX, Math.max(1, config.starting_level || 1)));
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [typedAnswer, setTypedAnswer] = useState("");
  const [answered, setAnswered] = useState(false);
  const [showHint, setShowHint] = useState(false);
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
    setPuzzle(genPuzzle(levelRef.current));
    setHighlighted(new Set());
    setTypedAnswer("");
    setAnswered(false);
    setShowHint(false);
    setStatus({ msg: "", kind: "" });
    setQIndex((i) => i + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex]);

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

  function toggleHighlight(key: string) {
    setHighlighted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function submitAnswer() {
    if (answered || finished || !puzzle || typedAnswer === "") return;
    const val = Number(typedAnswer);
    setAnswered(true);
    if (val === puzzle.total) {
      setCorrectCount((c) => c + 1);
      setStreak((s) => { const next = s + 1; setBestStreak((b) => Math.max(b, next)); return next; });
      setLevel((lv) => Math.min(LEVEL_MAX, lv + 1)); // adaptive: correct → harder
      setStatus({ msg: "🎉 答对了！难度提升一级", kind: "good" });
      setTimeout(nextQuestion, 1200);
    } else {
      setMistakeCount((m) => m + 1);
      setStreak(0);
      setLevel((lv) => Math.max(1, lv - 1)); // adaptive: wrong → easier
      setShowHint(true);
      setStatus({ msg: "不对哦，看看下面逐层提示～（难度降一级）", kind: "bad" });
    }
  }

  const timerLabel = config.timer_mode === "countdown" ? "剩余" : "用时";
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const accuracy = correctCount + mistakeCount > 0 ? Math.round((correctCount / (correctCount + mistakeCount)) * 100) : 0;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🧊</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          练习完成！答对 {correctCount} / {config.total_questions} 题
        </div>
        <div className="text-sm text-muted-foreground mt-1">最长连对 {bestStreak} 题　结束时等级 Lv.{level}</div>
      </div>
    );
  }

  if (!puzzle) return null;

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3 flex-wrap gap-1">
        <span>第 {qIndex} / {config.total_questions} 题　Lv.{level}</span>
        <span>✅ 正确率 {accuracy}%　🔥 连对 {streak}　⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      <div className="h-[360px] bg-muted/40 rounded-2xl mb-2 overflow-hidden">
        <Canvas camera={{ position: [6, 5, 6], fov: 45 }}>
          <Suspense fallback={null}>
            <CubeStackScene heightMap={puzzle.heightMap} highlighted={highlighted} onToggleHighlight={toggleHighlight} />
          </Suspense>
        </Canvas>
      </div>
      <p className="text-center text-xs text-muted-foreground mb-1">🖱️ 拖动旋转视角　滚轮缩放　点击方块可以标记已数过</p>
      {highlighted.size > 0 && (
        <p className="text-center text-xs text-emerald-600 dark:text-emerald-400 mb-3">已点选 {highlighted.size} 个</p>
      )}

      <p className="text-center text-lg font-semibold text-foreground mb-3">一共有多少个方块？</p>

      <div className="flex gap-3 justify-center mb-3">
        <input
          type="number"
          value={typedAnswer}
          onChange={(e) => setTypedAnswer(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitAnswer()}
          disabled={answered}
          className="text-2xl font-semibold text-center w-40 px-4 py-3 rounded-2xl border-2 border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="?"
        />
        {!answered ? (
          <button
            onClick={submitAnswer}
            disabled={typedAnswer === ""}
            className="text-lg font-semibold px-6 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
          >
            提交
          </button>
        ) : (
          <button
            onClick={nextQuestion}
            className="text-lg font-semibold px-6 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors"
          >
            下一题
          </button>
        )}
      </div>

      {status.msg && (
        <div className={`text-center text-lg font-medium px-4 py-3 rounded-xl mb-3 ${
          status.kind === "good" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
          : "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
        }`}>
          {status.msg}
        </div>
      )}

      {showHint && (
        <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl p-4 text-sm space-y-1">
          <p className="font-medium text-foreground mb-2">逐层数一数：</p>
          {puzzle.layerCounts.map((count, i) => (
            <p key={i} className="text-muted-foreground">第 {i + 1} 层：{count} 个</p>
          ))}
          <p className="font-medium text-foreground pt-1 border-t border-border mt-2">
            {puzzle.layerCounts.join(" + ")} = {puzzle.total} 个
          </p>
        </div>
      )}
    </div>
  );
}
