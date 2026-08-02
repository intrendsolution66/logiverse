// frontend/src/games/MemoryGame.tsx
//
// Memory 翻牌配对 engine. Theme presets are emoji sets (same approach as
// CountingGame's theme icons); shuffle-bag picks `pairs_count` distinct
// icons from the theme set so a repeat play doesn't always show the exact
// same subset. Cards preview face-up for `preview_seconds` at the start —
// this is a memory exercise, seeing the layout briefly is the point.

import { useState, useEffect, useRef, useCallback } from "react";

export interface MemoryConfig {
  theme: "animal" | "fruit" | "number" | "shape" | "custom";
  custom_icons?: string[]; // image URLs, used when theme === "custom" — replaces the emoji pool
  bg_image_url?: string;   // optional backdrop behind the board, any theme (not just custom)
  pairs_count: number;
  preview_seconds: number;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string };
  // 自由摆放——课程设计师在背景图上手动摆的牌位置槽（归一化0-1），数量
  // 要等于卡片总数（配对图片数×2）。哪张牌的图标落在哪个槽位是随机的
  // （靠下面 cards 洗牌决定），槽位本身的位置是设计师摆好、固定不变的。
  // 不设、或数量对不上卡片数时，退回原本的自动网格排列。
  layout?: "grid" | "free";
  positions?: { x: number; y: number }[];
}
export interface MemoryResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

const THEME_SETS: Record<string, string[]> = {
  animal: ["🐶","🐱","🐰","🐻","🦊","🐼","🐨","🦁","🐯","🐮","🐷","🐸"],
  fruit:  ["🍎","🍌","🍇","🍓","🍑","🍍","🥝","🍉","🍒","🍋","🥭","🍐"],
  number: ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"],
  shape:  ["🔴","🔵","🟢","🟡","🟣","🟠","⭐","💠","🔶","🔷"],
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Card { id: number; icon: string; matched: boolean }

export default function MemoryGame({ config, onComplete }: {
  config: MemoryConfig; onComplete: (r: MemoryResult) => void;
}) {
  const pairs = Math.max(2, config.pairs_count);
  const isCustom = config.theme === "custom" && !!config.custom_icons?.length;
  const pool = isCustom ? config.custom_icons! : (THEME_SETS[config.theme] ?? THEME_SETS.animal);

  const [cards] = useState<Card[]>(() => {
    const icons = shuffle(pool).slice(0, Math.min(pairs, pool.length));
    const deck = shuffle([...icons, ...icons]).map((icon, id) => ({ id, icon, matched: false }));
    return deck;
  });
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [flipped, setFlipped] = useState<number[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [previewing, setPreviewing] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());
  const lockRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => { setPreviewing(false); startRef.current = Date.now(); }, config.preview_seconds * 1000);
    return () => clearTimeout(t);
  }, [config.preview_seconds]);

  const finish = useCallback((completed: boolean) => {
    setFinished(true);
    onComplete({
      score: matched.size / 2, max_score: cards.length / 2,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes, completed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, mistakes, cards.length]);

  useEffect(() => {
    if (finished || previewing) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished, previewing]);

  useEffect(() => {
    if (config.timer_mode !== "countdown" || !config.time_limit || finished || previewing) return;
    if (elapsed >= config.time_limit) finish(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  function handleFlip(id: number) {
    if (previewing || finished || lockRef.current) return;
    if (matched.has(id) || flipped.includes(id)) return;

    const next = [...flipped, id];
    setFlipped(next);
    if (next.length === 2) {
      lockRef.current = true;
      const [a, b] = next;
      const cardA = cards.find((c) => c.id === a)!, cardB = cards.find((c) => c.id === b)!;
      if (cardA.icon === cardB.icon) {
        setTimeout(() => {
          const nextMatched = new Set(matched); nextMatched.add(a); nextMatched.add(b);
          setMatched(nextMatched);
          setFlipped([]);
          lockRef.current = false;
          if (nextMatched.size === cards.length) finish(true);
        }, 400);
      } else {
        setMistakes((m) => m + 1);
        setTimeout(() => { setFlipped([]); lockRef.current = false; }, 800);
      }
    }
  }

  const timerLabel = config.timer_mode === "countdown" ? "剩余" : "用时";
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const cols = Math.min(6, Math.ceil(Math.sqrt(cards.length)));
  // 自由摆放——位置槽数量必须正好等于卡片数才启用，数量对不上（比如
  // 旧数据、或者设计师改了配对图片数但没重新摆位置）就安全退回网格排列，
  // 不会因为数组越界崩溃或者有卡片没地方放。
  const isFree = config.layout === "free" && !!config.positions && config.positions.length === cards.length;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">{matched.size === cards.length ? "🎉" : "⏰"}</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          配对成功 {matched.size / 2} / {cards.length / 2} 对，用时 {timerValue.toFixed(1)} 秒
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3">
        <span>🃏 配对 {matched.size / 2} / {cards.length / 2}</span>
        <span>{previewing ? "记住位置..." : `⏱️ ${timerLabel} ${timerValue.toFixed(1)}s`}</span>
      </div>
      {(config.question_i18n?.zh || config.question_i18n?.en) && (
        <p className="text-center text-lg font-semibold text-foreground mb-3">{config.question_i18n?.zh || config.question_i18n?.en}</p>
      )}
      <div
        className={`relative rounded-2xl shadow-lg ring-1 ring-black/5 ${isFree ? "w-full aspect-[11/7]" : "grid gap-3 p-3"}`}
        style={{
          ...(isFree ? {} : { gridTemplateColumns: `repeat(${cols}, 1fr)` }),
          backgroundImage: config.bg_image_url ? `url(${config.bg_image_url})` : undefined,
          backgroundSize: "100% 100%", backgroundPosition: "center",
        }}
      >
        {cards.map((c, i) => {
          const isUp = previewing || matched.has(c.id) || flipped.includes(c.id);
          const pos = isFree ? config.positions![i] : null;
          return (
            <button
              key={c.id}
              onClick={() => handleFlip(c.id)}
              className={`${isFree ? "absolute -translate-x-1/2 -translate-y-1/2 w-[12%] aspect-square" : "aspect-square"} text-4xl sm:text-5xl rounded-xl border-2 transition-colors overflow-hidden flex items-center justify-center ${
                matched.has(c.id)
                  ? "border-emerald-200 bg-emerald-50/90 dark:border-emerald-900 dark:bg-emerald-950/60 cursor-default"
                  : isUp
                  ? "border-border bg-card/90 cursor-default"
                  : "border-violet-300 bg-violet-400 dark:bg-violet-600 cursor-pointer hover:bg-violet-500"
              }`}
              style={pos ? { left: `${pos.x * 100}%`, top: `${pos.y * 100}%` } : undefined}
            >
              {isUp && (isCustom ? <img src={c.icon} alt="" className="max-w-full max-h-full object-contain p-1.5" /> : c.icon)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
