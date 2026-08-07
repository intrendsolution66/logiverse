// frontend/src/games/CubeThreeViewGame.tsx
//
// 立体方块计数 — Stage 6 of 6 (最后一关，认知难度最高): 三视图. Same
// 10-level adaptive curve/puzzle generation as Stage 1/2/3 (duplicated per
// this codebase's "every game file is self-contained" convention).
//
// Each question randomly asks for ONE of 正视图(front) / 俯视图(top) /
// 侧视图(side) — never all three at once, keeping each question answerable
// in a reasonable number of clicks even at high difficulty levels.
//
// Views are computed as an orthographic MAX-projection along the collapsed
// axis (since these are opaque solid cubes, what you'd actually see from
// straight ahead/above/the side is the tallest silhouette along that line
// of sight, not literally every cube):
//   俯视图 — footprint: cell (r,c) filled iff heightMap[r][c] > 0
//   正视图 — collapse the row/depth axis: column c's visible height =
//            max over all rows of heightMap[r][c]
//   侧视图 — collapse the column axis: row r's visible height =
//            max over all columns of heightMap[r][c]
//
// Answer mechanism: an interactive grid of clickable cells sized to match
// the target view's dimensions — student toggles cells on/off to build the
// outline, submits, and gets cell-by-cell right/wrong feedback (same
// "authored answer, checked per-cell" quality as Stage 2's per-layer
// feedback, not just a single pass/fail for the whole picture).

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Edges } from "@react-three/drei";

export interface CubeThreeViewConfig {
  starting_level: number;    // 1-10，跟Stage1/2/3同一条自适应难度曲线
  total_questions: number;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
}
export interface CubeThreeViewResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
  ending_level?: number;
}

const LEVEL_MAX = 10;
type ViewType = "front" | "top" | "side";
const VIEW_LABELS: Record<ViewType, string> = { front: "🔼 正视图", top: "⬇️ 俯视图", side: "↔️ 侧视图" };

function levelParams(level: number) {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  const size = 2 + Math.floor((L - 1) / 3);
  const maxHeight = 1 + Math.floor((L - 1) / 2);
  const emptyProb = L <= 2 ? 0.1 : L <= 6 ? 0.25 : 0.4;
  return { rows: size, cols: size, maxHeight, emptyProb };
}

function randInt(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }

function genHeightMap(level: number): number[][] {
  const { rows, cols, maxHeight, emptyProb } = levelParams(level);
  const heightMap: number[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (Math.random() < emptyProb ? 0 : randInt(1, maxHeight)))
  );
  let anyCube = false;
  for (const row of heightMap) for (const h of row) if (h > 0) anyCube = true;
  if (!anyCube) heightMap[randInt(0, rows - 1)][randInt(0, cols - 1)] = randInt(1, maxHeight);
  return heightMap;
}

// displayRow 0 = 最高的那一层，最后一行 = 地面——跟画立面图的习惯一致
// (地面在下面)，不是数组本来的存储顺序。
function buildElevationGrid(colHeights: number[], maxH: number): boolean[][] {
  const grid: boolean[][] = [];
  for (let displayRow = 0; displayRow < maxH; displayRow++) {
    const level = maxH - 1 - displayRow;
    grid.push(colHeights.map((h) => h > level));
  }
  return grid;
}

interface Puzzle {
  heightMap: number[][];
  viewType: ViewType;
  target: boolean[][]; // 正确答案网格
}

function genPuzzle(level: number): Puzzle {
  const heightMap = genHeightMap(level);
  const rows = heightMap.length, cols = heightMap[0].length;
  const maxH = Math.max(...heightMap.flat());
  const viewType: ViewType = (["front", "top", "side"] as ViewType[])[randInt(0, 2)];

  let target: boolean[][];
  if (viewType === "top") {
    target = heightMap.map((row) => row.map((h) => h > 0));
  } else if (viewType === "front") {
    const colHeights = Array.from({ length: cols }, (_, c) => Math.max(...heightMap.map((row) => row[c])));
    target = buildElevationGrid(colHeights, maxH);
  } else {
    const rowHeights = heightMap.map((row) => Math.max(...row));
    target = buildElevationGrid(rowHeights, maxH);
  }
  return { heightMap, viewType, target };
}

const CUBE_SIZE = 0.88;

function ThreeViewScene({ heightMap }: { heightMap: number[][] }) {
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

      {cubes.map((cube) => (
        <mesh key={cube.key} position={[cube.x, cube.y, cube.z]} onClick={(e: ThreeEvent<MouseEvent>) => e.stopPropagation()}>
          <boxGeometry args={[CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]} />
          <meshStandardMaterial color="#e8a33d" />
          <Edges color="#8a5a1e" />
        </mesh>
      ))}

      <mesh position={[0, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[cols + 2, rows + 2]} />
        <meshStandardMaterial color="#f5f0e6" />
      </mesh>

      <OrbitControls enablePan={false} minDistance={3} maxDistance={16} />
    </>
  );
}

