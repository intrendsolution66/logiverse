// frontend/src/games/SpotDiffGame.tsx
//
// The 找不同之处 engine, ported from the standalone HTML prototype. Uses a
// canvas the same way the prototype did (two images side by side, hotspot
// hit-testing) — canvas is the right tool here since we're compositing two
// images plus circle overlays, not really a DOM-layout problem.
//
// Config shape matches edu.spot_diff_configs: image_a_url, image_b_url,
// hotspots ([{x,y,r}] normalized 0..1 per image), timer_mode, time_limit.
//
// i18n: zh/en/ms 已支持(界面文字) — 见 frontend/src/lib/gameLocale.ts。
// question_i18n 是designer自己填的authored题目文字，这次没扩展它加ms。

import { useEffect, useRef, useState, useCallback } from "react";
import { GAME_CANVAS_W, GAME_CANVAS_H } from "@/lib/gameCanvas";
import { type Locale, type Dict, t } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  default_prompt: { zh: "找找看两张图哪里不一样，点一下不同的地方吧！", en: "Find the differences between the two pictures and tap them!", ms: "Cari perbezaan antara dua gambar dan ketik!" },
  found_more:     { zh: "🎉 找到了！还有 {n} 处", en: "🎉 Found it! {n} left", ms: "🎉 Dijumpai! {n} lagi" },
  try_again:      { zh: "这里好像一样哦，再找找看～", en: "That looks the same — keep looking", ms: "Nampak sama sahaja — cari lagi" },
  loading_images: { zh: "图片加载中...", en: "Loading images...", ms: "Memuatkan imej..." },
  found_progress: { zh: "🔍 找到 {a} / {b}", en: "🔍 Found {a} / {b}", ms: "🔍 Dijumpai {a} / {b}" },
  found_done:     { zh: "找到 {a} / {b} 处，用时 {s} 秒", en: "Found {a} / {b}, time: {s}s", ms: "Dijumpai {a} / {b}, masa: {s}s" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

export interface SpotDiffHotspot { x: number; y: number; r: number }
export interface SpotDiffConfig {
  image_a_url: string;
  image_b_url: string;
  hotspots: SpotDiffHotspot[];
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string };
}
export interface SpotDiffResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

const W = GAME_CANVAS_W, H = GAME_CANVAS_H;
const BOX_W = 500, BOX_H = 655, LEFT_X = 30, RIGHT_X = 570, BOX_Y = 22;

export default function SpotDiffGame({ config, onComplete, locale = "zh" }: {
  config: SpotDiffConfig; onComplete: (r: SpotDiffResult) => void; locale?: Locale;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgARef = useRef<HTMLImageElement | null>(null);
  const imgBRef = useRef<HTMLImageElement | null>(null);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [found, setFound] = useState<Set<number>>(new Set());
  const [misses, setMisses] = useState(0);
  const [status, setStatus] = useState(config.question_i18n?.zh || config.question_i18n?.en || lt("default_prompt", locale));
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const missFlashRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const startRef = useRef(Date.now());

  useEffect(() => {
    let loadedCount = 0;
    const onLoad = () => { loadedCount++; if (loadedCount === 2) setImagesLoaded(true); };
    const a = new Image(); a.crossOrigin = "anonymous"; a.onload = onLoad; a.src = config.image_a_url;
    const b = new Image(); b.crossOrigin = "anonymous"; b.onload = onLoad; b.src = config.image_b_url;
    imgARef.current = a; imgBRef.current = b;
  }, [config.image_a_url, config.image_b_url]);

  const finish = useCallback(() => {
    setFinished(true);
    onComplete({
      score: found.size, max_score: config.hotspots.length,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes: misses, completed: found.size === config.hotspots.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, misses]);

  // render loop
  useEffect(() => {
    if (!imagesLoaded) return;
    let raf: number;
    const draw = () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx && imgARef.current && imgBRef.current) {
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(imgARef.current, LEFT_X, BOX_Y, BOX_W, BOX_H);
        ctx.drawImage(imgBRef.current, RIGHT_X, BOX_Y, BOX_W, BOX_H);
        ctx.strokeStyle = "#dbe9e0"; ctx.lineWidth = 2;
        ctx.strokeRect(LEFT_X, BOX_Y, BOX_W, BOX_H);
        ctx.strokeRect(RIGHT_X, BOX_Y, BOX_W, BOX_H);

        config.hotspots.forEach((h, i) => {
          if (!found.has(i)) return;
          [LEFT_X, RIGHT_X].forEach((ox) => {
            ctx.beginPath();
            ctx.arc(ox + h.x * BOX_W, BOX_Y + h.y * BOX_H, h.r * BOX_W, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(46,158,91,0.95)"; ctx.lineWidth = 4; ctx.stroke();
          });
        });

        const now = performance.now();
        missFlashRef.current = missFlashRef.current.filter((m) => now - m.t < 500);
        missFlashRef.current.forEach((m) => {
          const alpha = 1 - (now - m.t) / 500;
          ctx.beginPath(); ctx.arc(m.x, m.y, 16, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(224,87,74,${alpha})`; ctx.lineWidth = 4; ctx.stroke();
        });
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [imagesLoaded, found, config.hotspots]);

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  useEffect(() => {
    if (config.timer_mode !== "countdown" || !config.time_limit || finished) return;
    if (elapsed >= config.time_limit) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (finished) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = W / rect.width, scaleY = H / rect.height;
    const px = (e.clientX - rect.left) * scaleX, py = (e.clientY - rect.top) * scaleY;

    let side: "left" | "right" | null = null;
    let lx = 0, ly = 0;
    if (px >= LEFT_X && px <= LEFT_X + BOX_W && py >= BOX_Y && py <= BOX_Y + BOX_H) {
      side = "left"; lx = (px - LEFT_X) / BOX_W; ly = (py - BOX_Y) / BOX_H;
    } else if (px >= RIGHT_X && px <= RIGHT_X + BOX_W && py >= BOX_Y && py <= BOX_Y + BOX_H) {
      side = "right"; lx = (px - RIGHT_X) / BOX_W; ly = (py - BOX_Y) / BOX_H;
    }
    if (!side) return;

    const hitIdx = config.hotspots.findIndex((h, i) => !found.has(i) && Math.hypot(h.x - lx, h.y - ly) < h.r * 1.3);
    if (hitIdx >= 0) {
      const next = new Set(found); next.add(hitIdx); setFound(next);
      setStatus(lt("found_more", locale, { n: config.hotspots.length - next.size }));
      if (next.size === config.hotspots.length) setTimeout(finish, 600);
    } else {
      missFlashRef.current.push({ x: px, y: py, t: performance.now() });
      setMisses((m) => m + 1);
      setStatus(lt("try_again", locale));
    }
  }

  const timerLabel = config.timer_mode === "countdown" ? t("time_left", locale) : t("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🏆</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {lt("found_done", locale, { a: found.size, b: config.hotspots.length, s: timerValue.toFixed(1) })}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3">
        <span>{lt("found_progress", locale, { a: found.size, b: config.hotspots.length })}</span>
        <span>⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>
      {!imagesLoaded && <div className="text-center py-10 text-muted-foreground">{lt("loading_images", locale)}</div>}
      <canvas
        ref={canvasRef} width={W} height={H} onClick={handleClick}
        className={`w-full h-auto rounded-2xl shadow-lg ring-1 ring-black/5 cursor-pointer bg-sky-50 dark:bg-sky-950/20 ${imagesLoaded ? "block" : "hidden"}`}
      />
      <div className="mt-3 text-center text-lg font-medium px-4 py-3 rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
        {status}
      </div>
    </div>
  );
}
