// frontend/src/games/NumberMazeGame.tsx
//
// 数字迷宫 — 两种完全不同的玩法共用一个文件，靠 config.layout 分流到
// 两个子组件，彼此不共用状态/渲染逻辑（除了都从 SceneEditor/迷宫沿用
// 过来的一些约定）：
//
//   "path"（路径分岔/房间迷宫）—— 跟 MazeGame 同一套拖拽+像素蒙版碰撞
//   引擎（背景图+mask图，蒙版判断能不能走），额外加了"分岔点"：分岔点
//   在没解锁之前，半径范围内直接当成"不可走"处理，球拖到那里会像撞墙
//   一样停住，同时弹出这个分岔点的数字选项给学生选；选对了解锁（这个
//   点从此不再阻挡），选错了算一次失误、可以重选。
//
//   "grid"（方格棋盘/跳格子）—— 跟数独的网格图层同一套渲染方式（画
//   格子线、格子里的数字），玩法是从起点(path[0])开始，点相邻的格子
//   （只能上下左右，不能斜着），点对了（是路径的下一步）就往前走，点
//   错了算一次失误、原地不动，一路走到终点(path末尾)算通关。
//
// 两种玩法都是"休闲游戏"安全等级——正确答案(分岔点的correctIndex、
// 方格棋盘的path)直接跟着config发给前端，client端直接核对，不是隐藏
// 答案server端核对那一套，见 courses_controller.ts 对应 getLevel 分支的
// 注释。
//
// i18n: zh/en/ms 已支持(界面文字) — 见 frontend/src/lib/gameLocale.ts。
// question_i18n 是designer自己填的authored题目文字——现在CourseDesignerPage.tsx
// 已经支持三语言输入了(zh/en/ms)，运行时读取顺序是"当前locale优先，没填
// 再退回zh，还没填再退回en"。

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { GAME_CANVAS_W, GAME_CANVAS_H } from "@/lib/gameCanvas";
import { type Locale, type Dict, t as tt } from "@/lib/gameLocale";

