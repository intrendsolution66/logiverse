// frontend/src/games/MazeGame.tsx
//
// 迷宫 — authored content, not procedural generation. bg_image_url is the
// artwork the student sees; mask_image_url is a course-designer-painted PNG
// where non-transparent pixels mark the walkable path. Collision is real
// pixel sampling from the mask via canvas getImageData.
//
// The path the student has WALKED is now marked as a visible trail (small
// dots left behind as the ball moves) — separate from the designer's mask
// (which marks what's walkable), this trail marks what's ALREADY BEEN
// walked, so a student can see their own progress and backtrack visually.
// Two trail controls: clear the whole trail, or switch to an eraser tool
// and drag over just the part they want gone — same "tool switches what
// dragging does" pattern the maze DESIGNER already uses for paint/erase,
// just applied to the student's own trail instead of the mask.

import { useState, useEffect, useRef, useCallback } from "react";
import { GAME_CANVAS_W, GAME_CANVAS_H } from "@/lib/gameCanvas";

export interface MazeConfig {
  bg_image_url: string;
  mask_image_url: string;
  start_x: number; start_y: number; // normalized 0..1
  end_x: number; end_y: number;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
}
export interface MazeResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

const W = GAME_CANVAS_W, H = GAME_CANVAS_H;
const PLAYER_R = 16;
const END_R = 24;
const TRAIL_R = 6;
const ERASE_R = 26;

export default function MazeGame({ config, onComplete }: {
  config: MazeConfig; onComplete: (r: MazeResult) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null); // offscreen, for pixel sampling
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const maskImgRef = useRef<HTMLImageElement | null>(null);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [playerPos, setPlayerPos] = useState({ x: 0, y: 0 });
  const [trail, setTrail] = useState<{ x: number; y: number }[]>([]);
  const [tool, setTool] = useState<"move" | "erase">("move");
  const [dragging, setDragging] = useState(false);
  const [bumps, setBumps] = useState(0); // tried to move off-path
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const [status, setStatus] = useState("拖着小球，沿着走得通的路走到终点吧！");

  const startRef = useRef(Date.now());
  const startPx = { x: config.start_x * W, y: config.start_y * H };
  const endPx = { x: config.end_x * W, y: config.end_y * H };

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

    setPlayerPos(startPx);
    setTrail([startPx]);
    startRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.bg_image_url, config.mask_image_url]);

  const isWalkable = useCallback((x: number, y: number) => {
    const mc = maskCanvasRef.current;
    if (!mc || x < 0 || y < 0 || x >= W || y >= H) return false;
    const ctx = mc.getContext("2d")!;
    const alpha = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3];
    return alpha > 40;
  }, []);

  const finish = useCallback((completed: boolean) => {
    setFinished(true);
    onComplete({
      score: completed ? 1 : 0, max_score: 1,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes: bumps, completed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bumps]);

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

        // walked trail — small translucent dots, drawn UNDER the player/end markers
        ctx.fillStyle = "rgba(255,122,89,0.45)";
        trail.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, TRAIL_R, 0, Math.PI * 2); ctx.fill(); });

        ctx.beginPath(); ctx.arc(endPx.x, endPx.y, END_R, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(46,158,91,0.85)"; ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
        ctx.font = "26px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#fff";
        ctx.fillText("🏁", endPx.x, endPx.y + 9);

        ctx.beginPath(); ctx.arc(playerPos.x, playerPos.y, PLAYER_R, 0, Math.PI * 2);
        ctx.fillStyle = "#ff7a59"; ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [imagesLoaded, playerPos, trail, endPx.x, endPx.y]);

  function toCanvasXY(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = W / rect.width, scaleY = H / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (finished) return;
    const { x, y } = toCanvasXY(e);
    if (tool === "erase") { setDragging(true); eraseTrailNear(x, y); return; }
    if (Math.hypot(x - playerPos.x, y - playerPos.y) < PLAYER_R * 2) setDragging(true);
  }

  function eraseTrailNear(x: number, y: number) {
    setTrail((t) => t.filter((p) => Math.hypot(p.x - x, p.y - y) > ERASE_R));
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragging || finished) return;
    const { x, y } = toCanvasXY(e);
    if (tool === "erase") { eraseTrailNear(x, y); return; }
    if (isWalkable(x, y)) {
      setPlayerPos({ x, y });
      setTrail((t) => [...t, { x, y }]);
      setStatus("继续沿着路走～");
      if (Math.hypot(x - endPx.x, y - endPx.y) < END_R) {
        setDragging(false);
        setStatus("🎉 到达终点！");
        setTimeout(() => finish(true), 400);
      }
    } else {
      setBumps((b) => b + 1);
      setStatus("这里走不通哦，往回一点试试～");
    }
  }

  function handlePointerUp() { setDragging(false); }
  function clearTrail() { setTrail([playerPos]); }

  const timerLabel = config.timer_mode === "countdown" ? "剩余" : "用时";
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🏁</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {status.includes("到达") ? `走到终点了！用时 ${timerValue.toFixed(1)} 秒` : "时间到"}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto w-full">
      <div className="flex justify-between items-center text-base font-medium text-muted-foreground mb-3 flex-wrap gap-2">
        <span>🧭 走迷宫</span>
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
