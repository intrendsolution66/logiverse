// frontend/src/games/ColoringGame.tsx
//
// 填色游戏 — authored content: outline artwork + a hidden region mask
// (each region painted with its own marker_color) + per-region color
// rules. Same pixel-sampling click-detection technique MazeGame already
// uses for its walkable mask (getImageData off an offscreen canvas) —
// here extended from a single boolean mask to a MULTI-color one: a
// click's pixel color on the mask tells you WHICH region got clicked
// (compare against each region's marker_color), not just walkable/not.
//
// target_color for 'specific'-rule regions never reaches this component
// until after submitting — eduApi.checkColoring does the comparison
// server-side, same "hidden until checked" principle as sudoku/line_match.
// The requirement TYPE (free vs specific) is visible from the start —
// the point of this task is precise execution, not guessing a hidden
// rule — just not the target color itself.
//
// i18n: zh/en/ms 已支持(界面文字) — 见 frontend/src/lib/gameLocale.ts。
// question_i18n 和每个区块的 label 都是designer自己填的authored文字，
// 这次没扩展它们加ms。

import { useState, useRef, useEffect, useCallback } from "react";
import { eduApi } from "@/api";
import { Button } from "@/components/ui/button";
import { type Locale, type Dict, t } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  filled_progress: { zh: "🎨 已填 {a} / {b}", en: "🎨 Filled {a} / {b}", ms: "🎨 Diisi {a} / {b}" },
  checking:        { zh: "检查中...", en: "Checking...", ms: "Menyemak..." },
  submit:          { zh: "✅ 提交", en: "✅ Submit", ms: "✅ Hantar" },
  correct_regions: { zh: "答对 {a} / {b} 个区块", en: "{a} / {b} regions correct", ms: "{a} / {b} kawasan betul" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

interface ColoringRegion { marker_color: string; rule: "specific" | "free"; label?: string }
export interface ColoringConfig {
  bg_image_url: string;
  region_mask_url: string; // hidden from visual display, only pixel-sampled for click detection
  regions: ColoringRegion[]; // target_color stripped out by getLevel — see file header
  palette?: string[];
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string };
}
export interface ColoringResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

const W = 700, H = 500; // fixed canvas size, same convention every other authored-image module uses
const DEFAULT_PALETTE = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#78716c"];

function hexDistance(a: [number, number, number], b: string): number {
  const bi = parseInt(b.slice(1), 16);
  const br = (bi >> 16) & 255, bg = (bi >> 8) & 255, bb = bi & 255;
  return Math.abs(a[0] - br) + Math.abs(a[1] - bg) + Math.abs(a[2] - bb);
}

