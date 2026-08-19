// frontend/src/games/DragDropGame.tsx
//
// 统一拖拽游戏引擎——阶段1，只实现了 position_target 这一种玩法（把
// StickerGame.tsx 重新设计成更通用的版本，本质逻辑完全一样：摆的位置
// 就是答案，client端直接判定，休闲游戏级别的安全模型，不是隐藏答案
// server端核对那一套）。以后 sequence/sort_bins/fill_blank_tiles 三种
// 玩法会陆续加进来，靠 config.mode 分发，不是四个组件各写各的——拖拽
// 底层机制（pointer事件手动实现，不用原生HTML5 drag，触屏不可靠这个
// 坑StickerGame.tsx已经踩过了）在这几种mode之间是共用的。
//
// 跟 StickerGame.tsx 唯一的实质差别：这里用 objects[].label 字段(选填)
// 支持"目标区域显示一个文字标签而不是纯虚线框"，给position_target这个
// mode一点通用性上的提升——不是每次都非要"贴纸长什么样、目标框就长
// 什么样"，也可以是"这里应该放一个X"这种更抽象的提示。

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { STICKER_CANVAS_SIZE } from "@/lib/gameCanvas";
import { type Locale, type Dict, t } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  dragdrop_title: { zh: "🧩 拖拽游戏　{a}/{b}", en: "🧩 Drag & Drop　{a}/{b}", ms: "🧩 Seret & Lepas　{a}/{b}" },
  tray_empty:     { zh: "都拖完啦～", en: "All items placed!", ms: "Semua item telah diletakkan!" },
  drag_hint:      { zh: "把下面的物件拖到画面里对应的位置～", en: "Drag the items below to their matching spots", ms: "Seret item di bawah ke tempat yang sepadan" },
  all_placed:     { zh: "全部放对了！用时 {s} 秒", en: "All placed correctly! Time: {s}s", ms: "Semua diletakkan dengan betul! Masa: {s}s" },
  time_up_placed: { zh: "时间到，放对了 {a} / {b} 个", en: "Time's up — placed {a} / {b}", ms: "Masa tamat — {a} / {b} diletakkan" },
  total_mistakes: { zh: "共错了 {n} 次", en: "{n} mistakes total", ms: "Jumlah {n} kesilapan" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

export interface DragDropObject {
  image_url: string; x: number; y: number; w: number; h: number; rotation: number;
  type?: string; flip_x?: boolean; flip_y?: boolean; label?: string;
}
export interface DragDropConfig {
  mode: "position_target" | "sequence" | "sort_bins" | "fill_blank_tiles";
  bg_image_url?: string;
  objects?: DragDropObject[];
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string; ms?: string };
}
export interface DragDropResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

