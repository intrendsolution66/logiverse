// frontend/src/games/MazeGame.tsx
//
// 迷宫 — authored content, not procedural generation. bg_image_url is the
// artwork the student sees; mask_image_url is a course-designer-painted PNG
// where non-transparent pixels mark the walkable path. Collision is real
// pixel sampling from the mask via canvas getImageData.
//
// 支持多组"起点→终点"配对——同时有好几个球，每个球各自要从自己的起点
// 走到自己配对的终点，全部到齐才算过关。旧数据（只有单一 start_x/y、
// end_x/y，没有 pairs）会自动被当成"只有1对"处理，玩法完全不受影响。
// 拖动的时候，靠近哪个球（且那个球还没到终点）就拖动哪个，一次只能拖
// 一个，不需要真的同时多指操作。
//
// The path each ball has WALKED is marked as a visible trail (small dots
// left behind as it moves) — separate from the designer's mask (which
// marks what's walkable), trails mark what's ALREADY BEEN walked so a
// student can see their own progress and backtrack visually. Two trail
// controls: clear all trails, or switch to an eraser tool and drag over
// just the part they want gone.

import { useState, useEffect, useRef, useCallback } from "react";
import { GAME_CANVAS_W, GAME_CANVAS_H } from "@/lib/gameCanvas";

export interface MazePoint { x: number; y: number }
export interface MazePair { start: MazePoint; end: MazePoint }

export interface MazeConfig {
  bg_image_url: string;
  mask_image_url: string;
  start_x: number; start_y: number; // 旧栏位——normalized 0..1，pairs为空时当成唯一一对
  end_x: number; end_y: number;
  // 多组起点/终点配对——同时有好几个球。为空/未设时，退回用上面四个旧
  // 栏位当成只有一对（向后兼容旧的单球迷宫）。
  pairs?: MazePair[];
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string };
}
export interface MazeResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

const W = GAME_CANVAS_W, H = GAME_CANVAS_H;
const PLAYER_R = 16;
const END_R = 24;
const TRAIL_R = 6;
const ERASE_R = 26;
const GRAB_R = PLAYER_R * 2;
// 球数量多的时候用不同颜色区分是哪个球对哪个终点，第1对固定用原本的
// 橙色/绿色配色（视觉上跟旧的单球迷宫保持一致），第2对开始才用新颜色。
const BALL_COLORS = ["#ff7a59", "#5b8def", "#a855f7", "#f59e0b", "#14b8a6", "#ec4899", "#84cc16", "#06b6d4"];
const END_COLORS = ["#2e9e5b", "#3b6fd8", "#8b3fd8", "#c2760a", "#0e8f7a", "#c22a70", "#5a8a10", "#0891a8"];

interface Ball {
  id: number;
  start: MazePoint; end: MazePoint; // 像素坐标（已经乘过 W/H）
  pos: { x: number; y: number };
  trail: { x: number; y: number }[];
  done: boolean;
}

function normalizePairs(config: MazeConfig): MazePair[] {
  if (config.pairs && config.pairs.length > 0) return config.pairs;
  return [{ start: { x: config.start_x, y: config.start_y }, end: { x: config.end_x, y: config.end_y } }];
}

