// frontend/src/games/CubeFreeRotateGame.tsx
//
// 立体方块计数 — Stage 4 of 6: 自由旋转观察. Pure exploration, no scoring —
// this is a warm-up/tutorial stage for kids who aren't yet comfortable with
// 3D drag-to-rotate, meant to sit BEFORE Stage 1 (数方块) chronologically
// even though it's numbered later in the roadmap (see CubeStackGame.tsx's
// header comment for the full six-stage plan). No click-to-highlight, no
// "find the answer" — just "look at this from every angle before moving on".
//
// Reuses the exact same 3D box-rendering technique as CubeStackGame
// (instanced boxes + OrbitControls), deliberately NOT importing from that
// file — each game module stays self-contained per this codebase's existing
// convention (see e.g. the duplicated shuffle()/randInt() helpers across
// every other game file), so this file has its own copy of the small cube
// generation logic rather than reaching into CubeStackGame's internals.
//
// i18n: zh/en/ms 已支持(界面文字) — 见 frontend/src/lib/gameLocale.ts。
// question_i18n 这个字段是设计师自己填的authored题目文字，跟这套UI词典
// 是两回事，这次没有扩展它加ms(维持原样zh/en两个key)，不在这次试点范围。

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Edges } from "@react-three/drei";
import { type Locale, type Dict, t } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  shape_progress: { zh: "第 {i} / {n} 个结构", en: "Shape {i} / {n}", ms: "Bentuk {i} / {n}" },
  drag_hint:      { zh: "拖动旋转视角　滚轮缩放　点击方块可以标记一下（不影响对错，纯粹帮助自己看）", en: "Drag to rotate, scroll to zoom, click a cube to mark it (doesn't affect scoring, just a visual aid)", ms: "Seret untuk putar, skrol untuk zum, klik kiub untuk tanda (tidak menjejaskan markah, cuma bantuan visual)" },
  all_seen:       { zh: "都看完了！一共观察了 {n} 个立体结构", en: "All done! You observed {n} structures", ms: "Selesai! Anda telah memerhati {n} struktur" },
  done_button:    { zh: "✅ 看完了", en: "✅ Done", ms: "✅ Selesai" },
  next_shape:     { zh: "👉 下一个结构", en: "👉 Next shape", ms: "👉 Bentuk seterusnya" },
  keep_looking:   { zh: "再转一转，{s}秒后可以继续", en: "Keep exploring — {s}s until you can continue", ms: "Terus meneroka — {s}s lagi sebelum boleh teruskan" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

export interface CubeFreeRotateConfig {
  total_shapes: number;      // 依序看几个不同的结构
  shape_size: number;        // 2~5，网格边长，决定结构复杂度（这一关难度固定，不自适应——是热身关不是考题）
  min_view_seconds: number;  // 每个结构至少要转/看几秒，才能按"下一个"（防止直接秒点跳过）
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string };
}
export interface CubeFreeRotateResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

function randInt(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }

interface Shape { heightMap: number[][] }

function genShape(size: number): Shape {
  const s = Math.min(5, Math.max(2, size));
  const maxHeight = Math.ceil(s / 2) + 1;
  const heightMap: number[][] = Array.from({ length: s }, () =>
    Array.from({ length: s }, () => (Math.random() < 0.2 ? 0 : randInt(1, maxHeight)))
  );
  let anyCube = false;
  for (const row of heightMap) for (const h of row) if (h > 0) anyCube = true;
  if (!anyCube) heightMap[randInt(0, s - 1)][randInt(0, s - 1)] = randInt(1, maxHeight);
  return { heightMap };
}

const CUBE_SIZE = 0.88;

function FreeRotateScene({ heightMap, highlighted, onToggleHighlight }: {
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
            <meshStandardMaterial color={isHi ? "#4fb06d" : "#7dd3fc"} />
            <Edges color={isHi ? "#1e6b39" : "#0284c7"} />
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

export default function CubeFreeRotateGame({ config, onComplete, locale = "zh" }: {
  config: CubeFreeRotateConfig; onComplete: (r: CubeFreeRotateResult) => void; locale?: Locale;
}) {
  const total = Math.max(1, config.total_shapes || 1);
  const minView = Math.max(0, config.min_view_seconds ?? 5);

  const [shapeIndex, setShapeIndex] = useState(0);
  const [shape, setShape] = useState<Shape | null>(null);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [viewElapsed, setViewElapsed] = useState(0); // 当前这个结构已经看了几秒
  const [elapsed, setElapsed] = useState(0); // 整关总用时
  const [finished, setFinished] = useState(false);

  const startRef = useRef(Date.now());
  const shapeStartRef = useRef(Date.now());

  const finish = useCallback(() => {
    setFinished(true);
    onComplete({
      score: total, max_score: total, // 没有对错——看完几个就是几个，纯探索关
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes: 0, completed: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  const loadShape = useCallback((idx: number) => {
    if (idx >= total) { finish(); return; }
    setShape(genShape(config.shape_size || 3));
    setHighlighted(new Set());
    setViewElapsed(0);
    shapeStartRef.current = Date.now();
    setShapeIndex(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, config.shape_size]);

  useEffect(() => {
    startRef.current = Date.now();
    loadShape(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => {
      setElapsed((Date.now() - startRef.current) / 1000);
      setViewElapsed((Date.now() - shapeStartRef.current) / 1000);
    }, 100);
    return () => clearInterval(id);
  }, [finished]);

  useEffect(() => {
    if (config.timer_mode !== "countdown" || !config.time_limit || finished) return;
    if (elapsed >= config.time_limit) {
      setFinished(true);
      onComplete({
        score: shapeIndex, max_score: total,
        time_spent_seconds: elapsed, mistakes: 0, completed: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  function toggleHighlight(key: string) {
    setHighlighted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const timerLabel = config.timer_mode === "countdown" ? t("time_left", locale) : t("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const canAdvance = viewElapsed >= minView;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🔄</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {lt("all_seen", locale, { n: total })}
        </div>
      </div>
    );
  }

  if (!shape) return null;

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3 flex-wrap gap-1">
        <span>{lt("shape_progress", locale, { i: shapeIndex + 1, n: total })}</span>
        <span>⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>
      {(config.question_i18n?.zh || config.question_i18n?.en) && (
        <p className="text-center text-lg font-semibold text-foreground mb-3">{config.question_i18n?.zh || config.question_i18n?.en}</p>
      )}

      <div className="h-[360px] bg-muted/40 rounded-2xl mb-2 overflow-hidden">
        <Canvas camera={{ position: [6, 5, 6], fov: 45 }}>
          <Suspense fallback={null}>
            <FreeRotateScene heightMap={shape.heightMap} highlighted={highlighted} onToggleHighlight={toggleHighlight} />
          </Suspense>
        </Canvas>
      </div>
      <p className="text-center text-xs text-muted-foreground mb-4">🖱️ {lt("drag_hint", locale)}</p>

      <div className="flex justify-center">
        <button
          onClick={() => loadShape(shapeIndex + 1)}
          disabled={!canAdvance}
          className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
        >
          {canAdvance ? (shapeIndex + 1 >= total ? lt("done_button", locale) : lt("next_shape", locale)) : lt("keep_looking", locale, { s: (minView - viewElapsed).toFixed(1) })}
        </button>
      </div>
    </div>
  );
}
