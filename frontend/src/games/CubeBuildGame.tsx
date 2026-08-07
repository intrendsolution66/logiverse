// frontend/src/games/CubeBuildGame.tsx
//
// 立体方块计数 — Stage 5 of 6 (交互最复杂的一关): 自己搭积木. Same 10-level
// adaptive curve/puzzle generation as Stage 1/2/3/6 (duplicated per this
// codebase's "every game file is self-contained" convention).
//
// Dual-panel layout — a non-interactive rotatable REFERENCE scene (the
// target, always visible while building, not a memory test) above an
// interactive BUILD scene below. Same "two 3D/2D panels side by side"
// pattern this codebase already uses elsewhere for comparison tasks (see
// SpotDiffGame's two-image canvas), just stacked vertically here since
// both panels need real height to read as 3D structures, not squeezed
// side-by-side.
//
// Placing a block: each column always has an invisible "ghost" cube
// hovering exactly at its current top (y = current height for that
// column), semi-transparent, click = add one block there. This is
// deliberately NOT "click the ground plane" — once a column has any
// height, the ground beneath it is occluded from most angles, which would
// make later clicks unreliable. A ghost marker that rides on top of
// whatever's already stacked stays clickable regardless of the column's
// height, standard "phantom/preview block" affordance from sandbox
// builders. Removing a block: click any real cube in a column removes the
// TOP block of that column (can't reach into the middle of a stack — same
// physical constraint as the heightMap model itself, a column is always a
// solid stack from the ground up).

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Edges } from "@react-three/drei";

export interface CubeBuildConfig {
  starting_level: number;    // 1-10，跟其他CubeStack系列同一条自适应难度曲线
  total_questions: number;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
}
export interface CubeBuildResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
  ending_level?: number;
}

const LEVEL_MAX = 10;

function levelParams(level: number) {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  const size = 2 + Math.floor((L - 1) / 3);
  const maxHeight = 1 + Math.floor((L - 1) / 2);
  const emptyProb = L <= 2 ? 0.1 : L <= 6 ? 0.25 : 0.4;
  return { rows: size, cols: size, maxHeight, emptyProb };
}

function randInt(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }

function genHeightMap(level: number): { heightMap: number[][]; maxHeight: number } {
  const { rows, cols, maxHeight, emptyProb } = levelParams(level);
  const heightMap: number[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (Math.random() < emptyProb ? 0 : randInt(1, maxHeight)))
  );
  let anyCube = false;
  for (const row of heightMap) for (const h of row) if (h > 0) anyCube = true;
  if (!anyCube) heightMap[randInt(0, rows - 1)][randInt(0, cols - 1)] = randInt(1, maxHeight);
  return { heightMap, maxHeight };
}

const CUBE_SIZE = 0.88;

