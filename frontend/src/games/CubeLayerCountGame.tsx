// frontend/src/games/CubeLayerCountGame.tsx
//
// 立体方块计数 — Stage 2 of 6: 逐层计数. Same 10-level adaptive curve and
// puzzle generation as CubeStackGame (Stage 1) — duplicated here rather
// than imported, per this codebase's existing convention of keeping every
// game file self-contained (see e.g. shuffle()/randInt() re-implemented in
// every other game module instead of shared from a common utils file).
//
// The difference from Stage 1 isn't the puzzle, it's the ANSWER MECHANISM:
// Stage 1 asks "how many blocks total" as one number; this stage makes the
// student fill in a count for EACH layer (bottom to top) and only then sees
// the total — turning what was previously just a "wrong-answer hint" in
// Stage 1 into the actual primary problem-solving step. This is the whole
// point of Stage 2 existing as a separate stage rather than a Stage 1 option.
//
// max_split_layers exists because the adaptive curve tops out at 5 layers
// (see levelParams below — identical to Stage 1's), so in PRACTICE every
// layer always gets its own input box at default settings; the merge-into-
// one-bucket behavior only kicks in if a designer configures something
// tall enough to need it, so answering the question never becomes
// open-ended tedium regardless of how the difficulty curve is tuned later.
//
// i18n: zh/en/ms 已支持 — 见 frontend/src/lib/gameLocale.ts

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Edges } from "@react-three/drei";
import { type Locale, type Dict, t, questionProgress } from "@/lib/gameLocale";

// 这个游戏专属的短语，只有这个Stage会用到，不进gameLocale.ts的COMMON
// 词典，本地维护(每个游戏文件自成一体的既有惯例)。
const LOCAL: Record<string, Dict> = {
  layer_label:      { zh: "第 {i} 层", en: "Layer {i}", ms: "Lapisan {i}" },
  layer_and_above:  { zh: "第 {i} 层及以上", en: "Layer {i} and above", ms: "Lapisan {i} ke atas" },
  drag_hint:        { zh: "拖动旋转视角　滚轮缩放——从下往上，一层一层数", en: "Drag to rotate, scroll to zoom — count layer by layer from the bottom up", ms: "Seret untuk putar, skrol untuk zum — kira lapisan demi lapisan dari bawah" },
  unit_count:       { zh: "个", en: "", ms: "" }, // 中文"个"这种量词，英文/马来文不需要，留空
  correct_hint:     { zh: "（正确 {n}）", en: "(correct: {n})", ms: "(betul: {n})" },
  running_total:    { zh: "目前合计：{n}", en: "Current total: {n}", ms: "Jumlah semasa: {n}" },
  correct_total:    { zh: "（正确总数 {n}）", en: "(correct total: {n})", ms: "(jumlah betul: {n})" },
  correct_all:      { zh: "🎉 每一层都数对了！难度提升一级", en: "🎉 Every layer correct! Level up", ms: "🎉 Semua lapisan betul! Naik tahap" },
  wrong_some:       { zh: "有几层数得不对哦，看看下面标红的地方（难度降一级）", en: "Some layers are off — check the red ones below (level down)", ms: "Ada lapisan yang tersalah — lihat yang merah di bawah (tahap turun)" },
  practice_done:    { zh: "答对 {c} / {n} 题", en: "{c} / {n} correct", ms: "{c} / {n} betul" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

export interface CubeLayerCountConfig {
  starting_level: number;      // 1-10，跟Stage1同一条自适应难度曲线
  total_questions: number;
  max_split_layers: number;    // 超过这个层数，多出来的层合并成"第N层及以上"一个输入框
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
}
export interface CubeLayerCountResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
  ending_level?: number;
}

const LEVEL_MAX = 10;

// 跟 CubeStackGame Stage 1 完全一样的曲线——特意保持一致，不然同一个
// starting_level在两个stage里代表的实际难度会对不上。
function levelParams(level: number) {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  const size = 2 + Math.floor((L - 1) / 3);
  const maxHeight = 1 + Math.floor((L - 1) / 2);
  const emptyProb = L <= 2 ? 0.1 : L <= 6 ? 0.25 : 0.4;
  return { rows: size, cols: size, maxHeight, emptyProb };
}

function randInt(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }

interface Puzzle {
  heightMap: number[][];
  layerCounts: number[]; // 每层各有几个方块，index 0 = 第1层(最底层)
  total: number;
}

function genPuzzle(level: number): Puzzle {
  const { rows, cols, maxHeight, emptyProb } = levelParams(level);
  const heightMap: number[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (Math.random() < emptyProb ? 0 : randInt(1, maxHeight)))
  );
  let anyCube = false;
  for (const row of heightMap) for (const h of row) if (h > 0) anyCube = true;
  if (!anyCube) heightMap[randInt(0, rows - 1)][randInt(0, cols - 1)] = randInt(1, maxHeight);

  const layerCounts: number[] = [];
  for (let lvl = 1; lvl <= maxHeight; lvl++) {
    let count = 0;
    heightMap.forEach((row) => row.forEach((h) => { if (h >= lvl) count++; }));
    layerCounts.push(count);
  }
  return { heightMap, layerCounts, total: layerCounts.reduce((a, b) => a + b, 0) };
}