export default function ColoringGame({ levelId, config, onComplete, locale = "zh" }: {
  levelId: string; config: ColoringConfig; onComplete: (r: ColoringResult) => void; locale?: Locale;
}) {
  const regions = config.regions ?? [];
  const palette = config.palette?.length ? config.palette : DEFAULT_PALETTE;

  const canvasRef = useRef<HTMLCanvasElement>(null); // visible: outline + student's fills painted on top
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null); // offscreen: for pixel sampling only, never shown
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [selectedColor, setSelectedColor] = useState(palette[0]);
  const [fills, setFills] = useState<Record<string, string>>({}); // marker_color -> chosen color
  const [results, setResults] = useState<Record<string, boolean> | null>(null);
  const [checking, setChecking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  useEffect(() => {
    let loaded = 0;
    const onLoad = () => { loaded++; if (loaded === 2) setImagesLoaded(true); };

    const bg = new Image(); bg.crossOrigin = "anonymous"; bg.onload = onLoad; bg.src = config.bg_image_url;
    bgImgRef.current = bg;

    const mask = new Image(); mask.crossOrigin = "anonymous";
    mask.onload = () => {
      const off = document.createElement("canvas");
      off.width = W; off.height = H;
      off.getContext("2d")!.drawImage(mask, 0, 0, W, H);
      maskCanvasRef.current = off;
      onLoad();
    };
    mask.src = config.region_mask_url;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.bg_image_url, config.region_mask_url]);

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !bgImgRef.current) return;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bgImgRef.current, 0, 0, W, H);
    // 把已经填色的区块，用半透明色叠在底图上——不遮住原本的线稿轮廓，
    // 学生还是看得出这是在「涂」而不是整块换成实心色块。
    const mc = maskCanvasRef.current;
    if (mc) {
      const mctx = mc.getContext("2d")!;
      const maskData = mctx.getImageData(0, 0, W, H);
      const paintData = ctx.getImageData(0, 0, W, H);
      for (const region of regions) {
        const fillColor = fills[region.marker_color];
        if (!fillColor) continue;
        const fi = parseInt(fillColor.slice(1), 16);
        const fr = (fi >> 16) & 255, fg = (fi >> 8) & 255, fb = fi & 255;
        for (let i = 0; i < maskData.data.length; i += 4) {
          const mr = maskData.data[i], mg = maskData.data[i + 1], mb = maskData.data[i + 2], ma = maskData.data[i + 3];
          if (ma < 40) continue;
          if (hexDistance([mr, mg, mb], region.marker_color) < 30) {
            paintData.data[i] = Math.round(paintData.data[i] * 0.35 + fr * 0.65);
            paintData.data[i + 1] = Math.round(paintData.data[i + 1] * 0.35 + fg * 0.65);
            paintData.data[i + 2] = Math.round(paintData.data[i + 2] * 0.35 + fb * 0.65);
          }
        }
      }
      ctx.putImageData(paintData, 0, 0);
    }
  }, [fills, regions]);

  useEffect(() => { if (imagesLoaded) redraw(); }, [imagesLoaded, redraw]);

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (finished) return;
    const mc = maskCanvasRef.current;
    const canvas = canvasRef.current;
    if (!mc || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = Math.floor((e.clientX - rect.left) * (W / rect.width));
    const py = Math.floor((e.clientY - rect.top) * (H / rect.height));
    const pixel = mc.getContext("2d")!.getImageData(px, py, 1, 1).data;
    if (pixel[3] < 40) return; // transparent — clicked outside any region

    const clicked = regions.find((r) => hexDistance([pixel[0], pixel[1], pixel[2]], r.marker_color) < 30);
    if (!clicked) return;
    setFills((prev) => ({ ...prev, [clicked.marker_color]: selectedColor }));
  }

  async function handleSubmit() {
    if (checking) return;
    setChecking(true);
    try {
      const r = await eduApi.checkColoring(levelId, fills);
      const resultMap: Record<string, boolean> = {};
      r.results.forEach((x) => { resultMap[x.marker_color] = x.correct; });
      setResults(resultMap);
      setFinished(true);
      const correctCount = r.results.filter((x) => x.correct).length;
      onComplete({
        score: correctCount, max_score: r.totalRegions,
        time_spent_seconds: (Date.now() - startRef.current) / 1000,
        mistakes: r.totalRegions - correctCount, completed: r.allCorrect,
      });
    } finally {
      setChecking(false);
    }
  }

  const filledCount = Object.keys(fills).length;

  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3">
        <span>{lt("filled_progress", locale, { a: filledCount, b: regions.length })}</span>
        <span>⏱️ {t("time_used", locale)} {elapsed.toFixed(1)}s</span>
      </div>
      {(config.question_i18n?.zh || config.question_i18n?.en) && (
        <p className="text-center text-lg font-semibold text-foreground mb-3">{config.question_i18n?.zh || config.question_i18n?.en}</p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2 mb-3 p-2 bg-muted/40 rounded-xl">
        {palette.map((color) => (
          <button
            key={color} type="button" onClick={() => setSelectedColor(color)}
            className={`w-11 h-11 rounded-full border-2 transition-transform ${selectedColor === color ? "border-foreground scale-110" : "border-border"}`}
            style={{ backgroundColor: color }}
            aria-label={color}
          />
        ))}
      </div>

      <div className="relative bg-white rounded-2xl shadow-lg ring-1 ring-black/5 overflow-hidden" style={{ aspectRatio: `${W} / ${H}` }}>
        <canvas ref={canvasRef} width={W} height={H} onClick={handleCanvasClick} className="w-full h-auto cursor-pointer" />
      </div>

      {finished && results && (
        <div className="flex flex-wrap gap-2 mt-3 justify-center">
          {regions.map((r) => (
            <span key={r.marker_color} className={`text-xs px-2 py-1 rounded-full ${results[r.marker_color] ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"}`}>
              {r.label ?? r.marker_color} {results[r.marker_color] ? "✓" : "✗"}
            </span>
          ))}
        </div>
      )}

      {!finished ? (
        <div className="flex justify-center mt-4">
          <Button onClick={handleSubmit} disabled={checking || filledCount === 0} className="text-lg font-semibold px-8 py-2.5 rounded-2xl">
            {checking ? lt("checking", locale) : lt("submit", locale)}
          </Button>
        </div>
      ) : (
        <div className={`text-center text-lg font-medium mt-4 px-4 py-3 rounded-xl ${
          results && Object.values(results).every((v) => v) ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
          : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
        }`}>
          {results ? lt("correct_regions", locale, { a: Object.values(results).filter(Boolean).length, b: regions.length }) : ""}
        </div>
      )}
    </div>
  );
}
