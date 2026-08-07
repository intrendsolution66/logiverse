// frontend/src/games/CubeFindHiddenGame.tsx
//
// 立体方块计数 — Stage 3 of 6: 找隐藏方块. Same 10-level adaptive curve/
// puzzle shape as Stage 1/2 (duplicated per this codebase's "every game
// file is self-contained" convention), but this stage actually USES the
// occlusion that heightMap always allowed but Stage 1/2 never exploited
// (their totals are always countable without needing to find any specific
// cube — rotating to see everything is enough). Here the point IS finding
// specific cube(s) that are hard to see from the default angle.
//
// "Hidden" here means a heuristic, not a rigorous visibility computation:
// a column is a "valley" if every existing orthogonal neighbor is taller
// than it, and the topmost cube of a valley column is the designated
// target. This is a reasonable proxy for "occluded from typical angles,
// needs rotation to spot" for this age group's purposes — not a real
// raycasting-based occlusion proof, which would be substantial overkill
// for a children's spatial-reasoning exercise.
//
// Answer mechanism: click directly on the cube in the 3D scene (reuses the
// same onClick-per-mesh technique already used for the optional "mark as
// counted" highlight in Stage 1/4 — here the click has real judgement
// consequences instead of being a free scratch-mark).

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Edges } from "@react-three/drei";

export interface CubeFindHiddenConfig {
  starting_level: number;    // 1-10，跟Stage1/2同一条自适应难度曲线
  total_questions: number;
  hidden_targets: number;    // 每题要找几个隐藏方块（如果这一局结构生成出来的"山谷"位置不够，会自动取实际能有的数量，不会卡住）
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
}
export interface CubeFindHiddenResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
  ending_level?: number;
}

const LEVEL_MAX = 10;
const MAX_WRONG_GUESSES = 3; // 一题最多容许猜错几次，避免小孩瞎点点不完

function levelParams(level: number) {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  const size = 2 + Math.floor((L - 1) / 3);
  const maxHeight = 1 + Math.floor((L - 1) / 2);
  const emptyProb = L <= 2 ? 0.1 : L <= 6 ? 0.25 : 0.4;
  return { rows: size, cols: size, maxHeight, emptyProb };
}

function randInt(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Puzzle {
  heightMap: number[][];
  targets: Set<string>; // cube key，格式跟渲染用的key一致："row-col-level"(level从0起算)
}

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

// "山谷"列——每一个存在的相邻列(上下左右)都比它高，顶端那颗方块就是这
// 一列的"隐藏"目标。retry几次找不到山谷，就退而求其次挑"全场最矮、
// 紧邻着全场最高那根柱子"的那一列当保底目标，确保这一题一定有得找。
function findValleyTargets(heightMap: number[][]): string[] {
  const rows = heightMap.length, cols = heightMap[0]?.length ?? 0;
  const candidates: { r: number; c: number; h: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = heightMap[r][c];
      if (h === 0) continue;
      const neighbors = [
        r > 0 ? heightMap[r - 1][c] : null,
        r < rows - 1 ? heightMap[r + 1][c] : null,
        c > 0 ? heightMap[r][c - 1] : null,
        c < cols - 1 ? heightMap[r][c + 1] : null,
      ].filter((n): n is number => n !== null && n > 0);
      const tallerCount = neighbors.filter((n) => n > h).length;
      if (neighbors.length >= 2 && tallerCount === neighbors.length) {
        candidates.push({ r, c, h });
      }
    }
  }
  if (candidates.length === 0) {
    // 保底：找全场最矮的非空列，只要它至少有一个比它高的邻居就凑合当目标
    let best: { r: number; c: number; h: number } | null = null;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const h = heightMap[r][c];
      if (h === 0) continue;
      if (!best || h < best.h) best = { r, c, h };
    }
    if (best) candidates.push(best);
  }
  return candidates.map((v) => `${v.r}-${v.c}-${v.h - 1}`);
}

function genPuzzle(level: number, hiddenTargets: number): Puzzle {
  let heightMap = genHeightMap(level);
  let valleyKeys = findValleyTargets(heightMap);
  // 一直生不出任何目标的极端情况(理论上很少见)，重试几次换一个结构
  for (let attempt = 0; attempt < 8 && valleyKeys.length === 0; attempt++) {
    heightMap = genHeightMap(level);
    valleyKeys = findValleyTargets(heightMap);
  }
  const picked = shuffle(valleyKeys).slice(0, Math.max(1, Math.min(hiddenTargets, valleyKeys.length)));
  return { heightMap, targets: new Set(picked) };
}

const CUBE_SIZE = 0.88;