// 把 layerCounts 按 max_split_layers 拆成"要填的输入格"——没超过上限就
// 每层一格；超过的话，前面(max-1)层各自一格，剩下全部层合并成最后一格。
// label现在要按locale生成，所以这个函数多接一个locale参数。
interface InputBucket { label: string; trueValue: number }
function buildBuckets(layerCounts: number[], maxSplit: number, locale: Locale): InputBucket[] {
  if (layerCounts.length <= maxSplit) {
    return layerCounts.map((v, i) => ({ label: lt("layer_label", locale, { i: i + 1 }), trueValue: v }));
  }
  const individual = layerCounts.slice(0, maxSplit - 1).map((v, i) => ({ label: lt("layer_label", locale, { i: i + 1 }), trueValue: v }));
  const restSum = layerCounts.slice(maxSplit - 1).reduce((a, b) => a + b, 0);
  individual.push({ label: lt("layer_and_above", locale, { i: maxSplit }), trueValue: restSum });
  return individual;
}

const CUBE_SIZE = 0.88;

function LayerCountScene({ heightMap }: { heightMap: number[][] }) {
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

export default function CubeLayerCountGame({ config, onComplete, locale = "zh" }: {
  config: CubeLayerCountConfig; onComplete: (r: CubeLayerCountResult) => void; locale?: Locale;
}) {
  const maxSplit = Math.max(2, config.max_split_layers || 5);

  const [qIndex, setQIndex] = useState(0);
  const [level, setLevel] = useState(() => Math.min(LEVEL_MAX, Math.max(1, config.starting_level || 1)));
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [buckets, setBuckets] = useState<InputBucket[]>([]);
  const [inputs, setInputs] = useState<string[]>([]);
  const [answered, setAnswered] = useState(false);
  const [perLayerCorrect, setPerLayerCorrect] = useState<boolean[] | null>(null);
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
    const b = buildBuckets(p.layerCounts, maxSplit, locale);
    setPuzzle(p);
    setBuckets(b);
    setInputs(b.map(() => ""));
    setAnswered(false);
    setPerLayerCorrect(null);
    setStatus({ msg: "", kind: "" });
    setQIndex((i) => i + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, maxSplit, locale]);

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

  function updateInput(i: number, val: string) {
    const digits = val.replace(/[^0-9]/g, "");
    setInputs((prev) => prev.map((v, idx) => (idx === i ? digits : v)));
  }

  const runningTotal = inputs.reduce((sum, v) => sum + (v === "" ? 0 : parseInt(v, 10)), 0);
  const allFilled = inputs.every((v) => v !== "");

  function submitAnswer() {
    if (answered || finished || !allFilled) return;
    setAnswered(true);
    const results = buckets.map((b, i) => parseInt(inputs[i], 10) === b.trueValue);
    setPerLayerCorrect(results);
    const allCorrect = results.every(Boolean);
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
        <div className="text-6xl">🧊</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {t("practice_complete", locale)}{lt("practice_done", locale, { c: correctCount, n: config.total_questions })}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{t("best_streak", locale)} {bestStreak}　{t("ending_level", locale)} Lv.{level}</div>
      </div>
    );
  }

  if (!puzzle) return null;

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3 flex-wrap gap-1">
        <span>{questionProgress(qIndex, config.total_questions, locale)}　Lv.{level}</span>
        <span>✅ {t("accuracy", locale)} {accuracy}%　🔥 {t("streak", locale)} {streak}　⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      <div className="h-[320px] bg-muted/40 rounded-2xl mb-2 overflow-hidden">
        <Canvas camera={{ position: [6, 5, 6], fov: 45 }}>
          <Suspense fallback={null}>
            <LayerCountScene heightMap={puzzle.heightMap} />
          </Suspense>
        </Canvas>
      </div>
      <p className="text-center text-xs text-muted-foreground mb-4">🖱️ {lt("drag_hint", locale)}</p>

      <div className="space-y-2 mb-4">
        {buckets.map((b, i) => {
          const isCorrect = perLayerCorrect?.[i];
          const showColor = perLayerCorrect !== null;
          return (
            <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-muted/40">
              <span className="text-sm font-medium text-foreground">{b.label}</span>
              <div className="flex items-center gap-2">
                <input
                  type="tel" inputMode="numeric" value={inputs[i]}
                  disabled={answered}
                  onChange={(e) => updateInput(i, e.target.value)}
                  className={`w-16 text-center text-lg font-bold px-2 py-1.5 rounded-lg border-2 outline-none transition-colors ${
                    showColor
                      ? isCorrect ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-red-500 bg-red-50 text-red-600"
                      : "border-border bg-card focus:border-primary"
                  }`}
                  placeholder="?"
                />
                <span className="text-sm text-muted-foreground">{lt("unit_count", locale)}</span>
                {showColor && !isCorrect && <span className="text-xs text-red-500">{lt("correct_hint", locale, { n: b.trueValue })}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-sm text-muted-foreground mb-4">
        <span className="font-semibold text-foreground">{lt("running_total", locale, { n: runningTotal })}</span>
        {perLayerCorrect && <span> {lt("correct_total", locale, { n: puzzle.total })}</span>}
      </p>

      <div className="flex justify-center">
        {!answered ? (
          <button
            onClick={submitAnswer}
            disabled={!allFilled}
            className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
          >
            ✅ {t("submit", locale)}
          </button>
        ) : (
          <button
            onClick={nextQuestion}
            className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors"
          >
            {t("next_question", locale)}
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