// 两个子组件各自的短语都放这一份本地词典里——文件顶部 import 了
// gameLocale 的翻译函数，为了避免跟这个文件里到处出现的局部变量 t(比如
// setTrail((t) => ...))撞名，这里把导入的翻译函数改叫 tt，本地词典查
// 函数叫 lt，两个都跟"t"这个短名字错开。
const LOCAL: Record<string, Dict> = {
  path_default:    { zh: "拖着小球，走到分岔点要先选对数字才能继续前进～", en: "Drag the ball — pick the right number at each fork to continue", ms: "Seret bola — pilih nombor yang betul di setiap persimpangan untuk teruskan" },
  pick_first:      { zh: "先选对数字才能继续往前走～", en: "Pick the right number first to continue", ms: "Pilih nombor yang betul dahulu untuk teruskan" },
  hit_wall:        { zh: "撞墙了，沿着路走走看～", en: "Bumped a wall — try following the path", ms: "Terlanggar dinding — cuba ikut laluan" },
  arrived:         { zh: "🎉 到终点了！", en: "🎉 Reached the finish!", ms: "🎉 Sampai ke penamat!" },
  keep_going:      { zh: "继续沿着路走～", en: "Keep following the path", ms: "Teruskan ikut laluan" },
  correct_continue:{ zh: "答对了！继续拖着走～", en: "Correct! Keep dragging along", ms: "Betul! Teruskan menyeret" },
  loading:         { zh: "加载中...", en: "Loading...", ms: "Memuatkan..." },
  maze_title:      { zh: "🔀 数字迷宫", en: "🔀 Number Maze", ms: "🔀 Labirin Nombor" },
  bumps_short:     { zh: "💥 {n} 次", en: "💥 {n} times", ms: "💥 {n} kali" },
  pick_prompt:     { zh: "选一个正确的数字才能继续前进", en: "Pick the correct number to continue", ms: "Pilih nombor yang betul untuk teruskan" },
  path_done:       { zh: "到终点了！用时 {s} 秒", en: "Reached the finish! Time: {s}s", ms: "Sampai ke penamat! Masa: {s}s" },
  time_up:         { zh: "时间到", en: "Time's up", ms: "Masa tamat" },
  path_bumps:      { zh: "💥 撞墙/答错 {n} 次", en: "💥 Bumped/wrong {n} times", ms: "💥 Terlanggar/salah {n} kali" },
  grid_progress:   { zh: "🔀 数字迷宫　{a}/{b}", en: "🔀 Number Maze　{a}/{b}", ms: "🔀 Labirin Nombor　{a}/{b}" },
  grid_done:       { zh: "走到终点了！用时 {s} 秒", en: "Reached the finish! Time: {s}s", ms: "Sampai ke penamat! Masa: {s}s" },
  grid_time_up:    { zh: "时间到，走了 {a} / {b} 步", en: "Time's up — {a} / {b} steps", ms: "Masa tamat — {a} / {b} langkah" },
  grid_mistakes:   { zh: "共错了 {n} 次", en: "{n} mistakes total", ms: "Jumlah {n} kesilapan" },
  grid_hint:       { zh: "点小鸡🐣旁边相邻的格子（上下左右），走对数字才能前进～", en: "Tap a cell next to the chick 🐣 (up/down/left/right) — the right number moves you forward", ms: "Ketik petak bersebelahan anak ayam 🐣 (atas/bawah/kiri/kanan) — nombor yang betul membawa anda ke depan" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

// ---------- 共用类型 ----------
export interface NumberMazeOption { value: string }
export interface NumberMazeDecisionPoint { id: string; x: number; y: number; options: NumberMazeOption[]; correctIndex: number }
export interface NumberMazeConfig {
  layout: "path" | "grid";
  // layout === "path" 专用
  bg_image_url?: string;
  mask_image_url?: string;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  decision_points?: NumberMazeDecisionPoint[];
  // layout === "grid" 专用
  rows?: number; cols?: number;
  cells?: string[][];
  path?: Array<{ row: number; col: number }>;
  line_color?: string; given_color?: string; bg_color?: string; bg_enabled?: boolean; opacity?: number;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string; ms?: string };
}
export interface NumberMazeResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

const W = GAME_CANVAS_W, H = GAME_CANVAS_H;

// ============================================================
// layout === "path" —— 路径分岔/房间迷宫
// ============================================================

const PLAYER_R = 16;
const END_R = 24;
const TRAIL_R = 6;
const GRAB_R = PLAYER_R * 2;
const DECISION_R = 34; // 分岔点没解锁之前，这个半径范围内直接当"不可走"
const WALK_TOLERANCE = 5; // 跟 MazeGame 一样的容错半径，避免起点没精确对齐蒙版就卡死

function PathDecisionMazeGame({ config, onComplete, locale }: {
  config: NumberMazeConfig; onComplete: (r: NumberMazeResult) => void; locale: Locale;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const maskImgRef = useRef<HTMLImageElement | null>(null);
  const [imagesLoaded, setImagesLoaded] = useState(false);

  const decisionPoints = useMemo(() => config.decision_points ?? [], [config.decision_points]);
  const startPx = useMemo(() => ({ x: (config.start?.x ?? 0.1) * W, y: (config.start?.y ?? 0.5) * H }), [config.start]);
  const endPx = useMemo(() => ({ x: (config.end?.x ?? 0.9) * W, y: (config.end?.y ?? 0.5) * H }), [config.end]);

  const [pos, setPos] = useState(startPx);
  const [trail, setTrail] = useState([startPx]);
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(new Set());
  const [activeDecisionId, setActiveDecisionId] = useState<string | null>(null); // 当前弹出选项面板的是哪个分岔点
  const [wrongOptionFlash, setWrongOptionFlash] = useState<number | null>(null); // 点错了哪个选项index，闪一下红色
  const [dragging, setDragging] = useState(false);
  const [bumps, setBumps] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState(
    config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en || lt("path_default", locale)
  );
  const startRef = useRef(Date.now());
  const offPathRef = useRef(false);

  useEffect(() => {
    let loaded = 0;
    const onLoad = () => { loaded++; if (loaded === 2) setImagesLoaded(true); };
    const bg = new Image(); bg.crossOrigin = "anonymous"; bg.onload = onLoad; bg.src = config.bg_image_url ?? "";
    bgImgRef.current = bg;
    const mask = new Image(); mask.crossOrigin = "anonymous";
    mask.onload = () => {
      const off = document.createElement("canvas");
      off.width = W; off.height = H;
      off.getContext("2d")!.drawImage(mask, 0, 0, W, H);
      maskCanvasRef.current = off;
      onLoad();
    };
    mask.src = config.mask_image_url ?? "";
    maskImgRef.current = mask;
    startRef.current = Date.now();
  }, [config.bg_image_url, config.mask_image_url]);

  // 判断"能不能走"——跟 MazeGame 一样先看蒙版(带容错半径)，再额外检查
  // 是不是踩进了一个"还没解锁的分岔点"范围内(那也算不可走，效果跟撞墙
  // 一样，只是原因不同——蒙版挡的是"没画路"，这个挡的是"该回答问题了")。
  const isWalkable = useCallback((x: number, y: number) => {
    const mc = maskCanvasRef.current;
    if (!mc) return false;
    const ctx = mc.getContext("2d")!;
    const cx = Math.floor(x), cy = Math.floor(y);
    const left = Math.max(0, cx - WALK_TOLERANCE), top = Math.max(0, cy - WALK_TOLERANCE);
    const right = Math.min(W - 1, cx + WALK_TOLERANCE), bottom = Math.min(H - 1, cy + WALK_TOLERANCE);
    const w = right - left + 1, h = bottom - top + 1;
    if (w <= 0 || h <= 0) return false;
    const data = ctx.getImageData(left, top, w, h).data;
    let onMask = false;
    for (let i = 3; i < data.length; i += 4) { if (data[i] > 40) { onMask = true; break; } }
    if (!onMask) return false;

    for (const dp of decisionPoints) {
      if (unlockedIds.has(dp.id)) continue;
      const dpx = dp.x * W, dpy = dp.y * H;
      if (Math.hypot(x - dpx, y - dpy) < DECISION_R) return false;
    }
    return true;
  }, [decisionPoints, unlockedIds]);

  // 拖到一个"没解锁的分岔点"附近，撞墙撞的其实是它——找出是哪一个，
  // 弹出它的选项面板。
  const findBlockingDecision = useCallback((x: number, y: number) => {
    for (const dp of decisionPoints) {
      if (unlockedIds.has(dp.id)) continue;
      const dpx = dp.x * W, dpy = dp.y * H;
      if (Math.hypot(x - dpx, y - dpy) < DECISION_R + 8) return dp;
    }
    return null;
  }, [decisionPoints, unlockedIds]);

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

        ctx.fillStyle = "rgba(255,122,89,0.4)";
        trail.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, TRAIL_R, 0, Math.PI * 2); ctx.fill(); });

        // 分岔点——没解锁的显示为紫色带问号，解锁了的变淡+打勾
        decisionPoints.forEach((dp) => {
          const unlocked = unlockedIds.has(dp.id);
          const dpx = dp.x * W, dpy = dp.y * H;
          ctx.beginPath(); ctx.arc(dpx, dpy, DECISION_R * 0.55, 0, Math.PI * 2);
          ctx.fillStyle = unlocked ? "rgba(46,158,91,0.55)" : "rgba(139,122,224,0.9)";
          ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
          ctx.font = "bold 18px sans-serif"; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(unlocked ? "✓" : "?", dpx, dpy);
        });

        // 终点
        ctx.beginPath(); ctx.arc(endPx.x, endPx.y, END_R, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(46,158,91,0.9)"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
        ctx.font = "22px sans-serif"; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText(done ? "✅" : "🏁", endPx.x, endPx.y + 8);

        // 球
        ctx.beginPath(); ctx.arc(pos.x, pos.y, PLAYER_R, 0, Math.PI * 2);
        ctx.fillStyle = "#ff7a59"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [imagesLoaded, pos, trail, decisionPoints, unlockedIds, endPx, done]);

  function toCanvasXY(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = W / rect.width, scaleY = H / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (finished || activeDecisionId) return;
    const { x, y } = toCanvasXY(e);
    if (Math.hypot(x - pos.x, y - pos.y) < GRAB_R) { setDragging(true); offPathRef.current = false; }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragging || finished || activeDecisionId) return;
    const { x, y } = toCanvasXY(e);

    const STEPS = 20;
    let landing = pos, hitWall = false;
    if (isWalkable(x, y)) {
      landing = { x, y };
    } else {
      hitWall = true;
      for (let i = 1; i <= STEPS; i++) {
        const step = i / STEPS;
        const px = pos.x + (x - pos.x) * step, py = pos.y + (y - pos.y) * step;
        if (isWalkable(px, py)) landing = { x: px, y: py };
        else break;
      }
    }

    if (hitWall && !offPathRef.current) {
      setBumps((n) => n + 1);
      const blocking = findBlockingDecision(x, y);
      if (blocking) {
        setDragging(false);
        setActiveDecisionId(blocking.id);
        setStatus(lt("pick_first", locale));
      } else {
        setStatus(lt("hit_wall", locale));
      }
    }
    offPathRef.current = hitWall;

    setPos(landing);
    setTrail((prevTrail) => [...prevTrail, landing]);

    if (Math.hypot(landing.x - endPx.x, landing.y - endPx.y) < END_R) {
      setDone(true); setDragging(false);
      setStatus(lt("arrived", locale));
      setTimeout(() => finish(true), 400);
    } else if (!hitWall) {
      setStatus(lt("keep_going", locale));
    }
  }

  function handlePointerUp() { setDragging(false); }

  function chooseOption(dp: NumberMazeDecisionPoint, idx: number) {
    if (idx === dp.correctIndex) {
      setUnlockedIds((s) => new Set(s).add(dp.id));
      setActiveDecisionId(null);
      setStatus(lt("correct_continue", locale));
    } else {
      setBumps((n) => n + 1);
      setWrongOptionFlash(idx);
      setTimeout(() => setWrongOptionFlash(null), 500);
    }
  }

  const timerLabel = config.timer_mode === "countdown" ? tt("time_left", locale) : tt("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const activeDecision = decisionPoints.find((d) => d.id === activeDecisionId) ?? null;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🏁</div>
        <div className="text-xl font-semibold mt-3 text-foreground">{done ? lt("path_done", locale, { s: timerValue.toFixed(1) }) : lt("time_up", locale)}</div>
        <div className="text-sm text-muted-foreground mt-1">{lt("path_bumps", locale, { n: bumps })}</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto w-full">
      <div className="flex justify-between items-center text-base font-medium text-muted-foreground mb-3 flex-wrap gap-2">
        <span>{lt("maze_title", locale)}</span>
        <div className="flex items-center gap-3">
          <span>{lt("bumps_short", locale, { n: bumps })}</span>
          <span>⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
        </div>
      </div>
      {!imagesLoaded && <div className="text-center py-10 text-muted-foreground">{lt("loading", locale)}</div>}
      <div className={`relative ${imagesLoaded ? "block" : "hidden"}`}>
        <canvas
          ref={canvasRef} width={W} height={H}
          onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
          style={{ touchAction: "none" }}
          className="w-full h-auto rounded-2xl shadow-lg ring-1 ring-black/5 bg-muted cursor-grab active:cursor-grabbing"
        />
        {activeDecision && (
          <div className="absolute inset-0 bg-black/40 rounded-2xl flex items-center justify-center p-6">
            <div className="bg-white rounded-2xl shadow-xl p-5 space-y-3 max-w-xs w-full">
              <p className="text-center text-sm font-medium text-muted-foreground">{lt("pick_prompt", locale)}</p>
              <div className="grid grid-cols-2 gap-2">
                {activeDecision.options.map((opt, i) => (
                  <button
                    key={i} type="button" onClick={() => chooseOption(activeDecision, i)}
                    className={`h-14 rounded-xl text-2xl font-bold border-2 transition-colors ${
                      wrongOptionFlash === i ? "border-red-400 bg-red-50 text-red-600" : "border-border bg-muted/40 hover:border-primary hover:bg-primary/5"
                    }`}
                  >
                    {opt.value}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <p className="text-center text-sm font-medium text-muted-foreground mt-2">{status}</p>
    </div>
  );
}

// ============================================================
// layout === "grid" —— 方格棋盘/跳格子
// ============================================================

function GridPathMazeGame({ config, onComplete, locale }: {
  config: NumberMazeConfig; onComplete: (r: NumberMazeResult) => void; locale: Locale;
}) {
  const rows = config.rows ?? 1, cols = config.cols ?? 1;
  const cells = config.cells ?? [];
  const path = useMemo(() => config.path ?? [], [config.path]);

  const [stepIndex, setStepIndex] = useState(0); // 走到路径的第几步了(0起算)，初始就站在起点(path[0])
  const [wrongCell, setWrongCell] = useState<{ row: number; col: number } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  const finish = useCallback((completed: boolean) => {
    setFinished(true);
    onComplete({
      score: completed ? 1 : stepIndex / Math.max(1, path.length - 1),
      max_score: 1,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes, completed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mistakes, stepIndex, path.length]);

  useEffect(() => {
    if (!finished && path.length > 0 && stepIndex === path.length - 1) {
      setTimeout(() => finish(true), 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  useEffect(() => {
    if (config.timer_mode !== "countdown" || !config.time_limit || finished) return;
    if (elapsed >= config.time_limit) finish(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  const current = path[stepIndex];
  const visited = useMemo(() => new Set(path.slice(0, stepIndex + 1).map((p) => `${p.row}-${p.col}`)), [path, stepIndex]);

  function handleCellClick(row: number, col: number) {
    if (finished || !current) return;
    const isAdjacent = Math.abs(row - current.row) + Math.abs(col - current.col) === 1;
    const next = path[stepIndex + 1];
    if (isAdjacent && next && next.row === row && next.col === col) {
      setStepIndex((i) => i + 1);
    } else {
      setMistakes((m) => m + 1);
      setWrongCell({ row, col });
      setTimeout(() => setWrongCell(null), 400);
    }
  }

  const timerLabel = config.timer_mode === "countdown" ? tt("time_left", locale) : tt("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🔀</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {stepIndex === path.length - 1 ? lt("grid_done", locale, { s: timerValue.toFixed(1) }) : lt("grid_time_up", locale, { a: stepIndex + 1, b: path.length })}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{lt("grid_mistakes", locale, { n: mistakes })}</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex justify-between items-center text-base font-medium text-muted-foreground mb-3 flex-wrap gap-2">
        <span>{lt("grid_progress", locale, { a: stepIndex + 1, b: path.length })}</span>
        <span>⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>
      {(config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en) && (
        <p className="text-center text-lg font-semibold text-foreground mb-3">{config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en}</p>
      )}
      <div
        className="mx-auto rounded-2xl shadow-lg ring-1 ring-black/5 overflow-hidden grid"
        style={{
          gridTemplateRows: `repeat(${rows}, 1fr)`, gridTemplateColumns: `repeat(${cols}, 1fr)`,
          width: "100%", aspectRatio: `${cols} / ${rows}`,
          background: config.bg_enabled ? config.bg_color : "#ffffff",
          opacity: (config.opacity ?? 100) / 100,
        }}
      >
        {Array.from({ length: rows * cols }, (_, idx) => {
          const r = Math.floor(idx / cols), c = idx % cols;
          const isCurrent = current?.row === r && current?.col === c;
          const isVisited = visited.has(`${r}-${c}`);
          const isWrong = wrongCell?.row === r && wrongCell?.col === c;
          return (
            <button
              key={`${r}-${c}`} type="button" onClick={() => handleCellClick(r, c)}
              disabled={isCurrent}
              className={`flex items-center justify-center text-lg sm:text-2xl font-bold border transition-colors ${
                isWrong ? "bg-red-100 border-red-400 text-red-600"
                : isCurrent ? "bg-amber-300 border-amber-500 text-amber-900"
                : isVisited ? "bg-emerald-100 border-emerald-300 text-emerald-700"
                : "bg-white border-border hover:bg-primary/5"
              }`}
              style={{ borderColor: config.line_color, color: isCurrent || isWrong || isVisited ? undefined : config.given_color }}
            >
              {isCurrent ? "🐣" : (cells[r]?.[c] ?? "")}
            </button>
          );
        })}
      </div>
      <p className="text-center text-sm font-medium text-muted-foreground mt-2">{lt("grid_hint", locale)}</p>
    </div>
  );
}

// ============================================================
// 入口——按 layout 分流
// ============================================================
export default function NumberMazeGame({ config, onComplete, locale = "zh" }: {
  config: NumberMazeConfig; onComplete: (r: NumberMazeResult) => void; locale?: Locale;
}) {
  if (config.layout === "grid") return <GridPathMazeGame config={config} onComplete={onComplete} locale={locale} />;
  return <PathDecisionMazeGame config={config} onComplete={onComplete} locale={locale} />;
}