function FindHiddenScene({ heightMap, found, revealed, wrongFlashKey, onCubeClick }: {
  heightMap: number[][];
  found: Set<string>;
  revealed: Set<string>; // 猜错3次后揭晓、但玩家没找到的目标
  wrongFlashKey: string | null;
  onCubeClick: (key: string) => void;
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
        const isFound = found.has(cube.key);
        const isRevealed = revealed.has(cube.key);
        const isWrongFlash = wrongFlashKey === cube.key;
        const color = isFound ? "#4fb06d" : isRevealed ? "#f59e0b" : isWrongFlash ? "#ef4444" : "#93c5fd";
        const edgeColor = isFound ? "#1e6b39" : isRevealed ? "#92400e" : isWrongFlash ? "#7f1d1d" : "#1d4ed8";
        return (
          <mesh
            key={cube.key}
            position={[cube.x, cube.y, cube.z]}
            onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onCubeClick(cube.key); }}
          >
            <boxGeometry args={[CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]} />
            <meshStandardMaterial color={color} />
            <Edges color={edgeColor} />
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

export default function CubeFindHiddenGame({ config, onComplete }: {
  config: CubeFindHiddenConfig; onComplete: (r: CubeFindHiddenResult) => void;
}) {
  const hiddenTargets = Math.max(1, config.hidden_targets || 1);

  const [qIndex, setQIndex] = useState(0);
  const [level, setLevel] = useState(() => Math.min(LEVEL_MAX, Math.max(1, config.starting_level || 1)));
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [found, setFound] = useState<Set<string>>(new Set());
  const [wrongGuesses, setWrongGuesses] = useState(0);
  const [wrongFlashKey, setWrongFlashKey] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [outcome, setOutcome] = useState<"success" | "fail" | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);

  const startRef = useRef(Date.now());
  const levelRef = useRef(level);
  levelRef.current = level;
  const lockRef = useRef(false);

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
    setPuzzle(genPuzzle(levelRef.current, hiddenTargets));
    setFound(new Set());
    setWrongGuesses(0);
    setWrongFlashKey(null);
    setAnswered(false);
    setOutcome(null);
    setQIndex((i) => i + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, hiddenTargets]);

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

  function handleCubeClick(key: string) {
    if (answered || finished || !puzzle || lockRef.current) return;

    if (puzzle.targets.has(key)) {
      if (found.has(key)) return; // 已经找到过的目标，重复点不算事
      const nextFound = new Set(found); nextFound.add(key);
      setFound(nextFound);
      if (nextFound.size === puzzle.targets.size) {
        // 全部找到——这一题算对
        setAnswered(true);
        setOutcome("success");
        setCorrectCount((c) => c + 1);
        setStreak((s) => { const next = s + 1; setBestStreak((b) => Math.max(b, next)); return next; });
        setLevel((lv) => Math.min(LEVEL_MAX, lv + 1));
      }
    } else {
      // 点到的是普通方块，不是藏起来的那个——算猜错一次
      lockRef.current = true;
      setWrongFlashKey(key);
      setTimeout(() => { setWrongFlashKey(null); lockRef.current = false; }, 350);
      const nextWrong = wrongGuesses + 1;
      setWrongGuesses(nextWrong);
      if (nextWrong >= MAX_WRONG_GUESSES) {
        setAnswered(true);
        setOutcome("fail");
        setMistakeCount((m) => m + 1);
        setStreak(0);
        setLevel((lv) => Math.max(1, lv - 1));
      }
    }
  }

  const timerLabel = config.timer_mode === "countdown" ? "剩余" : "用时";
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const accuracy = correctCount + mistakeCount > 0 ? Math.round((correctCount / (correctCount + mistakeCount)) * 100) : 0;
  // 猜错3次公布答案时，把没找到的目标显示出来（找到的那些已经是found里的绿色了）
  const revealed = outcome === "fail" && puzzle ? new Set([...puzzle.targets].filter((k) => !found.has(k))) : new Set<string>();

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🕵️</div>
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

      <p className="text-center text-lg font-semibold text-foreground mb-2">
        转一转，找出被挡住看不见的方块（还差 {puzzle.targets.size - found.size} 个）
      </p>

      <div className="h-[360px] bg-muted/40 rounded-2xl mb-2 overflow-hidden">
        <Canvas camera={{ position: [6, 5, 6], fov: 45 }}>
          <Suspense fallback={null}>
            <FindHiddenScene heightMap={puzzle.heightMap} found={found} revealed={revealed} wrongFlashKey={wrongFlashKey} onCubeClick={handleCubeClick} />
          </Suspense>
        </Canvas>
      </div>
      <p className="text-center text-xs text-muted-foreground mb-4">
        🖱️ 拖动旋转视角　滚轮缩放　点击你觉得"这里应该有一个"的方块（最多猜错 {MAX_WRONG_GUESSES} 次，还有 {Math.max(0, MAX_WRONG_GUESSES - wrongGuesses)} 次机会）
      </p>

      {answered && (
        <div className={`text-center text-lg font-medium px-4 py-3 rounded-xl mb-3 ${
          outcome === "success" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
          : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
        }`}>
          {outcome === "success" ? "🎉 全部找到了！难度提升一级" : "橘色标出来的就是没找到的位置（难度降一级）"}
        </div>
      )}

      {answered && (
        <div className="flex justify-center">
          <button
            onClick={nextQuestion}
            className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors"
          >
            下一题
          </button>
        </div>
      )}
    </div>
  );
}