function shuffleIndices(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function withinTolerance(dropX: number, dropY: number, target: DragDropObject): boolean {
  const tolX = target.w * 0.5, tolY = target.h * 0.5;
  return Math.abs(dropX - target.x) < tolX && Math.abs(dropY - target.y) < tolY;
}

export default function DragDropGame({ config, onComplete, locale = "zh" }: {
  config: DragDropConfig; onComplete: (r: DragDropResult) => void; locale?: Locale;
}) {
  if (config.mode !== "position_target") {
    // 阶段1只做了这一种——其他mode先给个清楚的占位提示，不是静默失败
    // 白屏，方便以后接新mode时一眼看出还没接。
    return (
      <div className="max-w-md mx-auto text-center py-12 text-sm text-muted-foreground">
        🚧 "{config.mode}" 这个玩法还在开发中，敬请期待
      </div>
    );
  }
  return <PositionTargetMode config={config} onComplete={onComplete} locale={locale} />;
}

// ── position_target 玩法 ─────────────────────────────────────────────────────
// 逻辑跟 StickerGame.tsx 完全一致(照抄过来的)，唯一新增的是目标框可以
// 显示 label 文字(选填)，不局限于"纯虚线框"这一种视觉呈现。
function PositionTargetMode({ config, onComplete, locale }: {
  config: DragDropConfig; onComplete: (r: DragDropResult) => void; locale: Locale;
}) {
  const objects = config.objects ?? [];
  const [trayOrder] = useState(() => shuffleIndices(objects.length));
  const [placed, setPlaced] = useState<Set<number>>(new Set());
  const [mistakes, setMistakes] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());

  const stageRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ index: number; clientX: number; clientY: number } | null>(null);
  const [wrongFlashIndex, setWrongFlashIndex] = useState<number | null>(null);
  const lockRef = useRef(false);

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  const finish = useCallback((completed: boolean) => {
    setFinished(true);
    onComplete({
      score: placed.size, max_score: objects.length,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes, completed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, mistakes, objects.length]);

  useEffect(() => {
    if (!finished && objects.length > 0 && placed.size === objects.length) {
      setTimeout(() => finish(true), 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed.size]);

  useEffect(() => {
    if (config.timer_mode !== "countdown" || !config.time_limit || finished) return;
    if (elapsed >= config.time_limit) finish(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  const trayIndices = useMemo(() => trayOrder.filter((i) => !placed.has(i)), [trayOrder, placed]);

  function handleTrayPointerDown(index: number, e: React.PointerEvent) {
    if (finished || lockRef.current) return;
    e.preventDefault();
    setDragging({ index, clientX: e.clientX, clientY: e.clientY });
  }

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: PointerEvent) {
      setDragging((d) => (d ? { ...d, clientX: e.clientX, clientY: e.clientY } : d));
    }
    function onUp(e: PointerEvent) {
      const stage = stageRef.current;
      if (stage && dragging) {
        const rect = stage.getBoundingClientRect();
        const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
        if (inside) {
          const scaleX = STICKER_CANVAS_SIZE / rect.width, scaleY = STICKER_CANVAS_SIZE / rect.height;
          const dropX = (e.clientX - rect.left) * scaleX, dropY = (e.clientY - rect.top) * scaleY;
          const target = objects[dragging.index];
          if (target && withinTolerance(dropX, dropY, target)) {
            setPlaced((p) => new Set(p).add(dragging.index));
          } else {
            lockRef.current = true;
            setMistakes((m) => m + 1);
            setWrongFlashIndex(dragging.index);
            setTimeout(() => { setWrongFlashIndex(null); lockRef.current = false; }, 500);
          }
        }
      }
      setDragging(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const timerLabel = config.timer_mode === "countdown" ? t("time_left", locale) : t("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const draggingObject = dragging ? objects[dragging.index] : null;

  return (
    <div className="max-w-4xl mx-auto w-full select-none">
      <div className="flex justify-between items-center text-base font-medium text-muted-foreground mb-3 flex-wrap gap-2">
        <span>{lt("dragdrop_title", locale, { a: placed.size, b: objects.length })}</span>
        <span>⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>
      {(config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en) && (
        <p className="text-center text-lg font-semibold text-foreground mb-3">{config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en}</p>
      )}

      <div
        ref={stageRef}
        className="relative w-full rounded-2xl shadow-lg ring-1 ring-black/5 overflow-hidden bg-card"
        style={{
          aspectRatio: "1 / 1",
          backgroundImage: config.bg_image_url ? `url(${config.bg_image_url})` : undefined,
          backgroundSize: "100% 100%", backgroundPosition: "center", backgroundColor: config.bg_image_url ? undefined : "#f8fafc",
        }}
      >
        {objects.map((o, i) => (
          <div
            key={i}
            className={`absolute border-2 border-dashed rounded-lg pointer-events-none transition-colors flex items-center justify-center text-xs font-medium ${
              placed.has(i) ? "border-transparent" : wrongFlashIndex === i ? "border-red-400 text-red-500" : "border-white/70 text-white/70"
            }`}
            style={{
              left: `${(o.x / STICKER_CANVAS_SIZE) * 100}%`, top: `${(o.y / STICKER_CANVAS_SIZE) * 100}%`,
              width: `${(o.w / STICKER_CANVAS_SIZE) * 100}%`, height: `${(o.h / STICKER_CANVAS_SIZE) * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            {!placed.has(i) && o.label && <span>{o.label}</span>}
          </div>
        ))}

        {objects.map((o, i) => placed.has(i) && (
          <img
            key={i} src={o.image_url} alt=""
            className="absolute pointer-events-none"
            style={{
              left: `${(o.x / STICKER_CANVAS_SIZE) * 100}%`, top: `${(o.y / STICKER_CANVAS_SIZE) * 100}%`,
              width: `${(o.w / STICKER_CANVAS_SIZE) * 100}%`, height: `${(o.h / STICKER_CANVAS_SIZE) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${o.rotation ?? 0}deg) scale(${o.flip_x ? -1 : 1}, ${o.flip_y ? -1 : 1})`,
            }}
          />
        ))}

        {finished && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[1px]">
            <div className="bg-white rounded-2xl shadow-xl px-8 py-6 text-center max-w-xs mx-4">
              <div className="text-5xl">🧩</div>
              <div className="text-lg font-semibold mt-2 text-foreground">
                {placed.size === objects.length ? lt("all_placed", locale, { s: timerValue.toFixed(1) }) : lt("time_up_placed", locale, { a: placed.size, b: objects.length })}
              </div>
              <div className="text-sm text-muted-foreground mt-1">{lt("total_mistakes", locale, { n: mistakes })}</div>
            </div>
          </div>
        )}
      </div>

      {!finished && (
      <div className="mt-3 flex flex-wrap gap-3 justify-center rounded-2xl bg-muted/40 border border-border p-3 min-h-[88px]">
        {trayIndices.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 self-center">{lt("tray_empty", locale)}</p>
        ) : (
          trayIndices.map((i) => {
            const o = objects[i];
            const isBeingDragged = dragging?.index === i;
            return (
              <button
                key={i} type="button"
                onPointerDown={(e) => handleTrayPointerDown(i, e)}
                className={`w-16 h-16 rounded-xl bg-white border-2 flex items-center justify-center p-1 cursor-grab active:cursor-grabbing touch-none transition-opacity ${
                  isBeingDragged ? "opacity-0" : wrongFlashIndex === i ? "border-red-400" : "border-border"
                }`}
                style={{ touchAction: "none" }}
              >
                <img src={o.image_url} alt="" className="max-w-full max-h-full object-contain pointer-events-none" />
              </button>
            );
          })
        )}
      </div>
      )}

      {!finished && <p className="text-center text-xs text-muted-foreground mt-2">{lt("drag_hint", locale)}</p>}

      {dragging && draggingObject && (
        <img
          src={draggingObject.image_url} alt=""
          className="fixed pointer-events-none z-50 drop-shadow-lg"
          style={{
            left: dragging.clientX, top: dragging.clientY,
            width: 72, height: 72, objectFit: "contain",
            transform: `translate(-50%, -50%) rotate(${draggingObject.rotation ?? 0}deg) scale(${draggingObject.flip_x ? -1 : 1}, ${draggingObject.flip_y ? -1 : 1})`,
          }}
        />
      )}
    </div>
  );
}