export default function MazeGame({ config, onComplete }: {
  config: MazeConfig; onComplete: (r: MazeResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null); // offscreen, for pixel sampling
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const maskImgRef = useRef<HTMLImageElement | null>(null);
  const [imagesLoaded, setImagesLoaded] = useState(false);

  const pairs = normalizePairs(config);
  const [balls, setBalls] = useState<Ball[]>(() =>
    pairs.map((p, i) => {
      const start = { x: p.start.x * W, y: p.start.y * H };
      const end = { x: p.end.x * W, y: p.end.y * H };
      return { id: i, start, end, pos: start, trail: [start], done: false };
    })
  );
  const [activeBallId, setActiveBallId] = useState<number | null>(null);
  const [tool, setTool] = useState<"move" | "erase">("move");
  const [dragging, setDragging] = useState(false);
  const [bumps, setBumps] = useState(0); // 试图走到不能走的地方，累计所有球的次数
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const [status, setStatus] = useState(
    config.question_i18n?.zh || config.question_i18n?.en ||
    (pairs.length > 1 ? `拖着每个小球，各自走到自己颜色对应的终点吧！（共 ${pairs.length} 个）` : "拖着小球，沿着走得通的路走到终点吧！")
  );

  const startRef = useRef(Date.now());
  const offPathRef = useRef(false); // 上一帧在不在路上，用来判断"刚踩出去"那一瞬间，不是每一帧都算

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
    mask.src = config.mask_image_url;
    maskImgRef.current = mask;

    startRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.bg_image_url, config.mask_image_url]);

  // 判断某个坐标"能不能走"——不是只看那一个精确像素，而是看它周围一小
  // 圈(半径WALK_TOLERANCE)有没有任何一点是可走的。原因：设计师点"设
  // 起点"是手动点的，跟画笔涂的蒙版范围很难保证像素级对齐，起点差个
  // 一两像素很正常；严格拦截之后，起点没精确落在蒙版上的话，球会从
  // 第一步检测就判定"不在路上"，哪个方向都走不出去、完全卡死在起点。
  // 留一点容错半径，不会明显让"能穿墙"（就几像素），但能扛住起点/边缘
  // 的正常误差。
  const WALK_TOLERANCE = 5;
  const isWalkable = useCallback((x: number, y: number) => {
    const mc = maskCanvasRef.current;
    if (!mc) return false;
    const ctx = mc.getContext("2d")!;
    const cx = Math.floor(x), cy = Math.floor(y);
    const left = Math.max(0, cx - WALK_TOLERANCE), top = Math.max(0, cy - WALK_TOLERANCE);
    const right = Math.min(W - 1, cx + WALK_TOLERANCE), bottom = Math.min(H - 1, cy + WALK_TOLERANCE);
    const w = right - left + 1, h = bottom - top + 1;
    if (w <= 0 || h <= 0) return false;
    // 一次性读一块区域的像素、在内存里扫描，而不是对每个采样点分别调用
    // getImageData——canvas 像素读取本身有开销，拖动时一次移动要检查
    // 20个点，分开调用次数会乘起来，合并成一次读取明显快很多。
    const data = ctx.getImageData(left, top, w, h).data;
    for (let i = 3; i < data.length; i += 4) { if (data[i] > 40) return true; }
    return false;
  }, []);

  const finish = useCallback((completed: boolean) => {
    setFinished(true);
    onComplete({
      score: completed ? 1 : balls.filter((b) => b.done).length / balls.length,
      max_score: 1,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes: bumps, completed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bumps, balls]);

  useEffect(() => {
    if (finished || !imagesLoaded) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished, imagesLoaded]);

  useEffect(() => {
    if (config.timer_mode !== "countdown" || !config.time_limit || finished || !imagesLoaded) return;
    if (elapsed >= config.time_limit) finish(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  // render loop
  useEffect(() => {
    if (!imagesLoaded) return;
    let raf: number;
    const draw = () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx && bgImgRef.current) {
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(bgImgRef.current, 0, 0, W, H);

        balls.forEach((b, i) => {
          const ballColor = BALL_COLORS[i % BALL_COLORS.length];
          const endColor = END_COLORS[i % END_COLORS.length];

          // 走过的路——半透明小点，画在球/终点标记底下
          ctx.fillStyle = hexToRgba(ballColor, 0.4);
          b.trail.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, TRAIL_R, 0, Math.PI * 2); ctx.fill(); });

          // 终点标记
          ctx.beginPath(); ctx.arc(b.end.x, b.end.y, END_R, 0, Math.PI * 2);
          ctx.fillStyle = hexToRgba(endColor, 0.9); ctx.fill();
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
          ctx.font = "22px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#fff";
          ctx.fillText(b.done ? "✅" : "🏁", b.end.x, b.end.y + 8);

          // 球本身——已完成的球画淡一点，视觉上区分"还要不要管它"
          ctx.save();
          if (b.done) ctx.globalAlpha = 0.55;
          ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, PLAYER_R, 0, Math.PI * 2);
          ctx.fillStyle = ballColor; ctx.fill();
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
          ctx.restore();
        });
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [imagesLoaded, balls]);

  function hexToRgba(hex: string, alpha: number) {
    const m = hex.replace("#", "");
    const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function toCanvasXY(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = W / rect.width, scaleY = H / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (finished) return;
    const { x, y } = toCanvasXY(e);
    if (tool === "erase") { setDragging(true); eraseTrailNear(x, y); return; }
    // 找离点击位置最近、还没到终点的球，且要在抓取范围内——避免隔着老远
    // 不小心抓到别的球
    let nearest: Ball | null = null, nearestDist = Infinity;
    for (const b of balls) {
      if (b.done) continue;
      const d = Math.hypot(x - b.pos.x, y - b.pos.y);
      if (d < GRAB_R && d < nearestDist) { nearest = b; nearestDist = d; }
    }
    if (nearest) { setActiveBallId(nearest.id); setDragging(true); offPathRef.current = false; }
  }

  function eraseTrailNear(x: number, y: number) {
    setBalls((bs) => bs.map((b) => ({ ...b, trail: b.trail.filter((p) => Math.hypot(p.x - x, p.y - y) > ERASE_R) })));
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragging || finished) return;
    const { x, y } = toCanvasXY(e);
    if (tool === "erase") { eraseTrailNear(x, y); return; }
    if (activeBallId === null) return;

    // 先直接检查指针现在的位置能不能走——能走就直接把球放过去，这是最
    // 常见的情况，效果跟"自由跟手"一样顺滑。只有指针的目标位置本身踩
    // 到障碍物了，才退回去沿"上一个位置→指针位置"这条线一小步步找该
    // 停在哪个点。
    //
    // 之前是不管三七二十一都先做20步插值检查，结果正常慢速拖动的时候
    // 每次 pointermove 之间指针只挪了几像素，20份切下来每一步都不到
    // 1像素、四舍五入后可能一直落在同一个点上，只要起点附近有一点点没
    // 对齐，就会卡在这个死循环里出不去——直到某次指针挪动幅度够大、
    // 某一步刚好跳过了这个死角，才会突然"启动"，明明起点已经踩在容错
    // 范围里了却还是要拖出老远才有反应。改成先看目标点，只有真的要穿
    // 墙才需要insert插值去找边界，从源头上避免了"卡在起点附近挪不动"
    // 这种体验。
    const STEPS = 20;
    setBalls((bs) => {
      const ball = bs.find((b) => b.id === activeBallId);
      if (!ball) return bs;
      const from = ball.pos;
      let landing: { x: number; y: number };
      let hitWall: boolean;

      if (isWalkable(x, y)) {
        landing = { x, y };
        hitWall = false;
      } else {
        landing = from;
        hitWall = true;
        for (let i = 1; i <= STEPS; i++) {
          const t = i / STEPS;
          const px = from.x + (x - from.x) * t;
          const py = from.y + (y - from.y) * t;
          if (isWalkable(px, py)) landing = { x: px, y: py };
          else break;
        }
      }

      if (hitWall && !offPathRef.current) {
        setBumps((n) => n + 1);
        setStatus("撞墙了，沿着路走走看～");
      }
      offPathRef.current = hitWall;

      const next = bs.map((b) => {
        if (b.id !== activeBallId) return b;
        const reachedEnd = Math.hypot(landing.x - b.end.x, landing.y - b.end.y) < END_R;
        return { ...b, pos: landing, trail: [...b.trail, landing], done: reachedEnd || b.done };
      });
      const allDone = next.every((b) => b.done);
      if (allDone) {
        setDragging(false);
        setStatus("🎉 全部到达终点！");
        setTimeout(() => finish(true), 400);
      } else if (!hitWall) {
        const justFinished = next.find((b) => b.id === activeBallId)?.done && !bs.find((b) => b.id === activeBallId)?.done;
        setStatus(justFinished ? "🎉 这个球到了！还有别的球没到～" : "继续沿着路走～");
      }
      return next;
    });
  }

  function handlePointerUp() { setDragging(false); setActiveBallId(null); }
  function clearTrail() { setBalls((bs) => bs.map((b) => ({ ...b, trail: [b.pos] }))); }

  const timerLabel = config.timer_mode === "countdown" ? "剩余" : "用时";
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const doneCount = balls.filter((b) => b.done).length;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🏁</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {doneCount === balls.length ? `全部走到终点了！用时 ${timerValue.toFixed(1)} 秒` : `时间到，完成 ${doneCount} / ${balls.length} 个`}
        </div>
        <div className="text-sm text-muted-foreground mt-1">💥 一共撞墙 {bumps} 次</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto w-full">
      <div className="flex justify-between items-center text-base font-medium text-muted-foreground mb-3 flex-wrap gap-2">
        <span>🧭 走迷宫{balls.length > 1 ? `　${doneCount}/${balls.length}` : ""}</span>
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <button
              type="button" onClick={() => setTool("move")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${tool === "move" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
            >
              🖊️ 走路
            </button>
            <button
              type="button" onClick={() => setTool("erase")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${tool === "erase" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
            >
              🧹 擦掉走过的路
            </button>
            <button type="button" onClick={clearTrail} className="px-2.5 py-1 rounded-md text-xs font-medium border bg-card border-border text-muted-foreground">
              🗑️ 全部清除
            </button>
          </div>
          <span>💥 撞墙 {bumps} 次</span>
          <span>⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
        </div>
      </div>
      {!imagesLoaded && <div className="text-center py-10 text-muted-foreground">加载中...</div>}
      <canvas
        ref={canvasRef} width={W} height={H}
        onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
        style={{ touchAction: "none" }}
        className={`w-full h-auto rounded-2xl shadow-lg ring-1 ring-black/5 bg-muted ${tool === "erase" ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"} ${imagesLoaded ? "block" : "hidden"}`}
      />
      <p className="text-center text-sm font-medium text-muted-foreground mt-2">{status}</p>
    </div>
  );
}
