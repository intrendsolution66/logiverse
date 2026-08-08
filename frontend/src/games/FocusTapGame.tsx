// frontend/src/games/FocusTapGame.tsx
//
// The 专注力点数字 engine — two modes now:
//   'grid'   — procedural (N×N grid, numbers shuffled to cells each play)
//   'custom' — authored: course designer uploads a scene image and marks
//              exactly where each number should appear (positions), same
//              "this IS the content, not generation parameters" principle
//              as maze/spot_diff. Numbers still get reshuffled onto those
//              fixed positions every play — the POSITIONS are authored,
//              which number lands where each session is still randomized
//              (that randomization is the actual point of the exercise).
//
// i18n: zh/en/ms 已支持(界面文字) — 见 frontend/src/lib/gameLocale.ts。
// question_i18n 是designer自己填的authored题目文字——现在CourseDesignerPage.tsx
// 已经支持三语言输入了(zh/en/ms)，运行时读取顺序是"当前locale优先，没填
// 再退回zh，还没填再退回en"。

import { useState, useEffect, useRef, useCallback } from "react";
import { type Locale, type Dict, t } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  next_number:  { zh: "🎯 下一个：{n}", en: "🎯 Next: {n}", ms: "🎯 Seterusnya: {n}" },
  all_tapped:   { zh: "全部点完了！用时 {s} 秒", en: "All tapped! Time: {s}s", ms: "Semua ditekan! Masa: {s}s" },
  time_up:      { zh: "时间到，点到了 {c} / {n}", en: "Time's up — tapped {c} / {n}", ms: "Masa tamat — tekan {c} / {n}" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

export interface FocusTapPosition { x: number; y: number } // normalized 0..1

export interface FocusTapConfig {
  mode: "grid" | "custom";
  grid_size: number;
  bg_image_url?: string | null;
  positions?: FocusTapPosition[] | null;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string; ms?: string };
}
export interface FocusTapResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function FocusTapGame({ config, onComplete, locale = "zh" }: {
  config: FocusTapConfig; onComplete: (r: FocusTapResult) => void; locale?: Locale;
}) {
  const isCustom = config.mode === "custom" && config.bg_image_url && config.positions && config.positions.length >= 2;
  const total = isCustom ? config.positions!.length : config.grid_size * config.grid_size;

  // grid mode: numbers assigned to grid cells (array index = cell index)
  // custom mode: numbers assigned to config.positions (array index = position index)
  const [numberOrder] = useState<number[]>(() => shuffle(Array.from({ length: total }, (_, i) => i + 1)));
  const [next, setNext] = useState(1);
  const [mistakes, setMistakes] = useState(0);
  const [flashWrong, setFlashWrong] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());

  const finish = useCallback((completed: boolean) => {
    setFinished(true);
    onComplete({
      score: next - 1, max_score: total,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes, completed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, mistakes, total]);

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

  function handleTap(value: number) {
    if (finished) return;
    if (value === next) {
      if (next === total) { finish(true); return; }
      setNext(next + 1);
    } else {
      setMistakes((m) => m + 1);
      setFlashWrong(value);
      setTimeout(() => setFlashWrong(null), 300);
    }
  }

  const timerLabel = config.timer_mode === "countdown" ? t("time_left", locale) : t("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">{next > total ? "🎯" : "⏰"}</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {next > total ? lt("all_tapped", locale, { s: timerValue.toFixed(1) }) : lt("time_up", locale, { c: next - 1, n: total })}
        </div>
      </div>
    );
  }

  function numberButton(val: number, extraStyle?: React.CSSProperties) {
    const done = val < next;
    const wrong = flashWrong === val;
    return (
      <button
        key={val}
        onClick={() => handleTap(val)}
        disabled={done}
        style={extraStyle}
        className={`aspect-square text-2xl sm:text-3xl font-semibold rounded-xl border-2 transition-colors ${
          done
            ? "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400 cursor-default"
            : wrong
            ? "border-red-200 bg-red-50 text-foreground dark:border-red-900 dark:bg-red-950/40"
            : "border-border bg-card/90 text-foreground hover:border-primary/50 cursor-pointer shadow-sm"
        }`}
      >
        {val}
      </button>
    );
  }

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3">
        <span>{lt("next_number", locale, { n: next })}</span>
        <span>⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>
      {(config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en) && (
        <p className="text-center text-lg font-semibold text-foreground mb-3">{config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en}</p>
      )}

      {isCustom ? (
        <div className="relative w-full aspect-[11/7] rounded-2xl overflow-hidden bg-muted/40 shadow-lg ring-1 ring-black/5">
          <img src={config.bg_image_url!} alt="" className="absolute inset-0 w-full h-full object-fill" />
          {config.positions!.map((pos, i) => (
            <div key={i} className="absolute w-12 h-12 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}>
              {numberButton(numberOrder[i], { width: "100%", height: "100%" })}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 bg-amber-50 dark:bg-amber-950/20 rounded-2xl p-5 shadow-lg ring-1 ring-black/5" style={{ gridTemplateColumns: `repeat(${config.grid_size}, 1fr)` }}>
          {numberOrder.map((val) => numberButton(val))}
        </div>
      )}
    </div>
  );
}