export default function CubeThreeViewGame({ config, onComplete }: {
  config: CubeThreeViewConfig; onComplete: (r: CubeThreeViewResult) => void;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [level, setLevel] = useState(() => Math.min(LEVEL_MAX, Math.max(1, config.starting_level || 1)));
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [answerGrid, setAnswerGrid] = useState<boolean[][]>([]);
  const [answered, setAnswered] = useState(false);
  const [cellResults, setCellResults] = useState<boolean[][] | null>(null); // 每格对不对
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
    const p = genPuzzle(levelRef.current);
    setPuzzle(p);
    setAnswerGrid(p.target.map((row) => row.map(() => false)));
    setAnswered(false);
    setCellResults(null);
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

  function toggleCell(r: number, c: number) {
    if (answered) return;
    setAnswerGrid((prev) => prev.map((row, ri) => row.map((v, ci) => (ri === r && ci === c ? !v : v))));
  }

  function submitAnswer() {
    if (answered || !puzzle) return;
    setAnswered(true);
    const results = puzzle.target.map((row, r) => row.map((v, c) => v === answerGrid[r][c]));
    setCellResults(results);
    const allCorrect = results.every((row) => row.every(Boolean));
    if (allCorrect) {
      setCorrectCount((c) => c + 1);
      setStreak((s) => { const next = s + 1; setBestStreak((b) => Math.max(b, next)); return next; });
      setLevel((lv) => Math.min(LEVEL_MAX, lv + 1));
      setStatus({ msg: "🎉 拼对了！难度提升一级", kind: "good" });
    } else {
      setMistakeCount((m) => m + 1);
      setStreak(0);
      setLevel((lv) => Math.max(1, lv - 1));
      setStatus({ msg: "有几格不对哦，红色标出来的是错的地方（难度降一级）", kind: "bad" });
    }
  }

  const timerLabel = config.timer_mode === "countdown" ? "剩余" : "用时";
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const accuracy = correctCount + mistakeCount > 0 ? Math.round((correctCount / (correctCount + mistakeCount)) * 100) : 0;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">📐</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          练习完成！答对 {correctCount} / {config.total_questions} 题
        </div>
        <div className="text-sm text-muted-foreground mt-1">最长连对 {bestStreak} 题　结束时等级 Lv.{level}</div>
      </div>
    );
  }

  if (!puzzle) return null;

  const gridCols = puzzle.target[0]?.length ?? 1;

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3 flex-wrap gap-1">
        <span>第 {qIndex} / {config.total_questions} 题　Lv.{level}</span>
        <span>✅ 正确率 {accuracy}%　🔥 连对 {streak}　⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      <div className="h-[300px] bg-muted/40 rounded-2xl mb-2 overflow-hidden">
        <Canvas camera={{ position: [6, 5, 6], fov: 45 }}>
          <Suspense fallback={null}>
            <ThreeViewScene heightMap={puzzle.heightMap} />
          </Suspense>
        </Canvas>
      </div>
      <p className="text-center text-xs text-muted-foreground mb-4">🖱️ 拖动旋转视角　滚轮缩放</p>

      <p className="text-center text-lg font-semibold text-foreground mb-3">拼出这个结构的 {VIEW_LABELS[puzzle.viewType]}</p>

      <div className="flex justify-center mb-4">
        <div className="inline-grid gap-1 p-3 bg-muted/40 rounded-2xl" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
          {puzzle.target.map((row, r) => row.map((_, c) => {
            const filled = answerGrid[r][c];
            const result = cellResults?.[r]?.[c];
            const showColor = cellResults !== null;
            let cls = "border-border bg-card";
            if (showColor) {
              cls = result
                ? (filled ? "border-emerald-500 bg-emerald-100" : "border-border bg-card")
                : "border-red-500 bg-red-100";
            } else if (filled) {
              cls = "border-primary bg-primary/20";
            }
            return (
              <button
                key={`${r}-${c}`}
                type="button"
                disabled={answered}
                onClick={() => toggleCell(r, c)}
                className={`w-10 h-10 sm:w-12 sm:h-12 rounded-md border-2 transition-colors ${cls}`}
              />
            );
          }))}
        </div>
      </div>

      <div className="flex justify-center">
        {!answered ? (
          <button
            onClick={submitAnswer}
            className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors"
          >
            ✅ 提交
          </button>
        ) : (
          <button
            onClick={nextQuestion}
            className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors"
          >
            下一题
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