// 只读的参考场景——目标结构，可以自由转，但不能点它加减方块
function ReferenceScene({ heightMap }: { heightMap: number[][] }) {
  const rows = heightMap.length, cols = heightMap[0]?.length ?? 0;
  const offsetX = (cols - 1) / 2, offsetZ = (rows - 1) / 2;

  const cubes = useMemo(() => {
    const list: { x: number; y: number; z: number; key: string }[] = [];
    heightMap.forEach((row, r) => row.forEach((h, c) => {
      for (let level = 0; level < h; level++) list.push({ x: c - offsetX, y: level, z: r - offsetZ, key: `${r}-${c}-${level}` });
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
        <mesh key={cube.key} position={[cube.x, cube.y, cube.z]}>
          <boxGeometry args={[CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]} />
          <meshStandardMaterial color="#c4b5fd" />
          <Edges color="#5b21b6" />
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

// 可以互动的搭建场景——每一列头顶上都有一个半透明"虚影方块"，点它加一
// 块；点已经搭好的实体方块，拿掉那一列最上面那一块。
function BuildScene({ heightMap, rows, cols, wrongCols, answered, onAdd, onRemove }: {
  heightMap: number[][]; rows: number; cols: number; wrongCols: Set<string>; answered: boolean;
  onAdd: (r: number, c: number) => void; onRemove: (r: number, c: number) => void;
}) {
  const offsetX = (cols - 1) / 2, offsetZ = (rows - 1) / 2;

  const cubes = useMemo(() => {
    const list: { x: number; y: number; z: number; key: string; r: number; c: number }[] = [];
    heightMap.forEach((row, r) => row.forEach((h, c) => {
      for (let level = 0; level < h; level++) list.push({ x: c - offsetX, y: level, z: r - offsetZ, key: `${r}-${c}-${level}`, r, c });
    }));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightMap]);

  const ghosts = useMemo(() => {
    const list: { x: number; y: number; z: number; r: number; c: number }[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      list.push({ x: c - offsetX, y: heightMap[r][c], z: r - offsetZ, r, c });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heightMap, rows, cols]);

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 5]} intensity={0.9} />
      <directionalLight position={[-4, 4, -4]} intensity={0.3} />

      {cubes.map((cube) => {
        const isWrong = wrongCols.has(`${cube.r}-${cube.c}`);
        return (
          <mesh
            key={cube.key} position={[cube.x, cube.y, cube.z]}
            onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onRemove(cube.r, cube.c); }}
          >
            <boxGeometry args={[CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]} />
            <meshStandardMaterial color={isWrong ? "#ef4444" : "#4fb06d"} />
            <Edges color={isWrong ? "#7f1d1d" : "#1e6b39"} />
          </mesh>
        );
      })}

      {!answered && ghosts.map((g) => (
        <mesh
          key={`ghost-${g.r}-${g.c}`} position={[g.x, g.y, g.z]}
          onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onAdd(g.r, g.c); }}
        >
          <boxGeometry args={[CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]} />
          <meshStandardMaterial color="#94a3b8" transparent opacity={0.25} />
          <Edges color="#475569" />
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

export default function CubeBuildGame({ config, onComplete }: {
  config: CubeBuildConfig; onComplete: (r: CubeBuildResult) => void;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [level, setLevel] = useState(() => Math.min(LEVEL_MAX, Math.max(1, config.starting_level || 1)));
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [target, setTarget] = useState<number[][] | null>(null);
  const [maxHeight, setMaxHeight] = useState(1);
  const [build, setBuild] = useState<number[][]>([]);
  const [answered, setAnswered] = useState(false);
  const [wrongCols, setWrongCols] = useState<Set<string>>(new Set());
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
    const { heightMap, maxHeight: mh } = genHeightMap(levelRef.current);
    setTarget(heightMap);
    setMaxHeight(mh);
    setBuild(heightMap.map((row) => row.map(() => 0)));
    setAnswered(false);
    setWrongCols(new Set());
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

  const buildRows = target?.length ?? 0, buildCols = target?.[0]?.length ?? 0;
  // 留一点余量(比目标最高再高2层)，不然手滑多点几下会觉得"卡住加不上去"
  const capHeight = maxHeight + 2;

  function addBlock(r: number, c: number) {
    if (answered) return;
    setBuild((prev) => prev.map((row, ri) => row.map((v, ci) => (ri === r && ci === c ? Math.min(capHeight, v + 1) : v))));
  }
  function removeBlock(r: number, c: number) {
    if (answered) return;
    setBuild((prev) => prev.map((row, ri) => row.map((v, ci) => (ri === r && ci === c ? Math.max(0, v - 1) : v))));
  }
  function resetBuild() {
    if (answered || !target) return;
    setBuild(target.map((row) => row.map(() => 0)));
  }

  function submitAnswer() {
    if (answered || !target) return;
    setAnswered(true);
    const wrong = new Set<string>();
    let allCorrect = true;
    for (let r = 0; r < buildRows; r++) for (let c = 0; c < buildCols; c++) {
      if (build[r][c] !== target[r][c]) { wrong.add(`${r}-${c}`); allCorrect = false; }
    }
    setWrongCols(wrong);
    if (allCorrect) {
      setCorrectCount((c) => c + 1);
      setStreak((s) => { const next = s + 1; setBestStreak((b) => Math.max(b, next)); return next; });
      setLevel((lv) => Math.min(LEVEL_MAX, lv + 1));
      setStatus({ msg: "🎉 搭得一模一样！难度提升一级", kind: "good" });
    } else {
      setMistakeCount((m) => m + 1);
      setStreak(0);
      setLevel((lv) => Math.max(1, lv - 1));
      setStatus({ msg: "有几根柱子高度不对哦，红色标出来了（难度降一级）", kind: "bad" });
    }
  }

  const placedTotal = build.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0);
  const targetTotal = target ? target.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0) : 0;
  const timerLabel = config.timer_mode === "countdown" ? "剩余" : "用时";
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const accuracy = correctCount + mistakeCount > 0 ? Math.round((correctCount / (correctCount + mistakeCount)) * 100) : 0;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🏗️</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          练习完成！答对 {correctCount} / {config.total_questions} 题
        </div>
        <div className="text-sm text-muted-foreground mt-1">最长连对 {bestStreak} 题　结束时等级 Lv.{level}</div>
      </div>
    );
  }

  if (!target) return null;

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3 flex-wrap gap-1">
        <span>第 {qIndex} / {config.total_questions} 题　Lv.{level}</span>
        <span>✅ 正确率 {accuracy}%　🔥 连对 {streak}　⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      <p className="text-center text-sm font-medium text-muted-foreground mb-1">🎯 目标（照着这个搭）</p>
      <div className="h-[190px] bg-violet-50 dark:bg-violet-950/20 rounded-2xl mb-3 overflow-hidden">
        <Canvas camera={{ position: [6, 5, 6], fov: 45 }}>
          <Suspense fallback={null}>
            <ReferenceScene heightMap={target} />
          </Suspense>
        </Canvas>
      </div>

      <p className="text-center text-sm font-medium text-muted-foreground mb-1">🔨 你的搭建（已放 {placedTotal} / 目标 {targetTotal} 块）</p>
      <div className="h-[320px] bg-muted/40 rounded-2xl mb-2 overflow-hidden">
        <Canvas camera={{ position: [6, 5, 6], fov: 45 }}>
          <Suspense fallback={null}>
            <BuildScene
              heightMap={build} rows={buildRows} cols={buildCols}
              wrongCols={wrongCols} answered={answered}
              onAdd={addBlock} onRemove={removeBlock}
            />
          </Suspense>
        </Canvas>
      </div>
      <p className="text-center text-xs text-muted-foreground mb-4">🖱️ 拖动旋转视角　滚轮缩放　点半透明的虚影方块加一块，点实心方块拿掉最上面一块</p>

      <div className="flex justify-center gap-3">
        {!answered ? (
          <>
            <button
              onClick={resetBuild}
              className="text-lg font-semibold px-6 py-3 rounded-2xl border-2 border-border bg-card text-foreground transition-colors"
            >
              🗑 清空重搭
            </button>
            <button
              onClick={submitAnswer}
              disabled={placedTotal === 0}
              className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
            >
              ✅ 提交
            </button>
          </>
        ) : (
          <button
            onClick={nextQuestion}
            className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors"
          >
            下一题
          </button>
        )}
      </div>

      {answered && wrongCols.size > 0 && (
        <p className="text-center text-xs text-muted-foreground mt-2">上面搭建区里标红的柱子，就是高度跟目标对不上的地方</p>
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
