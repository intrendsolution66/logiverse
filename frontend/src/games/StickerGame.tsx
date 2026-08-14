// frontend/src/games/StickerGame.tsx
//
// 贴纸游戏 — authored content: 设计师在 SceneEditor 里把每个贴纸摆在
// "正确的位置"，那个位置就是答案。运行时把这些贴纸打乱塞进旁边的
// "贴纸盘"，学生要一个个拖回它原本摆放的位置。
//
// 判定走客户端直接比较（正确位置直接发给前端），不是隐藏答案server端
// 核对那一套——这是"休闲游戏"级别的安全模型，跟连线配对、迷宫、数字
// 迷宫是同一个取舍：贴纸游戏本来就是靠"看着背景图猜"，不是防作弊的
// 考题，没有必要为了藏几个坐标数字，另外做一套隐藏答案的后端接口。
//
// 拖拽用 pointer 事件手动做（不是 HTML5 native drag-and-drop），原因
// 跟 MazeGame 一样——原生 drag events 在触屏上一直不可靠，pointer 事件
// 这一套鼠标/触屏/触控笔都走同一份逻辑，不用分别处理。拖的时候画一个
// "跟着手指走"的浮层贴纸(ghost)，跟贴纸盘/画布本身的坐标系统脱钩，才
// 能自由地从贴纸盘拖进画布——如果贴纸元素本身被限制在贴纸盘的容器里，
// 拖出这个容器时坐标会算不对。
//
// i18n: zh/en/ms 已支持(界面文字) — 见 frontend/src/lib/gameLocale.ts。
// question_i18n 是designer自己填的authored题目文字——现在CourseDesignerPage.tsx
// 已经支持三语言输入了(zh/en/ms)，运行时读取顺序是"当前locale优先，没填
// 再退回zh，还没填再退回en"。

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { STICKER_CANVAS_SIZE } from "@/lib/gameCanvas";
import { type Locale, type Dict, t } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  sticker_title:  { zh: "🏷️ 贴纸游戏　{a}/{b}", en: "🏷️ Sticker Game　{a}/{b}", ms: "🏷️ Permainan Pelekat　{a}/{b}" },
  tray_empty:     { zh: "贴纸盘空了，都贴出去了～", en: "Tray's empty — all stickers placed!", ms: "Dulang kosong — semua pelekat sudah diletakkan!" },
  drag_hint:      { zh: "把下面的贴纸拖到画面里虚线框标出来的位置～", en: "Drag the stickers below to the dashed outlines on the picture", ms: "Seret pelekat di bawah ke garis putus-putus pada gambar" },
  all_placed:     { zh: "全部贴对了！用时 {s} 秒", en: "All placed correctly! Time: {s}s", ms: "Semua diletakkan dengan betul! Masa: {s}s" },
  time_up_placed: { zh: "时间到，贴对了 {a} / {b} 个", en: "Time's up — placed {a} / {b}", ms: "Masa tamat — {a} / {b} diletakkan" },
  total_mistakes: { zh: "共错了 {n} 次", en: "{n} mistakes total", ms: "Jumlah {n} kesilapan" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

export interface StickerObject {
  image_url: string; x: number; y: number; w: number; h: number; rotation: number;
  type?: string; flip_x?: boolean; flip_y?: boolean;
}
export interface StickerGameConfig {
  bg_image_url: string;
  objects: StickerObject[];
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string; ms?: string };
}
export interface StickerGameResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

// 打乱一次就固定住，不要每次渲染都重新洗牌——用 index 当身份标记（同一
// 张图可能出现好几次，不能靠图片网址本身分辨是哪一个）
function shuffleIndices(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 掉进目标位置附近多大范围算"对"——按物件自己的宽高取一个比例，物件
// 越大容错范围也跟着放大，比固定死一个像素数字更合理（贴纸大小可能
// 差很多）。
function withinTolerance(dropX: number, dropY: number, target: StickerObject): boolean {
  const tolX = target.w * 0.5, tolY = target.h * 0.5;
  return Math.abs(dropX - target.x) < tolX && Math.abs(dropY - target.y) < tolY;
}

export default function StickerGame({ config, onComplete, locale = "zh" }: {
  config: StickerGameConfig; onComplete: (r: StickerGameResult) => void; locale?: Locale;
}) {
  const objects = config.objects ?? [];
  const [trayOrder] = useState(() => shuffleIndices(objects.length));
  const [placed, setPlaced] = useState<Set<number>>(new Set()); // 已经放对位置的 index
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
  const draggingSticker = dragging ? objects[dragging.index] : null;

  return (
    <div className="max-w-4xl mx-auto w-full select-none">
      <div className="flex justify-between items-center text-base font-medium text-muted-foreground mb-3 flex-wrap gap-2">
        <span>{lt("sticker_title", locale, { a: placed.size, b: objects.length })}</span>
        <span>⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>
      {(config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en) && (
        <p className="text-center text-lg font-semibold text-foreground mb-3">{config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en}</p>
      )}

      <div
        ref={stageRef}
        className="relative w-full rounded-2xl shadow-lg ring-1 ring-black/5 overflow-hidden bg-card"
        style={{
          aspectRatio: "1 / 1", // 固定1:1正方形，不强行拉宽拉高撑满整个画布；下面objects的百分比定位是按容器自身宽高分别计算的，跟容器是不是正方形无关，不用同步改坐标逻辑
          backgroundImage: `url(${config.bg_image_url})`, backgroundSize: "100% 100%", backgroundPosition: "center", // 背景图是编辑器那边已经按正方形裁剪居中烘焙好的，这里直接铺满即可，不再用CSS二次裁剪（否则会跟贴纸坐标错位）
        }}
      >
        {/* 目标位置的淡淡虚线框——给小朋友一点提示，不是完全靠瞎猜，位置感不强的年龄段（4-12岁）这个提示很有必要 */}
        {objects.map((o, i) => (
          <div
            key={i}
            className={`absolute border-2 border-dashed rounded-lg pointer-events-none transition-colors ${
              placed.has(i) ? "border-transparent" : wrongFlashIndex === i ? "border-red-400" : "border-white/70"
            }`}
            style={{
              left: `${(o.x / STICKER_CANVAS_SIZE) * 100}%`, top: `${(o.y / STICKER_CANVAS_SIZE) * 100}%`,
              width: `${(o.w / STICKER_CANVAS_SIZE) * 100}%`, height: `${(o.h / STICKER_CANVAS_SIZE) * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
          />
        ))}

        {/* 已经贴对的贴纸——固定显示在正确位置上 */}
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

        {/* 完成摘要——盖在已经贴满贴纸的图片上，学生能看到自己完成的作品，不是直接跳走。重玩/退出用页面顶部本来就有的固定按钮，这里不重复放 */}
        {finished && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[1px]">
            <div className="bg-white rounded-2xl shadow-xl px-8 py-6 text-center max-w-xs mx-4">
              <div className="text-5xl">🏷️</div>
              <div className="text-lg font-semibold mt-2 text-foreground">
                {placed.size === objects.length ? lt("all_placed", locale, { s: timerValue.toFixed(1) }) : lt("time_up_placed", locale, { a: placed.size, b: objects.length })}
              </div>
              <div className="text-sm text-muted-foreground mt-1">{lt("total_mistakes", locale, { n: mistakes })}</div>
            </div>
          </div>
        )}
      </div>

      {/* 贴纸盘——完成后不再需要，直接不渲染，画面更干净 */}
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

      {/* 拖动中的浮层贴纸——跟着手指/鼠标走，脱离贴纸盘和画布各自的坐标系统 */}
      {dragging && draggingSticker && (
        <img
          src={draggingSticker.image_url} alt=""
          className="fixed pointer-events-none z-50 drop-shadow-lg"
          style={{
            left: dragging.clientX, top: dragging.clientY,
            width: 72, height: 72, objectFit: "contain",
            transform: `translate(-50%, -50%) rotate(${draggingSticker.rotation ?? 0}deg) scale(${draggingSticker.flip_x ? -1 : 1}, ${draggingSticker.flip_y ? -1 : 1})`,
          }}
        />
      )}
    </div>
  );
}
