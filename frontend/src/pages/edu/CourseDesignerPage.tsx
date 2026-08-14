// frontend/src/pages/edu/CourseDesignerPage.tsx
//
// Table-list + modal pattern (see prior notes in README), this pass focuses
// on visual consistency: every input/select now shares the same Tailwind
// treatment as the design system's <Input> component (border-input,
// rounded-lg, focus ring), tables sit inside a bordered/rounded container
// with a muted header row and hover states, and spacing follows the app's
// existing scale instead of ad-hoc inline styles.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Hash, ScanSearch, Target, Layers, Puzzle, FileText, Route, GitBranch, Grid3x3, Link2, Palette, Presentation, Film, Music2, Sticker, Boxes, Rows3, Eye, RotateCw, Hammer, Frame, Square, Clock, Grid2x2, PenLine, X, CheckSquare, PencilLine, Info, Tags, SlidersHorizontal, Sparkles, Dice5, ImagePlus, MessageSquareText, Volume2, BookOpenText, Play, Pause, Repeat, type LucideIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { eduApi, lessonsApi, exerciseClassificationApi, taxonomyApi } from "@/api";
import { GAME_CANVAS_W, GAME_CANVAS_H } from "@/lib/gameCanvas";
import SceneEditor, { type StructuredSceneOutput } from "@/components/SceneEditor";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import AssetPicker from "@/components/AssetPicker";
import toast from "react-hot-toast";

interface GradeTier { id: string; code: string; name_i18n: Record<string,string>; age_min?: number; age_max?: number }
interface Course { id: string; title_i18n: Record<string,string>; grade_tier_code?: string; grade_tier_name_i18n?: Record<string,string>; created_at?: string }
interface Level {
  id: string; order_index: number; module_type: string; title_i18n?: Record<string,string>; exercise_number?: string;
  category_name_zh?: string; group_name_zh?: string; subject_name_zh?: string; programme_name_zh?: string;
}

// Shared control classes so raw <select>/<input type=number> elements match
// the design system's <Input> exactly, instead of a plain browser default.
const SELECT_CLASS = "flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const MINI_SELECT_CLASS = "h-9 rounded-lg border border-input bg-transparent px-2 text-sm font-medium shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const MINI_INPUT_CLASS = "h-9 w-16 rounded-lg border border-input bg-transparent px-2 text-sm font-medium shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

// crypto.randomUUID() 只在"安全上下文"下可用（HTTPS 或 localhost）——
// 局域网内用普通 HTTP 访问（比如 http://192.168.0.5:8080 这种）会被浏览
// 器当成不安全环境，直接不提供这个 API，调用就整页崩溃。这里生成的都
// 是前端本地临时用来区分"这是哪一个"的标记（列表 key、临时对象 id），
// 不是真的需要密码学级别的唯一性，不用 crypto，一个简单的随机字符串
// 就够用，而且到处都能跑，不挑访问方式。
function uid() { return Math.random().toString(36).slice(2, 10); }

const MODULE_LABELS: Record<string, { emoji: string; label: string }> = {
  counting:     { emoji: "🔢", label: "点点数数" },
  spot_diff:    { emoji: "🔍", label: "找不同之处" },
  focus_tap:    { emoji: "🎯", label: "专注力点数字" },
  memory:       { emoji: "🃏", label: "Memory配对" },
  pattern:      { emoji: "🧩", label: "找规律" },
  word_problem: { emoji: "📝", label: "应用题" },
  maze:         { emoji: "🧭", label: "迷宫" },
  number_maze:  { emoji: "🔀", label: "数字迷宫" },
  sudoku:       { emoji: "🔢", label: "数独" },
  line_match:   { emoji: "🔗", label: "连线配对" },
  coloring:     { emoji: "🎨", label: "填色游戏" },
  ppt_lecture:  { emoji: "📊", label: "PPT讲义" },
  video_lecture:{ emoji: "🎬", label: "视频讲义" },
  play_along:   { emoji: "🎼", label: "跟弹练习" },
  sticker_game: { emoji: "🏷️", label: "贴纸游戏" },
  cube_stack:   { emoji: "🧊", label: "立体方块计数" },
  cube_layer_count: { emoji: "🧱", label: "立体方块-逐层计数" },
  cube_find_hidden: { emoji: "🕵️", label: "立体方块-找隐藏方块" },
  cube_free_rotate: { emoji: "🔄", label: "立体方块-自由旋转观察" },
  cube_build:       { emoji: "🏗️", label: "立体方块-自己搭积木" },
  cube_three_view:  { emoji: "📐", label: "立体方块-三视图" },
  shape_count:      { emoji: "🔲", label: "数方块(平面图形)" },
  clock:            { emoji: "🕐", label: "认钟表" },
  latin_square:     { emoji: "🎲", label: "图形排排看" },
  chinese_stroke:   { emoji: "✍️", label: "中文字笔顺练习" },
  multiple_choice:  { emoji: "☑️", label: "选择题" },
  fill_blank:       { emoji: "📝", label: "填充题" },
};

// 每个游戏类型一个专属色系——像玩具架上的游戏卡带，一眼就能从颜色分辨
// 类型，不用逐个读文字。跟侧边栏原本就有的 teal-to-blue 渐变是同一个
// 色系家族的延伸，不是另起炉灶。
const MODULE_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  counting:      { bg: "#FEF3C7", text: "#B45309", ring: "#F59E0B" },
  spot_diff:     { bg: "#DBEAFE", text: "#1D4ED8", ring: "#2563EB" },
  focus_tap:     { bg: "#FFE4E6", text: "#BE123C", ring: "#FB7185" },
  memory:        { bg: "#EDE9FE", text: "#6D28D9", ring: "#8B5CF6" },
  pattern:       { bg: "#CCFBF1", text: "#0F766E", ring: "#14B8A6" },
  word_problem:  { bg: "#F1F5F9", text: "#334155", ring: "#64748B" },
  maze:          { bg: "#D1FAE5", text: "#047857", ring: "#10B981" },
  number_maze:   { bg: "#E0F2FE", text: "#0369A1", ring: "#0EA5E9" },
  sudoku:        { bg: "#E0E7FF", text: "#4338CA", ring: "#6366F1" },
  line_match:    { bg: "#FCE7F3", text: "#BE185D", ring: "#EC4899" },
  coloring:      { bg: "#FFEDD5", text: "#C2410C", ring: "#F97316" },
  ppt_lecture:   { bg: "#F3F4F6", text: "#4B5563", ring: "#9CA3AF" },
  video_lecture: { bg: "#FEE2E2", text: "#B91C1C", ring: "#EF4444" },
  play_along:    { bg: "#FDF4FF", text: "#A21CAF", ring: "#D946EF" },
  sticker_game:  { bg: "#FEF9C3", text: "#854D0E", ring: "#EAB308" },
  cube_stack:    { bg: "#E7E5E4", text: "#44403C", ring: "#78716C" },
  cube_layer_count: { bg: "#FFEDD5", text: "#9A3412", ring: "#FB923C" },
  cube_find_hidden: { bg: "#E0E7FF", text: "#3730A3", ring: "#818CF8" },
  cube_free_rotate: { bg: "#CFFAFE", text: "#155E75", ring: "#22D3EE" },
  cube_build:       { bg: "#FEF3C7", text: "#92400E", ring: "#F59E0B" },
  cube_three_view:  { bg: "#F3E8FF", text: "#6B21A8", ring: "#C084FC" },
  shape_count:      { bg: "#DBEAFE", text: "#1E40AF", ring: "#60A5FA" },
  clock:            { bg: "#ECFCCB", text: "#3F6212", ring: "#84CC16" },
  latin_square:     { bg: "#FAE8FF", text: "#86198F", ring: "#E879F9" },
  chinese_stroke:   { bg: "#FBCFE8", text: "#831843", ring: "#EC4899" },
  multiple_choice:  { bg: "#DCFCE7", text: "#15803D", ring: "#22C55E" },
  fill_blank:       { bg: "#FFF7ED", text: "#C2410C", ring: "#FB923C" },
};
const FALLBACK_COLOR = { bg: "#F1F5F9", text: "#334155", ring: "#94A3B8" };

// 专业的线性图标取代表情符号——emoji在不同系统/浏览器渲染不一致，看
// 起来业余，用 lucide-react 这个项目里本来就在用的图标库（AppLayout.tsx
// 已经引入过），保持视觉统一、干净。
const MODULE_ICONS: Record<string, LucideIcon> = {
  counting: Hash, spot_diff: ScanSearch, focus_tap: Target, memory: Layers,
  pattern: Puzzle, word_problem: FileText, maze: Route, number_maze: GitBranch, sudoku: Grid3x3,
  line_match: Link2, coloring: Palette, ppt_lecture: Presentation, video_lecture: Film,
  play_along: Music2, sticker_game: Sticker, cube_stack: Boxes,
  cube_layer_count: Rows3, cube_find_hidden: Eye, cube_free_rotate: RotateCw,
  cube_build: Hammer, cube_three_view: Frame, shape_count: Square, clock: Clock, latin_square: Grid2x2,
  chinese_stroke: PenLine,
  multiple_choice: CheckSquare, fill_blank: PencilLine,
};

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// ── Modal: add course ─────────────────────────────────────────────────────────
// ── Modal: add level (module type picked first, fields swap accordingly) ─────
const SD_W = GAME_CANVAS_W, SD_H = GAME_CANVAS_H, SD_BOX_W = 500, SD_BOX_H = 655, SD_LEFT_X = 30, SD_RIGHT_X = 570, SD_BOX_Y = 22;
const SD_COLORS = ["#e8a33d", "#ff7a59", "#4fb06d", "#5b8def", "#8b7ae0", "#222222", "#ffffff"];
// 跟 MazeGame.tsx 里的 BALL_COLORS 保持同一个顺序——这样设计器里第几个
// 配对显示什么颜色，玩游戏时那个球就是同一个颜色，不会对不上。
const MZ_BALL_COLORS = ["#ff7a59", "#5b8def", "#a855f7", "#f59e0b", "#14b8a6", "#ec4899", "#84cc16", "#06b6d4"];

interface SpotDiffHotspotDraft { x: number; y: number; r: number }
interface SdStrokeDraft { id: string; color: string; width: number; opacity: number; isEraser?: boolean; points: { x: number; y: number }[] }

// 三种图层类型统一放一个数组里管理（跟 SceneEditor 的 Layer 联合类型
// 是同一个思路），这样选中/拖动/删除这些操作可以写一套逻辑，不用给
// 物件、文字、形状各写一份。笔画（strokes）是单独一个数组，因为它的
// 形状是一串点而不是矩形边界，选中判定和拖动方式不一样，但一样支持
// 选中改属性/拖动/删除，跟其它图层用同一套右键属性面板。
interface SdObjectLayer { id: string; kind: "object"; imageUrl: string; x: number; y: number; w: number; h: number; rotation: number; flipX?: boolean; flipY?: boolean; opacity?: number }
interface SdTextLayer { id: string; kind: "text"; text: string; x: number; y: number; fontSize: number; color: string; fontFamily: string; rotation: number; opacity?: number }
interface SdShapeLayer {
  id: string; kind: "shape"; shape: "rect" | "ellipse" | "line";
  x: number; y: number; w: number; h: number; rotation: number;
  fillColor: string; fillEnabled: boolean; borderColor: string; borderWidth: number; opacity?: number;
}
type SdLayer = SdObjectLayer | SdTextLayer | SdShapeLayer;

// updateSelectedLayer 要接受"不管选中的是物件/文字/形状里哪一种，改动
// 里可能出现的任何字段"——写成 Partial<SdObjectLayer & SdTextLayer &
// SdShapeLayer>（交叉类型）是错的：三种类型的 kind 字段互相矛盾（同时
// 是"object"又是"text"又是"shape"是不可能的），TS 会把整个交叉类型判定
// 成 never，所有字段跟着报错。改成"把三种类型各自的字段摊平合并、全部
// 可选"这个写法才对。
type SdLayerPatch = Partial<{
  imageUrl: string; x: number; y: number; w: number; h: number; rotation: number; flipX: boolean; flipY: boolean;
  text: string; fontSize: number; color: string; fontFamily: string;
  shape: "rect" | "ellipse" | "line"; fillColor: string; fillEnabled: boolean; borderColor: string; borderWidth: number;
  opacity: number;
}>;

// 选中的东西可能是图层（物件/文字/形状），也可能是一条笔画——两种数据
// 结构完全不同，用这个联合类型统一表示"当前选中的是谁"。
type SdSelection = { type: "layer"; id: string } | { type: "stroke"; id: string } | null;

const SD_FONTS = [
  { value: "system-ui, sans-serif", label: "系统默认" },
  { value: "'Noto Sans SC', sans-serif", label: "思源黑体" },
  { value: "'Noto Serif SC', serif", label: "思源宋体" },
  { value: "cursive", label: "手写风格" },
];

function sdUid() { return Math.random().toString(36).slice(2, 10); }

function sdHexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  return [parseInt(m.slice(0, 2), 16) || 0, parseInt(m.slice(2, 4), 16) || 0, parseInt(m.slice(4, 6), 16) || 0];
}

// 跟 SceneEditor 用的是同一套泛洪填充算法，独立复制一份而不是跨文件共用——
// 这里的填色桶只需要在"找不同图"这一个方框范围内运作，逻辑比 SceneEditor
// 那个通用版本简单，没必要为了共用几十行代码去处理跨组件传参。
function sdFloodFill(imageData: ImageData, startX: number, startY: number, fillRgb: [number, number, number], tolerance: number) {
  const { width, height, data } = imageData;
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;
  const startIdx = (startY * width + startX) * 4;
  const sr = data[startIdx], sg = data[startIdx + 1], sb = data[startIdx + 2], sa = data[startIdx + 3];
  const [fr, fg, fb] = fillRgb;
  if (Math.abs(sr - fr) <= 2 && Math.abs(sg - fg) <= 2 && Math.abs(sb - fb) <= 2 && sa > 200) return;
  const tol2 = tolerance * tolerance;
  const matches = (idx: number) => {
    const dr = data[idx] - sr, dg = data[idx + 1] - sg, db = data[idx + 2] - sb, da = data[idx + 3] - sa;
    return dr * dr + dg * dg + db * db + da * da <= tol2;
  };
  const visited = new Uint8Array(width * height);
  const stack: number[] = [startX, startY];
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!;
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const vIdx = y * width + x;
    if (visited[vIdx]) continue;
    const idx = vIdx * 4;
    if (!matches(idx)) continue;
    visited[vIdx] = 1;
    data[idx] = fr; data[idx + 1] = fg; data[idx + 2] = fb; data[idx + 3] = 255;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
}

function sdLayerBounds(l: SdObjectLayer | SdShapeLayer) { return { x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h }; }

function sdStrokeBounds(s: SdStrokeDraft) {
  const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
  const minX = Math.min(...xs) - s.width / 2, maxX = Math.max(...xs) + s.width / 2;
  const minY = Math.min(...ys) - s.width / 2, maxY = Math.max(...ys) + s.width / 2;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function sdDistToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function sdHitTestStroke(px: number, py: number, s: SdStrokeDraft): boolean {
  const pad = s.width / 2 + 8; // 8px 容错，细笔画不容易精确点中
  if (s.points.length === 1) return Math.hypot(px - s.points[0].x, py - s.points[0].y) <= pad;
  for (let i = 1; i < s.points.length; i++) {
    if (sdDistToSegment(px, py, s.points[i - 1].x, s.points[i - 1].y, s.points[i].x, s.points[i].y) <= pad) return true;
  }
  return false;
}

// 找不同之处的标记工具——两张图放回同一个画布省空间。默认是"标记模式"：
// 点空白处直接加一个标记，点已有的标记可以拖动改位置，选中之后能调整
// 判定范围大小或删除，这是最常用、最直觉的操作。
//
// 需要的时候可以切到"画笔模式"：只在"找不同图"(右边)那个框里操作——
// 铅笔/毛笔/橡皮擦/填色桶画线；加物件（从素材库选图片，支持翻转）；
// 加文字（可以调字体、字号、颜色）；加形状（方形/圆形/直线，支持填色）。
// 画的笔画（铅笔/毛笔）也不是画完就定死了——切到"选择"工具，点笔画本身
// 也能选中，一样可以拖动、改颜色/粗细/透明度、复制、删除，跟物件/文字/
// 形状用同一套右键属性面板。做完点"✅ 应用到找不同图"，会把这些东西
// 烤进一张新的找不同图里（通过 onImgBUpdated 传回去），然后自动切回
// 标记模式，让你标记刚做出来的这处差异。
function SpotDiffMarker({ imgAUrl, imgBUrl, hotspots, setHotspots, onImgBUpdated }: {
  imgAUrl: string | null; imgBUrl: string | null;
  hotspots: SpotDiffHotspotDraft[]; setHotspots: (h: SpotDiffHotspotDraft[]) => void;
  onImgBUpdated: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgARef = useRef<HTMLImageElement | null>(null);
  const imgBRef = useRef<HTMLImageElement | null>(null);
  const layerImgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const [subMode, setSubMode] = useState<"mark" | "draw">("mark");
  const [drawTool, setDrawTool] = useState<"pencil" | "brush" | "eraser" | "bucket" | "select">("pencil");
  const [drawColor, setDrawColor] = useState("#e8a33d");
  const [drawWidth, setDrawWidth] = useState(6);
  const [drawOpacity, setDrawOpacity] = useState(100);
  const [strokes, setStrokes] = useState<SdStrokeDraft[]>([]);
  const [layers, setLayers] = useState<SdLayer[]>([]);
  const [selection, setSelection] = useState<SdSelection>(null);
  const dragRef = useRef<{ startPx: number; startPy: number; origX: number; origY: number } | null>(null);
  const currentStrokeRef = useRef<SdStrokeDraft | null>(null);
  const [, forceTick] = useState(0);
  // 右键弹出的属性面板——位置是屏幕坐标（fixed定位用），不是画布坐标
  const [propPopup, setPropPopup] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!imgAUrl) { imgARef.current = null; return; }
    const img = new Image(); img.onload = () => { imgARef.current = img; redraw(); }; img.src = imgAUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgAUrl]);
  useEffect(() => {
    if (!imgBUrl) { imgBRef.current = null; return; }
    const img = new Image(); img.onload = () => { imgBRef.current = img; redraw(); }; img.src = imgBUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgBUrl]);

  // 物件图层的图片要单独加载缓存——跟背景图是两码事
  useEffect(() => {
    layers.forEach((l) => {
      if (l.kind !== "object") return;
      if (layerImgCacheRef.current.has(l.imageUrl)) return;
      const img = new Image();
      img.onload = () => forceTick((n) => n + 1);
      img.src = l.imageUrl;
      layerImgCacheRef.current.set(l.imageUrl, img);
    });
  }, [layers]);

  const selectedLayer = selection?.type === "layer" ? layers.find((l) => l.id === selection.id) ?? null : null;
  const selectedStroke = selection?.type === "stroke" ? strokes.find((s) => s.id === selection.id) ?? null : null;

  function drawLayer(ctx: CanvasRenderingContext2D, l: SdLayer, offsetX: number, offsetY: number) {
    const lx = l.x - offsetX, ly = l.y - offsetY;
    if (l.kind === "text") {
      ctx.save();
      ctx.globalAlpha = l.opacity ?? 1;
      ctx.translate(lx, ly); ctx.rotate((l.rotation * Math.PI) / 180); ctx.translate(-lx, -ly);
      ctx.font = `${l.fontSize}px ${l.fontFamily}`;
      ctx.fillStyle = l.color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(l.text, lx, ly);
      ctx.restore();
      return;
    }
    const b = { x: lx - l.w / 2, y: ly - l.h / 2, w: l.w, h: l.h };
    ctx.save();
    ctx.globalAlpha = l.opacity ?? 1;
    ctx.translate(lx, ly); ctx.rotate((l.rotation * Math.PI) / 180); ctx.translate(-lx, -ly);
    if (l.kind === "object") {
      const img = layerImgCacheRef.current.get(l.imageUrl);
      if (img?.complete) {
        const fx = l.flipX ? -1 : 1, fy = l.flipY ? -1 : 1;
        if (fx !== 1 || fy !== 1) {
          ctx.save();
          ctx.translate(lx, ly); ctx.scale(fx, fy); ctx.translate(-lx, -ly);
          ctx.drawImage(img, b.x, b.y, b.w, b.h);
          ctx.restore();
        } else {
          ctx.drawImage(img, b.x, b.y, b.w, b.h);
        }
      }
    } else if (l.kind === "shape") {
      if (l.shape === "line") {
        ctx.beginPath(); ctx.moveTo(b.x, ly); ctx.lineTo(b.x + b.w, ly);
        ctx.lineCap = "round"; ctx.strokeStyle = l.borderColor; ctx.lineWidth = Math.max(1, l.borderWidth); ctx.stroke();
      } else {
        ctx.beginPath();
        if (l.shape === "ellipse") ctx.ellipse(lx, ly, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
        else ctx.rect(b.x, b.y, b.w, b.h);
        if (l.fillEnabled) { ctx.fillStyle = l.fillColor; ctx.fill(); }
        if (l.borderWidth > 0) { ctx.strokeStyle = l.borderColor; ctx.lineWidth = l.borderWidth; ctx.stroke(); }
      }
    }
    ctx.restore();
  }

  function drawStroke(ctx: CanvasRenderingContext2D, s: SdStrokeDraft) {
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    ctx.globalCompositeOperation = s.isEraser ? "destination-out" : "source-over";
    ctx.beginPath();
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
    s.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.restore();
  }

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SD_W, SD_H);
    ctx.fillStyle = "#fff";
    ctx.fillRect(SD_LEFT_X, SD_BOX_Y, SD_BOX_W, SD_BOX_H);
    ctx.fillRect(SD_RIGHT_X, SD_BOX_Y, SD_BOX_W, SD_BOX_H);
    if (imgARef.current) ctx.drawImage(imgARef.current, SD_LEFT_X, SD_BOX_Y, SD_BOX_W, SD_BOX_H);
    if (imgBRef.current) ctx.drawImage(imgBRef.current, SD_RIGHT_X, SD_BOX_Y, SD_BOX_W, SD_BOX_H);

    // 画笔/物件/文字/形状——只画在右边"找不同图"这个框里，用 clip 夹住，不会画出界
    ctx.save();
    ctx.beginPath();
    ctx.rect(SD_RIGHT_X, SD_BOX_Y, SD_BOX_W, SD_BOX_H);
    ctx.clip();
    strokes.forEach((s) => {
      drawStroke(ctx, s);
      if (selection?.type === "stroke" && selection.id === s.id) {
        const b = sdStrokeBounds(s);
        ctx.save();
        ctx.strokeStyle = "#5b8def"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
        ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
        ctx.setLineDash([]);
        ctx.restore();
      }
    });
    layers.forEach((l) => {
      drawLayer(ctx, l, 0, 0);
      if (selection?.type === "layer" && selection.id === l.id) {
        const b = l.kind === "text"
          ? { x: l.x - 40, y: l.y - l.fontSize / 2, w: 80, h: l.fontSize }
          : sdLayerBounds(l);
        ctx.save();
        ctx.strokeStyle = "#5b8def"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
        ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
        ctx.setLineDash([]);
        ctx.restore();
      }
    });
    ctx.restore();

    ctx.strokeStyle = "#dbe9e0"; ctx.lineWidth = 2;
    ctx.strokeRect(SD_LEFT_X, SD_BOX_Y, SD_BOX_W, SD_BOX_H);
    ctx.strokeRect(SD_RIGHT_X, SD_BOX_Y, SD_BOX_W, SD_BOX_H);

    if (subMode === "mark") {
      hotspots.forEach((h, i) => {
        [SD_LEFT_X, SD_RIGHT_X].forEach((ox) => {
          ctx.beginPath();
          ctx.arc(ox + h.x * SD_BOX_W, SD_BOX_Y + h.y * SD_BOX_H, h.r * SD_BOX_W, 0, Math.PI * 2);
          ctx.setLineDash(i === selectedIdx ? [] : [6, 5]);
          ctx.strokeStyle = i === selectedIdx ? "#5b8def" : "rgba(255,122,89,0.9)";
          ctx.lineWidth = 3; ctx.stroke();
          ctx.setLineDash([]);
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotspots, selectedIdx, strokes, layers, selection, subMode]);

  useEffect(redraw, [redraw]);

  function toCanvasXY(e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>): { px: number; py: number } {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = SD_W / rect.width, scaleY = SD_H / rect.height;
    return { px: (e.clientX - rect.left) * scaleX, py: (e.clientY - rect.top) * scaleY };
  }

  function toBoxXY(e: React.PointerEvent<HTMLCanvasElement>): { lx: number; ly: number } | null {
    const { px, py } = toCanvasXY(e);
    if (px >= SD_LEFT_X && px <= SD_LEFT_X + SD_BOX_W && py >= SD_BOX_Y && py <= SD_BOX_Y + SD_BOX_H) {
      return { lx: (px - SD_LEFT_X) / SD_BOX_W, ly: (py - SD_BOX_Y) / SD_BOX_H };
    }
    if (px >= SD_RIGHT_X && px <= SD_RIGHT_X + SD_BOX_W && py >= SD_BOX_Y && py <= SD_BOX_Y + SD_BOX_H) {
      return { lx: (px - SD_RIGHT_X) / SD_BOX_W, ly: (py - SD_BOX_Y) / SD_BOX_H };
    }
    return null;
  }

  // ── 标记模式：点空白加标记、点已有的拖动、松手结束 ──────────────────────────
  function handleMarkPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const pos = toBoxXY(e);
    if (!pos) return;
    const hitIdx = hotspots.findIndex((h) => Math.hypot(h.x - pos.lx, h.y - pos.ly) < h.r);
    if (hitIdx >= 0) { setSelectedIdx(hitIdx); setDragIdx(hitIdx); }
    else { const next = [...hotspots, { x: pos.lx, y: pos.ly, r: 0.06 }]; setHotspots(next); setSelectedIdx(next.length - 1); }
  }
  function handleMarkPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (dragIdx === null) return;
    const pos = toBoxXY(e);
    if (!pos) return;
    setHotspots(hotspots.map((h, i) => (i === dragIdx ? { ...h, x: pos.lx, y: pos.ly } : h)));
  }
  function removeSelected() {
    if (selectedIdx === null) return;
    setHotspots(hotspots.filter((_, i) => i !== selectedIdx));
    setSelectedIdx(null);
  }
  function resizeSelected(delta: number) {
    if (selectedIdx === null) return;
    setHotspots(hotspots.map((h, i) => (i === selectedIdx ? { ...h, r: Math.max(0.02, Math.min(0.15, h.r + delta)) } : h)));
  }

  // ── 画笔模式：铅笔/毛笔/橡皮擦画线，填色桶灌颜色，物件/文字/形状/笔画都能选中拖动 ──
  function bucketFillAt(px: number, py: number) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !imgBRef.current) return;
    const off = document.createElement("canvas");
    off.width = SD_BOX_W; off.height = SD_BOX_H;
    const octx = off.getContext("2d");
    if (!octx) return;
    octx.drawImage(imgBRef.current, 0, 0, SD_BOX_W, SD_BOX_H);
    const imageData = octx.getImageData(0, 0, SD_BOX_W, SD_BOX_H);
    sdFloodFill(imageData, Math.round(px - SD_RIGHT_X), Math.round(py - SD_BOX_Y), sdHexToRgb(drawColor), 32);
    octx.putImageData(imageData, 0, 0);
    const newUrl = off.toDataURL("image/png");
    const newImg = new Image();
    newImg.onload = () => { imgBRef.current = newImg; redraw(); };
    newImg.src = newUrl;
    onImgBUpdated(newUrl);
  }

  // 统一命中测试——图层（物件/文字/形状）在上层，画笔笔画在下层，所以先
  // 查图层再查笔画，符合"点哪个就选哪个可见的东西"的直觉。
  function hitTestAny(px: number, py: number): SdSelection {
    const pad = 10;
    const layerHit = [...layers].reverse().find((l) => {
      if (l.kind === "text") {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return false;
        ctx.font = `${l.fontSize}px ${l.fontFamily}`;
        const w = ctx.measureText(l.text).width;
        return px >= l.x - w / 2 - pad && px <= l.x + w / 2 + pad && py >= l.y - l.fontSize / 2 - pad && py <= l.y + l.fontSize / 2 + pad;
      }
      const b = sdLayerBounds(l);
      return px >= b.x - pad && px <= b.x + b.w + pad && py >= b.y - pad && py <= b.y + b.h + pad;
    });
    if (layerHit) return { type: "layer", id: layerHit.id };
    const strokeHit = [...strokes].reverse().find((s) => sdHitTestStroke(px, py, s));
    if (strokeHit) return { type: "stroke", id: strokeHit.id };
    return null;
  }

  function handleDrawPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    setPropPopup(null);
    const { px, py } = toCanvasXY(e);
    const inRightBox = px >= SD_RIGHT_X && px <= SD_RIGHT_X + SD_BOX_W && py >= SD_BOX_Y && py <= SD_BOX_Y + SD_BOX_H;

    if (drawTool === "select") {
      if (!inRightBox) { setSelection(null); return; }
      const hit = hitTestAny(px, py);
      setSelection(hit);
      if (hit) {
        const origX = hit.type === "layer" ? (layers.find((l) => l.id === hit.id)?.x ?? px) : (strokes.find((s) => s.id === hit.id)?.points[0]?.x ?? px);
        const origY = hit.type === "layer" ? (layers.find((l) => l.id === hit.id)?.y ?? py) : (strokes.find((s) => s.id === hit.id)?.points[0]?.y ?? py);
        dragRef.current = { startPx: px, startPy: py, origX, origY };
      }
      return;
    }
    if (!inRightBox) return;
    if (drawTool === "bucket") { bucketFillAt(px, py); return; }
    const opacity = drawTool === "brush" ? drawOpacity / 100 : 1;
    const stroke: SdStrokeDraft = { id: sdUid(), color: drawColor, width: drawWidth, opacity, isEraser: drawTool === "eraser", points: [{ x: px, y: py }] };
    currentStrokeRef.current = stroke;
    setStrokes((s) => [...s, stroke]);
  }

  function handleDrawPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const { px, py } = toCanvasXY(e);
    if (drawTool === "select" && dragRef.current && selection) {
      const d = dragRef.current;
      const dx = px - d.startPx, dy = py - d.startPy;
      if (selection.type === "layer") {
        setLayers((ls) => ls.map((l) => (l.id === selection.id ? { ...l, x: d.origX + dx, y: d.origY + dy } : l)));
      } else {
        // 拖动整条笔画——所有点一起平移
        setStrokes((ss) => ss.map((s) => {
          if (s.id !== selection.id) return s;
          if (!s.points.length) return s;
          const baseX = s.points[0].x, baseY = s.points[0].y;
          const shiftX = (d.origX + dx) - baseX, shiftY = (d.origY + dy) - baseY;
          return { ...s, points: s.points.map((p) => ({ x: p.x + shiftX, y: p.y + shiftY })) };
        }));
        dragRef.current = { ...d, startPx: px, startPy: py, origX: d.origX + dx, origY: d.origY + dy };
      }
      return;
    }
    if (!currentStrokeRef.current) return;
    currentStrokeRef.current.points.push({ x: px, y: py });
    setStrokes((s) => [...s.slice(0, -1), { ...currentStrokeRef.current! }]);
  }

  function handlePointerUp() {
    setDragIdx(null);
    currentStrokeRef.current = null;
    dragRef.current = null;
  }

  // 右键：选中被点到的东西（图层或笔画），在鼠标位置弹出属性面板；空白
  // 处右键、或者已经有选中的东西时右键点偏了，也照样弹出（点太准太麻烦）。
  function handleContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (subMode !== "draw") return;
    const { px, py } = toCanvasXY(e);
    const hit = hitTestAny(px, py);
    if (hit) {
      setSelection(hit);
      setPropPopup({ x: e.clientX, y: e.clientY });
    } else if (selection) {
      setPropPopup({ x: e.clientX, y: e.clientY });
    } else {
      setSelection(null);
      setPropPopup(null);
    }
  }

  function addShape(kind: "rect" | "ellipse" | "line") {
    const w = kind === "line" ? 160 : 100, h = kind === "line" ? 4 : 100;
    const newLayer: SdShapeLayer = {
      id: sdUid(), kind: "shape", shape: kind,
      x: SD_RIGHT_X + SD_BOX_W / 2, y: SD_BOX_Y + SD_BOX_H / 2, w, h, rotation: 0,
      fillColor: drawColor, fillEnabled: kind !== "line",
      borderColor: drawColor, borderWidth: 4,
    };
    setLayers((ls) => [...ls, newLayer]);
    setSelection({ type: "layer", id: newLayer.id });
    setDrawTool("select");
  }

  function addObjectFromAsset(dataUrl: string) {
    const newLayer: SdObjectLayer = {
      id: sdUid(), kind: "object", imageUrl: dataUrl,
      x: SD_RIGHT_X + SD_BOX_W / 2, y: SD_BOX_Y + SD_BOX_H / 2, w: 100, h: 100, rotation: 0,
    };
    setLayers((ls) => [...ls, newLayer]);
    setSelection({ type: "layer", id: newLayer.id });
    setDrawTool("select");
  }

  function addText() {
    const newLayer: SdTextLayer = {
      id: sdUid(), kind: "text", text: "文字",
      x: SD_RIGHT_X + SD_BOX_W / 2, y: SD_BOX_Y + SD_BOX_H / 2,
      fontSize: 32, color: drawColor, fontFamily: SD_FONTS[0].value, rotation: 0,
    };
    setLayers((ls) => [...ls, newLayer]);
    setSelection({ type: "layer", id: newLayer.id });
    setDrawTool("select");
  }

  function updateSelectedLayer(patch: SdLayerPatch) {
    if (selection?.type !== "layer") return;
    setLayers((ls) => ls.map((l) => (l.id === selection.id ? ({ ...l, ...patch } as SdLayer) : l)));
  }
  function updateSelectedStroke(patch: Partial<SdStrokeDraft>) {
    if (selection?.type !== "stroke") return;
    setStrokes((ss) => ss.map((s) => (s.id === selection.id ? { ...s, ...patch } : s)));
  }
  function toggleFlipSelected(axis: "x" | "y") {
    if (!selectedLayer || selectedLayer.kind !== "object") return;
    updateSelectedLayer(axis === "x" ? { flipX: !selectedLayer.flipX } : { flipY: !selectedLayer.flipY });
  }
  function rotateSelectedLayer(delta: number) {
    if (!selectedLayer) return;
    updateSelectedLayer({ rotation: (selectedLayer.rotation + delta + 360) % 360 });
  }
  function duplicateSelected() {
    if (selection?.type === "layer" && selectedLayer) {
      const copy = { ...selectedLayer, id: sdUid(), x: selectedLayer.x + 20, y: selectedLayer.y + 20 } as SdLayer;
      setLayers((ls) => [...ls, copy]);
      setSelection({ type: "layer", id: copy.id });
    } else if (selection?.type === "stroke" && selectedStroke) {
      const copy: SdStrokeDraft = { ...selectedStroke, id: sdUid(), points: selectedStroke.points.map((p) => ({ x: p.x + 20, y: p.y + 20 })) };
      setStrokes((ss) => [...ss, copy]);
      setSelection({ type: "stroke", id: copy.id });
    }
  }
  function deleteSelected() {
    if (selection?.type === "layer") setLayers((ls) => ls.filter((l) => l.id !== selection.id));
    else if (selection?.type === "stroke") setStrokes((ss) => ss.filter((s) => s.id !== selection.id));
    setSelection(null);
    setPropPopup(null);
  }
  // 图层顺序——数组里越后面的画在越上面，把选中的图层往前/往后移一位
  // 就是把它跟相邻那个的位置互换。只对物件/文字/形状生效，笔画固定在
  // 最底层。
  function moveLayer(direction: "front" | "back") {
    if (selection?.type !== "layer") return;
    setLayers((ls) => {
      const idx = ls.findIndex((l) => l.id === selection.id);
      if (idx < 0) return ls;
      const targetIdx = direction === "front" ? idx + 1 : idx - 1;
      if (targetIdx < 0 || targetIdx >= ls.length) return ls;
      const next = [...ls];
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      return next;
    });
  }
  function clearDrawing() { setStrokes([]); setLayers([]); setSelection(null); setPropPopup(null); }

  // 把笔画/物件/文字/形状烤进一张新的找不同图——只裁右边那个框的范围，
  // 跟原本图片分辨率一致（用 SD_BOX_W/H 当画布尺寸），传回去更新 imgBUrl。
  function applyDrawingToImgB() {
    if (strokes.length === 0 && layers.length === 0) { clearDrawing(); setSubMode("mark"); return; }
    const off = document.createElement("canvas");
    off.width = SD_BOX_W; off.height = SD_BOX_H;
    const octx = off.getContext("2d");
    if (!octx) return;
    if (imgBRef.current) octx.drawImage(imgBRef.current, 0, 0, SD_BOX_W, SD_BOX_H);
    strokes.forEach((s) => {
      const localStroke: SdStrokeDraft = { ...s, points: s.points.map((p) => ({ x: p.x - SD_RIGHT_X, y: p.y - SD_BOX_Y })) };
      drawStroke(octx, localStroke);
    });
    layers.forEach((l) => drawLayer(octx, l, SD_RIGHT_X, SD_BOX_Y));
    const newUrl = off.toDataURL("image/png");
    const newImg = new Image();
    newImg.onload = () => { imgBRef.current = newImg; redraw(); };
    newImg.src = newUrl;
    onImgBUpdated(newUrl);
    clearDrawing();
    setSubMode("mark");
  }

  const toolBtnCls = (active: boolean) =>
    `px-2 py-1.5 rounded-md text-xs font-medium border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`;

  return (
    <div className="space-y-2 relative">
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => setSubMode("mark")} className={toolBtnCls(subMode === "mark")}>🎯 标记模式</button>
        <button type="button" onClick={() => setSubMode("draw")} className={toolBtnCls(subMode === "draw")}>🎨 画笔模式（在找不同图上做出差异）</button>
      </div>

      {subMode === "draw" && (
        <div className="rounded-lg border border-border bg-muted/40 p-2 flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            <button type="button" onClick={() => setDrawTool("select")} className={toolBtnCls(drawTool === "select")} title="选择/拖动（右键或点⚙️可以改属性，物件/文字/形状/笔画都行）">🖱️</button>
            <button type="button" onClick={() => setDrawTool("pencil")} className={toolBtnCls(drawTool === "pencil")} title="铅笔">✏️</button>
            <button type="button" onClick={() => setDrawTool("brush")} className={toolBtnCls(drawTool === "brush")} title="毛笔">🖌️</button>
            <button type="button" onClick={() => setDrawTool("eraser")} className={toolBtnCls(drawTool === "eraser")} title="橡皮擦">🧽</button>
            <button type="button" onClick={() => setDrawTool("bucket")} className={toolBtnCls(drawTool === "bucket")} title="填色桶">🪣</button>
          </div>
          <div className="flex gap-1 items-center">
            <div title="加物件（从素材库选，或直接上传）"><AssetPicker category="object" label="🧸" onSelect={addObjectFromAsset} /></div>
            <button type="button" onClick={addText} className="px-2 py-1.5 rounded-md text-xs border bg-card border-border text-muted-foreground" title="加文字">🔤</button>
            <button type="button" onClick={() => addShape("rect")} className="px-2 py-1.5 rounded-md text-xs border bg-card border-border text-muted-foreground" title="加方形">⬜</button>
            <button type="button" onClick={() => addShape("ellipse")} className="px-2 py-1.5 rounded-md text-xs border bg-card border-border text-muted-foreground" title="加圆形">⚫</button>
            <button type="button" onClick={() => addShape("line")} className="px-2 py-1.5 rounded-md text-xs border bg-card border-border text-muted-foreground" title="加直线">／</button>
          </div>
          {drawTool !== "select" && drawTool !== "bucket" && (
            <div className="flex items-center gap-1.5">
              {SD_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setDrawColor(c)} className={`w-5 h-5 rounded-full border-2 ${drawColor === c ? "border-primary" : "border-border"}`} style={{ background: c }} />
              ))}
              <input type="color" value={drawColor} onChange={(e) => setDrawColor(e.target.value)} className="w-6 h-6 rounded border border-border cursor-pointer p-0.5" />
              <input type="range" min={2} max={40} value={drawWidth} onChange={(e) => setDrawWidth(+e.target.value)} className="w-16" />
              {drawTool === "brush" && <input type="range" min={10} max={100} value={drawOpacity} onChange={(e) => setDrawOpacity(+e.target.value)} className="w-16" title="不透明度" />}
            </div>
          )}
          {drawTool === "bucket" && (
            <div className="flex items-center gap-1.5">
              {SD_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setDrawColor(c)} className={`w-5 h-5 rounded-full border-2 ${drawColor === c ? "border-primary" : "border-border"}`} style={{ background: c }} />
              ))}
              <input type="color" value={drawColor} onChange={(e) => setDrawColor(e.target.value)} className="w-6 h-6 rounded border border-border cursor-pointer p-0.5" />
            </div>
          )}
          {drawTool === "select" && (
            <span className="text-[11px] text-muted-foreground">拖动改位置；右键点一下（物件/文字/形状/笔画都行）可以改属性</span>
          )}
          {selection && (
            <button
              type="button"
              onClick={() => setPropPopup({ x: 200, y: 200 })}
              className="px-2 py-1.5 rounded-md text-xs border bg-card border-border text-muted-foreground hover:bg-muted"
              title="如果右键没反应，点这个也能打开属性面板"
            >
              ⚙️ 编辑属性
            </button>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {(strokes.length > 0 || layers.length > 0) && (
              <button type="button" onClick={clearDrawing} className="px-2 py-1.5 rounded-md text-xs border border-border text-muted-foreground hover:bg-muted">清空画的东西</button>
            )}
            <Button type="button" size="sm" onClick={applyDrawingToImgB}>✅ 应用到找不同图</Button>
          </div>
        </div>
      )}

      <canvas
        ref={canvasRef} width={SD_W} height={SD_H}
        onPointerDown={subMode === "mark" ? handleMarkPointerDown : handleDrawPointerDown}
        onPointerMove={subMode === "mark" ? handleMarkPointerMove : handleDrawPointerMove}
        onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
        onContextMenu={handleContextMenu}
        style={{ touchAction: "none" }}
        className="w-full h-auto rounded-lg bg-card cursor-crosshair border border-border"
      />
      {subMode === "draw" && layers.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-2">
          <p className="text-[11px] text-muted-foreground mb-1.5">图层（由上到下：最上面的盖在最下面上面，点一下可以选中）</p>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {[...layers].reverse().map((l) => (
              <div
                key={l.id}
                onClick={() => setSelection({ type: "layer", id: l.id })}
                className={`flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer ${selection?.type === "layer" && selection.id === l.id ? "bg-primary/10 border border-primary/40" : "hover:bg-muted"}`}
              >
                <span>{l.kind === "object" ? "🧸" : l.kind === "text" ? "🔤" : "▦"}</span>
                <span className="flex-1 truncate">{l.kind === "text" ? l.text : l.kind === "shape" ? `${l.shape}形状` : "物件图片"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {subMode === "mark" && (
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className="text-muted-foreground">已标记 {hotspots.length} 处——点空白处新增标记，点已有标记可以拖动改位置</span>
          {selectedIdx !== null && hotspots[selectedIdx] && (
            <>
              <button type="button" onClick={() => resizeSelected(-0.01)} className="px-2 py-1 rounded border border-border hover:bg-muted">－ 缩小判定范围</button>
              <button type="button" onClick={() => resizeSelected(0.01)} className="px-2 py-1 rounded border border-border hover:bg-muted">＋ 放大判定范围</button>
              <button type="button" onClick={removeSelected} className="px-2 py-1 rounded border border-border text-destructive hover:bg-destructive/10">删除这个标记</button>
            </>
          )}
        </div>
      )}

      {/* 右键属性面板——背后一层透明遮罩，点面板外面就关掉 */}
      {propPopup && (selectedLayer || selectedStroke) && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPropPopup(null)} onContextMenu={(e) => { e.preventDefault(); setPropPopup(null); }} />
          <div
            className="fixed z-50 bg-card border border-border rounded-xl shadow-xl p-3 space-y-2.5 text-xs w-64"
            style={{ left: Math.min(propPopup.x, window.innerWidth - 270), top: Math.min(propPopup.y, window.innerHeight - 340) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">
                {selectedLayer?.kind === "object" ? "🧸 物件属性" : selectedLayer?.kind === "text" ? "🔤 文字属性" : selectedLayer?.kind === "shape" ? "▦ 形状属性" : "✏️ 笔画属性"}
              </span>
              <button type="button" onClick={() => setPropPopup(null)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            {selectedLayer && selectedLayer.kind !== "text" && (
              <div>
                <Label>大小</Label>
                <input
                  type="range" min={20} max={SD_BOX_W} value={selectedLayer.w}
                  onChange={(e) => {
                    const w = +e.target.value;
                    const ratio = selectedLayer.h / selectedLayer.w;
                    updateSelectedLayer({ w, h: selectedLayer.kind === "shape" && selectedLayer.shape === "line" ? selectedLayer.h : Math.round(w * ratio) });
                  }}
                  className="w-full"
                />
              </div>
            )}

            {selectedLayer?.kind === "text" && (
              <>
                <div>
                  <Label>文字内容</Label>
                  <Input value={selectedLayer.text} onChange={(e) => updateSelectedLayer({ text: e.target.value })} className="h-8" />
                </div>
                <div>
                  <Label>字体</Label>
                  <select
                    value={selectedLayer.fontFamily}
                    onChange={(e) => updateSelectedLayer({ fontFamily: e.target.value })}
                    className="w-full border rounded-md px-2 py-1.5 text-xs"
                  >
                    {SD_FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
                <div>
                  <Label>字号：{selectedLayer.fontSize}px</Label>
                  <input type="range" min={12} max={120} value={selectedLayer.fontSize} onChange={(e) => updateSelectedLayer({ fontSize: +e.target.value })} className="w-full" />
                </div>
              </>
            )}

            {(selectedLayer?.kind === "text" || selectedLayer?.kind === "shape") && (
              <div>
                <Label>{selectedLayer.kind === "shape" && selectedLayer.shape === "line" ? "线条颜色" : selectedLayer.kind === "shape" ? "填充颜色" : "颜色"}</Label>
                <div className="flex items-center gap-1.5 mt-1">
                  {SD_COLORS.map((c) => (
                    <button
                      key={c} type="button"
                      onClick={() => updateSelectedLayer(selectedLayer.kind === "shape" && selectedLayer.shape === "line" ? { borderColor: c } : selectedLayer.kind === "shape" ? { fillColor: c, fillEnabled: true } : { color: c })}
                      className="w-5 h-5 rounded-full border-2 border-border"
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            )}

            {selectedLayer?.kind === "shape" && (
              <div>
                <Label>边框粗细：{selectedLayer.borderWidth}px</Label>
                <input type="range" min={0} max={20} value={selectedLayer.borderWidth} onChange={(e) => updateSelectedLayer({ borderWidth: +e.target.value })} className="w-full" />
              </div>
            )}

            {selectedLayer && (
              <div>
                <Label>不透明度：{Math.round((selectedLayer.opacity ?? 1) * 100)}%</Label>
                <input type="range" min={10} max={100} value={Math.round((selectedLayer.opacity ?? 1) * 100)} onChange={(e) => updateSelectedLayer({ opacity: +e.target.value / 100 })} className="w-full" />
              </div>
            )}

            {selectedStroke && (
              <>
                <div>
                  <Label>粗细：{selectedStroke.width}px</Label>
                  <input type="range" min={2} max={40} value={selectedStroke.width} onChange={(e) => updateSelectedStroke({ width: +e.target.value })} className="w-full" />
                </div>
                {!selectedStroke.isEraser && (
                  <>
                    <div>
                      <Label>颜色</Label>
                      <div className="flex items-center gap-1.5 mt-1">
                        {SD_COLORS.map((c) => (
                          <button key={c} type="button" onClick={() => updateSelectedStroke({ color: c })} className="w-5 h-5 rounded-full border-2 border-border" style={{ background: c }} />
                        ))}
                        <input type="color" value={selectedStroke.color} onChange={(e) => updateSelectedStroke({ color: e.target.value })} className="w-6 h-6 rounded border border-border cursor-pointer p-0.5" />
                      </div>
                    </div>
                    <div>
                      <Label>不透明度：{Math.round((selectedStroke.opacity ?? 1) * 100)}%</Label>
                      <input type="range" min={10} max={100} value={Math.round((selectedStroke.opacity ?? 1) * 100)} onChange={(e) => updateSelectedStroke({ opacity: +e.target.value / 100 })} className="w-full" />
                    </div>
                  </>
                )}
              </>
            )}

            <div className="flex items-center gap-1 pt-2 border-t border-border">
              {selectedLayer?.kind === "object" && (
                <>
                  <button type="button" onClick={() => toggleFlipSelected("x")} className={toolBtnCls(!!selectedLayer.flipX)} title="水平翻转">↔️</button>
                  <button type="button" onClick={() => toggleFlipSelected("y")} className={toolBtnCls(!!selectedLayer.flipY)} title="垂直翻转">↕️</button>
                </>
              )}
              {selectedLayer && (
                <>
                  <button type="button" onClick={() => rotateSelectedLayer(-90)} className="px-2 py-1 rounded border border-border hover:bg-muted" title="逆时针转90°">↺</button>
                  <button type="button" onClick={() => rotateSelectedLayer(90)} className="px-2 py-1 rounded border border-border hover:bg-muted" title="顺时针转90°">↻</button>
                </>
              )}
              {selectedLayer && (
                <>
                  <button type="button" onClick={() => moveLayer("front")} className="px-2 py-1 rounded border border-border hover:bg-muted text-xs" title="上移一层">⬆️层</button>
                  <button type="button" onClick={() => moveLayer("back")} className="px-2 py-1 rounded border border-border hover:bg-muted text-xs" title="下移一层">⬇️层</button>
                </>
              )}
              <button type="button" onClick={duplicateSelected} className="px-2 py-1 rounded border border-border hover:bg-muted" title="复制">📋</button>
              <button type="button" onClick={deleteSelected} className="ml-auto px-2 py-1 rounded border border-border text-destructive hover:bg-destructive/10">删除</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


// 迷宫的"装饰模式"——在迷宫背景图上加纯装饰性的文字/图案/画笔涂鸦，不
// 影响能不能走（走不走得通只看画路径模式里那张蒙版，蒙版和这里的装饰
// 完全是两张不同的东西）。工具跟找不同之处的"画笔模式"是同一套（复用
// 同样的 SdLayer/SdStrokeDraft 类型和 sdXxx 辅助函数），差别只是这里画
// 布是整张图，没有找不同之处那种"两个框"的限制。做完点"应用到背景图"，
// 会把装饰烤进一张新的背景图里，通过 onBgUpdated 传回去。
function MazeDecorator({ bgUrl, onBgUpdated }: { bgUrl: string; onBgUpdated: (dataUrl: string) => void }) {
  const MD_W = GAME_CANVAS_W, MD_H = GAME_CANVAS_H;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const layerImgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [, forceTick] = useState(0);

  const [drawTool, setDrawTool] = useState<"pencil" | "brush" | "eraser" | "bucket" | "select">("pencil");
  const [drawColor, setDrawColor] = useState("#e8a33d");
  const [drawWidth, setDrawWidth] = useState(6);
  const [drawOpacity, setDrawOpacity] = useState(100);
  const [strokes, setStrokes] = useState<SdStrokeDraft[]>([]);
  const [layers, setLayers] = useState<SdLayer[]>([]);
  const [selection, setSelection] = useState<SdSelection>(null);
  const dragRef = useRef<{ startPx: number; startPy: number; origX: number; origY: number } | null>(null);
  const currentStrokeRef = useRef<SdStrokeDraft | null>(null);
  const [propPopup, setPropPopup] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { bgImgRef.current = img; redraw(); };
    img.src = bgUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgUrl]);

  useEffect(() => {
    layers.forEach((l) => {
      if (l.kind !== "object") return;
      if (layerImgCacheRef.current.has(l.imageUrl)) return;
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => forceTick((n) => n + 1);
      img.src = l.imageUrl;
      layerImgCacheRef.current.set(l.imageUrl, img);
    });
  }, [layers]);

  const selectedLayer = selection?.type === "layer" ? layers.find((l) => l.id === selection.id) ?? null : null;
  const selectedStroke = selection?.type === "stroke" ? strokes.find((s) => s.id === selection.id) ?? null : null;

  function drawLayer(ctx: CanvasRenderingContext2D, l: SdLayer) {
    if (l.kind === "text") {
      ctx.save();
      ctx.globalAlpha = l.opacity ?? 1;
      ctx.translate(l.x, l.y); ctx.rotate((l.rotation * Math.PI) / 180); ctx.translate(-l.x, -l.y);
      ctx.font = `${l.fontSize}px ${l.fontFamily}`;
      ctx.fillStyle = l.color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(l.text, l.x, l.y);
      ctx.restore();
      return;
    }
    const b = sdLayerBounds(l);
    ctx.save();
    ctx.globalAlpha = l.opacity ?? 1;
    ctx.translate(l.x, l.y); ctx.rotate((l.rotation * Math.PI) / 180); ctx.translate(-l.x, -l.y);
    if (l.kind === "object") {
      const img = layerImgCacheRef.current.get(l.imageUrl);
      if (img?.complete) {
        const fx = l.flipX ? -1 : 1, fy = l.flipY ? -1 : 1;
        if (fx !== 1 || fy !== 1) {
          ctx.save();
          ctx.translate(l.x, l.y); ctx.scale(fx, fy); ctx.translate(-l.x, -l.y);
          ctx.drawImage(img, b.x, b.y, b.w, b.h);
          ctx.restore();
        } else {
          ctx.drawImage(img, b.x, b.y, b.w, b.h);
        }
      }
    } else if (l.kind === "shape") {
      if (l.shape === "line") {
        ctx.beginPath(); ctx.moveTo(b.x, l.y); ctx.lineTo(b.x + b.w, l.y);
        ctx.lineCap = "round"; ctx.strokeStyle = l.borderColor; ctx.lineWidth = Math.max(1, l.borderWidth); ctx.stroke();
      } else {
        ctx.beginPath();
        if (l.shape === "ellipse") ctx.ellipse(l.x, l.y, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
        else ctx.rect(b.x, b.y, b.w, b.h);
        if (l.fillEnabled) { ctx.fillStyle = l.fillColor; ctx.fill(); }
        if (l.borderWidth > 0) { ctx.strokeStyle = l.borderColor; ctx.lineWidth = l.borderWidth; ctx.stroke(); }
      }
    }
    ctx.restore();
  }

  function drawStroke(ctx: CanvasRenderingContext2D, s: SdStrokeDraft) {
    ctx.save();
    ctx.globalAlpha = s.opacity ?? 1;
    ctx.globalCompositeOperation = s.isEraser ? "destination-out" : "source-over";
    ctx.beginPath();
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
    s.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.restore();
  }

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, MD_W, MD_H);
    if (bgImgRef.current) ctx.drawImage(bgImgRef.current, 0, 0, MD_W, MD_H);

    strokes.forEach((s) => {
      drawStroke(ctx, s);
      if (selection?.type === "stroke" && selection.id === s.id) {
        const b = sdStrokeBounds(s);
        ctx.save(); ctx.strokeStyle = "#5b8def"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
        ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8); ctx.setLineDash([]); ctx.restore();
      }
    });
    layers.forEach((l) => {
      drawLayer(ctx, l);
      if (selection?.type === "layer" && selection.id === l.id) {
        const b = l.kind === "text" ? { x: l.x - 40, y: l.y - l.fontSize / 2, w: 80, h: l.fontSize } : sdLayerBounds(l);
        ctx.save(); ctx.strokeStyle = "#5b8def"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
        ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8); ctx.setLineDash([]); ctx.restore();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, layers, selection]);

  useEffect(redraw, [redraw]);

  function toCanvasXY(e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = MD_W / rect.width, scaleY = MD_H / rect.height;
    return { px: (e.clientX - rect.left) * scaleX, py: (e.clientY - rect.top) * scaleY };
  }

  function bucketFillAt(px: number, py: number) {
    const octx = document.createElement("canvas").getContext("2d")!;
    const off = octx.canvas; off.width = MD_W; off.height = MD_H;
    if (bgImgRef.current) octx.drawImage(bgImgRef.current, 0, 0, MD_W, MD_H);
    const imageData = octx.getImageData(0, 0, MD_W, MD_H);
    sdFloodFill(imageData, Math.round(px), Math.round(py), sdHexToRgb(drawColor), 32);
    octx.putImageData(imageData, 0, 0);
    const newUrl = off.toDataURL("image/png");
    const newImg = new Image(); newImg.crossOrigin = "anonymous";
    newImg.onload = () => { bgImgRef.current = newImg; redraw(); };
    newImg.src = newUrl;
    onBgUpdated(newUrl);
  }

  function hitTestAny(px: number, py: number): SdSelection {
    const pad = 10;
    const layerHit = [...layers].reverse().find((l) => {
      if (l.kind === "text") {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return false;
        ctx.font = `${l.fontSize}px ${l.fontFamily}`;
        const w = ctx.measureText(l.text).width;
        return px >= l.x - w / 2 - pad && px <= l.x + w / 2 + pad && py >= l.y - l.fontSize / 2 - pad && py <= l.y + l.fontSize / 2 + pad;
      }
      const b = sdLayerBounds(l);
      return px >= b.x - pad && px <= b.x + b.w + pad && py >= b.y - pad && py <= b.y + b.h + pad;
    });
    if (layerHit) return { type: "layer", id: layerHit.id };
    const strokeHit = [...strokes].reverse().find((s) => sdHitTestStroke(px, py, s));
    if (strokeHit) return { type: "stroke", id: strokeHit.id };
    return null;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    setPropPopup(null);
    const { px, py } = toCanvasXY(e);
    if (drawTool === "select") {
      const hit = hitTestAny(px, py);
      setSelection(hit);
      if (hit) {
        const origX = hit.type === "layer" ? (layers.find((l) => l.id === hit.id)?.x ?? px) : (strokes.find((s) => s.id === hit.id)?.points[0]?.x ?? px);
        const origY = hit.type === "layer" ? (layers.find((l) => l.id === hit.id)?.y ?? py) : (strokes.find((s) => s.id === hit.id)?.points[0]?.y ?? py);
        dragRef.current = { startPx: px, startPy: py, origX, origY };
      }
      return;
    }
    if (drawTool === "bucket") { bucketFillAt(px, py); return; }
    const opacity = drawTool === "brush" ? drawOpacity / 100 : 1;
    const stroke: SdStrokeDraft = { id: sdUid(), color: drawColor, width: drawWidth, opacity, isEraser: drawTool === "eraser", points: [{ x: px, y: py }] };
    currentStrokeRef.current = stroke;
    setStrokes((s) => [...s, stroke]);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const { px, py } = toCanvasXY(e);
    if (drawTool === "select" && dragRef.current && selection) {
      const d = dragRef.current;
      const dx = px - d.startPx, dy = py - d.startPy;
      if (selection.type === "layer") {
        setLayers((ls) => ls.map((l) => (l.id === selection.id ? { ...l, x: d.origX + dx, y: d.origY + dy } : l)));
      } else {
        setStrokes((ss) => ss.map((s) => {
          if (s.id !== selection.id) return s;
          if (!s.points.length) return s;
          const baseX = s.points[0].x, baseY = s.points[0].y;
          const shiftX = (d.origX + dx) - baseX, shiftY = (d.origY + dy) - baseY;
          return { ...s, points: s.points.map((p) => ({ x: p.x + shiftX, y: p.y + shiftY })) };
        }));
        dragRef.current = { ...d, startPx: px, startPy: py, origX: d.origX + dx, origY: d.origY + dy };
      }
      return;
    }
    if (!currentStrokeRef.current) return;
    currentStrokeRef.current.points.push({ x: px, y: py });
    setStrokes((s) => [...s.slice(0, -1), { ...currentStrokeRef.current! }]);
  }

  function handlePointerUp() { currentStrokeRef.current = null; dragRef.current = null; }

  function handleContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const { px, py } = toCanvasXY(e);
    const hit = hitTestAny(px, py);
    if (hit) { setSelection(hit); setPropPopup({ x: e.clientX, y: e.clientY }); }
    else if (selection) { setPropPopup({ x: e.clientX, y: e.clientY }); }
    else { setSelection(null); setPropPopup(null); }
  }

  function addShape(kind: "rect" | "ellipse" | "line") {
    const w = kind === "line" ? 160 : 100, h = kind === "line" ? 4 : 100;
    const newLayer: SdShapeLayer = {
      id: sdUid(), kind: "shape", shape: kind,
      x: MD_W / 2, y: MD_H / 2, w, h, rotation: 0,
      fillColor: drawColor, fillEnabled: kind !== "line", borderColor: drawColor, borderWidth: 4,
    };
    setLayers((ls) => [...ls, newLayer]); setSelection({ type: "layer", id: newLayer.id }); setDrawTool("select");
  }
  function addObjectFromAsset(dataUrl: string) {
    const newLayer: SdObjectLayer = { id: sdUid(), kind: "object", imageUrl: dataUrl, x: MD_W / 2, y: MD_H / 2, w: 100, h: 100, rotation: 0 };
    setLayers((ls) => [...ls, newLayer]); setSelection({ type: "layer", id: newLayer.id }); setDrawTool("select");
  }
  function addText() {
    const newLayer: SdTextLayer = { id: sdUid(), kind: "text", text: "文字", x: MD_W / 2, y: MD_H / 2, fontSize: 32, color: drawColor, fontFamily: SD_FONTS[0].value, rotation: 0 };
    setLayers((ls) => [...ls, newLayer]); setSelection({ type: "layer", id: newLayer.id }); setDrawTool("select");
  }
  function updateSelectedLayer(patch: SdLayerPatch) {
    if (selection?.type !== "layer") return;
    setLayers((ls) => ls.map((l) => (l.id === selection.id ? ({ ...l, ...patch } as SdLayer) : l)));
  }
  function updateSelectedStroke(patch: Partial<SdStrokeDraft>) {
    if (selection?.type !== "stroke") return;
    setStrokes((ss) => ss.map((s) => (s.id === selection.id ? { ...s, ...patch } : s)));
  }
  function toggleFlipSelected(axis: "x" | "y") {
    if (!selectedLayer || selectedLayer.kind !== "object") return;
    updateSelectedLayer(axis === "x" ? { flipX: !selectedLayer.flipX } : { flipY: !selectedLayer.flipY });
  }
  function rotateSelectedLayer(delta: number) {
    if (!selectedLayer) return;
    updateSelectedLayer({ rotation: (selectedLayer.rotation + delta + 360) % 360 });
  }
  function duplicateSelected() {
    if (selection?.type === "layer" && selectedLayer) {
      const copy = { ...selectedLayer, id: sdUid(), x: selectedLayer.x + 20, y: selectedLayer.y + 20 } as SdLayer;
      setLayers((ls) => [...ls, copy]); setSelection({ type: "layer", id: copy.id });
    } else if (selection?.type === "stroke" && selectedStroke) {
      const copy: SdStrokeDraft = { ...selectedStroke, id: sdUid(), points: selectedStroke.points.map((p) => ({ x: p.x + 20, y: p.y + 20 })) };
      setStrokes((ss) => [...ss, copy]); setSelection({ type: "stroke", id: copy.id });
    }
  }
  function deleteSelected() {
    if (selection?.type === "layer") setLayers((ls) => ls.filter((l) => l.id !== selection.id));
    else if (selection?.type === "stroke") setStrokes((ss) => ss.filter((s) => s.id !== selection.id));
    setSelection(null); setPropPopup(null);
  }
  // 图层顺序——数组里越后面的画在越上面（跟画布"后画的盖住先画的"是
  // 同一个道理），把选中的图层往前/往后移一位，就是把它跟数组里相邻那
  // 个的位置互换。只对物件/文字/形状生效（strokes 笔画目前固定画在最
  // 底层，不参与图层排序，这个简化跟 SceneEditor 那边不完全一样，但对
  // "装饰"这种轻量场景够用）。
  function moveLayer(direction: "front" | "back") {
    if (selection?.type !== "layer") return;
    setLayers((ls) => {
      const idx = ls.findIndex((l) => l.id === selection.id);
      if (idx < 0) return ls;
      const targetIdx = direction === "front" ? idx + 1 : idx - 1;
      if (targetIdx < 0 || targetIdx >= ls.length) return ls;
      const next = [...ls];
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      return next;
    });
  }
  function clearDrawing() { setStrokes([]); setLayers([]); setSelection(null); setPropPopup(null); }

  function applyDecorations() {
    if (strokes.length === 0 && layers.length === 0) return;
    const off = document.createElement("canvas");
    off.width = MD_W; off.height = MD_H;
    const octx = off.getContext("2d")!;
    if (bgImgRef.current) octx.drawImage(bgImgRef.current, 0, 0, MD_W, MD_H);
    strokes.forEach((s) => drawStroke(octx, s));
    layers.forEach((l) => drawLayer(octx, l));
    const newUrl = off.toDataURL("image/png");
    const newImg = new Image(); newImg.crossOrigin = "anonymous";
    newImg.onload = () => { bgImgRef.current = newImg; redraw(); };
    newImg.src = newUrl;
    onBgUpdated(newUrl);
    clearDrawing();
  }

  const toolBtnCls = (active: boolean) =>
    `px-2 py-1.5 rounded-md text-xs font-medium border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`;

  return (
    <div className="space-y-2 relative">
      <div className="rounded-lg border border-border bg-muted/40 p-2 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <button type="button" onClick={() => setDrawTool("select")} className={toolBtnCls(drawTool === "select")} title="选择/拖动（右键可以改属性）">🖱️</button>
          <button type="button" onClick={() => setDrawTool("pencil")} className={toolBtnCls(drawTool === "pencil")} title="铅笔">✏️</button>
          <button type="button" onClick={() => setDrawTool("brush")} className={toolBtnCls(drawTool === "brush")} title="毛笔">🖌️</button>
          <button type="button" onClick={() => setDrawTool("eraser")} className={toolBtnCls(drawTool === "eraser")} title="橡皮擦">🧽</button>
          <button type="button" onClick={() => setDrawTool("bucket")} className={toolBtnCls(drawTool === "bucket")} title="填色桶">🪣</button>
        </div>
        <div className="flex gap-1 items-center">
          <div title="加物件"><AssetPicker category="object" label="🧸" onSelect={addObjectFromAsset} /></div>
          <button type="button" onClick={addText} className="px-2 py-1.5 rounded-md text-xs border bg-card border-border text-muted-foreground" title="加文字">🔤</button>
          <button type="button" onClick={() => addShape("rect")} className="px-2 py-1.5 rounded-md text-xs border bg-card border-border text-muted-foreground" title="加方形">⬜</button>
          <button type="button" onClick={() => addShape("ellipse")} className="px-2 py-1.5 rounded-md text-xs border bg-card border-border text-muted-foreground" title="加圆形">⚫</button>
          <button type="button" onClick={() => addShape("line")} className="px-2 py-1.5 rounded-md text-xs border bg-card border-border text-muted-foreground" title="加直线">／</button>
        </div>
        {drawTool !== "select" && drawTool !== "bucket" && (
          <div className="flex items-center gap-1.5">
            {SD_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setDrawColor(c)} className={`w-5 h-5 rounded-full border-2 ${drawColor === c ? "border-primary" : "border-border"}`} style={{ background: c }} />
            ))}
            <input type="color" value={drawColor} onChange={(e) => setDrawColor(e.target.value)} className="w-6 h-6 rounded border border-border cursor-pointer p-0.5" />
            <input type="range" min={2} max={40} value={drawWidth} onChange={(e) => setDrawWidth(+e.target.value)} className="w-16" />
            {drawTool === "brush" && <input type="range" min={10} max={100} value={drawOpacity} onChange={(e) => setDrawOpacity(+e.target.value)} className="w-16" title="不透明度" />}
          </div>
        )}
        {drawTool === "bucket" && (
          <div className="flex items-center gap-1.5">
            {SD_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setDrawColor(c)} className={`w-5 h-5 rounded-full border-2 ${drawColor === c ? "border-primary" : "border-border"}`} style={{ background: c }} />
            ))}
            <input type="color" value={drawColor} onChange={(e) => setDrawColor(e.target.value)} className="w-6 h-6 rounded border border-border cursor-pointer p-0.5" />
          </div>
        )}
        {selection && (
          <button type="button" onClick={() => setPropPopup({ x: 200, y: 200 })} className="px-2 py-1.5 rounded-md text-xs border bg-card border-border text-muted-foreground hover:bg-muted" title="右键没反应时点这个">⚙️ 编辑属性</button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {(strokes.length > 0 || layers.length > 0) && (
            <>
              <button type="button" onClick={clearDrawing} className="px-2 py-1.5 rounded-md text-xs border border-border text-muted-foreground hover:bg-muted">清空</button>
              <Button type="button" size="sm" onClick={applyDecorations}>✅ 应用到背景图</Button>
            </>
          )}
        </div>
      </div>

      <canvas
        ref={canvasRef} width={MD_W} height={MD_H}
        onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
        onContextMenu={handleContextMenu}
        style={{ touchAction: "none" }}
        className="w-full h-auto rounded-lg bg-card cursor-crosshair border border-border"
      />
      {layers.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-2">
          <p className="text-[11px] text-muted-foreground mb-1.5">图层（由上到下：最上面的盖在最下面上面，点一下可以选中）</p>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {[...layers].reverse().map((l) => (
              <div
                key={l.id}
                onClick={() => setSelection({ type: "layer", id: l.id })}
                className={`flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer ${selection?.type === "layer" && selection.id === l.id ? "bg-primary/10 border border-primary/40" : "hover:bg-muted"}`}
              >
                <span>{l.kind === "object" ? "🧸" : l.kind === "text" ? "🔤" : "▦"}</span>
                <span className="flex-1 truncate">{l.kind === "text" ? l.text : l.kind === "shape" ? `${l.shape}形状` : "物件图片"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">这里加的东西纯装饰，不影响走不走得通；走不走得通只看"画路径模式"那张蒙版。画完记得点"✅ 应用到背景图"才会真的存进去。</p>

      {propPopup && (selectedLayer || selectedStroke) && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPropPopup(null)} onContextMenu={(e) => { e.preventDefault(); setPropPopup(null); }} />
          <div
            className="fixed z-50 bg-card border border-border rounded-xl shadow-xl p-3 space-y-2.5 text-xs w-64"
            style={{ left: Math.min(propPopup.x, window.innerWidth - 270), top: Math.min(propPopup.y, window.innerHeight - 340) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">
                {selectedLayer?.kind === "object" ? "🧸 物件属性" : selectedLayer?.kind === "text" ? "🔤 文字属性" : selectedLayer?.kind === "shape" ? "▦ 形状属性" : "✏️ 笔画属性"}
              </span>
              <button type="button" onClick={() => setPropPopup(null)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            {selectedLayer && selectedLayer.kind !== "text" && (
              <div>
                <Label>大小</Label>
                <input
                  type="range" min={20} max={MD_W} value={selectedLayer.w}
                  onChange={(e) => {
                    const w = +e.target.value;
                    const ratio = selectedLayer.h / selectedLayer.w;
                    updateSelectedLayer({ w, h: selectedLayer.kind === "shape" && selectedLayer.shape === "line" ? selectedLayer.h : Math.round(w * ratio) });
                  }}
                  className="w-full"
                />
              </div>
            )}

            {selectedLayer?.kind === "text" && (
              <>
                <div><Label>文字内容</Label><Input value={selectedLayer.text} onChange={(e) => updateSelectedLayer({ text: e.target.value })} className="h-8" /></div>
                <div>
                  <Label>字体</Label>
                  <select value={selectedLayer.fontFamily} onChange={(e) => updateSelectedLayer({ fontFamily: e.target.value })} className="w-full border rounded-md px-2 py-1.5 text-xs">
                    {SD_FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
                <div>
                  <Label>字号：{selectedLayer.fontSize}px</Label>
                  <input type="range" min={12} max={120} value={selectedLayer.fontSize} onChange={(e) => updateSelectedLayer({ fontSize: +e.target.value })} className="w-full" />
                </div>
              </>
            )}

            {(selectedLayer?.kind === "text" || selectedLayer?.kind === "shape") && (
              <div>
                <Label>{selectedLayer.kind === "shape" && selectedLayer.shape === "line" ? "线条颜色" : selectedLayer.kind === "shape" ? "填充颜色" : "颜色"}</Label>
                <div className="flex items-center gap-1.5 mt-1">
                  {SD_COLORS.map((c) => (
                    <button
                      key={c} type="button"
                      onClick={() => updateSelectedLayer(selectedLayer.kind === "shape" && selectedLayer.shape === "line" ? { borderColor: c } : selectedLayer.kind === "shape" ? { fillColor: c, fillEnabled: true } : { color: c })}
                      className="w-5 h-5 rounded-full border-2 border-border" style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            )}

            {selectedLayer?.kind === "shape" && (
              <div>
                <Label>边框粗细：{selectedLayer.borderWidth}px</Label>
                <input type="range" min={0} max={20} value={selectedLayer.borderWidth} onChange={(e) => updateSelectedLayer({ borderWidth: +e.target.value })} className="w-full" />
              </div>
            )}

            {selectedLayer && (
              <div>
                <Label>不透明度：{Math.round((selectedLayer.opacity ?? 1) * 100)}%</Label>
                <input type="range" min={10} max={100} value={Math.round((selectedLayer.opacity ?? 1) * 100)} onChange={(e) => updateSelectedLayer({ opacity: +e.target.value / 100 })} className="w-full" />
              </div>
            )}

            {selectedStroke && (
              <>
                <div>
                  <Label>粗细：{selectedStroke.width}px</Label>
                  <input type="range" min={2} max={40} value={selectedStroke.width} onChange={(e) => updateSelectedStroke({ width: +e.target.value })} className="w-full" />
                </div>
                {!selectedStroke.isEraser && (
                  <>
                    <div>
                      <Label>颜色</Label>
                      <div className="flex items-center gap-1.5 mt-1">
                        {SD_COLORS.map((c) => (
                          <button key={c} type="button" onClick={() => updateSelectedStroke({ color: c })} className="w-5 h-5 rounded-full border-2 border-border" style={{ background: c }} />
                        ))}
                        <input type="color" value={selectedStroke.color} onChange={(e) => updateSelectedStroke({ color: e.target.value })} className="w-6 h-6 rounded border border-border cursor-pointer p-0.5" />
                      </div>
                    </div>
                    <div>
                      <Label>不透明度：{Math.round((selectedStroke.opacity ?? 1) * 100)}%</Label>
                      <input type="range" min={10} max={100} value={Math.round((selectedStroke.opacity ?? 1) * 100)} onChange={(e) => updateSelectedStroke({ opacity: +e.target.value / 100 })} className="w-full" />
                    </div>
                  </>
                )}
              </>
            )}

            <div className="flex items-center gap-1 pt-2 border-t border-border">
              {selectedLayer?.kind === "object" && (
                <>
                  <button type="button" onClick={() => toggleFlipSelected("x")} className={toolBtnCls(!!selectedLayer.flipX)} title="水平翻转">↔️</button>
                  <button type="button" onClick={() => toggleFlipSelected("y")} className={toolBtnCls(!!selectedLayer.flipY)} title="垂直翻转">↕️</button>
                </>
              )}
              {selectedLayer && (
                <>
                  <button type="button" onClick={() => rotateSelectedLayer(-90)} className="px-2 py-1 rounded border border-border hover:bg-muted" title="逆时针转90°">↺</button>
                  <button type="button" onClick={() => rotateSelectedLayer(90)} className="px-2 py-1 rounded border border-border hover:bg-muted" title="顺时针转90°">↻</button>
                </>
              )}
              {selectedLayer && (
                <>
                  <button type="button" onClick={() => moveLayer("front")} className="px-2 py-1 rounded border border-border hover:bg-muted text-xs" title="上移一层">⬆️层</button>
                  <button type="button" onClick={() => moveLayer("back")} className="px-2 py-1 rounded border border-border hover:bg-muted text-xs" title="下移一层">⬇️层</button>
                </>
              )}
              <button type="button" onClick={duplicateSelected} className="px-2 py-1 rounded border border-border hover:bg-muted" title="复制">📋</button>
              <button type="button" onClick={deleteSelected} className="ml-auto px-2 py-1 rounded border border-border text-destructive hover:bg-destructive/10">删除</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


// focus_tap 自定义场景现在跟 counting 用同一套 SceneEditor structuredMode
// 编辑体验（拖物件、缩放、旋转、复制、图层排序，全部都有），不再是原本
// 那个只能点一下加一个点、没法拖动调整的简易画布。旧资料（只有 x,y，
// 没有 image_url）加载进编辑器时，用这个占位图标当每个位置的可视标记——
// 玩游戏的时候学生看到的是数字按钮，不是这个图标，这个纯粹是设计时方便
// 看清楚"数字会出现在哪"用的。
const FT_MARKER_ICON = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#e8a33d" stroke="#ffffff" stroke-width="8"/></svg>'
);

// Memory配对"自由摆放"第一次打开时，把已经加好的配对图片（每张各出现
// 两次）自动排成一排整整齐齐摆进画布——用的是设计师自己选的真实图片，
// 不是占位符，这样一进去就能直接拖动调整位置，不用再重新一个个从素材
// 库加。之后如果重新编辑已经摆好的场景，就不会再用这个函数（用回存好
// 的实际位置）。
function buildInitialMemoryPositions(icons: string[]): StructuredSceneOutput["objects"] {
  const deck = [...icons, ...icons];
  if (deck.length === 0) return [];
  const margin = 90;
  const cols = Math.ceil(Math.sqrt(deck.length));
  const rows = Math.ceil(deck.length / cols);
  const usableW = GAME_CANVAS_W - margin * 2, usableH = GAME_CANVAS_H - margin * 2;
  return deck.map((url, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = margin + (col + 0.5) * (usableW / cols);
    const y = margin + (row + 0.5) * (usableH / rows);
    return { imageUrl: url, x, y, w: 80, h: 80, rotation: 0 };
  });
}


interface SudokuCellDraft { x: number; y: number; answer: string }

// ── 填色游戏设计器：选中一个区块，用它专属的标记色把形状画出来 ──────────────────
// 跟迷宫的画笔工具同一个技巧（画布 + 笔刷），差别是迷宫只有一种"可以走/
// 不能走"，这里要支持好几个区块，每个区块用自己独一无二的标记色在
// mask画布上画出形状，播放时用点击位置的像素颜色去比对是点到了哪个区块。
interface ColoringRegionDraft { marker_color: string; rule: "specific" | "free"; target_color?: string; label?: string }
const REGION_COLOR_POOL = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff", "#ff8800", "#8800ff", "#00ff88", "#ff0088"];

function ColoringRegionDesigner({ bgUrl, setBgUrl, regions, setRegions, maskDataUrl, setMaskDataUrl }: {
  bgUrl: string | null; setBgUrl: (u: string) => void;
  regions: ColoringRegionDraft[]; setRegions: (r: ColoringRegionDraft[]) => void;
  maskDataUrl: string | null; setMaskDataUrl: (u: string | null) => void;
}) {
  const CW_W = GAME_CANVAS_W, CW_H = GAME_CANVAS_H;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const [activeColor, setActiveColor] = useState<string | null>(null);
  const [brushWidth, setBrushWidth] = useState(18);
  const [painting, setPainting] = useState(false);

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, CW_W, CW_H);
    ctx.fillStyle = "#f6faf7"; ctx.fillRect(0, 0, CW_W, CW_H);
    if (bgImgRef.current) ctx.drawImage(bgImgRef.current, 0, 0, CW_W, CW_H);
    if (maskCanvasRef.current) {
      ctx.save(); ctx.globalAlpha = 0.5;
      ctx.drawImage(maskCanvasRef.current, 0, 0);
      ctx.restore();
    }
  }, [CW_W, CW_H]);

  useEffect(redraw, [redraw, bgUrl]);

  useEffect(() => {
    if (!maskDataUrl) return;
    const img = new Image();
    img.onload = () => {
      const off = document.createElement("canvas"); off.width = CW_W; off.height = CW_H;
      off.getContext("2d")!.drawImage(img, 0, 0, CW_W, CW_H);
      maskCanvasRef.current = off;
      redraw();
    };
    img.src = maskDataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleBgSelect(dataUrl: string) {
    const img = new Image();
    img.onload = () => { bgImgRef.current = img; redraw(); };
    img.src = dataUrl;
    setBgUrl(dataUrl);
  }

  function nextColor(): string {
    const used = new Set(regions.map((r) => r.marker_color));
    return REGION_COLOR_POOL.find((c) => !used.has(c)) ?? `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`;
  }

  function addRegion() {
    const color = nextColor();
    setRegions([...regions, { marker_color: color, rule: "free" }]);
    setActiveColor(color);
  }
  function removeRegion(color: string) {
    setRegions(regions.filter((r) => r.marker_color !== color));
    if (activeColor === color) setActiveColor(null);
    // 擦掉mask画布上这个颜色的像素，不然删掉的区块还留着看不见的鬼影
    const mc = maskCanvasRef.current;
    if (mc) {
      const mctx = mc.getContext("2d")!;
      const data = mctx.getImageData(0, 0, CW_W, CW_H);
      const ci = parseInt(color.slice(1), 16);
      const cr = (ci >> 16) & 255, cg = (ci >> 8) & 255, cb = ci & 255;
      for (let i = 0; i < data.data.length; i += 4) {
        if (Math.abs(data.data[i] - cr) + Math.abs(data.data[i + 1] - cg) + Math.abs(data.data[i + 2] - cb) < 30) data.data[i + 3] = 0;
      }
      mctx.putImageData(data, 0, 0);
      redraw();
      setMaskDataUrl(mc.toDataURL("image/png"));
    }
  }

  function ensureMaskCanvas() {
    if (!maskCanvasRef.current) {
      const off = document.createElement("canvas"); off.width = CW_W; off.height = CW_H;
      maskCanvasRef.current = off;
    }
    return maskCanvasRef.current;
  }

  function paintAt(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!activeColor) return;
    const mc = ensureMaskCanvas();
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = CW_W / rect.width, scaleY = CW_H / rect.height;
    const px = (e.clientX - rect.left) * scaleX, py = (e.clientY - rect.top) * scaleY;
    const ctx = mc.getContext("2d")!;
    ctx.fillStyle = activeColor;
    ctx.beginPath(); ctx.arc(px, py, brushWidth, 0, Math.PI * 2); ctx.fill();
    redraw();
  }

  function handleMouseUp() {
    if (painting) {
      setPainting(false);
      const mc = maskCanvasRef.current;
      if (mc) setMaskDataUrl(mc.toDataURL("image/png"));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <label className="flex items-center gap-1.5">底图（线稿或情境图，必填）<input type="file" accept="image/*" className="text-xs" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const fr = new FileReader(); fr.onload = () => handleBgSelect(fr.result as string); fr.readAsDataURL(f); } }} /></label>
        <AssetPicker category="background" label="🗂️ 从素材库选" moduleType="coloring" onSelect={handleBgSelect} />
        <label className="flex items-center gap-1.5">笔刷 <input type="range" min={6} max={40} value={brushWidth} onChange={(e) => setBrushWidth(+e.target.value)} /> {brushWidth}px</label>
      </div>
      <p className="text-xs text-muted-foreground">
        {activeColor ? "已选中一个区块——在下面画布上画出这个区块的形状（按住拖动）" : "先在下面「+ 加一个区块」，选中它之后再来这里画形状"}
      </p>
      <canvas
        ref={canvasRef} width={CW_W} height={CW_H}
        onMouseDown={(e) => { setPainting(true); paintAt(e); }}
        onMouseMove={(e) => { if (painting) paintAt(e); }}
        onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
        className={`w-full h-auto rounded-lg bg-card border border-border ${activeColor ? "cursor-crosshair" : "cursor-not-allowed"}`}
      />
      <div className="space-y-1.5">
        {regions.map((r) => (
          <div key={r.marker_color} className={`flex items-center gap-2 bg-card rounded-lg border px-3 py-1.5 ${activeColor === r.marker_color ? "border-primary" : "border-border"}`}>
            <button type="button" onClick={() => setActiveColor(r.marker_color)} className="w-6 h-6 rounded-full border border-border shrink-0" style={{ backgroundColor: r.marker_color }} />
            <Input
              placeholder="区块名称（选填，如：太阳）" value={r.label ?? ""}
              onChange={(e) => setRegions(regions.map((x) => x.marker_color === r.marker_color ? { ...x, label: e.target.value } : x))}
              className="h-7 text-xs flex-1"
            />
            <select
              value={r.rule} className="text-xs border rounded p-1"
              onChange={(e) => setRegions(regions.map((x) => x.marker_color === r.marker_color ? { ...x, rule: e.target.value as "free" | "specific" } : x))}
            >
              <option value="free">自由选色</option>
              <option value="specific">指定颜色</option>
            </select>
            {r.rule === "specific" && (
              <input
                type="color" value={r.target_color ?? "#ff0000"}
                onChange={(e) => setRegions(regions.map((x) => x.marker_color === r.marker_color ? { ...x, target_color: e.target.value } : x))}
                className="w-7 h-7 rounded border border-border"
              />
            )}
            <button type="button" onClick={() => removeRegion(r.marker_color)} className="text-red-500 hover:text-red-600 text-xs">删除</button>
          </div>
        ))}
      </div>
      <Button type="button" size="sm" variant="outline" onClick={addRegion}>+ 加一个区块</Button>
    </div>
  );
}

// 数字迷宫——独立的迷宫风格设计器，不共用现有 maze 那套（那套的画布/
// canvas ref 是直接写死在主组件里的，深度耦合，硬要复用风险比重写一个
// 简化版还大）。玩法：跟现有迷宫一样沿路径拖着走，但路上有几个"分岔
// 点"，走到那里要先点对数字选项才能继续往前（选错算一次失误，可以
// 重选）。这里只管路径+起点终点+分岔点怎么摆、怎么编辑，"选错了会怎样"
// 这些运行时判定逻辑在 NumberMazeGame.tsx（还没做）。
interface NumberMazeOption { value: string }
interface NumberMazeDecisionPoint { id: string; x: number; y: number; options: NumberMazeOption[]; correctIndex: number }
function NumberMazeDesigner({
  bgUrl, setBgUrl, maskDataUrl, setMaskDataUrl,
  start, setStart, end, setEnd,
  decisionPoints, setDecisionPoints,
}: {
  bgUrl: string | null; setBgUrl: (u: string) => void;
  maskDataUrl: string | null; setMaskDataUrl: (u: string) => void;
  start: { x: number; y: number } | null; setStart: (p: { x: number; y: number } | null) => void;
  end: { x: number; y: number } | null; setEnd: (p: { x: number; y: number } | null) => void;
  decisionPoints: NumberMazeDecisionPoint[]; setDecisionPoints: (d: NumberMazeDecisionPoint[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null); // offscreen——累积画的可走路径，跟主画布分开，方便单独导出成mask图
  const [mode, setMode] = useState<"path" | "erase" | "start" | "end" | "decision">("path");
  const [brushWidth, setBrushWidth] = useState(36);
  const paintingRef = useRef(false);
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null);

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, GAME_CANVAS_W, GAME_CANVAS_H);
    ctx.fillStyle = "#eef2f5"; ctx.fillRect(0, 0, GAME_CANVAS_W, GAME_CANVAS_H);
    if (bgImgRef.current) ctx.drawImage(bgImgRef.current, 0, 0, GAME_CANVAS_W, GAME_CANVAS_H);
    if (maskCanvasRef.current) {
      ctx.save(); ctx.globalAlpha = 0.45;
      ctx.drawImage(maskCanvasRef.current, 0, 0);
      ctx.restore();
    }
    if (start) {
      ctx.beginPath(); ctx.arc(start.x * GAME_CANVAS_W, start.y * GAME_CANVAS_H, 16, 0, Math.PI * 2);
      ctx.fillStyle = "#ff7a59"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
      ctx.font = "bold 14px sans-serif"; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText("起", start.x * GAME_CANVAS_W, start.y * GAME_CANVAS_H + 5);
    }
    if (end) {
      ctx.beginPath(); ctx.arc(end.x * GAME_CANVAS_W, end.y * GAME_CANVAS_H, 16, 0, Math.PI * 2);
      ctx.fillStyle = "#2e9e5b"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
      ctx.font = "bold 14px sans-serif"; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText("终", end.x * GAME_CANVAS_W, end.y * GAME_CANVAS_H + 5);
    }
    decisionPoints.forEach((dp, i) => {
      const isSel = dp.id === selectedDecisionId;
      ctx.beginPath(); ctx.arc(dp.x * GAME_CANVAS_W, dp.y * GAME_CANVAS_H, 14, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? "#5b8def" : "#8b7ae0"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
      ctx.font = "bold 13px sans-serif"; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText(String(i + 1), dp.x * GAME_CANVAS_W, dp.y * GAME_CANVAS_H + 4);
    });
  }, [start, end, decisionPoints, selectedDecisionId]);

  useEffect(redraw, [redraw, bgUrl]);

  function loadBg(url: string) {
    const img = new Image();
    img.onload = () => { bgImgRef.current = img; redraw(); };
    img.src = url;
    setBgUrl(url);
  }
  async function handleUpload(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
    loadBg(dataUrl);
  }

  // 蒙版画布只在组件第一次挂载的时候准备一次——这里特意用空依赖数组，
  // 只处理"进来编辑已有关卡、maskDataUrl 一开始就有内容"这一种情况，
  // 之后画笔画的东西都是直接改这个 canvas 本身，不会再重新触发这个
  // effect，不然画到一半图会被这个 effect 冲掉重置。
  useEffect(() => {
    if (!maskCanvasRef.current) {
      const off = document.createElement("canvas");
      off.width = GAME_CANVAS_W; off.height = GAME_CANVAS_H;
      maskCanvasRef.current = off;
    }
    if (maskDataUrl) {
      const img = new Image();
      img.onload = () => {
        maskCanvasRef.current!.getContext("2d")!.drawImage(img, 0, 0, GAME_CANVAS_W, GAME_CANVAS_H);
        redraw();
      };
      img.src = maskDataUrl;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toXY(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = GAME_CANVAS_W / rect.width, scaleY = GAME_CANVAS_H / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function paintAt(x: number, y: number) {
    const ctx = maskCanvasRef.current!.getContext("2d")!;
    ctx.globalCompositeOperation = mode === "erase" ? "destination-out" : "source-over";
    ctx.fillStyle = "#4fb06d";
    ctx.beginPath(); ctx.arc(x, y, brushWidth / 2, 0, Math.PI * 2); ctx.fill();
    redraw();
  }

  function commitMask() {
    setMaskDataUrl(maskCanvasRef.current!.toDataURL("image/png"));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const { x, y } = toXY(e);
    if (mode === "path" || mode === "erase") {
      paintingRef.current = true;
      paintAt(x, y);
    } else if (mode === "start") {
      setStart({ x: x / GAME_CANVAS_W, y: y / GAME_CANVAS_H });
    } else if (mode === "end") {
      setEnd({ x: x / GAME_CANVAS_W, y: y / GAME_CANVAS_H });
    } else if (mode === "decision") {
      // 先看点的位置离哪个已有的分岔点够近——够近就选中它（方便回去改
      // 选项），不够近才新建一个。之前漏了这个判断，导致点画布永远是
      // 新建，前面建好的分岔点一旦不是"刚建好那一个"就再也点不回去选
      // 中它、没法回去改选项了。
      const HIT_R = 20; // 像素半径，跟画出来的圆点大小差不多
      const hitPoint = decisionPoints.find((d) => Math.hypot(d.x * GAME_CANVAS_W - x, d.y * GAME_CANVAS_H - y) < HIT_R);
      if (hitPoint) {
        setSelectedDecisionId(hitPoint.id);
      } else {
        const newPoint: NumberMazeDecisionPoint = {
          id: uid(), x: x / GAME_CANVAS_W, y: y / GAME_CANVAS_H,
          options: [{ value: "" }, { value: "" }], correctIndex: 0,
        };
        setDecisionPoints([...decisionPoints, newPoint]);
        setSelectedDecisionId(newPoint.id);
      }
    }
  }
  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!paintingRef.current) return;
    const { x, y } = toXY(e);
    paintAt(x, y);
  }
  function handlePointerUp() {
    if (paintingRef.current) { paintingRef.current = false; commitMask(); }
  }

  const selectedPoint = decisionPoints.find((d) => d.id === selectedDecisionId) ?? null;

  function updateSelectedPoint(patch: Partial<NumberMazeDecisionPoint>) {
    setDecisionPoints(decisionPoints.map((d) => (d.id === selectedDecisionId ? { ...d, ...patch } : d)));
  }
  function updateOption(idx: number, value: string) {
    if (!selectedPoint) return;
    const options = selectedPoint.options.map((o, i) => (i === idx ? { value } : o));
    updateSelectedPoint({ options });
  }
  function addOption() {
    if (!selectedPoint || selectedPoint.options.length >= 4) return;
    updateSelectedPoint({ options: [...selectedPoint.options, { value: "" }] });
  }
  function removeOption(idx: number) {
    if (!selectedPoint || selectedPoint.options.length <= 2) return;
    const options = selectedPoint.options.filter((_, i) => i !== idx);
    const correctIndex = selectedPoint.correctIndex >= options.length ? 0 : selectedPoint.correctIndex;
    updateSelectedPoint({ options, correctIndex });
  }
  function deleteSelectedPoint() {
    setDecisionPoints(decisionPoints.filter((d) => d.id !== selectedDecisionId));
    setSelectedDecisionId(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-sm">背景图 <input type="file" accept="image/*" className="text-xs" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} /></label>
        <AssetPicker category="background" label="🗂️ 从素材库选" moduleType="number_maze" onSelect={loadBg} />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {([["path", "🖌️ 画路径"], ["erase", "🧹 擦掉路径"], ["start", "🏁 设起点"], ["end", "🏆 设终点"], ["decision", "🔀 加分岔点"]] as const).map(([m, label]) => (
          <button
            key={m} type="button" onClick={() => setMode(m)}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${mode === m ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
        {(mode === "path" || mode === "erase") && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            笔刷 <input type="range" min={12} max={80} value={brushWidth} onChange={(e) => setBrushWidth(+e.target.value)} />
          </label>
        )}
      </div>
      <p className="text-xs text-muted-foreground">先上传背景图、画出可走的路径（绿色半透明区域），设好起点终点，再点"🔀 加分岔点"、在画布上点几个要放判断题的位置——每个分岔点在下面可以编辑它的数字选项，选一个标成正确答案。</p>

      <canvas
        ref={canvasRef} width={GAME_CANVAS_W} height={GAME_CANVAS_H}
        onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
        style={{ touchAction: "none" }}
        className={`w-full h-auto rounded-lg bg-card border border-border ${mode === "path" || mode === "erase" ? "cursor-crosshair" : "cursor-pointer"}`}
      />

      {selectedPoint && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">分岔点 #{decisionPoints.findIndex((d) => d.id === selectedDecisionId) + 1} 的数字选项</p>
            <button type="button" onClick={deleteSelectedPoint} className="text-xs text-red-500 hover:text-red-600">删除这个分岔点</button>
          </div>
          {selectedPoint.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" checked={selectedPoint.correctIndex === i} onChange={() => updateSelectedPoint({ correctIndex: i })} />
              <input
                type="text" value={opt.value} onChange={(e) => updateOption(i, e.target.value)}
                placeholder={`选项${i + 1}`}
                className={`flex-1 h-8 text-sm border rounded-md px-2 ${selectedPoint.correctIndex === i ? "border-emerald-400" : "border-border"}`}
              />
              {selectedPoint.options.length > 2 && (
                <button type="button" onClick={() => removeOption(i)} className="text-xs text-muted-foreground hover:text-red-500">✕</button>
              )}
            </div>
          ))}
          {selectedPoint.options.length < 4 && (
            <button type="button" onClick={addOption} className="text-xs text-primary hover:underline">+ 加一个选项</button>
          )}
          <p className="text-[11px] text-muted-foreground/70">左边打勾的是正确答案——学生走到这个分岔点，要点选项，选中打勾这个才能继续往前走。</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        已画路径 · 起点{start ? "✓" : "未设"} · 终点{end ? "✓" : "未设"} · {decisionPoints.length} 个分岔点
      </p>
    </div>
  );
}


function SudokuCellDesigner({ bgUrl, setBgUrl, cells, setCells }: {
  bgUrl: string | null; setBgUrl: (u: string) => void;
  cells: SudokuCellDraft[]; setCells: (c: SudokuCellDraft[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, GAME_CANVAS_W, GAME_CANVAS_H);
    ctx.fillStyle = "#f6faf7"; ctx.fillRect(0, 0, GAME_CANVAS_W, GAME_CANVAS_H);
    if (bgImgRef.current) ctx.drawImage(bgImgRef.current, 0, 0, GAME_CANVAS_W, GAME_CANVAS_H);
    cells.forEach((c, i) => {
      const x = c.x * GAME_CANVAS_W, y = c.y * GAME_CANVAS_H;
      ctx.strokeStyle = c.answer ? "#4fb06d" : "#e8a33d"; ctx.lineWidth = 3;
      ctx.strokeRect(x - 20, y - 20, 40, 40);
      ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = c.answer ? "#4fb06d" : "#e8a33d";
      ctx.fillText(c.answer || String(i + 1), x, y + 6);
    });
  }, [cells]);

  useEffect(redraw, [redraw, bgUrl]);

  async function handleUpload(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
    handleSelect(dataUrl);
  }

  function handleSelect(dataUrl: string) {
    const img = new Image();
    img.onload = () => { bgImgRef.current = img; redraw(); };
    img.src = dataUrl;
    setBgUrl(dataUrl);
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = GAME_CANVAS_W / rect.width, scaleY = GAME_CANVAS_H / rect.height;
    const px = (e.clientX - rect.left) * scaleX, py = (e.clientY - rect.top) * scaleY;
    const lx = px / GAME_CANVAS_W, ly = py / GAME_CANVAS_H;
    const hitIdx = cells.findIndex((c) => Math.hypot(c.x - lx, c.y - ly) * GAME_CANVAS_W < 22);
    if (hitIdx >= 0) setCells(cells.filter((_, i) => i !== hitIdx));
    else setCells([...cells, { x: lx, y: ly, answer: "" }]);
  }

  function updateAnswer(i: number, val: string) {
    const digit = val.replace(/[^1-9]/g, "").slice(-1);
    setCells(cells.map((c, idx) => (idx === i ? { ...c, answer: digit } : c)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <label className="flex items-center gap-1.5">数独图片 <input type="file" accept="image/*" className="text-xs" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} /></label>
        <AssetPicker category="background" label="🗂️ 从素材库选" moduleType="sudoku" onSelect={handleSelect} />
      </div>
      <p className="text-xs text-muted-foreground">上传一张数独图片后，点图上每一个空格的位置来标记（橙色框=还没填答案，绿色框=已经填了）。点已有的标记可以移除。已标记 {cells.length} 个空格。</p>
      <canvas
        ref={canvasRef} width={GAME_CANVAS_W} height={GAME_CANVAS_H} onClick={handleClick}
        className="w-full h-auto rounded-lg bg-card cursor-crosshair border border-border"
      />
      {cells.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-muted-foreground mb-2">每个空格的正确答案（1-9）</p>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {cells.map((c, i) => (
              <label key={i} className="flex items-center gap-1.5 text-sm">
                第{i + 1}格
                <input
                  type="text" inputMode="numeric" maxLength={1} value={c.answer}
                  onChange={(e) => updateAnswer(i, e.target.value)}
                  className={`w-10 h-8 text-center border rounded-md text-sm font-bold ${c.answer ? "border-emerald-400" : "border-amber-400"}`}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 跟弹练习的时间标记编辑器——设计师放音频、点乐谱上对应位置，记一个
// {time, page, y} 标记。播放时（PlayAlongGame.tsx，运行时组件）在同页
// 相邻两个标记之间线性插值出高亮线的位置，跨页就翻页。至少要2个标记
// 才能插值，这个最低限制在 AddLevelModal 保存时挡。
interface PlayAlongMarker { time: number; page: number; x: number; y: number }
function PlayAlongMarkerEditor({ pages, audioUrl, markers, setMarkers, currentPage, setCurrentPage }: {
  pages: string[]; audioUrl: string;
  markers: PlayAlongMarker[]; setMarkers: React.Dispatch<React.SetStateAction<PlayAlongMarker[]>>;
  currentPage: number; setCurrentPage: (n: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [editSpeed, setEditSpeed] = useState(0.5); // 打标记默认放慢到一半速度，不用跟真实节奏抢时间
  const [autoPauseOnMark, setAutoPauseOnMark] = useState(true);
  const [editLoop, setEditLoop] = useState<{ start: number; end: number } | null>(null);

  // 带上原始数组下标，才能准确删对那一个（不能靠 time/x/y 相等去比对——
  // 万一两个标记凑巧同一个坐标或者同一秒，比对会删错）。按时间排序而
  // 不是按坐标排序——弹奏顺序才是这些标记真正的先后关系，同一行左右
  // 移动、跨行都靠 time 串起来，不是靠 y 由上到下这种假设。
  const pageMarkers = markers
    .map((m, idx) => ({ ...m, idx }))
    .filter((m) => m.page === currentPage)
    .sort((a, b) => a.time - b.time);

  function handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setMarkers((ms) => [...ms, { time: audio.currentTime, page: currentPage, x, y }]);
    // 点下去的瞬间自动定格——打标记这件事不该要求手速跟上音乐，暂停下来
    // 看清楚点得准不准、要不要用下面的步进按钮微调，比"必须实时点准"
    // 从容得多。
    if (autoPauseOnMark) audio.pause();
  }

  function seekTo(time: number) {
    if (audioRef.current) audioRef.current.currentTime = Math.max(0, Math.min(duration, time));
  }

  function nudge(delta: number) {
    seekTo((audioRef.current?.currentTime ?? 0) + delta);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play(); else audio.pause();
  }

  function setSpeed(rate: number) {
    const clamped = Math.max(0.1, Math.min(1.5, rate));
    if (audioRef.current) audioRef.current.playbackRate = clamped;
    setEditSpeed(clamped);
  }

  function markLoopStart() {
    const t = audioRef.current?.currentTime ?? 0;
    setEditLoop((r) => (r && t < r.end ? { start: t, end: r.end } : { start: t, end: Math.min(duration, t + 4) }));
  }
  function markLoopEnd() {
    const t = audioRef.current?.currentTime ?? 0;
    setEditLoop((r) => (r && t > r.start ? { start: r.start, end: t } : { start: Math.max(0, t - 4), end: t }));
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    if (editLoop && audio.currentTime >= editLoop.end) audio.currentTime = editLoop.start;
  }

  return (
    <div className="pt-3 border-t border-border/60 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">时间标记编辑器</p>
        <div className="flex items-center gap-2">
          <button type="button" disabled={currentPage === 0} onClick={() => setCurrentPage(currentPage - 1)} className="text-xs px-2 py-1 rounded border border-border disabled:opacity-30 hover:bg-muted">← 上一页</button>
          <span className="text-xs text-muted-foreground tabular-nums">第 {currentPage + 1} / {pages.length} 页</span>
          <button type="button" disabled={currentPage === pages.length - 1} onClick={() => setCurrentPage(currentPage + 1)} className="text-xs px-2 py-1 rounded border border-border disabled:opacity-30 hover:bg-muted">下一页 →</button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5">
        放慢速度、圈一小段反复听，点到乐谱上对应音符的位置——不用跟着真实节奏抢时间点，点下去会自动暂停，看清楚了再用下面的步进按钮微调、或者直接放下一段接着点。点之间用虚线按弹奏顺序连起来，方便检查路径对不对。
      </p>

      <div className="relative border border-border rounded-lg overflow-hidden bg-muted/20 select-none">
        <img
          src={pages[currentPage]} alt={`第${currentPage + 1}页`}
          onClick={handleImageClick}
          className="w-full h-auto cursor-crosshair block"
        />
        {pageMarkers.length > 1 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline
              points={pageMarkers.map((m) => `${m.x * 100},${m.y * 100}`).join(" ")}
              fill="none" stroke="var(--primary)" strokeWidth={0.4} strokeDasharray="1.2,1.2" opacity={0.6}
            />
          </svg>
        )}
        {pageMarkers.map((m, seq) => (
          <div key={m.idx} style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }} className="absolute -translate-x-1/2 -translate-y-1/2 group">
            <button
              type="button" onClick={(e) => { e.stopPropagation(); seekTo(m.time); }}
              className="w-3.5 h-3.5 rounded-full bg-primary border-2 border-white shadow flex items-center justify-center text-[8px] text-primary-foreground font-bold"
              title={`第${seq + 1}个标记 · ${m.time.toFixed(1)}s`}
            >
              {seq + 1}
            </button>
            <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              <span className="text-[10px] bg-black/70 text-white rounded px-1 py-0.5 tabular-nums">{m.time.toFixed(1)}s</span>
              <button
                type="button" onClick={(e) => { e.stopPropagation(); setMarkers((ms) => ms.filter((_, i) => i !== m.idx)); }}
                className="text-[10px] text-white bg-red-500 rounded px-1 hover:bg-red-600"
              >✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* 自定义播放条——不用浏览器原生 <audio controls>，原生控件没有慢放
          /步进/圈段这些打标记专用的辅助功能，得自己做一套。 */}
      <div className="rounded-lg border border-border bg-card p-3 space-y-2.5">
        <div className="flex items-center gap-3">
          <button type="button" onClick={togglePlay} className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:opacity-90">
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
          </button>
          <span className="text-xs tabular-nums text-muted-foreground shrink-0 w-24">{currentTime.toFixed(1)}s / {duration.toFixed(1)}s</span>
          <input
            type="range" min={0} max={duration || 1} step={0.01} value={currentTime}
            onChange={(e) => seekTo(+e.target.value)}
            className="flex-1 accent-primary"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">步进</span>
          <button type="button" onClick={() => nudge(-1)} className="text-xs px-2 py-1 rounded border border-border hover:bg-muted">−1s</button>
          <button type="button" onClick={() => nudge(-0.1)} className="text-xs px-2 py-1 rounded border border-border hover:bg-muted">−0.1s</button>
          <button type="button" onClick={() => nudge(0.1)} className="text-xs px-2 py-1 rounded border border-border hover:bg-muted">+0.1s</button>
          <button type="button" onClick={() => nudge(1)} className="text-xs px-2 py-1 rounded border border-border hover:bg-muted">+1s</button>

          <span className="text-xs text-muted-foreground shrink-0 ml-2">速度</span>
          <input
            type="range" min={0.1} max={1.5} step={0.05} value={editSpeed}
            onChange={(e) => setSpeed(+e.target.value)}
            className="w-24 accent-primary"
          />
          <span className="text-xs text-muted-foreground tabular-nums w-10">{Math.round(editSpeed * 100)}%</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border/60">
          <Repeat className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <button type="button" onClick={markLoopStart} className="text-xs px-2 py-1 rounded border border-border hover:bg-muted">设起点</button>
          <button type="button" onClick={markLoopEnd} className="text-xs px-2 py-1 rounded border border-border hover:bg-muted">设终点</button>
          {editLoop ? (
            <>
              <span className="text-xs text-muted-foreground tabular-nums">循环 {editLoop.start.toFixed(1)}s–{editLoop.end.toFixed(1)}s</span>
              <button type="button" onClick={() => setEditLoop(null)} className="text-xs px-2 py-1 rounded border border-border text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30">清除</button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground/70">先播到起点按"设起点"，播到终点按"设终点"，会自动反复播放这一段</span>
          )}

          <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto shrink-0">
            <input type="checkbox" checked={autoPauseOnMark} onChange={(e) => setAutoPauseOnMark(e.target.checked)} />
            点乐谱自动暂停
          </label>
        </div>
      </div>

      <audio
        ref={audioRef} src={audioUrl} className="hidden"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />

      <p className="text-xs text-muted-foreground">
        已打 {markers.length} 个标记（这一页 {pageMarkers.length} 个）
      </p>
    </div>
  );
}

// 模块类型的联合类型——单独命名，不要在 moduleType 自己的初始化表达式
// 里用 typeof moduleType 反过来引用它自己（TS 处理不了这种循环引用，
// 会报 "implicitly has type any"）。这两个地方（下面 useState 的初始值、
// presetModuleType 转型）都要用这个命名类型，不要图省事写 typeof。
type ModuleType = "counting" | "spot_diff" | "focus_tap" | "memory" | "pattern" | "word_problem" | "maze" | "number_maze" | "sudoku" | "line_match" | "coloring" | "ppt_lecture" | "video_lecture" | "play_along" | "sticker_game" | "cube_stack" | "cube_layer_count" | "cube_find_hidden" | "cube_free_rotate" | "cube_build" | "cube_three_view" | "shape_count" | "clock" | "latin_square" | "chinese_stroke" | "multiple_choice" | "fill_blank";

function AddLevelModal({ open, onClose, editingLevelId, onSaved, presetModuleType }: {
  open: boolean; onClose: () => void; editingLevelId?: string | null; onSaved: () => void;
  // 从第二层（某个类型的 Activity 列表）点"+ Add Activity"进来的时候，
  // 类型其实已经在上下文里确定了（就是当前这个列表页的类型），不用再
  // 让设计师在弹窗里重复选一次——传这个进来，新建时直接预选好，模块
  // 类型那个下拉框也顺便锁住（逻辑上跟"编辑现有 Activity 时类型锁死
  // 不能改"是同一件事：类型已经由外部上下文决定了，不该在这个弹窗里
  // 再改）。
  presetModuleType?: string | null;
}) {


  const [moduleType, setModuleType] = useState<ModuleType>(
    (presetModuleType as ModuleType) ?? "counting"
  );
  const [levelTitle, setLevelTitle] = useState("");
  const [explanationText, setExplanationText] = useState("");
  const [hintText, setHintText] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFileName, setAudioFileName] = useState("");
  const [explanationImageUrl, setExplanationImageUrl] = useState<string | null>(null);
  const [explanationVideoUrl, setExplanationVideoUrl] = useState("");

  // Activity 不需要绑 Course——这个字段已经完全拿掉了，建 Activity 用
  // 独立的 eduApi.createActivity（不带 courseId），跟点点数数、迷宫这些
  // 一样，先建好内容，之后要不要透过 Lesson 引用它，是 Lesson 那边的事，
  // 跟这里无关。

  // 弹窗改成分页籤显示，不是全部塞在一个页面里一路往下滚——内容太长
  // （光是模块专属的设定就有八种模块各自一大块，加上分类、属性、提示栏），
  // 硬塞成一条长表单不好操作。保存按钮固定在分页籤外面，不管停在哪个
  // 分页籤都能直接保存，不用先切到"最后一个分页籤"才能存。
  type TabKey = "basic" | "classification" | "content" | "properties" | "hints";
  const [activeTab, setActiveTab] = useState<TabKey>("basic");

  // 习题分类 (exercise classification) — all optional; leaving these unset
  // just means the exercise has no auto-generated number yet, not an error.
  const [categories, setCategories] = useState<Array<{ id: string; code: string; name_zh: string; prefix: string; subject_id?: string }>>([]);
  const [groups, setGroups] = useState<Array<{ id: string; category_id: string; code: string; name_zh: string }>>([]);
  const [curriculumTypes, setCurriculumTypes] = useState<Array<{ id: string; code: string; name_zh: string }>>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; programme_id?: string; code: string; name_zh: string }>>([]);
  const [subjectId, setSubjectId] = useState("");
  const [categoryId, setCategoryId] = useState(""); // 级联选择器里"正在挑的那一个"，挑完点"加入"才会进下面的数组
  const [categoryIds, setCategoryIds] = useState<string[]>([]); // 这个 Activity 实际挂的全部 Topic（多对多）
  const [groupId, setGroupId] = useState("");
  const [curriculumTypeId, setCurriculumTypeId] = useState("");

  // chinese_stroke fields
  const [chineseStrokeChars, setChineseStrokeChars] = useState<string[]>([]);
  const [chineseStrokeInput, setChineseStrokeInput] = useState(""); // 输入框里正在打的字，还没确认加进字库

  // multiple_choice fields——选项列表(每个选项独立三语言+是否正确)，
  // 场景(SceneEditor组合的背景，选填)复用跟点点数数自定义模式同一套
  // StructuredSceneOutput类型。
  interface MCOption { id: string; zh: string; en: string; ms: string; correct: boolean }
  const [mcScene, setMcScene] = useState<StructuredSceneOutput | null>(null);
  const [mcAnswerMode, setMcAnswerMode] = useState<"single" | "multi">("single");
  const [mcOptions, setMcOptions] = useState<MCOption[]>([
    { id: "opt1", zh: "", en: "", ms: "", correct: false },
    { id: "opt2", zh: "", en: "", ms: "", correct: false },
  ]);
  // 题目文字（必填，至少中文）——选择题总要有个"问什么"，专属字段，
  // 不跟其他模块共用 customQuestionText（那个是选填的辅助说明，这个是
  // 选择题的核心内容）。
  const [mcQuestionZh, setMcQuestionZh] = useState("");
  const [mcQuestionEn, setMcQuestionEn] = useState("");
  const [mcQuestionMs, setMcQuestionMs] = useState("");

  // fill_blank fields——题目句子(三语言，各自的"___"数量应该一致，用
  // 中文那份句子的"___"数量决定要显示几个"接受答案"输入框)，场景同
  // 选择题一样复用SceneEditor。
  const [fbScene, setFbScene] = useState<StructuredSceneOutput | null>(null);
  const [fbSentenceZh, setFbSentenceZh] = useState("");
  const [fbSentenceEn, setFbSentenceEn] = useState("");
  const [fbSentenceMs, setFbSentenceMs] = useState("");
  // 每个空一条，逗号分隔"这个空所有算对的写法"(比如"5,五")
  const [fbBlankAnswers, setFbBlankAnswers] = useState<string[]>([""]);

  // Activity 属性 (LogiVerse Education Taxonomy v1.0) — all optional,
  // metadata about the activity itself rather than the numbering/content
  // classification above. teaching_modes and skills_developed are
  // multi-select (an activity can suit several teaching modes / build
  // several skills at once); tags reuses the same max-3 convention as the
  // asset library's tags.
  const [activityType, setActivityType] = useState("game");
  const [teachingModes, setTeachingModes] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState("");
  const [ageGroupMin, setAgeGroupMin] = useState("");
  const [ageGroupMax, setAgeGroupMax] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [learningOutcomes, setLearningOutcomes] = useState("");
  const [skillsInput, setSkillsInput] = useState(""); // comma-separated, parsed on save
  const [activityLanguage, setActivityLanguage] = useState("universal");
  const [activityTagsInput, setActivityTagsInput] = useState(""); // comma-separated, capped at 3 on save

  // 使用场景——跟素材库那个"实体课/Self-Guided/公开课"完全同一个概念，
  // 搬到 Activity 上。勾了 self_guided 才需要选 Programme（不选=不限制，
  // 所有 Programme 的学生都看得到；选了才收窄）。
  const [usageContexts, setUsageContexts] = useState<string[]>([]);
  const [selfGuidedProgrammeIds, setSelfGuidedProgrammeIds] = useState<string[]>([]);
  const [allProgrammes, setAllProgrammes] = useState<Array<{ id: string; name_zh: string }>>([]);
  useEffect(() => { taxonomyApi.listProgrammes().then(setAllProgrammes); }, []);
  // 后端 course_levels.parent_preview_enabled 这个栏位其实早就存在（家长
  // 预览那个页面一直在按它筛选），但设计器这边从来没做过对应的开关，
  // 导致这个功能形同虚设——数据库里没有任何 Activity 被标记过，家长
  // 预览永远是空的。现在补上。
  const [parentPreviewEnabled, setParentPreviewEnabled] = useState(false);
  // Activity 设计管理列表卡片用的封面图，跟 explanationImageUrl(讲解图，
  // 学生答完题之后看的说明配图)是两个完全独立的字段，不要混用。
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    exerciseClassificationApi.listCategories().then(setCategories); // unfiltered — needed for the module_type→Topic auto-match below regardless of what Subject is currently picked
    exerciseClassificationApi.listCurriculumTypes().then(setCurriculumTypes);
    taxonomyApi.listSubjects().then(setSubjects); // 直接加载全部 Subject，不再需要先选 Programme
  }, [open]);
  useEffect(() => {
    // "分类"(Group)现在跟着下面已经加入的全部 Topic 走，不是只跟着级联
    // 选择器里"当前选中"的那一个——挂了好几个 Topic，这里就把每个 Topic
    // 底下的分类选项都拉出来合并、按 id 去重。原本选的分类如果在新列表
    // 里还找得到就保留，找不到（比如把那个 Topic 从标签里删掉了）才清空。
    if (categoryIds.length === 0) { setGroups([]); setGroupId(""); return; }
    Promise.all(categoryIds.map((cid) => exerciseClassificationApi.listGroups(cid))).then((results) => {
      const merged = results.flat();
      const deduped = Array.from(new Map(merged.map((g) => [g.id, g])).values());
      setGroups(deduped);
      setGroupId((prev) => (deduped.some((g) => g.id === prev) ? prev : ""));
    });
  }, [categoryIds]);
  // convenience: picking a module type auto-selects the matching Topic
  // (they're 1:1 in practice — 迷宫 module → 迷宫 Topic) so the designer
  // doesn't have to pick it twice; still freely changeable if they want.
  useEffect(() => {
    const match = categories.find((c) => c.code === moduleType);
    if (match) setCategoryId(match.id);
  }, [moduleType, categories]);
  // 反过来也要成立——现在的流程是先选 Programme→Subject→Topic，再决定
  // 模块类型，所以"选 Topic 自动带出模块类型"这个方向同样要有，不能只有
  // "选模块类型带出Topic"这一个方向。两个effect会互相触发，但因为最终都
  // 收敛到同一组一致的值，setState传进去的值如果跟当前值一样不会真的
  // 变化，不会变成死循环。
  useEffect(() => {
    const topic = categories.find((c) => c.id === categoryId);
    if (topic && MODULE_LABELS[topic.code]) setModuleType(topic.code as typeof moduleType);
  }, [categoryId, categories]);
  // Programme/Subject/Topic 是一个整体链路，不是三个各自独立的选项——不管
  // Topic 是被上面那个自动匹配选上的，还是设计者自己在下拉框里选的，一旦
  // Topic 定了，它所属的 Subject、以及 Subject 所属的 Programme，都要跟着
  //自动对齐，不能让画面显示出"选了迷宫这个Topic，但Programme/Subject栏位
  //还空着"这种不一致的状态。
  useEffect(() => {
    if (!categoryId) return;
    const topic = categories.find((c) => c.id === categoryId);
    if (!topic?.subject_id) return;
    setSubjectId((prev) => (prev === topic.subject_id ? prev : topic.subject_id!));
  }, [categoryId, categories]);

  // counting fields
  const [theme, setTheme] = useState("apple");
  const [minVal, setMinVal] = useState(1);
  const [maxVal, setMaxVal] = useState(10);
  const [numChoices, setNumChoices] = useState(3);
  const [totalQuestions, setTotalQuestions] = useState(5);
  const [countingMode, setCountingMode] = useState<"random" | "custom_scene">("random");
  const [countingScene, setCountingScene] = useState<StructuredSceneOutput | null>(null);
  // 这一题要问哪几种物件类型的和——从 countingScene.objects 里已经打过的
  // 类型标签中勾选，不设的话（比如设计师没给物件打类型）退回"数全部"。
  const [countingTargetTypes, setCountingTargetTypes] = useState<string[]>([]);
  // 自定义题目句子（选填）——不填的话游戏画面按 target_types 自动生成
  // 一句话；这个只改"怎么问"，答案还是由 target_types 决定，不受这个影响。
  const [countingQuestionText, setCountingQuestionText] = useState("");

  // 其它8个模块（找不同/专注力点数字/Memory配对/找规律/迷宫/填色/连线配对/
  // 数独）共用同一个"自定义题目句子"栏位——一次只编辑一个 Activity，共用
  // 一个 state 就够了，不用给每个模块各开一个。counting 自己已经有独立的
  // 一套（上面那个 countingQuestionText），这里不重复。
  const CUSTOM_QUESTION_MODULES = ["spot_diff", "focus_tap", "memory", "pattern", "maze", "coloring", "line_match", "sudoku", "shape_count"];
  const [customQuestionText, setCustomQuestionText] = useState("");

  // focus_tap fields (grid mode only for now)
  const [gridSize, setGridSize] = useState(4);
  const [ftMode, setFtMode] = useState<"grid" | "custom">("grid");
  const [ftScene, setFtScene] = useState<StructuredSceneOutput | null>(null);

  // memory fields
  const [memoryTheme, setMemoryTheme] = useState("animal");
  const [pairsCount, setPairsCount] = useState(6);
  const [previewSeconds, setPreviewSeconds] = useState(3);
  const [memoryMode, setMemoryMode] = useState<"preset" | "custom">("preset");
  const [memoryCustomIcons, setMemoryCustomIcons] = useState<string[]>([]);
  const [memoryBgUrl, setMemoryBgUrl] = useState<string | null>(null);
  // 自由摆放——牌的位置槽（数量要等于 memoryCustomIcons.length × 2）；
  // 不设(null)或者 memoryLayout==="grid" 时用原本的系统自动排格子。
  const [memoryLayout, setMemoryLayout] = useState<"grid" | "free">("grid");
  const [memoryScene, setMemoryScene] = useState<StructuredSceneOutput | null>(null);

  // pattern fields
  const [patternTheme, setPatternTheme] = useState("shape");
  const [patternTypes, setPatternTypes] = useState<string[]>(["AB", "ABC", "AAB", "ABB", "AABB"]);
  const [seqLength, setSeqLength] = useState(7);

  // cube_stack fields — 没有素材/authored内容，只有一个"从第几级难度
  // 开始"的参数，题数/计时用跟其他模块共用的 totalQuestions
  const [cubeStackStartingLevel, setCubeStackStartingLevel] = useState(1);
  // 同一系列(Stage2/3/5/6)和数方块都共用同一个 starting_level 输入状态
  // (cubeStackStartingLevel)——反正设计器一次只编辑一种模块类型，不会
  // 互相干扰，不用为每个模块各开一个几乎一样的state。下面这几个才是
  // 各自独有、跟starting_level/total_questions不一样的额外参数。
  const [cubeMaxSplitLayers, setCubeMaxSplitLayers] = useState(5);      // Stage2 逐层计数
  const [cubeHiddenTargets, setCubeHiddenTargets] = useState(1);        // Stage3 找隐藏方块
  const [cubeFreeRotateShapes, setCubeFreeRotateShapes] = useState(3);  // Stage4 看几个结构
  const [cubeFreeRotateSize, setCubeFreeRotateSize] = useState(3);      // Stage4 结构大小(固定难度，不自适应)
  const [cubeFreeRotateMinSec, setCubeFreeRotateMinSec] = useState(5);  // Stage4 每个结构至少看几秒
  const [shapeAskType, setShapeAskType] = useState<"square" | "rectangle" | "both">("both"); // 平面数方块 问正方形/长方形/都问
  // shape_count 的 custom 布局——跟focus_tap的grid/custom是同一个套路，
  // grid沿用现成的公式生成模式，custom是设计师自己画/摆的单题场景。
  const [shapeCountLayout, setShapeCountLayout] = useState<"grid" | "custom">("grid");
  const [shapeCountScene, setShapeCountScene] = useState<StructuredSceneOutput | null>(null);
  // clock fields — starting_level/total_questions复用cubeStackStartingLevel/
  // totalQuestions这两个共用state(同一套1-10自适应难度语义)，mode是独有的
  const [clockMode, setClockMode] = useState<"read" | "set" | "both">("both");
  // latin_square fields — starting_level/total_questions复用共用state
  const [latinSquareTheme, setLatinSquareTheme] = useState<"shape" | "animal" | "fruit" | "emotion">("shape");

  // word_problem fields
  const [wpCategories, setWpCategories] = useState<string[]>(["chicken_rabbit"]);
  const [wpAnswerMode, setWpAnswerMode] = useState<"select" | "input">("select");

  // sudoku fields — authored, not generated/solved: a puzzle image + which
  // cells are blank + the correct digit for each (kept only in this
  // designer's own state and the save payload — never round-tripped back
  // from the server once saved, matching how the play side never gets to
  // see answers either)
  const [sudokuBgUrl, setSudokuBgUrl] = useState<string | null>(null);
  const [sudokuCells, setSudokuCells] = useState<SudokuCellDraft[]>([]);
  const [sudokuDifficulty, setSudokuDifficulty] = useState<"easy" | "medium" | "hard" | "custom">("medium");
  // "传照片标空格"（旧）vs "自己画网格"（新，SceneEditor 网格图层）——
  // grid 模式下不需要背景照片，网格本身就是画面；sudokuScene 存
  // SceneEditor 的 structuredMode 输出，里面的 grids[0] 就是整个数独。
  const [sudokuLayout, setSudokuLayout] = useState<"photo" | "grid">("photo");
  const [sudokuScene, setSudokuScene] = useState<StructuredSceneOutput | null>(null);

  // 数字迷宫 fields
  const [nmBgUrl, setNmBgUrl] = useState<string | null>(null);
  const [nmMaskDataUrl, setNmMaskDataUrl] = useState<string | null>(null);
  const [nmStart, setNmStart] = useState<{ x: number; y: number } | null>(null);
  const [nmEnd, setNmEnd] = useState<{ x: number; y: number } | null>(null);
  const [nmDecisionPoints, setNmDecisionPoints] = useState<NumberMazeDecisionPoint[]>([]);
  // "路径分岔"（上面那几个，图3那种房间迷宫） vs "方格棋盘"（图1那种，
  // 从起点按相邻格子规则跳到终点，靠 SceneEditor 的网格图层 + pathStep
  // 标记解题路径）——两种玩法都留着，设计师自己选。
  const [nmLayout, setNmLayout] = useState<"path" | "grid">("path");
  const [nmScene, setNmScene] = useState<StructuredSceneOutput | null>(null);

  // 贴纸游戏——100%复用 SceneEditor 的自由摆放，物件摆在哪就是"正确
  // 位置"。运行时会把这些贴纸打乱塞进一个"贴纸盘"，学生要拖回原本
  // 摆放的位置（在NumberMazeGame等一样，还没做的是运行时组件）。
  const [stickerScene, setStickerScene] = useState<StructuredSceneOutput | null>(null);

  // line_match fields — authored directly. 从"左右一一对应"换成"左右各
  // 自一份物件清单 + 一份明确的连线清单(edges)"，才能支持多对多——一个
  // 物件可以被好几条线连到（一对多/多对一），不再限制左右数量要相等。
  // 旧数据（config.pairs，左右各一个、隐含1对1）在读取时会自动转成这个
  // 新形状（每对pair拆成一个左物件+一个右物件+一条edge），运行时
  // LineMatchGame.tsx 也保留了同样的向后兼容转换，旧 Activity 不用重新编辑就能继续玩。
  interface LineMatchItem { id: string; type: "text" | "image"; content: string }
  interface LineMatchEdge { leftId: string; rightId: string }
  const [lineMatchLeftItems, setLineMatchLeftItems] = useState<LineMatchItem[]>([{ id: uid(), type: "text", content: "" }]);
  const [lineMatchRightItems, setLineMatchRightItems] = useState<LineMatchItem[]>([{ id: uid(), type: "text", content: "" }]);
  const [lineMatchEdges, setLineMatchEdges] = useState<LineMatchEdge[]>([]);
  const [lineMatchConnectFrom, setLineMatchConnectFrom] = useState<string | null>(null); // 连线时先点的那个item的id，等第二下点击完成一条线
  const [lineMatchShuffleRight, setLineMatchShuffleRight] = useState(true);
  // "列表配对"（左右两栏，上面这几个state）vs "自定义画面"（背景图+自由
  // 摆放物件，复用 SceneEditor structuredMode）。自由摆放那边的"配对"靠
  // 物件的 objectType 字段当分组标记——同一个标记的所有物件必须互相连
  // 成一团（不再像最早版本那样限制正好2个，3个、4个共用一个标记也行，
  // 对应"一组可以超过两个成员"这个需求）。
  const [lineMatchLayout, setLineMatchLayout] = useState<"list" | "scene">("list");
  const [lineMatchScene, setLineMatchScene] = useState<StructuredSceneOutput | null>(null);

  // ppt_lecture / video_lecture fields — 讲义类，不是游戏，没有对错判断。
  // 字段名直接对齐 courses.controller.ts 实际存的 config 形状：
  // ppt_lecture 存 slide_image_urls（已转换好的幻灯片图片阵列）+
  // original_filename；video_lecture 存 video_url + poster_image_url。
  const [pptSlideUrls, setPptSlideUrls] = useState<string[]>([]);
  const [pptOriginalFilename, setPptOriginalFilename] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoPosterUrl, setVideoPosterUrl] = useState<string | null>(null);

  // play_along fields — 跟弹练习：乐谱(多页图片) + 音频 + 一串"这个时间点
  // 对应乐谱第几页哪个高度"的标记。markers 是设计师在编辑器里边放音频
  // 边点乐谱边打出来的，字段名对齐 0XZ_play_along_module.sql 那张表。
  // PlayAlongMarker 类型定义在文件上面（PlayAlongMarkerEditor 旁边），
  // 两处共用同一个，不用各自重复定义。
  const [paSheetUrls, setPaSheetUrls] = useState<string[]>([]);
  const [paOriginalFilename, setPaOriginalFilename] = useState("");
  const [paAudioUrl, setPaAudioUrl] = useState<string | null>(null);
  const [paMarkers, setPaMarkers] = useState<PlayAlongMarker[]>([]);
  const [paEditorPage, setPaEditorPage] = useState(0); // 编辑器当前显示第几页，不存进config，纯UI状态
  const [paOriginalBpm, setPaOriginalBpm] = useState(120); // 这首曲子的原速，播放器那边按BPM调速度要拿这个换算倍率

  // coloring fields
  const [coloringBgUrl, setColoringBgUrl] = useState<string | null>(null);
  const [coloringRegions, setColoringRegions] = useState<ColoringRegionDraft[]>([]);
  const [coloringMaskDataUrl, setColoringMaskDataUrl] = useState<string | null>(null);

  // maze fields — authored, not generated: bg image + a hand-painted mask
  const [mazeBgUrl, setMazeBgUrl] = useState<string | null>(null);
  const [mazeTool, setMazeTool] = useState<"paint" | "erase" | "fill" | "fillErase" | "barrier" | "start" | "end">("paint");
  const [mazeBrushWidth, setMazeBrushWidth] = useState(22);
  const [mazePaintColor, setMazePaintColor] = useState("#4fb06d"); // 画笔/填充共用这个颜色，只是给设计师看清楚画了哪里用的，蒙版真正判定"能不能走"只看透明度，颜色本身不影响判定逻辑
  // 多组起点/终点配对——同时有好几个球，每个球各自要走到自己配对的终点。
  // mazeActivePairIdx 决定"设起点"/"设终点"这两个工具现在改的是哪一对。
  interface MazePairDraft { start: { x: number; y: number } | null; end: { x: number; y: number } | null }
  const [mazePairs, setMazePairs] = useState<MazePairDraft[]>([{ start: null, end: null }]);
  const [mazeActivePairIdx, setMazeActivePairIdx] = useState(0);
  const [mazeEditMode, setMazeEditMode] = useState<"path" | "decorate">("path");
  const [mazeHistoryCount, setMazeHistoryCount] = useState(0); // just for enabling/disabling the undo button
  const mazeCanvasRef = useRef<HTMLCanvasElement>(null);
  const mazeMaskCanvasRef = useRef<HTMLCanvasElement | null>(null); // offscreen: accumulates the painted mask
  // 分隔线——纯粹是设计时用来"框住"填充范围的辅助线，不算进蒙版本身，
  // 也不会存进最终的关卡数据。背景图上如果是一整条连在一起的路（比如
  // 螺旋迷宫那种从头到尾没有分岔的画法），"填充"认颜色的话会整条路一
  // 起填满；先在中间画几道分隔线当"墙"，填充遇到这些线就不会继续漫过
  // 去，才能只填其中一段。
  const mazeBarrierCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mazeBgImgRef = useRef<HTMLImageElement | null>(null);
  const mazePaintingRef = useRef(false);
  // Undo history for the mask only — a fill click on an unbounded area covers
  // the WHOLE canvas in one go (that's correct bucket-fill behaviour, same as
  // any paint program), which makes "no way to undo" a real trap, not just
  // an inconvenience. History is ImageData snapshots, captured once per
  // stroke/click (pointerdown), not per pointermove — so one paint DRAG is
  // one undo step, not hundreds.
  const mazeHistoryRef = useRef<ImageData[]>([]);

  // spot_diff fields
  const [imgAUrl, setImgAUrl] = useState<string | null>(null);
  const [imgBUrl, setImgBUrl] = useState<string | null>(null);
  const [hotspots, setHotspots] = useState<SpotDiffHotspotDraft[]>([]);

  // ── Maze: paint the mask + render background/markers ─────────────────────
  const MZ_W = GAME_CANVAS_W, MZ_H = GAME_CANVAS_H;
  const mazeRedraw = useCallback(() => {
    const ctx = mazeCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, MZ_W, MZ_H);
    if (mazeBgImgRef.current) ctx.drawImage(mazeBgImgRef.current, 0, 0, MZ_W, MZ_H);
    if (mazeMaskCanvasRef.current) {
      ctx.save(); ctx.globalAlpha = 0.45;
      ctx.drawImage(mazeMaskCanvasRef.current, 0, 0);
      ctx.restore();
    }
    if (mazeBarrierCanvasRef.current) {
      ctx.save(); ctx.globalAlpha = 0.85;
      ctx.drawImage(mazeBarrierCanvasRef.current, 0, 0);
      ctx.restore();
    }
    mazePairs.forEach((p, i) => {
      const color = MZ_BALL_COLORS[i % MZ_BALL_COLORS.length];
      const active = i === mazeActivePairIdx;
      if (p.start) {
        ctx.beginPath(); ctx.arc(p.start.x * MZ_W, p.start.y * MZ_H, 16, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = active ? "#222" : "#fff"; ctx.lineWidth = active ? 4 : 3; ctx.stroke();
      }
      if (p.end) {
        ctx.beginPath(); ctx.arc(p.end.x * MZ_W, p.end.y * MZ_H, 16, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = active ? "#222" : "#fff"; ctx.lineWidth = active ? 4 : 3; ctx.stroke();
        ctx.font = "14px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#fff";
        ctx.fillText("🏁", p.end.x * MZ_W, p.end.y * MZ_H + 5);
      }
    });
  }, [mazePairs, mazeActivePairIdx]);

  // mazeEditMode 也要放进依赖——切"装饰模式"再切回"画路径模式"的时候，
  // 画路径那个 <canvas> 是全新挂载的（切走的时候整个卸载掉了），画布本身
  // 是空白的，不会自动记得之前画过什么，必须重新触发一次画上去的动作。
  useEffect(() => { if (open && moduleType === "maze" && mazeEditMode === "path") mazeRedraw(); }, [open, moduleType, mazeRedraw, mazeBgUrl, mazeEditMode]);

  async function handleMazeBgUpload(file: File) {
    const dataUrl = await readAsDataURL(file);
    handleMazeBgSelect(dataUrl);
  }

  function handleMazeBgSelect(dataUrl: string) {
    const img = new Image();
    img.crossOrigin = "anonymous"; // 图片可能来自不同源，不设这个的话"填充"读取背景图颜色时会因为"跨域画布污染"报错
    img.onload = () => {
      mazeBgImgRef.current = img;
      const mask = document.createElement("canvas");
      mask.width = MZ_W; mask.height = MZ_H;
      mazeMaskCanvasRef.current = mask;
      const barrier = document.createElement("canvas");
      barrier.width = MZ_W; barrier.height = MZ_H;
      mazeBarrierCanvasRef.current = barrier;
      mazeHistoryRef.current = []; setMazeHistoryCount(0);
      mazeRedraw();
    };
    img.src = dataUrl;
    setMazeBgUrl(dataUrl);
  }

  // 装饰模式改完背景图之后回调这个——只换图片本身，蒙版（已经画好的能
  // 走的路）完全不动。跟上面 handleMazeBgSelect 的差别就在这里：那个是
  // "换一张全新的图"，理所当然要清空蒙版重新画；这个是"同一张图上加了
  // 点装饰"，路径不该被清掉。
  function handleMazeDecorationUpdate(dataUrl: string) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { mazeBgImgRef.current = img; mazeRedraw(); };
    img.src = dataUrl;
    setMazeBgUrl(dataUrl);
  }

  function pushMazeHistory() {
    const mc = mazeMaskCanvasRef.current;
    if (!mc) return;
    const ctx = mc.getContext("2d")!;
    mazeHistoryRef.current = [...mazeHistoryRef.current.slice(-19), ctx.getImageData(0, 0, MZ_W, MZ_H)];
    setMazeHistoryCount(mazeHistoryRef.current.length);
  }
  function undoMaze() {
    const mc = mazeMaskCanvasRef.current;
    if (!mc || mazeHistoryRef.current.length === 0) return;
    const last = mazeHistoryRef.current[mazeHistoryRef.current.length - 1];
    mazeHistoryRef.current = mazeHistoryRef.current.slice(0, -1);
    setMazeHistoryCount(mazeHistoryRef.current.length);
    mc.getContext("2d")!.putImageData(last, 0, 0);
    mazeRedraw();
  }

  function mazeToolAt(px: number, py: number) {
    if (mazeTool === "barrier") {
      const bc = mazeBarrierCanvasRef.current;
      if (!bc) return;
      const bctx = bc.getContext("2d")!;
      bctx.globalCompositeOperation = "source-over";
      bctx.fillStyle = "#ff3b30";
      bctx.beginPath(); bctx.arc(px, py, Math.max(3, mazeBrushWidth / 3), 0, Math.PI * 2); bctx.fill();
      mazeRedraw();
      return;
    }
    const mc = mazeMaskCanvasRef.current;
    if (!mc) return;
    const ctx = mc.getContext("2d")!;
    if (mazeTool === "paint") {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = mazePaintColor;
      ctx.beginPath(); ctx.arc(px, py, mazeBrushWidth, 0, Math.PI * 2); ctx.fill();
    } else if (mazeTool === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath(); ctx.arc(px, py, mazeBrushWidth, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    mazeRedraw();
  }

  function clearMazeBarriers() {
    const bc = mazeBarrierCanvasRef.current;
    if (!bc) return;
    bc.getContext("2d")!.clearRect(0, 0, MZ_W, MZ_H);
    mazeRedraw();
  }

  // 桶装填色 (bucket fill) — click once inside an enclosed empty area and it
  // fills the whole connected region in one go, instead of painting every
  // pixel by hand with the brush. Iterative (stack-based, not recursive) so
  // a large fill on a 900×620 canvas can't blow the call stack. Matches
  // same-state connected pixels by alpha (empty vs already-painted), same
  // "walkable" classification the play engine's pixel sampling uses.
  function bucketFillAt(px: number, py: number, erase: boolean) {
    const mc = mazeMaskCanvasRef.current;
    if (!mc) return;
    const ctx = mc.getContext("2d")!;
    const w = MZ_W, h = MZ_H;
    const startX = Math.floor(px), startY = Math.floor(py);
    if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;

    const maskData = ctx.getImageData(0, 0, w, h);
    const idx = (x: number, y: number) => (y * w + x) * 4;
    const visited = new Uint8Array(w * h);
    const stack: [number, number][] = [[startX, startY]];

    if (!erase) {
      // "填充"——认背景图片本身画好的路径颜色，不是认蒙版上还没画过什么
      // （之前那版只看蒙版，蒙版一开始整片都是空的，路径线只要有一丁点
      // 没封住，颜色就会顺着缺口漏出去、把整张图填满）。这张图本来就已
      // 经画好一条边界清楚的路，直接照着这条路自己的颜色、封闭边界去
      // 判断范围，才是真正"聪明"的填充，不用逼着用画笔重新描一次轮廓。
      const off = document.createElement("canvas");
      off.width = w; off.height = h;
      const octx = off.getContext("2d")!;
      if (mazeBgImgRef.current) octx.drawImage(mazeBgImgRef.current, 0, 0, w, h);
      const bgData = octx.getImageData(0, 0, w, h).data;
      const startI = idx(startX, startY);
      const sr = bgData[startI], sg = bgData[startI + 1], sb = bgData[startI + 2];
      const tol = 40; // 颜色容错——线稿边缘有一点点抗锯齿的渐变色也不会漏出去
      const [pr, pg, pb] = sdHexToRgb(mazePaintColor);
      // 分隔线——设计师自己画的"墙"，填充碰到这里就当成边界，不管背景图
      // 颜色是不是还连着，都不会继续漫过去。这样一条从头到尾没有分岔的
      // 路，也能靠画几道分隔线切成好几段，分开填。
      const barrierCanvas = mazeBarrierCanvasRef.current;
      const barrierData = barrierCanvas ? barrierCanvas.getContext("2d")!.getImageData(0, 0, w, h).data : null;
      while (stack.length) {
        const [x, y] = stack.pop()!;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        const vIdx = y * w + x;
        if (visited[vIdx]) continue;
        const i = idx(x, y);
        if (barrierData && barrierData[i + 3] >= 10) continue; // 撞到分隔线，这条路走不通
        const dr = bgData[i] - sr, dg = bgData[i + 1] - sg, db = bgData[i + 2] - sb;
        if (dr * dr + dg * dg + db * db > tol * tol) continue;
        visited[vIdx] = 1;
        maskData.data[i] = pr; maskData.data[i + 1] = pg; maskData.data[i + 2] = pb; maskData.data[i + 3] = 255;
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
    } else {
      // "删除颜色"——填充的反向操作，清掉蒙版上"已经连在一起的一整块"
      // 已填色区域，这个本来就该认蒙版自己画了什么，跟背景图颜色无关。
      const data = maskData.data;
      const targetIsEmpty = data[idx(startX, startY) + 3] < 10;
      while (stack.length) {
        const [x, y] = stack.pop()!;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        const vIdx = y * w + x;
        if (visited[vIdx]) continue;
        const i = idx(x, y);
        const matches = targetIsEmpty ? data[i + 3] < 10 : data[i + 3] >= 10;
        if (!matches) continue;
        visited[vIdx] = 1;
        data[i + 3] = 0; // transparent → "not walkable" again
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
    }

    ctx.putImageData(maskData, 0, 0);
    mazeRedraw();
  }

  function mazeCanvasXY(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = mazeCanvasRef.current!.getBoundingClientRect();
    const scaleX = MZ_W / rect.width, scaleY = MZ_H / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handleMazePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!mazeBgUrl) return;
    const { x, y } = mazeCanvasXY(e);
    if (mazeTool === "start") {
      setMazePairs((ps) => ps.map((p, i) => (i === mazeActivePairIdx ? { ...p, start: { x: x / MZ_W, y: y / MZ_H } } : p)));
      return;
    }
    if (mazeTool === "end") {
      setMazePairs((ps) => ps.map((p, i) => (i === mazeActivePairIdx ? { ...p, end: { x: x / MZ_W, y: y / MZ_H } } : p)));
      return;
    }
    if (mazeTool === "fill") { pushMazeHistory(); bucketFillAt(x, y, false); return; } // single click, not a drag
    if (mazeTool === "fillErase") { pushMazeHistory(); bucketFillAt(x, y, true); return; }
    pushMazeHistory();
    mazePaintingRef.current = true;
    mazeToolAt(x, y);
  }
  function handleMazePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!mazePaintingRef.current) return;
    const { x, y } = mazeCanvasXY(e);
    mazeToolAt(x, y);
  }
  function handleMazePointerUp() { mazePaintingRef.current = false; }

  // 弹窗真正打开的那一刻，重新对一次 moduleType——只在"关闭时重置"不够，
  // 因为如果弹窗从上一次打开到现在都还没关过（或者根本还没打开过第
  // 一次），presetModuleType 在这期间可能已经变了（比如用户在没关掉
  // 弹窗的情况下，换了个类型的列表页），只在关闭那一刻同步的话会漏掉
  // 这种情况，导致选了"数独"点加号，跳出来的却还是上一次的旧类型。
  useEffect(() => {
    if (open && !editingLevelId) {
      setModuleType((presetModuleType as ModuleType) ?? "counting");
    }
  }, [open, editingLevelId, presetModuleType]);

  // reset when the modal is closed so re-opening starts fresh
  useEffect(() => {
    if (!open) {
      setLevelTitle(""); setModuleType((presetModuleType as ModuleType) ?? "counting");
      setChineseStrokeChars([]); setChineseStrokeInput("");
      setMcScene(null); setMcAnswerMode("single");
      setMcOptions([{ id: "opt1", zh: "", en: "", ms: "", correct: false }, { id: "opt2", zh: "", en: "", ms: "", correct: false }]);
      setMcQuestionZh(""); setMcQuestionEn(""); setMcQuestionMs("");
      setFbScene(null); setFbSentenceZh(""); setFbSentenceEn(""); setFbSentenceMs(""); setFbBlankAnswers([""]);
      setExplanationText(""); setExplanationImageUrl(null); setExplanationVideoUrl("");
      setHintText(""); setAudioUrl(null); setAudioFileName("");
      setSubjectId(""); setCategoryId(""); setCategoryIds([]); setGroupId(""); setCurriculumTypeId("");
      setActiveTab("basic");
      setActivityType("game"); setTeachingModes([]); setDifficulty("");
      setAgeGroupMin(""); setAgeGroupMax(""); setDurationMinutes("");
      setLearningOutcomes(""); setSkillsInput(""); setActivityLanguage("universal"); setActivityTagsInput("");
      setUsageContexts([]); setSelfGuidedProgrammeIds([]);
      setParentPreviewEnabled(false);
      setCoverImageUrl(null);
      setTheme("apple"); setMinVal(1); setMaxVal(10); setNumChoices(3); setTotalQuestions(5);
      setCountingMode("random"); setCountingScene(null); setCountingTargetTypes([]); setCountingQuestionText(""); setCustomQuestionText("");
      setGridSize(4);
      setFtMode("grid"); setFtScene(null);
      setMemoryTheme("animal"); setPairsCount(6); setPreviewSeconds(3);
      setMemoryMode("preset"); setMemoryCustomIcons([]); setMemoryBgUrl(null); setMemoryLayout("grid"); setMemoryScene(null);
      setPatternTheme("shape"); setPatternTypes(["AB","ABC","AAB","ABB","AABB"]); setSeqLength(7);
      setWpCategories(["chicken_rabbit"]); setWpAnswerMode("select");
      setMazeBgUrl(null); setMazeTool("paint"); setMazeBrushWidth(22); setMazePairs([{ start: null, end: null }]); setMazeActivePairIdx(0);
      mazeHistoryRef.current = []; setMazeHistoryCount(0);
      mazeMaskCanvasRef.current = null; mazeBgImgRef.current = null; mazeBarrierCanvasRef.current = null;
      setSudokuBgUrl(null); setSudokuCells([]); setSudokuDifficulty("medium");
      setSudokuLayout("photo"); setSudokuScene(null);
      setNmBgUrl(null); setNmMaskDataUrl(null); setNmStart(null); setNmEnd(null); setNmDecisionPoints([]);
      setNmLayout("path"); setNmScene(null);
      setStickerScene(null);
      setLineMatchLeftItems([{ id: uid(), type: "text", content: "" }]);
      setLineMatchRightItems([{ id: uid(), type: "text", content: "" }]);
      setLineMatchEdges([]); setLineMatchConnectFrom(null); setLineMatchShuffleRight(true);
      setLineMatchLayout("list"); setLineMatchScene(null);
      setPptSlideUrls([]); setPptOriginalFilename(""); setVideoUrl(null); setVideoPosterUrl(null);
      setPaSheetUrls([]); setPaOriginalFilename(""); setPaAudioUrl(null); setPaMarkers([]); setPaEditorPage(0); setPaOriginalBpm(120);
      setColoringBgUrl(null); setColoringRegions([]); setColoringMaskDataUrl(null);
      setImgAUrl(null); setImgBUrl(null); setHotspots([]);
    }
  }, [open]);

  // 编辑模式 — fetch the existing level and populate every relevant piece
  // of state, branching on module_type the same way handleSave's switch
  // does. module_type itself is NOT set here as editable — see the
  // disabled dropdown below — this only fills in everything else.
  useEffect(() => {
    if (!open || !editingLevelId) return;
    eduApi.getLevelForEdit(editingLevelId).then((level) => {
      setModuleType(level.module_type as typeof moduleType);
      setLevelTitle(level.title_i18n?.zh ?? level.title_i18n?.en ?? "");
      setExplanationText(level.explanation_text ?? "");
      setExplanationImageUrl(level.explanation_image_url ?? null);
      setExplanationVideoUrl(level.explanation_video_url ?? "");
      setHintText(level.hint_text ?? "");
      setAudioUrl(level.audio_url ?? null);
      if (level.audio_url) setAudioFileName("已有音频");
      setCategoryIds(level.category_ids ?? []);
      setCategoryId(level.category_ids?.[0] ?? level.category_id ?? "");
      setGroupId(level.group_id ?? ""); setCurriculumTypeId(level.curriculum_type_id ?? "");
      setActivityType(level.activity_type ?? "game");
      setTeachingModes(level.teaching_modes ?? []);
      setDifficulty(level.difficulty ?? "");
      setAgeGroupMin(level.age_group_min != null ? String(level.age_group_min) : "");
      setAgeGroupMax(level.age_group_max != null ? String(level.age_group_max) : "");
      setDurationMinutes(level.duration_minutes != null ? String(level.duration_minutes) : "");
      setLearningOutcomes(level.learning_outcomes ?? "");
      setSkillsInput((level.skills_developed ?? []).join("、"));
      setActivityLanguage(level.language ?? "universal");
      setActivityTagsInput((level.tags ?? []).join("、"));
      setUsageContexts((level as { usage_contexts?: string[] }).usage_contexts ?? []);
      setSelfGuidedProgrammeIds((level as { self_guided_programme_ids?: string[] }).self_guided_programme_ids ?? []);
      setParentPreviewEnabled((level as { parent_preview_enabled?: boolean }).parent_preview_enabled === true);
      setCoverImageUrl((level as { cover_image_url?: string }).cover_image_url ?? null);

      const cfg = level.config as Record<string, unknown>;
      // 通用读取——8个模块共用同一个栏位，这里统一处理一次，不用在每个
      // module_type 分支里各写一遍。counting自己有独立的一套，不受影响。
      const sharedQi18n = cfg.question_i18n as Record<string, string> | undefined;
      setCustomQuestionText(sharedQi18n?.zh ?? sharedQi18n?.en ?? "");
      if (level.module_type === "counting") {
        if (cfg.mode === "custom_scene") {
          setCountingMode("custom_scene");
          const positions = (cfg.positions as Array<{ x: number; y: number; image_url?: string; w?: number; h?: number; rotation?: number; type?: string; flip_x?: boolean; flip_y?: boolean }>) ?? [];
          setCountingScene({
            bgUrl: (cfg.bg_image_url as string) ?? null,
            objects: positions.map((p) => ({
              imageUrl: p.image_url ?? (cfg.custom_icon_url as string) ?? "",
              x: p.x * GAME_CANVAS_W, y: p.y * GAME_CANVAS_H,
              w: p.w ?? 80, h: p.h ?? 80, rotation: p.rotation ?? 0,
              objectType: p.type ?? "",
              flipX: p.flip_x ?? false, flipY: p.flip_y ?? false,
            })),
            texts: ((cfg.texts as StructuredSceneOutput["texts"]) ?? []).map((t) => ({ ...t, x: t.x * GAME_CANVAS_W, y: t.y * GAME_CANVAS_H })),
          });
          setCountingTargetTypes((cfg.target_types as string[]) ?? []);
          const qi18n = cfg.question_i18n as Record<string, string> | undefined;
          setCountingQuestionText(qi18n?.zh ?? qi18n?.en ?? "");
        } else {
          setCountingMode("random");
          setTheme((cfg.theme as string) ?? "apple");
          setMinVal((cfg.min_val as number) ?? 1); setMaxVal((cfg.max_val as number) ?? 10);
          setNumChoices((cfg.num_choices as number) ?? 3); setTotalQuestions((cfg.total_questions as number) ?? 5);
        }
      } else if (level.module_type === "spot_diff") {
        setImgAUrl((cfg.image_a_url as string) ?? null);
        setImgBUrl((cfg.image_b_url as string) ?? null);
        setHotspots((cfg.hotspots as SpotDiffHotspotDraft[]) ?? []);
      } else if (level.module_type === "focus_tap") {
        setFtMode(((cfg.mode as string) ?? "grid") as "grid" | "custom");
        setGridSize((cfg.grid_size as number) ?? 4);
        const ftPositionsRaw = (cfg.positions as Array<{ x: number; y: number; image_url?: string; w?: number; h?: number; rotation?: number }>) ?? [];
        const ftBg = (cfg.bg_image_url as string) ?? null;
        setFtScene(ftBg || ftPositionsRaw.length > 0 ? {
          bgUrl: ftBg,
          objects: ftPositionsRaw.map((p) => ({
            imageUrl: p.image_url ?? FT_MARKER_ICON,
            x: p.x * GAME_CANVAS_W, y: p.y * GAME_CANVAS_H,
            w: p.w ?? 60, h: p.h ?? 60, rotation: p.rotation ?? 0,
          })),
          texts: [],
        } : null);
      } else if (level.module_type === "memory") {
        if (cfg.theme === "custom") {
          setMemoryMode("custom");
          setMemoryCustomIcons((cfg.custom_icons as string[]) ?? []);
          setMemoryBgUrl((cfg.bg_image_url as string) ?? null);
          const mLayout = ((cfg.layout as string) ?? "grid") as "grid" | "free";
          setMemoryLayout(mLayout);
          const mPositions = (cfg.positions as Array<{ x: number; y: number }>) ?? [];
          setMemoryScene(mLayout === "free" && cfg.bg_image_url ? {
            bgUrl: cfg.bg_image_url as string,
            objects: mPositions.map((p) => ({
              imageUrl: FT_MARKER_ICON,
              x: p.x * GAME_CANVAS_W, y: p.y * GAME_CANVAS_H,
              w: 60, h: 60, rotation: 0,
            })),
            texts: [],
          } : null);
        } else {
          setMemoryMode("preset");
          setMemoryTheme((cfg.theme as string) ?? "animal");
        }
        setPairsCount((cfg.pairs_count as number) ?? 6); setPreviewSeconds((cfg.preview_seconds as number) ?? 3);
      } else if (level.module_type === "pattern") {
        setPatternTheme((cfg.theme as string) ?? "shape");
        setPatternTypes((cfg.pattern_types as string[]) ?? ["AB","ABC","AAB","ABB","AABB"]);
        setSeqLength((cfg.seq_length as number) ?? 7);
        setTotalQuestions((cfg.total_questions as number) ?? 5);
      } else if (level.module_type === "cube_stack") {
        setCubeStackStartingLevel((cfg.starting_level as number) ?? 1);
        setTotalQuestions((cfg.total_questions as number) ?? 5);
      } else if (level.module_type === "cube_layer_count") {
        setCubeStackStartingLevel((cfg.starting_level as number) ?? 1);
        setTotalQuestions((cfg.total_questions as number) ?? 5);
        setCubeMaxSplitLayers((cfg.max_split_layers as number) ?? 5);
      } else if (level.module_type === "cube_find_hidden") {
        setCubeStackStartingLevel((cfg.starting_level as number) ?? 1);
        setTotalQuestions((cfg.total_questions as number) ?? 5);
        setCubeHiddenTargets((cfg.hidden_targets as number) ?? 1);
      } else if (level.module_type === "cube_free_rotate") {
        setCubeFreeRotateShapes((cfg.total_shapes as number) ?? 3);
        setCubeFreeRotateSize((cfg.shape_size as number) ?? 3);
        setCubeFreeRotateMinSec((cfg.min_view_seconds as number) ?? 5);
      } else if (level.module_type === "cube_build") {
        setCubeStackStartingLevel((cfg.starting_level as number) ?? 1);
        setTotalQuestions((cfg.total_questions as number) ?? 5);
      } else if (level.module_type === "cube_three_view") {
        setCubeStackStartingLevel((cfg.starting_level as number) ?? 1);
        setTotalQuestions((cfg.total_questions as number) ?? 5);
      } else if (level.module_type === "shape_count") {
        setCubeStackStartingLevel((cfg.starting_level as number) ?? 1);
        setTotalQuestions((cfg.total_questions as number) ?? 5);
        setShapeAskType((cfg.ask_type as "square" | "rectangle" | "both") ?? "both");
        const scLayout = ((cfg.layout as string) ?? "grid") as "grid" | "custom";
        setShapeCountLayout(scLayout);
        if (scLayout === "custom") {
          const scShapes = (cfg.shapes as Array<{ shape: "rect" | "ellipse" | "line" | "triangle"; x: number; y: number; w: number; h: number; rotation: number; fillColor: string; fillEnabled: boolean; borderColor: string; borderEnabled: boolean; borderWidth: number; radius?: number; opacity?: number }>) ?? [];
          const scObjects = (cfg.objects as Array<{ image_url: string; x: number; y: number; w: number; h: number; rotation: number; object_type?: string; flip_x?: boolean; flip_y?: boolean; opacity?: number }>) ?? [];
          setShapeCountScene({
            bgUrl: (cfg.bg_image_url as string) ?? null,
            objects: scObjects.map((o) => ({
              imageUrl: o.image_url, x: o.x * GAME_CANVAS_W, y: o.y * GAME_CANVAS_H,
              w: o.w, h: o.h, rotation: o.rotation, objectType: o.object_type, flipX: o.flip_x, flipY: o.flip_y, opacity: o.opacity,
            })),
            texts: [],
            shapes: scShapes.map((s) => ({
              shape: s.shape, x: s.x * GAME_CANVAS_W, y: s.y * GAME_CANVAS_H, w: s.w, h: s.h, rotation: s.rotation,
              fillColor: s.fillColor, fillEnabled: s.fillEnabled, borderColor: s.borderColor, borderEnabled: s.borderEnabled,
              borderWidth: s.borderWidth, radius: s.radius, opacity: s.opacity,
            })),
          });
        } else {
          setShapeCountScene(null);
        }
      } else if (level.module_type === "clock") {
        setCubeStackStartingLevel((cfg.starting_level as number) ?? 1);
        setTotalQuestions((cfg.total_questions as number) ?? 5);
        setClockMode((cfg.mode as "read" | "set" | "both") ?? "both");
      } else if (level.module_type === "latin_square") {
        setCubeStackStartingLevel((cfg.starting_level as number) ?? 1);
        setTotalQuestions((cfg.total_questions as number) ?? 5);
        setLatinSquareTheme((cfg.theme as "shape" | "animal" | "fruit" | "emotion") ?? "shape");
      } else if (level.module_type === "chinese_stroke") {
        setChineseStrokeChars((cfg.characters as string[]) ?? []);
        setChineseStrokeInput("");
        setTotalQuestions((cfg.total_questions as number) ?? 5);
      } else if (level.module_type === "multiple_choice") {
        const decos = (cfg.objects as Array<{ image_url: string; x: number; y: number; w: number; h: number; rotation: number; flip_x?: boolean; flip_y?: boolean; opacity?: number }>) ?? [];
        const txts = (cfg.texts as Array<{ text: string; x: number; y: number; fontSize: number; color: string; fontFamily: string; rotation: number; bold?: boolean; italic?: boolean; underline?: boolean }>) ?? [];
        setMcScene(cfg.bg_image_url || decos.length || txts.length ? {
          bgUrl: (cfg.bg_image_url as string) ?? null,
          objects: decos.map((d) => ({
            imageUrl: d.image_url, x: d.x * GAME_CANVAS_W, y: d.y * GAME_CANVAS_H,
            w: d.w, h: d.h, rotation: d.rotation, flipX: d.flip_x, flipY: d.flip_y, opacity: d.opacity,
          })),
          texts: txts.map((tx) => ({
            text: tx.text, x: tx.x * GAME_CANVAS_W, y: tx.y * GAME_CANVAS_H, fontSize: tx.fontSize,
            color: tx.color, fontFamily: tx.fontFamily, rotation: tx.rotation, bold: tx.bold, italic: tx.italic, underline: tx.underline,
          })),
        } : null);
        setMcAnswerMode(((cfg.answer_mode as string) ?? "single") as "single" | "multi");
        const opts = (cfg.options as Array<{ id: string; text_i18n?: Record<string, string> }>) ?? [];
        const correctIds = new Set((cfg.correct_option_ids as string[]) ?? []);
        setMcOptions(opts.length >= 2 ? opts.map((o) => ({
          id: o.id, zh: o.text_i18n?.zh ?? "", en: o.text_i18n?.en ?? "", ms: o.text_i18n?.ms ?? "", correct: correctIds.has(o.id),
        })) : [{ id: "opt1", zh: "", en: "", ms: "", correct: false }, { id: "opt2", zh: "", en: "", ms: "", correct: false }]);
        const mcQi18n = cfg.question_i18n as Record<string, string> | undefined;
        setMcQuestionZh(mcQi18n?.zh ?? ""); setMcQuestionEn(mcQi18n?.en ?? ""); setMcQuestionMs(mcQi18n?.ms ?? "");
      } else if (level.module_type === "fill_blank") {
        const decos = (cfg.objects as Array<{ image_url: string; x: number; y: number; w: number; h: number; rotation: number; flip_x?: boolean; flip_y?: boolean; opacity?: number }>) ?? [];
        const txts = (cfg.texts as Array<{ text: string; x: number; y: number; fontSize: number; color: string; fontFamily: string; rotation: number; bold?: boolean; italic?: boolean; underline?: boolean }>) ?? [];
        setFbScene(cfg.bg_image_url || decos.length || txts.length ? {
          bgUrl: (cfg.bg_image_url as string) ?? null,
          objects: decos.map((d) => ({
            imageUrl: d.image_url, x: d.x * GAME_CANVAS_W, y: d.y * GAME_CANVAS_H,
            w: d.w, h: d.h, rotation: d.rotation, flipX: d.flip_x, flipY: d.flip_y, opacity: d.opacity,
          })),
          texts: txts.map((tx) => ({
            text: tx.text, x: tx.x * GAME_CANVAS_W, y: tx.y * GAME_CANVAS_H, fontSize: tx.fontSize,
            color: tx.color, fontFamily: tx.fontFamily, rotation: tx.rotation, bold: tx.bold, italic: tx.italic, underline: tx.underline,
          })),
        } : null);
        const sentI18n = cfg.sentence_i18n as Record<string, string> | undefined;
        setFbSentenceZh(sentI18n?.zh ?? ""); setFbSentenceEn(sentI18n?.en ?? ""); setFbSentenceMs(sentI18n?.ms ?? "");
        const blanksArr = (cfg.blanks as Array<{ accepted_answers: string[] }>) ?? [];
        setFbBlankAnswers(blanksArr.length ? blanksArr.map((b) => (b.accepted_answers ?? []).join(",")) : [""]);
      } else if (level.module_type === "word_problem") {
        setWpCategories((cfg.categories as string[]) ?? ["chicken_rabbit"]);
        setWpAnswerMode(((cfg.answer_mode as string) ?? "select") as "select" | "input");
        setTotalQuestions((cfg.total_questions as number) ?? 5);
      } else if (level.module_type === "sudoku") {
        const layout = (cfg.layout as "photo" | "grid") ?? "photo";
        setSudokuLayout(layout);
        setSudokuDifficulty(((cfg.difficulty as string) ?? "medium") as "easy" | "medium" | "hard" | "custom");
        if (layout === "grid") {
          // 跟 photo 模式一样的限制——getLevel 不会把留空格子的正确答案
          // 送回来（安全考量，见 checkSudoku 那边的说明），所以重新编辑
          // grid 模式的数独，留空格子会是空的占位符，设计师要重新打一次
          // 答案；给定的数字(given_cells)不是要藏的答案，会正常还原。
          const rows = (cfg.rows as number) ?? 4, cols = (cfg.cols as number) ?? 4;
          const givenCells = (cfg.given_cells as Array<{ row: number; col: number; value: string }>) ?? [];
          const blankCells = (cfg.blank_cells as Array<{ row: number; col: number; answer?: string }>) ?? [];
          const cells: { value: string; blank: boolean; answer?: string }[][] = Array.from({ length: rows }, () =>
            Array.from({ length: cols }, () => ({ value: "", blank: false }))
          );
          givenCells.forEach((c) => { if (cells[c.row]?.[c.col]) cells[c.row][c.col] = { value: c.value, blank: false }; });
          blankCells.forEach((c) => { if (cells[c.row]?.[c.col]) cells[c.row][c.col] = { value: "", blank: true, answer: c.answer ?? "" }; });
          setSudokuScene({
            bgUrl: null, objects: [], texts: [],
            grids: [{
              x: GAME_CANVAS_W / 2, y: GAME_CANVAS_H / 2, w: 320, h: 320, rotation: 0,
              rows, cols, cells,
              lineColor: (cfg.line_color as string) ?? "#333333",
              givenColor: (cfg.given_color as string) ?? "#222222",
              blankBg: (cfg.blank_bg as string) ?? "#fff3d6",
              bgColor: (cfg.bg_color as string) ?? "#ffffff",
              bgEnabled: (cfg.bg_enabled as boolean) ?? false,
              opacity: cfg.opacity as number | undefined,
            }],
          });
        } else {
          setSudokuBgUrl((cfg.bg_image_url as string) ?? null);
          // cells come back from getLevel WITHOUT answers on the play side, but
          // this is the DESIGNER editing their own puzzle — createLevel/
          // updateLevel's own validation requires every cell to have an
          // answer, so editing needs the real digits, not the play-side
          // redacted shape. Re-fetching with answers isn't exposed by a
          // separate endpoint (deliberately — see checkSudoku's comment on
          // why), so for now editing a sudoku re-enters cells as blank
          // placeholders the designer re-types — noted in the UI below.
          const cells = (cfg.cells as Array<{ x: number; y: number; answer?: number }>) ?? [];
          setSudokuCells(cells.map((c) => ({ x: c.x, y: c.y, answer: c.answer ? String(c.answer) : "" })));
        }
      } else if (level.module_type === "number_maze") {
        const layout = (cfg.layout as "path" | "grid") ?? "path";
        setNmLayout(layout);
        if (layout === "grid") {
          const rows = (cfg.rows as number) ?? 4, cols = (cfg.cols as number) ?? 4;
          const cells = (cfg.cells as string[][]) ?? Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));
          const path = (cfg.path as Array<{ row: number; col: number }>) ?? [];
          const gridCells: { value: string; blank: boolean; pathStep?: number }[][] = cells.map((rowArr) => rowArr.map((v) => ({ value: v, blank: false })));
          path.forEach((p, i) => { if (gridCells[p.row]?.[p.col]) gridCells[p.row][p.col].pathStep = i + 1; });
          setNmScene({
            bgUrl: null, objects: [], texts: [],
            grids: [{
              x: GAME_CANVAS_W / 2, y: GAME_CANVAS_H / 2, w: 320, h: 320, rotation: 0,
              rows, cols, cells: gridCells,
              lineColor: (cfg.line_color as string) ?? "#333333",
              givenColor: (cfg.given_color as string) ?? "#222222",
              blankBg: "#fff3d6",
              bgColor: (cfg.bg_color as string) ?? "#ffffff",
              bgEnabled: (cfg.bg_enabled as boolean) ?? false,
              opacity: cfg.opacity as number | undefined,
            }],
          });
        } else {
          setNmBgUrl((cfg.bg_image_url as string) ?? null);
          setNmMaskDataUrl((cfg.mask_image_url as string) ?? null);
          setNmStart((cfg.start as { x: number; y: number }) ?? null);
          setNmEnd((cfg.end as { x: number; y: number }) ?? null);
          setNmDecisionPoints((cfg.decision_points as NumberMazeDecisionPoint[]) ?? []);
        }
      } else if (level.module_type === "sticker_game") {
        const objects = (cfg.objects as Array<{ image_url: string; x: number; y: number; w: number; h: number; rotation: number; type?: string; flip_x?: boolean; flip_y?: boolean }>) ?? [];
        setStickerScene({
          bgUrl: (cfg.bg_image_url as string) ?? null,
          objects: objects.map((o) => ({
            imageUrl: o.image_url,
            x: o.x, y: o.y, // 保存端已经不再除以GAME_CANVAS_W/H了（原始像素值），这里也别再乘回去，两边要对称
            w: o.w, h: o.h, rotation: o.rotation,
            objectType: o.type ?? "",
            flipX: o.flip_x ?? false, flipY: o.flip_y ?? false,
          })),
          texts: [],
        });
      } else if (level.module_type === "line_match") {
        const layout = (cfg.layout as "list" | "scene") ?? "list";
        setLineMatchLayout(layout);
        if (layout === "scene") {
          const objs = (cfg.objects as Array<{ image_url: string; x: number; y: number; w: number; h: number; rotation: number; pair_key?: string; flip_x?: boolean; flip_y?: boolean; opacity?: number }>) ?? [];
          setLineMatchScene({
            bgUrl: (cfg.bg_image_url as string) ?? null,
            objects: objs.map((o) => ({
              imageUrl: o.image_url,
              x: o.x * GAME_CANVAS_W, y: o.y * GAME_CANVAS_H,
              w: o.w * GAME_CANVAS_W, h: o.h * GAME_CANVAS_H,
              rotation: o.rotation, objectType: o.pair_key ?? "",
              flipX: o.flip_x, flipY: o.flip_y, opacity: o.opacity,
            })),
            texts: [],
          });
        } else if (cfg.left_items && cfg.right_items) {
          // 新形状——直接读
          setLineMatchLeftItems(cfg.left_items as LineMatchItem[]);
          setLineMatchRightItems(cfg.right_items as LineMatchItem[]);
          setLineMatchEdges((cfg.edges as LineMatchEdge[]) ?? []);
        } else {
          // 旧形状兼容——config.pairs 是 [{left:{type,content}, right:{type,content}}]，
          // 隐含1对1，拆成新的 左物件+右物件+一条edge，设计师打开旧
          // Activity 编辑时会自动升级，不用手动重建
          const oldPairs = (cfg.pairs as Array<{ left: { type: "text" | "image"; content: string }; right: { type: "text" | "image"; content: string } }>) ?? [];
          if (oldPairs.length > 0) {
            const lefts = oldPairs.map((p) => ({ id: uid(), ...p.left }));
            const rights = oldPairs.map((p) => ({ id: uid(), ...p.right }));
            setLineMatchLeftItems(lefts);
            setLineMatchRightItems(rights);
            setLineMatchEdges(lefts.map((l, i) => ({ leftId: l.id, rightId: rights[i].id })));
          } else {
            setLineMatchLeftItems([{ id: uid(), type: "text", content: "" }]);
            setLineMatchRightItems([{ id: uid(), type: "text", content: "" }]);
            setLineMatchEdges([]);
          }
        }
        setLineMatchShuffleRight((cfg.shuffle_right as boolean) ?? true);
      } else if (level.module_type === "ppt_lecture") {
        setPptSlideUrls((cfg.slide_image_urls as string[]) ?? []);
        setPptOriginalFilename((cfg.original_filename as string) ?? "");
      } else if (level.module_type === "video_lecture") {
        setVideoUrl((cfg.video_url as string) ?? null);
        setVideoPosterUrl((cfg.poster_image_url as string) ?? null);
      } else if (level.module_type === "play_along") {
        setPaSheetUrls((cfg.sheet_image_urls as string[]) ?? []);
        setPaOriginalFilename((cfg.original_filename as string) ?? "");
        setPaAudioUrl((cfg.audio_url as string) ?? null);
        setPaMarkers((cfg.markers as PlayAlongMarker[]) ?? []);
        setPaEditorPage(0);
        setPaOriginalBpm((cfg.original_bpm as number) ?? 120);
      } else if (level.module_type === "coloring") {
        setColoringBgUrl((cfg.bg_image_url as string) ?? null);
        setColoringMaskDataUrl((cfg.region_mask_url as string) ?? null);
        setColoringRegions((cfg.regions as ColoringRegionDraft[]) ?? []);
      } else if (level.module_type === "maze") {
        setMazeBgUrl((cfg.bg_image_url as string) ?? null);
        const cfgPairs = cfg.pairs as Array<{ start: { x: number; y: number }; end: { x: number; y: number } }> | undefined;
        if (cfgPairs && cfgPairs.length > 0) {
          setMazePairs(cfgPairs.map((p) => ({ start: p.start, end: p.end })));
        } else if (cfg.start_x != null) {
          setMazePairs([{ start: { x: cfg.start_x as number, y: cfg.start_y as number }, end: { x: cfg.end_x as number, y: cfg.end_y as number } }]);
        } else {
          setMazePairs([{ start: null, end: null }]);
        }
        setMazeActivePairIdx(0);
        if (cfg.bg_image_url) {
          const bgImg = new Image();
          bgImg.crossOrigin = "anonymous";
          bgImg.onload = () => {
            mazeBgImgRef.current = bgImg;
            const mask = document.createElement("canvas");
            mask.width = MZ_W; mask.height = MZ_H;
            mazeMaskCanvasRef.current = mask;
            const barrier = document.createElement("canvas");
            barrier.width = MZ_W; barrier.height = MZ_H;
            mazeBarrierCanvasRef.current = barrier;
            if (cfg.mask_image_url) {
              const maskImg = new Image();
              maskImg.onload = () => { mask.getContext("2d")!.drawImage(maskImg, 0, 0, MZ_W, MZ_H); mazeRedraw(); };
              maskImg.src = cfg.mask_image_url as string;
            } else { mazeRedraw(); }
          };
          bgImg.src = cfg.bg_image_url as string;
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingLevelId]);

  async function handleUpload(side: "a" | "b", file: File) {
    const dataUrl = await readAsDataURL(file);
    handleSelect(side, dataUrl);
  }

  function handleSelect(side: "a" | "b", dataUrl: string) {
    if (side === "a") setImgAUrl(dataUrl); else setImgBUrl(dataUrl);
  }

  // Dispatches to create or update depending on whether this modal is
  // editing an existing level — every module branch below builds the same
  // payload shape either way, this is the one place that decides which
  // HTTP call that payload actually goes to.
  async function saveLevel(payload: Parameters<typeof eduApi.createLevel>[1]) {
    const activityMeta = {
      activity_type: activityType,
      teaching_modes: teachingModes,
      difficulty: difficulty || undefined,
      age_group_min: ageGroupMin ? Number(ageGroupMin) : undefined,
      age_group_max: ageGroupMax ? Number(ageGroupMax) : undefined,
      duration_minutes: durationMinutes ? Number(durationMinutes) : undefined,
      learning_outcomes: learningOutcomes || undefined,
      skills_developed: skillsInput.split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
      language: activityLanguage,
      tags: activityTagsInput.split(/[,，、]/).map((t) => t.trim()).filter(Boolean).slice(0, 3),
      usage_contexts: usageContexts,
      self_guided_programme_ids: usageContexts.includes("self_guided") ? selfGuidedProgrammeIds : [],
      parent_preview_enabled: parentPreviewEnabled,
      cover_image_url: coverImageUrl || undefined,
    };
    const fullPayload = { ...payload, ...activityMeta };
    if (editingLevelId) await eduApi.updateLevel(editingLevelId, fullPayload);
    else await eduApi.createActivity(fullPayload);
  }

  async function handleSave() {
    // Topic 现在新建、编辑都是选填——可以当下就分类，也可以先建立
    // Activity（先专心把游戏内容做好），之后再回来「编辑」补上
    // Programme/Subject/Topic，不会因为还没想好归到哪个分类就卡住整个
    // 保存流程。
    try {
     if (moduleType === "counting") {
        if (countingMode === "custom_scene") {
          if (!countingScene?.bgUrl) { toast.error("请选背景图片"); return; }
          if (countingScene.objects.length < 1) { toast.error("请至少加1个要数的物件"); return; }
          await saveLevel({
            module_type: "counting",
            title_i18n: { zh: levelTitle || "点点数数", en: levelTitle || "Counting" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,
            hint_text: hintText || undefined, audio_url: audioUrl || undefined,
            category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: {
              mode: "custom_scene", bg_image_url: countingScene.bgUrl,
              positions: countingScene.objects.map((o) => ({ x: o.x / GAME_CANVAS_W, y: o.y / GAME_CANVAS_H, w: o.w, h: o.h, rotation: o.rotation, image_url: o.imageUrl, type: o.objectType || undefined, flip_x: o.flipX || undefined, flip_y: o.flipY || undefined })),
              texts: countingScene.texts.map((t) => ({ ...t, x: t.x / GAME_CANVAS_W, y: t.y / GAME_CANVAS_H })),
              num_choices: numChoices, timer_mode: "stopwatch",
              target_types: countingTargetTypes.length > 0 ? countingTargetTypes : undefined,
              question_i18n: countingQuestionText.trim()
                ? { zh: countingQuestionText.trim(), en: countingQuestionText.trim() }
                : undefined,
            },
          });
        } else {
          await saveLevel({
            module_type: "counting",
            title_i18n: { zh: levelTitle || "点点数数", en: levelTitle || "Counting" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,
            category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: { mode: "random", theme, min_val: minVal, max_val: maxVal, quiz_mode: "select", num_choices: numChoices, total_questions: totalQuestions, timer_mode: "stopwatch" },
          });
        }
      } else if (moduleType === "spot_diff") {
        if (!imgAUrl || !imgBUrl) { toast.error("请上传两张图片"); return; }
        if (hotspots.length < 1) { toast.error("请至少标记一个差异点"); return; }
        await saveLevel({
          module_type: "spot_diff",
          title_i18n: { zh: levelTitle || "找不同之处", en: levelTitle || "Spot the Difference" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,

          hint_text: hintText || undefined, audio_url: audioUrl || undefined,

          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { image_a_url: imgAUrl, image_b_url: imgBUrl, hotspots, timer_mode: "stopwatch", question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined },
        });
      } else if (moduleType === "focus_tap") {
        if (ftMode === "custom") {
          if (!ftScene?.bgUrl) { toast.error("请选背景图片"); return; }
          if (ftScene.objects.length < 2) { toast.error("请至少加2个数字位置标记"); return; }
          await saveLevel({
            module_type: "focus_tap",
            title_i18n: { zh: levelTitle || "专注力点数字", en: levelTitle || "Focus Tap" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,

            category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: {
              mode: "custom", bg_image_url: ftScene.bgUrl,
              positions: ftScene.objects.map((o) => ({ x: o.x / GAME_CANVAS_W, y: o.y / GAME_CANVAS_H, w: o.w, h: o.h, rotation: o.rotation })),
              timer_mode: "stopwatch", question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined,
            },
          });
        } else {
          await saveLevel({
            module_type: "focus_tap",
            title_i18n: { zh: levelTitle || "专注力点数字", en: levelTitle || "Focus Tap" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,

            category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: { mode: "grid", grid_size: gridSize, timer_mode: "stopwatch", question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined },
          });
        }
      } else if (moduleType === "memory") {
        if (memoryMode === "custom") {
          if (memoryCustomIcons.length < 2) { toast.error("请至少加2张配对图片"); return; }
          const needed = memoryCustomIcons.length * 2;
          if (memoryLayout === "free") {
            if (!memoryBgUrl) { toast.error("自由摆放模式请先选背景图"); return; }
            if (!memoryScene || memoryScene.objects.length !== needed) {
              toast.error(`自由摆放需要摆 ${needed} 个位置（配对图片数×2），现在有 ${memoryScene?.objects.length ?? 0} 个——记得在编辑器里点"完成"确认`);
              return;
            }
          }
          await saveLevel({
            module_type: "memory",
            title_i18n: { zh: levelTitle || "Memory配对", en: levelTitle || "Memory Match" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,
            category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: {
              theme: "custom", custom_icons: memoryCustomIcons, bg_image_url: memoryBgUrl || undefined,
              pairs_count: memoryCustomIcons.length, preview_seconds: previewSeconds, timer_mode: "stopwatch",
              question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined,
              layout: memoryLayout,
              positions: memoryLayout === "free" && memoryScene
                ? memoryScene.objects.map((o) => ({ x: o.x / GAME_CANVAS_W, y: o.y / GAME_CANVAS_H }))
                : undefined,
            },
          });
        } else {
          await saveLevel({
            module_type: "memory",
            title_i18n: { zh: levelTitle || "Memory配对", en: levelTitle || "Memory Match" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,
            category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: { theme: memoryTheme, pairs_count: pairsCount, preview_seconds: previewSeconds, timer_mode: "stopwatch", question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined },
          });
        }
      } else if (moduleType === "pattern") {
        if (patternTypes.length === 0) { toast.error("请至少选一种规律类型"); return; }
        await saveLevel({
          module_type: "pattern",
          title_i18n: { zh: levelTitle || "找规律", en: levelTitle || "Pattern" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,

          hint_text: hintText || undefined, audio_url: audioUrl || undefined,

          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { theme: patternTheme, pattern_types: patternTypes, seq_length: seqLength, num_choices: 3, total_questions: totalQuestions, timer_mode: "stopwatch", question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined },
        });
      } else if (moduleType === "cube_stack") {
        await saveLevel({
          module_type: "cube_stack",
          title_i18n: { zh: levelTitle || "立体方块计数", en: levelTitle || "Cube Stack" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,

          hint_text: hintText || undefined, audio_url: audioUrl || undefined,

          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { starting_level: cubeStackStartingLevel, total_questions: totalQuestions, timer_mode: "stopwatch" },
        });
      } else if (moduleType === "cube_layer_count") {
        await saveLevel({
          module_type: "cube_layer_count",
          title_i18n: { zh: levelTitle || "立体方块-逐层计数", en: levelTitle || "Cube Layer Count" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,
          hint_text: hintText || undefined, audio_url: audioUrl || undefined,
          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { starting_level: cubeStackStartingLevel, total_questions: totalQuestions, max_split_layers: cubeMaxSplitLayers, timer_mode: "stopwatch" },
        });
      } else if (moduleType === "cube_find_hidden") {
        await saveLevel({
          module_type: "cube_find_hidden",
          title_i18n: { zh: levelTitle || "立体方块-找隐藏方块", en: levelTitle || "Cube Find Hidden" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,
          hint_text: hintText || undefined, audio_url: audioUrl || undefined,
          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { starting_level: cubeStackStartingLevel, total_questions: totalQuestions, hidden_targets: cubeHiddenTargets, timer_mode: "stopwatch" },
        });
      } else if (moduleType === "cube_free_rotate") {
        await saveLevel({
          module_type: "cube_free_rotate",
          title_i18n: { zh: levelTitle || "立体方块-自由旋转观察", en: levelTitle || "Cube Free Rotate" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,
          hint_text: hintText || undefined, audio_url: audioUrl || undefined,
          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { total_shapes: cubeFreeRotateShapes, shape_size: cubeFreeRotateSize, min_view_seconds: cubeFreeRotateMinSec, timer_mode: "stopwatch" },
        });
      } else if (moduleType === "cube_build") {
        await saveLevel({
          module_type: "cube_build",
          title_i18n: { zh: levelTitle || "立体方块-自己搭积木", en: levelTitle || "Cube Build" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,
          hint_text: hintText || undefined, audio_url: audioUrl || undefined,
          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { starting_level: cubeStackStartingLevel, total_questions: totalQuestions, timer_mode: "stopwatch" },
        });
      } else if (moduleType === "cube_three_view") {
        await saveLevel({
          module_type: "cube_three_view",
          title_i18n: { zh: levelTitle || "立体方块-三视图", en: levelTitle || "Cube Three View" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,
          hint_text: hintText || undefined, audio_url: audioUrl || undefined,
          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { starting_level: cubeStackStartingLevel, total_questions: totalQuestions, timer_mode: "stopwatch" },
        });
      } else if (moduleType === "shape_count") {
        if (shapeCountLayout === "custom") {
          if (!shapeCountScene?.bgUrl && !shapeCountScene?.shapes?.length && !shapeCountScene?.objects.length) {
            toast.error("请至少加一个背景图、形状或物件");
            return;
          }
          await saveLevel({
            module_type: "shape_count",
            title_i18n: { zh: levelTitle || "数方块(平面图形)", en: levelTitle || "Shape Count" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,
            hint_text: hintText || undefined, audio_url: audioUrl || undefined,
            category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: {
              layout: "custom", bg_image_url: shapeCountScene?.bgUrl ?? undefined,
              shapes: (shapeCountScene?.shapes ?? []).map((s) => ({
                shape: s.shape, x: s.x / GAME_CANVAS_W, y: s.y / GAME_CANVAS_H, w: s.w, h: s.h, rotation: s.rotation,
                fillColor: s.fillColor, fillEnabled: s.fillEnabled, borderColor: s.borderColor, borderEnabled: s.borderEnabled,
                borderWidth: s.borderWidth, radius: s.radius, opacity: s.opacity,
              })),
              objects: (shapeCountScene?.objects ?? []).map((o) => ({
                image_url: o.imageUrl, x: o.x / GAME_CANVAS_W, y: o.y / GAME_CANVAS_H, w: o.w, h: o.h, rotation: o.rotation,
                object_type: o.objectType || undefined, flip_x: o.flipX, flip_y: o.flipY, opacity: o.opacity,
              })),
              timer_mode: "stopwatch",
              question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined,
            },
          });
        } else {
          await saveLevel({
            module_type: "shape_count",
            title_i18n: { zh: levelTitle || "数方块(平面图形)", en: levelTitle || "Shape Count" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,
            hint_text: hintText || undefined, audio_url: audioUrl || undefined,
            category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: { layout: "grid", ask_type: shapeAskType, starting_level: cubeStackStartingLevel, total_questions: totalQuestions, timer_mode: "stopwatch" },
          });
        }
      } else if (moduleType === "clock") {
        await saveLevel({
          module_type: "clock",
          title_i18n: { zh: levelTitle || "认钟表", en: levelTitle || "Clock" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,
          hint_text: hintText || undefined, audio_url: audioUrl || undefined,
          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { starting_level: cubeStackStartingLevel, total_questions: totalQuestions, mode: clockMode, timer_mode: "stopwatch" },
        });
      } else if (moduleType === "latin_square") {
        await saveLevel({
          module_type: "latin_square",
          title_i18n: { zh: levelTitle || "图形排排看", en: levelTitle || "Latin Square" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,
          hint_text: hintText || undefined, audio_url: audioUrl || undefined,
          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { starting_level: cubeStackStartingLevel, total_questions: totalQuestions, theme: latinSquareTheme, timer_mode: "stopwatch" },
        });
      } else if (moduleType === "chinese_stroke") {
        if (chineseStrokeChars.length === 0) { toast.error("请至少输入1个字"); return; }
        await saveLevel({
          module_type: "chinese_stroke",
          title_i18n: { zh: levelTitle || "中文字笔顺练习", en: levelTitle || "Chinese Stroke Order" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,
          hint_text: hintText || undefined, audio_url: audioUrl || undefined,
          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { characters: chineseStrokeChars, total_questions: totalQuestions, timer_mode: "stopwatch" },
        });
      } else if (moduleType === "multiple_choice") {
        const filledOptions = mcOptions.filter((o) => o.zh.trim() || o.en.trim() || o.ms.trim());
        if (filledOptions.length < 2) { toast.error("至少要有2个选项(至少填中文)"); return; }
        const correctOptions = filledOptions.filter((o) => o.correct);
        if (correctOptions.length === 0) { toast.error("请至少勾选1个正确答案"); return; }
        if (!mcQuestionZh.trim()) { toast.error("请填写题目文字(至少中文)"); return; }
        await saveLevel({
          module_type: "multiple_choice",
          title_i18n: { zh: levelTitle || "选择题", en: levelTitle || "Multiple Choice" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,
          hint_text: hintText || undefined, audio_url: audioUrl || undefined,
          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: {
            bg_image_url: mcScene?.bgUrl ?? undefined,
            objects: (mcScene?.objects ?? []).map((o) => ({
              image_url: o.imageUrl, x: o.x / GAME_CANVAS_W, y: o.y / GAME_CANVAS_H, w: o.w, h: o.h, rotation: o.rotation,
              flip_x: o.flipX, flip_y: o.flipY, opacity: o.opacity,
            })),
            texts: (mcScene?.texts ?? []).map((tx) => ({
              text: tx.text, x: tx.x / GAME_CANVAS_W, y: tx.y / GAME_CANVAS_H, fontSize: tx.fontSize,
              color: tx.color, fontFamily: tx.fontFamily, rotation: tx.rotation, bold: tx.bold, italic: tx.italic, underline: tx.underline,
            })),
            answer_mode: mcAnswerMode,
            options: filledOptions.map((o) => ({ id: o.id, text_i18n: { zh: o.zh || undefined, en: o.en || undefined, ms: o.ms || undefined } })),
            correct_option_ids: correctOptions.map((o) => o.id),
            question_i18n: { zh: mcQuestionZh.trim() || undefined, en: mcQuestionEn.trim() || undefined, ms: mcQuestionMs.trim() || undefined },
            timer_mode: "stopwatch",
          },
        });
      } else if (moduleType === "fill_blank") {
        const zhBlankCount = (fbSentenceZh.match(/___/g) ?? []).length;
        if (!fbSentenceZh.trim() || zhBlankCount === 0) { toast.error('请填写题目句子(中文)，并用"___"标记至少1个空'); return; }
        const blanks = fbBlankAnswers.slice(0, zhBlankCount).map((s) => s.split(",").map((x) => x.trim()).filter(Boolean));
        if (blanks.length < zhBlankCount || blanks.some((b) => b.length === 0)) { toast.error("每个空都要至少填1个正确答案"); return; }
        await saveLevel({
          module_type: "fill_blank",
          title_i18n: { zh: levelTitle || "填充题", en: levelTitle || "Fill in the Blank" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,
          hint_text: hintText || undefined, audio_url: audioUrl || undefined,
          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: {
            bg_image_url: fbScene?.bgUrl ?? undefined,
            objects: (fbScene?.objects ?? []).map((o) => ({
              image_url: o.imageUrl, x: o.x / GAME_CANVAS_W, y: o.y / GAME_CANVAS_H, w: o.w, h: o.h, rotation: o.rotation,
              flip_x: o.flipX, flip_y: o.flipY, opacity: o.opacity,
            })),
            texts: (fbScene?.texts ?? []).map((tx) => ({
              text: tx.text, x: tx.x / GAME_CANVAS_W, y: tx.y / GAME_CANVAS_H, fontSize: tx.fontSize,
              color: tx.color, fontFamily: tx.fontFamily, rotation: tx.rotation, bold: tx.bold, italic: tx.italic, underline: tx.underline,
            })),
            sentence_i18n: { zh: fbSentenceZh.trim() || undefined, en: fbSentenceEn.trim() || undefined, ms: fbSentenceMs.trim() || undefined },
            blanks: blanks.map((accepted) => ({ accepted_answers: accepted })),
            timer_mode: "stopwatch",
          },
        });
      } else if (moduleType === "word_problem") {
        if (wpCategories.length === 0) { toast.error("请至少选一种题型"); return; }
        await saveLevel({
          module_type: "word_problem",
          title_i18n: { zh: levelTitle || "应用题", en: levelTitle || "Word Problems" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,

          hint_text: hintText || undefined, audio_url: audioUrl || undefined,

          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { categories: wpCategories, answer_mode: wpAnswerMode, num_choices: 3, total_questions: totalQuestions, timer_mode: "stopwatch" },
        });
      } else if (moduleType === "maze") { // authored: what gets saved IS the puzzle (bg + painted mask + start/end pairs), not generation params
        if (!mazeBgUrl) { toast.error("请先上传背景图片"); return; }
        if (mazePairs.length === 0) { toast.error("至少要有1对起点/终点"); return; }
        const incompleteIdx = mazePairs.findIndex((p) => !p.start || !p.end);
        if (incompleteIdx >= 0) { toast.error(`第 ${incompleteIdx + 1} 对起点/终点还没设完，选中它、用"设起点"/"设终点"点一下`); return; }
        if (!mazeMaskCanvasRef.current) { toast.error("请先画出可以走的路径"); return; }
        const maskDataUrl = mazeMaskCanvasRef.current.toDataURL("image/png");
        const completePairs = mazePairs as { start: { x: number; y: number }; end: { x: number; y: number } }[];
        await saveLevel({
          module_type: "maze",
          title_i18n: { zh: levelTitle || "迷宫", en: levelTitle || "Maze" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,

          hint_text: hintText || undefined, audio_url: audioUrl || undefined,

          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: {
            bg_image_url: mazeBgUrl, mask_image_url: maskDataUrl,
            // 旧栏位也顺手填上第一对的值，保持向后兼容（万一有别的地方还在读这四个栏位）
            start_x: completePairs[0].start.x, start_y: completePairs[0].start.y,
            end_x: completePairs[0].end.x, end_y: completePairs[0].end.y,
            pairs: completePairs,
            timer_mode: "stopwatch",
            question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined,
          },
        });
      } else if (moduleType === "line_match") { // authored: every pair/edge IS the puzzle, same shape as maze/sudoku
        if (lineMatchLayout === "scene") {
          if (!lineMatchScene || lineMatchScene.objects.length === 0) { toast.error("自定义画面模式请先在编辑器里摆好物件"); return; }
          const byKey = new Map<string, number>();
          lineMatchScene.objects.forEach((o) => {
            const key = (o.objectType ?? "").trim();
            byKey.set(key, (byKey.get(key) ?? 0) + 1);
          });
          if (byKey.has("")) { toast.error("每个物件都要填「配对标记」，不能留空"); return; }
          // 一组允许2个以上（不再限制正好2个）——同一个标记的所有物件最后
          // 会互相连成一团，但至少要2个才叫"连线"，落单1个的标记没意义
          const soloKeys = [...byKey.entries()].filter(([, count]) => count < 2).map(([k]) => k);
          if (soloKeys.length > 0) { toast.error(`配对标记「${soloKeys.join("、")}」只有1个物件，至少要2个才能连线`); return; }
          await saveLevel({
            module_type: "line_match",
            title_i18n: { zh: levelTitle || "连线配对", en: levelTitle || "Line Match" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,

            category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: {
              layout: "scene",
              bg_image_url: lineMatchScene.bgUrl,
              objects: lineMatchScene.objects.map((o) => ({
                image_url: o.imageUrl,
                x: o.x / GAME_CANVAS_W, y: o.y / GAME_CANVAS_H,
                w: o.w / GAME_CANVAS_W, h: o.h / GAME_CANVAS_H,
                rotation: o.rotation, pair_key: o.objectType,
                flip_x: o.flipX || undefined, flip_y: o.flipY || undefined,
                opacity: o.opacity,
              })),
              timer_mode: "stopwatch",
              question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined,
            },
          });
        } else {
          const cleanLeft = lineMatchLeftItems.filter((it) => it.content.trim());
          const cleanRight = lineMatchRightItems.filter((it) => it.content.trim());
          if (cleanLeft.length === 0 || cleanRight.length === 0) { toast.error("左右两边至少各要有1个物件，内容不能空着"); return; }
          const validIds = new Set([...cleanLeft.map((i) => i.id), ...cleanRight.map((i) => i.id)]);
          const cleanEdges = lineMatchEdges.filter((e) => validIds.has(e.leftId) && validIds.has(e.rightId));
          if (cleanEdges.length === 0) { toast.error("至少要连1条线——点左边一项、再点右边一项来连线"); return; }
          await saveLevel({
            module_type: "line_match",
            title_i18n: { zh: levelTitle || "连线配对", en: levelTitle || "Line Match" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,

            category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: {
              layout: "list",
              left_items: cleanLeft, right_items: cleanRight, edges: cleanEdges,
              shuffle_right: lineMatchShuffleRight,
              timer_mode: "stopwatch",
              question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined,
            },
          });
        }
      } else if (moduleType === "ppt_lecture") { // 讲义类，不是游戏：一份转好的幻灯片图片清单，没有对错判断
        if (pptSlideUrls.length === 0) { toast.error("请先上传并转换 PPT，至少要有1页幻灯片"); return; }
        await saveLevel({
          module_type: "ppt_lecture",
          title_i18n: { zh: levelTitle || "PPT讲义", en: levelTitle || "PPT Lecture" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,

          hint_text: hintText || undefined, audio_url: audioUrl || undefined,

          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: {
            slide_image_urls: pptSlideUrls,
            original_filename: pptOriginalFilename || undefined,
          },
        });
      } else if (moduleType === "video_lecture") { // 讲义类，不是游戏：一个视频链接，没有对错判断
        if (!videoUrl) { toast.error("请填视频链接或上传视频"); return; }
        await saveLevel({
          module_type: "video_lecture",
          title_i18n: { zh: levelTitle || "视频讲义", en: levelTitle || "Video Lecture" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,

          hint_text: hintText || undefined, audio_url: audioUrl || undefined,

          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: {
            video_url: videoUrl,
            poster_image_url: videoPosterUrl || undefined,
          },
        });
      } else if (moduleType === "play_along") { // 讲义类，不是游戏：乐谱+音频+同步标记，没有对错判断
        if (paSheetUrls.length === 0) { toast.error("请先上传乐谱图片"); return; }
        if (!paAudioUrl) { toast.error("请上传或选择音频"); return; }
        if (paMarkers.length < 2) { toast.error("至少要打2个时间标记，播放时才能算出光标该移到哪"); return; }
        if (!paOriginalBpm || paOriginalBpm < 1) { toast.error("请填这首曲子的原速 BPM"); return; }
        await saveLevel({
          module_type: "play_along",
          title_i18n: { zh: levelTitle || "跟弹练习", en: levelTitle || "Play Along" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,

          hint_text: hintText || undefined, audio_url: audioUrl || undefined,

          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: {
            sheet_image_urls: paSheetUrls,
            original_filename: paOriginalFilename || undefined,
            audio_url: paAudioUrl,
            markers: [...paMarkers].sort((a, b) => a.time - b.time),
            original_bpm: paOriginalBpm,
          },
        });
      } else if (moduleType === "coloring") { // authored: outline + region mask + per-region color rules, no generation
        if (!coloringBgUrl) { toast.error("请先上传底图"); return; }
        if (!coloringMaskDataUrl) { toast.error("请至少画出1个区块"); return; }
        if (coloringRegions.length === 0) { toast.error("请至少加1个区块"); return; }
        if (coloringRegions.some((r) => r.rule === "specific" && !r.target_color)) { toast.error("选了「指定颜色」的区块，要填要求的颜色"); return; }
        await saveLevel({
          module_type: "coloring",
          title_i18n: { zh: levelTitle || "填色游戏", en: levelTitle || "Coloring" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,

          hint_text: hintText || undefined, audio_url: audioUrl || undefined,

          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: {
            bg_image_url: coloringBgUrl,
            region_mask_url: coloringMaskDataUrl,
            regions: coloringRegions,
            timer_mode: "stopwatch",
            question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined,
          },
        });
      } else if (moduleType === "sudoku") { // authored: a puzzle image + which cells are blank + each one's correct digit
        if (sudokuLayout === "grid") {
          const grid = sudokuScene?.grids?.[0];
          if (!grid) { toast.error("请先在编辑器里画好网格"); return; }
          const givenCells: Array<{ row: number; col: number; value: string }> = [];
          const blankCells: Array<{ row: number; col: number; answer: string }> = [];
          const missingCells: Array<{ row: number; col: number }> = [];
          grid.cells.forEach((rowArr, r) => rowArr.forEach((cell, c) => {
            if (cell.blank) blankCells.push({ row: r, col: c, answer: (cell.answer ?? "").trim() });
            else if (cell.value.trim()) givenCells.push({ row: r, col: c, value: cell.value.trim() });
            else missingCells.push({ row: r, col: c }); // 既没勾"留空给学生填"也没填数字——不能悄悄丢弃，否则这格在游戏里会彻底消失
          }));
          if (missingCells.length > 0) {
            const list = missingCells.map((m) => `第${m.row + 1}行第${m.col + 1}列`).join("、");
            toast.error(`这些格子既没填数字也没勾"留空给学生填"：${list}，请点画布上对应格子处理`);
            return;
          }
          if (blankCells.length === 0) { toast.error("至少要有1个留空的格子给学生填"); return; }
          if (blankCells.some((c) => !c.answer)) { toast.error("每个留空的格子都要填答案（1-9），点画布上那个格子在右边填"); return; }
          await saveLevel({
            module_type: "sudoku",
            title_i18n: { zh: levelTitle || "数独", en: levelTitle || "Sudoku" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,

            category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: {
              layout: "grid",
              rows: grid.rows, cols: grid.cols,
              given_cells: givenCells, blank_cells: blankCells,
              line_color: grid.lineColor, given_color: grid.givenColor, blank_bg: grid.blankBg,
              bg_color: grid.bgColor, bg_enabled: grid.bgEnabled, opacity: grid.opacity,
              difficulty: sudokuDifficulty,
              timer_mode: "stopwatch",
              question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined,
            },
          });
        } else {
          if (!sudokuBgUrl) { toast.error("请先上传数独图片"); return; }
          if (sudokuCells.length === 0) { toast.error("请至少标记1个空格"); return; }
          if (sudokuCells.some((c) => !c.answer)) { toast.error("每个空格都要填答案（1-9）"); return; }
          await saveLevel({
            module_type: "sudoku",
            title_i18n: { zh: levelTitle || "数独", en: levelTitle || "Sudoku" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,

            category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: {
              layout: "photo",
              bg_image_url: sudokuBgUrl,
              cells: sudokuCells.map((c) => ({ x: c.x, y: c.y, answer: parseInt(c.answer, 10) })),
              difficulty: sudokuDifficulty,
              timer_mode: "stopwatch",
              question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined,
            },
          });
        }
      } else if (moduleType === "number_maze") { // authored: 判定走client端直接核对，不像数独那样藏答案——这是"休闲游戏"级别的安全模型，跟line_match/迷宫是同一个取舍，不是疏忽
        if (nmLayout === "grid") {
          const grid = nmScene?.grids?.[0];
          if (!grid) { toast.error("请先在编辑器里画好网格、填好数字"); return; }
          const pathCells: Array<{ row: number; col: number; step: number }> = [];
          grid.cells.forEach((rowArr, r) => rowArr.forEach((cell, c) => { if (cell.pathStep) pathCells.push({ row: r, col: c, step: cell.pathStep }); }));
          pathCells.sort((a, b) => a.step - b.step);
          if (pathCells.length < 2) { toast.error("至少要标2个格子的「路径顺序」，构成从起点到终点的一条路"); return; }
          // 相邻格子的顺序号必须连续(1,2,3...)且物理位置真的相邻(上下左右差1格)，
          // 不然运行时没办法判断"从这格能不能走到下一格"——这个校验是为了
          // 挡住设计师手滑标错、标了两个不相邻的格子当作连续步骤这种情况。
          for (let i = 0; i < pathCells.length; i++) {
            if (pathCells[i].step !== i + 1) { toast.error(`路径顺序不连续——缺第 ${i + 1} 步，检查一下有没有编号重复或跳号`); return; }
            if (i > 0) {
              const dr = Math.abs(pathCells[i].row - pathCells[i - 1].row), dc = Math.abs(pathCells[i].col - pathCells[i - 1].col);
              if (dr + dc !== 1) { toast.error(`第 ${i} 步和第 ${i + 1} 步不是相邻的格子（只能上下左右移动一格），检查一下路径顺序标得对不对`); return; }
            }
          }
          await saveLevel({
            module_type: "number_maze",
            title_i18n: { zh: levelTitle || "数字迷宫", en: levelTitle || "Number Maze" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,

            category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: {
              layout: "grid",
              rows: grid.rows, cols: grid.cols,
              cells: grid.cells.map((rowArr) => rowArr.map((c) => c.value)),
              path: pathCells.map((p) => ({ row: p.row, col: p.col })),
              line_color: grid.lineColor, given_color: grid.givenColor,
              bg_color: grid.bgColor, bg_enabled: grid.bgEnabled, opacity: grid.opacity,
              timer_mode: "stopwatch",
              question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined,
            },
          });
        } else {
          if (!nmBgUrl) { toast.error("请先上传背景图片"); return; }
          if (!nmMaskDataUrl) { toast.error("请先画出可走的路径"); return; }
          if (!nmStart || !nmEnd) { toast.error("请设好起点和终点"); return; }
          if (nmDecisionPoints.some((d) => d.options.some((o) => !o.value.trim()))) { toast.error("每个分岔点的每个选项都要填数字，不能留空"); return; }
          await saveLevel({
            module_type: "number_maze",
            title_i18n: { zh: levelTitle || "数字迷宫", en: levelTitle || "Number Maze" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,

            category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: {
              layout: "path",
              bg_image_url: nmBgUrl, mask_image_url: nmMaskDataUrl,
              start: nmStart, end: nmEnd,
              decision_points: nmDecisionPoints,
              timer_mode: "stopwatch",
              question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined,
            },
          });
        }
      } else if (moduleType === "sticker_game") { // authored: 摆的位置就是"正确答案"，跟counting的custom_scene模式同一个套路，运行时自己会把贴纸打乱塞进贴纸盘
        if (!stickerScene?.bgUrl) { toast.error("请先选背景图片"); return; }
        if (stickerScene.objects.length < 1) { toast.error("请至少放1个贴纸"); return; }
        await saveLevel({
          module_type: "sticker_game",
          title_i18n: { zh: levelTitle || "贴纸游戏", en: levelTitle || "Sticker Game" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,

          hint_text: hintText || undefined, audio_url: audioUrl || undefined,

          category_ids: categoryIds, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: {
            bg_image_url: stickerScene.bgUrl,
            objects: stickerScene.objects.map((o) => ({
              image_url: o.imageUrl, x: o.x, y: o.y, // 保持原始画布像素坐标，别在这里提前除以GAME_CANVAS_W/H——播放端(StickerGame.tsx)本来就会统一做这个换算，w/h也是原样传的，x/y提前除了一次会跟w/h单位对不上，播放时位置全乱、贴纸也永远判定不了"贴对"
              w: o.w, h: o.h, rotation: o.rotation, type: o.objectType || undefined,
              flip_x: o.flipX || undefined, flip_y: o.flipY || undefined,
            })),
            timer_mode: "stopwatch",
            question_i18n: customQuestionText.trim() ? { zh: customQuestionText.trim(), en: customQuestionText.trim() } : undefined,
          },
        });
      } else { // fallback — should be unreachable given the exhaustive branches above, kept only so TS doesn't flag a missing final else
      }
      toast.success(editingLevelId ? "Activity 改好了" : "Activity 加好了");
      onSaved(); onClose();
    } catch {
      toast.error("新增失败（可能没有权限）");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editingLevelId ? "编辑 Activity" : "加 Activity"} size="full">
      <div className="space-y-5">
        <div className="flex gap-1.5 bg-muted/50 p-1 rounded-xl">
          {([
            ["basic", Info, "基本信息"],
            ["classification", Tags, "分类"],
            ["content", SlidersHorizontal, "内容设置"],
            ["properties", Sparkles, "属性"],
            ["hints", MessageSquareText, "提示与讲解"],
          ] as [TabKey, LucideIcon, string][]).map(([key, Icon, label]) => (
            <button
              key={key} type="button" onClick={() => setActiveTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === key ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              style={activeTab === key ? { boxShadow: "0 1px 3px rgba(0,0,0,0.08)" } : undefined}
            >
              <Icon size={15} strokeWidth={2} className={activeTab === key ? "text-primary" : ""} />
              {label}
            </button>
          ))}
        </div>

        {/* 分类：确定这个 Activity 属于哪个 Programme → Subject → Topic——
            现在新建、编辑都是选填，可以当下就分类，也可以先把游戏内容做好，
            之后再回来这个分页籤补上分类。选好 Topic 之后，如果它对应到
            某个具体的游戏模块，「基本信息」那个分页籤的模块类型会自动帮你
            选上；反过来，如果先选了模块类型，Topic也会自动对齐——两个
            方向都支持。 */}
        <div className={activeTab === "classification" ? "block" : "hidden"}>
        <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Tags size={16} className="text-primary" /> 这个 Activity 属于哪里？
            <span className="text-xs font-normal text-muted-foreground">（选填，可挂多个 Topic）</span>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              className="border rounded-md p-2 text-sm"
              value={subjectId}
              onChange={(e) => { setSubjectId(e.target.value); setCategoryId(""); }}
            >
              <option value="">Subject...</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name_zh}</option>)}
            </select>
            <select
              className="border rounded-md p-2 text-sm" disabled={!subjectId}
              value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Topic...</option>
              {categories.filter((c) => c.subject_id === subjectId).map((c) => <option key={c.id} value={c.id}>{c.name_zh}</option>)}
            </select>
            <Button
              size="sm" type="button" disabled={!categoryId || categoryIds.includes(categoryId)}
              onClick={() => setCategoryIds((ids) => Array.from(new Set([...ids, categoryId])))}
            >
              ➕ 加入
            </Button>
          </div>

          {categoryIds.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {categoryIds.map((cid) => {
                const c = categories.find((x) => x.id === cid);
                return (
                  <span key={cid} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-primary/10 border border-primary/30">
                    {c?.name_zh ?? cid}
                    <button
                      type="button" onClick={() => setCategoryIds((ids) => ids.filter((x) => x !== cid))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      ✕
                    </button>
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/70">未挂 Topic 也能先保存，之后再回来补。</p>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
            <select className="border rounded-md p-2 text-sm" value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={categoryIds.length === 0}>
              <option value="">分类（选填）...</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name_zh}</option>)}
            </select>
            <select className="border rounded-md p-2 text-sm" value={curriculumTypeId} onChange={(e) => setCurriculumTypeId(e.target.value)}>
              <option value="">小分类（选填）...</option>
              {curriculumTypes.map((t) => <option key={t.id} value={t.id}>{t.name_zh}</option>)}
            </select>
          </div>
        </div>
        </div>

        <div className={activeTab === "basic" ? "block space-y-4" : "hidden"}>
        <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4">
          <div className="space-y-1.5">
            <Label>模块类型</Label>
            <div className="flex items-center gap-3">
              {(() => {
                const c = MODULE_COLORS[moduleType] ?? FALLBACK_COLOR;
                const Icon = MODULE_ICONS[moduleType];
                return (
                  <div className="w-14 h-14 rounded-xl border border-border shadow-sm flex items-center justify-center shrink-0" style={{ background: c.bg }}>
                    {Icon ? <Icon size={26} strokeWidth={2} style={{ color: c.text }} /> : null}
                  </div>
                );
              })()}
              <select disabled={!!editingLevelId || !!presetModuleType} className={`${SELECT_CLASS} flex-1`} value={moduleType} onChange={(e) => setModuleType(e.target.value as ModuleType)}>
                {Object.entries(MODULE_LABELS).map(([key, { emoji, label }]) => (
                  <option key={key} value={key}>{emoji} {label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Activity 名称</Label>
            <Input placeholder="Activity 名称" value={levelTitle} onChange={(e) => setLevelTitle(e.target.value)} />
          </div>
          {CUSTOM_QUESTION_MODULES.includes(moduleType) && (
            <div className="space-y-1.5">
              <Label>自定义题目句子（选填）</Label>
              <Input
                placeholder="不填的话游戏画面用默认提示文字"
                value={customQuestionText}
                onChange={(e) => setCustomQuestionText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground/80">只改"怎么问"，不影响判分逻辑本身。</p>
            </div>
          )}
        </div>
        </div>

        <div className={activeTab === "content" ? "block space-y-4" : "hidden"}>
        {moduleType === "counting" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4 text-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Hash size={16} className="text-primary" /> 点点数数 · 内容设置
            </div>
            <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
              {(["random", "custom_scene"] as const).map((m) => (
                <button
                  key={m} type="button" onClick={() => setCountingMode(m)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    countingMode === m ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "random" ? "🎲 随机生成" : "🖼️ 自定义画面"}
                </button>
              ))}
            </div>

            {countingMode === "random" ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">主题</Label>
                  <select value={theme} onChange={(e) => setTheme(e.target.value)} className={`${MINI_SELECT_CLASS} w-full`}>
                    <option value="apple">🍎 苹果</option><option value="star">⭐ 星星</option>
                    <option value="fish">🐟 鱼</option><option value="balloon">🎈 气球</option><option value="candy">🍬 糖果</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">范围</Label>
                  <div className="flex items-center gap-1">
                    <input type="number" value={minVal} onChange={(e) => setMinVal(+e.target.value)} className={`${MINI_INPUT_CLASS} w-full`} />
                    <span className="text-muted-foreground text-xs">~</span>
                    <input type="number" value={maxVal} onChange={(e) => setMaxVal(+e.target.value)} className={`${MINI_INPUT_CLASS} w-full`} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">选项数</Label>
                  <input type="number" value={numChoices} onChange={(e) => setNumChoices(+e.target.value)} className={`${MINI_INPUT_CLASS} w-full`} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">题数</Label>
                  <input type="number" value={totalQuestions} onChange={(e) => setTotalQuestions(+e.target.value)} className={`${MINI_INPUT_CLASS} w-full`} />
                </div>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5">
                  选背景图、加物件（可以从素材库选，也可以直接上传——每次加的物件图片可以都不一样，数量不限），拖到想要的位置，还能旋转、缩放。加了几个物件，答案就是几个；文字是装饰用的，不算进答案里。
                </p>
                <SceneEditor
                  structuredMode presetModuleType="counting"
                  onSaveStructured={setCountingScene} initial={countingScene ?? undefined}
                />
                {countingScene && (
  <>
    <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">✓ 场景已确认（{countingScene.objects.length} 个物件），可以点上面"完成"重新调整</p>

    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
      <Label className="text-xs">自定义题目句子（选填）</Label>
      <Input
        value={countingQuestionText}
        onChange={(e) => setCountingQuestionText(e.target.value)}
        placeholder="例如：苹果和西瓜一共有几个？（不填的话系统会按下面勾选的类型自动生成一句）"
      />
      <p className="text-xs text-muted-foreground/80">
        这里只是改"怎么问"——正确答案还是由下面"这一题要问哪几种"决定，跟画面里实际摆的物件数量对应，不会因为这句话改变。
      </p>
    </div>

    {(() => {
      const objectTypes = Array.from(new Set(countingScene.objects.map((o) => o.objectType).filter((t): t is string => !!t)));
      if (objectTypes.length === 0) return null;
      return (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">这一题要问哪几种？（不选默认数全部物件）</p>
          <div className="flex flex-wrap gap-2">
            {objectTypes.map((t) => {
              const checked = countingTargetTypes.includes(t);
              return (
                <button
                  key={t} type="button"
                  onClick={() => setCountingTargetTypes((prev) => checked ? prev.filter((x) => x !== t) : [...prev, t])}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    checked ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
          {countingTargetTypes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              答案 = {countingTargetTypes.join(" + ")} 的数量总和
            </p>
          )}
        </div>
      );
    })()}
  </>
)}
              </>
            )}
          </div>
        )}

        {moduleType === "spot_diff" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ScanSearch size={16} className="text-primary" /> 找不同 · 内容设置
            </div>
            <div className="flex gap-4 flex-wrap">
              {([["a", "原图", imgAUrl, "选原图"], ["b", "找不同图", imgBUrl, "选找不同图"]] as const).map(([side, label, url, pickerLabel]) => (
                <div key={side} className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">{label}</p>
                  <div className="flex items-center gap-2">
                    {url ? (
                      <div className="w-20 h-20 rounded-lg border border-border shadow-sm overflow-hidden bg-muted/30 shrink-0">
                        <img src={url} alt={label} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-20 h-20 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground/50 shrink-0">
                        <ImagePlus size={20} />
                      </div>
                    )}
                    <div className="flex flex-col gap-1.5">
                      <input type="file" accept="image/*" className="text-xs w-32" onChange={(e) => e.target.files?.[0] && handleUpload(side, e.target.files[0])} />
                      <AssetPicker category="background" label={url ? "换一张" : `🗂️ ${pickerLabel}`} moduleType="spot_diff" onSelect={(u) => handleSelect(side, u)} seedFromUrl={side === "b" ? imgAUrl ?? undefined : undefined} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5">在下面画布上点一下标记一个差异点（左右两图点哪张都行，会同步显示）；已有标记可拖动、调整判定范围或删除。已标记 {hotspots.length} 个。</p>
            <SpotDiffMarker imgAUrl={imgAUrl} imgBUrl={imgBUrl} hotspots={hotspots} setHotspots={setHotspots} onImgBUpdated={setImgBUrl} />
          </div>
        )}

        {moduleType === "focus_tap" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4 text-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Target size={16} className="text-primary" /> 专注力点数字 · 内容设置
            </div>
            <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
              {(["grid", "custom"] as const).map((m) => (
                <button
                  key={m} type="button" onClick={() => setFtMode(m)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    ftMode === m ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "grid" ? "🔲 格子模式" : "🖼️ 自定义场景"}
                </button>
              ))}
            </div>

            {ftMode === "grid" ? (
              <div className="flex gap-3 flex-wrap items-center pt-1 border-t border-border/60">
                <label className="flex items-center gap-1.5">格子大小
                  <select value={gridSize} onChange={(e) => setGridSize(+e.target.value)} className={MINI_SELECT_CLASS}>
                    <option value={3}>3×3</option><option value={4}>4×4</option>
                    <option value={5}>5×5</option><option value={6}>6×6</option>
                  </select>
                </label>
                <span className="text-xs text-muted-foreground/80">共 {gridSize * gridSize} 个数字，玩的时候每次都会重新随机分配位置</span>
              </div>
            ) : (
              <div className="space-y-3 pt-1 border-t border-border/60">
                <p className="text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5">
                  选背景图、加几个标记（代表数字会出现的位置，可以从素材库选任意图标，也可以直接上传），拖到想要的位置，还能旋转、缩放、复制。加了几个标记，游戏里就有几个数字，具体哪个数字落在哪个位置，每次玩都会重新随机分配。
                </p>
                <SceneEditor
                  structuredMode presetModuleType="focus_tap"
                  onSaveStructured={setFtScene} initial={ftScene ?? undefined}
                />
                {ftScene && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ 场景已确认（{ftScene.objects.length} 个位置），可以点上面"完成"重新调整</p>
                )}
              </div>
            )}
          </div>
        )}

        {moduleType === "memory" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4 text-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Layers size={16} className="text-primary" /> Memory配对 · 内容设置
            </div>

            <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
              {(["preset", "custom"] as const).map((m) => (
                <button
                  key={m} type="button" onClick={() => setMemoryMode(m)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    memoryMode === m ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "preset" ? "🎨 主题图库" : "🖼️ 自定义图片"}
                </button>
              ))}
            </div>

            {memoryMode === "preset" ? (
              <div className="flex gap-3 flex-wrap items-center pt-1 border-t border-border/60">
                <label className="flex items-center gap-1.5">主题
                  <select value={memoryTheme} onChange={(e) => setMemoryTheme(e.target.value)} className={MINI_SELECT_CLASS}>
                    <option value="animal">🐶 动物</option><option value="fruit">🍎 水果</option>
                    <option value="number">🔢 数字</option><option value="shape">🔴 图形</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5">配对数 <input type="number" min={2} max={12} value={pairsCount} onChange={(e) => setPairsCount(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
                <label className="flex items-center gap-1.5">预览秒数 <input type="number" min={1} max={10} value={previewSeconds} onChange={(e) => setPreviewSeconds(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
              </div>
            ) : (
              <div className="space-y-4 pt-1 border-t border-border/60">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-muted-foreground">配对图片（{memoryCustomIcons.length} 张，至少需要2张）</p>
                    <AssetPicker category="object" label="🧸 加一张" moduleType="memory" onSelect={(url) => setMemoryCustomIcons((arr) => [...arr, url])} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {memoryCustomIcons.map((url, i) => (
                      <div key={i} className="relative w-16 h-16 rounded-lg border border-border shadow-sm bg-white flex items-center justify-center overflow-hidden">
                        <img src={url} alt="" className="max-w-full max-h-full object-contain" />
                        <button
                          type="button" onClick={() => setMemoryCustomIcons((arr) => arr.filter((_, idx) => idx !== i))}
                          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center hover:bg-red-500"
                        >✕</button>
                      </div>
                    ))}
                    {memoryCustomIcons.length === 0 && (
                      <div className="w-16 h-16 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground/50">
                        <ImagePlus size={18} />
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">背景图（选填）</p>
                  <div className="flex items-center gap-3">
                    {memoryBgUrl ? (
                      <div className="relative w-24 h-24 rounded-lg border border-border shadow-sm overflow-hidden bg-muted/30 shrink-0">
                        <img src={memoryBgUrl} alt="背景" className="w-full h-full object-cover" />
                        <button
                          type="button" onClick={() => setMemoryBgUrl(null)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[11px] flex items-center justify-center hover:bg-red-500"
                        >✕</button>
                      </div>
                    ) : (
                      <div className="w-24 h-24 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground/50 shrink-0">
                        <ImagePlus size={22} />
                      </div>
                    )}
                    <AssetPicker category="background" label={memoryBgUrl ? "换一张" : "🗂️ 选背景图"} moduleType="memory" onSelect={setMemoryBgUrl} />
                  </div>
                </div>
                <label className="flex items-center gap-1.5">预览秒数 <input type="number" min={1} max={10} value={previewSeconds} onChange={(e) => setPreviewSeconds(+e.target.value)} className={MINI_INPUT_CLASS} /></label>

                <div className="pt-3 border-t border-border/60 space-y-3">
                  <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
                    {(["grid", "free"] as const).map((lo) => (
                      <button
                        key={lo} type="button" onClick={() => setMemoryLayout(lo)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                          memoryLayout === lo ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {lo === "grid" ? "🔲 传统表格排法" : "🖼️ 自由摆放"}
                      </button>
                    ))}
                  </div>

                  {memoryLayout === "free" && (
                    !memoryBgUrl ? (
                      <p className="text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5">自由摆放需要先在上面选一张背景图。</p>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5">
                          已经把 {memoryCustomIcons.length * 2} 张配对图片（每张各出现两次）自动排好摆进画布了——直接拖动调整到想要的位置就行；也可以再点左边"🧸 加物件"补充别的图片、或删掉多余的。哪张图落在哪个位置最后是随机的，跟专注力点数字同一个逻辑。
                        </p>
                        <SceneEditor
                          key={memoryBgUrl}
                          structuredMode presetModuleType="memory"
                          onSaveStructured={setMemoryScene}
                          initial={memoryScene ?? { bgUrl: memoryBgUrl, objects: buildInitialMemoryPositions(memoryCustomIcons), texts: [] }}
                        />
                        {memoryScene && (
                          <p className={`text-xs flex items-center gap-1 ${memoryScene.objects.length === memoryCustomIcons.length * 2 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                            {memoryScene.objects.length === memoryCustomIcons.length * 2 ? "✓" : "⚠️"} 已摆 {memoryScene.objects.length} / {memoryCustomIcons.length * 2} 个位置
                          </p>
                        )}
                      </>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {moduleType === "pattern" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3 text-sm">
            <div className="flex gap-3 flex-wrap items-center">
              <label className="flex items-center gap-1.5">主题
                <select value={patternTheme} onChange={(e) => setPatternTheme(e.target.value)} className={MINI_SELECT_CLASS}>
                  <option value="shape">🔴 图形</option><option value="animal">🐶 动物</option><option value="fruit">🍎 水果</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5">序列长度 <input type="number" min={4} max={12} value={seqLength} onChange={(e) => setSeqLength(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
              <label className="flex items-center gap-1.5">题数 <input type="number" value={totalQuestions} onChange={(e) => setTotalQuestions(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block mb-1.5">规律类型（至少选一个）</span>
              <div className="flex gap-2 flex-wrap">
                {["AB", "ABC", "AAB", "ABB", "AABB"].map((pt) => (
                  <button
                    key={pt} type="button"
                    onClick={() => setPatternTypes(patternTypes.includes(pt) ? patternTypes.filter((p) => p !== pt) : [...patternTypes, pt])}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      patternTypes.includes(pt) ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                    }`}
                  >
                    {pt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {moduleType === "cube_stack" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3 text-sm">
            <div className="flex gap-3 flex-wrap items-center">
              <label className="flex items-center gap-1.5">起始难度等级
                <input type="number" min={1} max={10} value={cubeStackStartingLevel} onChange={(e) => setCubeStackStartingLevel(Math.min(10, Math.max(1, +e.target.value)))} className={MINI_INPUT_CLASS} />
              </label>
              <label className="flex items-center gap-1.5">题数 <input type="number" value={totalQuestions} onChange={(e) => setTotalQuestions(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
            </div>
            <p className="text-xs text-muted-foreground">
              这个游戏没有素材图或题目内容要准备——每题的立体方块结构是玩的时候现场生成的。难度会跟着学生答对/答错自动升降（1~10级），这里只是设定"从第几级开始"。
            </p>
          </div>
        )}

        {moduleType === "cube_layer_count" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3 text-sm">
            <div className="flex gap-3 flex-wrap items-center">
              <label className="flex items-center gap-1.5">起始难度等级
                <input type="number" min={1} max={10} value={cubeStackStartingLevel} onChange={(e) => setCubeStackStartingLevel(Math.min(10, Math.max(1, +e.target.value)))} className={MINI_INPUT_CLASS} />
              </label>
              <label className="flex items-center gap-1.5">题数 <input type="number" value={totalQuestions} onChange={(e) => setTotalQuestions(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
              <label className="flex items-center gap-1.5">最多拆几层
                <input type="number" min={2} value={cubeMaxSplitLayers} onChange={(e) => setCubeMaxSplitLayers(Math.max(2, +e.target.value))} className={MINI_INPUT_CLASS} />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              学生要按楼层输入每层有几个方块，自动加总。"最多拆几层"是保底设置——结构实际层数超过这个数字时，多出来的层会自动合并成最后一格，避免答题变得没完没了（按目前的难度曲线，最高10级也就5层，正常不会触发合并）。
            </p>
          </div>
        )}

        {moduleType === "cube_find_hidden" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3 text-sm">
            <div className="flex gap-3 flex-wrap items-center">
              <label className="flex items-center gap-1.5">起始难度等级
                <input type="number" min={1} max={10} value={cubeStackStartingLevel} onChange={(e) => setCubeStackStartingLevel(Math.min(10, Math.max(1, +e.target.value)))} className={MINI_INPUT_CLASS} />
              </label>
              <label className="flex items-center gap-1.5">题数 <input type="number" value={totalQuestions} onChange={(e) => setTotalQuestions(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
              <label className="flex items-center gap-1.5">每题要找几个隐藏方块
                <input type="number" min={1} value={cubeHiddenTargets} onChange={(e) => setCubeHiddenTargets(Math.max(1, +e.target.value))} className={MINI_INPUT_CLASS} />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              学生转动结构，点击"应该藏着一个看不见的方块"的位置。如果某一局生成出来的结构里，天然能藏的位置没这么多，会自动改成实际能有的数量，不会卡住。每题最多容许猜错3次，超过会直接公布答案。
            </p>
          </div>
        )}

        {moduleType === "cube_free_rotate" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3 text-sm">
            <div className="flex gap-3 flex-wrap items-center">
              <label className="flex items-center gap-1.5">看几个结构
                <input type="number" min={1} value={cubeFreeRotateShapes} onChange={(e) => setCubeFreeRotateShapes(Math.max(1, +e.target.value))} className={MINI_INPUT_CLASS} />
              </label>
              <label className="flex items-center gap-1.5">结构大小
                <input type="number" min={2} max={5} value={cubeFreeRotateSize} onChange={(e) => setCubeFreeRotateSize(Math.min(5, Math.max(2, +e.target.value)))} className={MINI_INPUT_CLASS} />
              </label>
              <label className="flex items-center gap-1.5">每个至少看几秒
                <input type="number" min={0} value={cubeFreeRotateMinSec} onChange={(e) => setCubeFreeRotateMinSec(Math.max(0, +e.target.value))} className={MINI_INPUT_CLASS} />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              纯探索关，没有对错判定——热身/教程性质，帮还不熟悉3D拖动旋转操作的孩子先练习一下。"结构大小"是固定难度，不会自动升降（这一关的重点是熟悉操作，不是考验空间推理）。
            </p>
          </div>
        )}

        {moduleType === "cube_build" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3 text-sm">
            <div className="flex gap-3 flex-wrap items-center">
              <label className="flex items-center gap-1.5">起始难度等级
                <input type="number" min={1} max={10} value={cubeStackStartingLevel} onChange={(e) => setCubeStackStartingLevel(Math.min(10, Math.max(1, +e.target.value)))} className={MINI_INPUT_CLASS} />
              </label>
              <label className="flex items-center gap-1.5">题数 <input type="number" value={totalQuestions} onChange={(e) => setTotalQuestions(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
            </div>
            <p className="text-xs text-muted-foreground">
              学生照着上方展示的目标结构，在下方搭建区一块一块搭出一样的形状（点方块顶上的半透明虚影加一块，点实心方块拿掉最上面一块）。提交后逐根柱子比对高度，哪根不对会标红。
            </p>
          </div>
        )}

        {moduleType === "cube_three_view" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3 text-sm">
            <div className="flex gap-3 flex-wrap items-center">
              <label className="flex items-center gap-1.5">起始难度等级
                <input type="number" min={1} max={10} value={cubeStackStartingLevel} onChange={(e) => setCubeStackStartingLevel(Math.min(10, Math.max(1, +e.target.value)))} className={MINI_INPUT_CLASS} />
              </label>
              <label className="flex items-center gap-1.5">题数 <input type="number" value={totalQuestions} onChange={(e) => setTotalQuestions(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
            </div>
            <p className="text-xs text-muted-foreground">
              每题随机问正视图/俯视图/侧视图三选一，学生在网格上点格子拼出轮廓。提交后逐格比对，标红的地方是拼错的位置。
            </p>
          </div>
        )}

        {moduleType === "shape_count" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4 text-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Square size={16} className="text-primary" /> 数方块(平面图形) · 内容设置
            </div>
            <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
              {(["grid", "custom"] as const).map((m) => (
                <button
                  key={m} type="button" onClick={() => setShapeCountLayout(m)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    shapeCountLayout === m ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "grid" ? "🔲 网格模式" : "🖼️ 自定义画图"}
                </button>
              ))}
            </div>

            {shapeCountLayout === "grid" ? (
              <div className="space-y-3 pt-1 border-t border-border/60">
                <div className="flex gap-3 flex-wrap items-center">
                  <label className="flex items-center gap-1.5">问哪种
                    <select value={shapeAskType} onChange={(e) => setShapeAskType(e.target.value as "square" | "rectangle" | "both")} className={MINI_INPUT_CLASS}>
                      <option value="both">正方形+长方形都问</option>
                      <option value="square">只问正方形</option>
                      <option value="rectangle">只问长方形</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5">起始难度等级
                    <input type="number" min={1} max={10} value={cubeStackStartingLevel} onChange={(e) => setCubeStackStartingLevel(Math.min(10, Math.max(1, +e.target.value)))} className={MINI_INPUT_CLASS} />
                  </label>
                  <label className="flex items-center gap-1.5">题数 <input type="number" value={totalQuestions} onChange={(e) => setTotalQuestions(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
                </div>
                <p className="text-xs text-muted-foreground">
                  经典"数格子图里有几个正方形/长方形"题型——网格是现场画的，答案是公式算出来的，不需要准备任何素材图。长方形题会提醒学生"正方形也算长方形的一种"。
                </p>
              </div>
            ) : (
              <div className="space-y-3 pt-1 border-t border-border/60">
                <p className="text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5">
                  选背景图（选填）、用画笔工具画方形/圆形/三角形（可以互相重叠），也可以上传物件图片、在"类型"里打上 square/circle/triangle 其中一个标签让它算进对应类型。学生玩的时候要分别数出"正方形/圆形/三角形"各有几个——单题，不循环。
                </p>
                <SceneEditor
                  structuredMode presetModuleType="shape_count"
                  onSaveStructured={setShapeCountScene} initial={shapeCountScene ?? undefined}
                />
                {shapeCountScene && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    ✓ 场景已确认（{(shapeCountScene.shapes?.length ?? 0)} 个形状、{shapeCountScene.objects.length} 个物件），可以点上面"完成"重新调整
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {moduleType === "clock" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3 text-sm">
            <div className="flex gap-3 flex-wrap items-center">
              <label className="flex items-center gap-1.5">模式
                <select value={clockMode} onChange={(e) => setClockMode(e.target.value as "read" | "set" | "both")} className={MINI_INPUT_CLASS}>
                  <option value="both">读钟表+拨钟表都出</option>
                  <option value="read">只出"读钟表"</option>
                  <option value="set">只出"拨钟表"</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5">起始难度等级
                <input type="number" min={1} max={10} value={cubeStackStartingLevel} onChange={(e) => setCubeStackStartingLevel(Math.min(10, Math.max(1, +e.target.value)))} className={MINI_INPUT_CLASS} />
              </label>
              <label className="flex items-center gap-1.5">题数 <input type="number" value={totalQuestions} onChange={(e) => setTotalQuestions(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
            </div>
            <p className="text-xs text-muted-foreground">
              没有素材图要准备，钟面是现场画的SVG。难度决定分钟的刻度粒度——等级1-3只有整点，4-6到半点，7-8到一刻钟，9-10任意5分钟。"读钟表"看钟面说出几点几分，"拨钟表"看数字时间调整钟面指针，两者会跟着答对/答错自动升降难度。
            </p>
          </div>
        )}

        {moduleType === "latin_square" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3 text-sm">
            <div className="flex gap-3 flex-wrap items-center">
              <label className="flex items-center gap-1.5">图标主题
                <select value={latinSquareTheme} onChange={(e) => setLatinSquareTheme(e.target.value as "shape" | "animal" | "fruit" | "emotion")} className={MINI_INPUT_CLASS}>
                  <option value="shape">🔷 形状</option>
                  <option value="animal">🐶 动物</option>
                  <option value="fruit">🍎 水果</option>
                  <option value="emotion">😀 表情</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5">起始难度等级
                <input type="number" min={1} max={10} value={cubeStackStartingLevel} onChange={(e) => setCubeStackStartingLevel(Math.min(10, Math.max(1, +e.target.value)))} className={MINI_INPUT_CLASS} />
              </label>
              <label className="flex items-center gap-1.5">题数 <input type="number" value={totalQuestions} onChange={(e) => setTotalQuestions(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
            </div>
            <p className="text-xs text-muted-foreground">
              经典"每行每列图形都不重复"练习(拉丁方阵)，没有素材图要准备，网格是现场生成的。难度决定网格边长——从4×4起步，每2级加大一圈，最高8×8。学生点空格弹出图形选择面板，选一个放进去。
            </p>
          </div>
        )}

        {moduleType === "chinese_stroke" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4 text-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <PenLine size={16} className="text-primary" /> 中文字笔顺练习 · 内容设置
            </div>
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground block">字库（至少1个字，每次玩从这里随机抽题）</span>
              <div className="flex flex-wrap gap-2">
                {chineseStrokeChars.map((ch, i) => (
                  <span key={i} className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-full border border-border bg-muted/40 text-base font-medium">
                    {ch}
                    <button
                      type="button"
                      onClick={() => setChineseStrokeChars((arr) => arr.filter((_, idx) => idx !== i))}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chineseStrokeInput}
                  onChange={(e) => setChineseStrokeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const newChars = Array.from(chineseStrokeInput.trim()).filter((ch) => ch.trim());
                    if (newChars.length > 0) {
                      setChineseStrokeChars((arr) => Array.from(new Set([...arr, ...newChars])));
                      setChineseStrokeInput("");
                    }
                  }}
                  placeholder="打一个字或一段词，按Enter加进字库"
                  className={MINI_INPUT_CLASS}
                  style={{ width: 220 }}
                />
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => {
                    const newChars = Array.from(chineseStrokeInput.trim()).filter((ch) => ch.trim());
                    if (newChars.length > 0) {
                      setChineseStrokeChars((arr) => Array.from(new Set([...arr, ...newChars])));
                      setChineseStrokeInput("");
                    }
                  }}
                >
                  + 加进字库
                </Button>
              </div>
            </div>
            <div className="flex gap-3 flex-wrap items-center">
              <label className="flex items-center gap-1.5">每次玩练几个字
                <input type="number" min={1} value={totalQuestions} onChange={(e) => setTotalQuestions(Math.max(1, +e.target.value))} className={MINI_INPUT_CLASS} />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              每次玩从字库里随机抽题(字库不够题数时允许重复抽)。每个字先播放一遍笔顺动画演示，再让学生自己描着写，系统判断每一笔的顺序/方向/形状对不对——这部分靠 hanzi-writer 这个开源库处理，笔顺数据来自后端服务器(designer这里随便加什么常用字都能立刻用，不需要额外准备数据)。极少数生僻字可能不在数据库里，练习时会跳过并提示。
            </p>
          </div>
        )}

        {moduleType === "multiple_choice" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4 text-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <CheckSquare size={16} className="text-primary" /> 选择题 · 内容设置
            </div>

            <div className="space-y-1.5">
              <Label>题目文字（必填，至少中文）</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Input placeholder="中文" value={mcQuestionZh} onChange={(e) => setMcQuestionZh(e.target.value)} />
                <Input placeholder="English" value={mcQuestionEn} onChange={(e) => setMcQuestionEn(e.target.value)} />
                <Input placeholder="Bahasa Melayu" value={mcQuestionMs} onChange={(e) => setMcQuestionMs(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs text-muted-foreground block">背景画面（选填）——想给题目配一张图/摆几个物件，可以用这个编辑器；不需要的话跳过这一块，直接往下设置选项就行</span>
              <SceneEditor
                structuredMode presetModuleType="multiple_choice"
                onSaveStructured={setMcScene} initial={mcScene ?? undefined}
              />
              {mcScene && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  ✓ 背景已确认（{mcScene.objects.length} 个物件），可以点上面"完成"重新调整
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">答题方式：</span>
              <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
                {(["single", "multi"] as const).map((m) => (
                  <button
                    key={m} type="button" onClick={() => setMcAnswerMode(m)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      mcAnswerMode === m ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m === "single" ? "⚪ 单选" : "☑️ 多选"}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs text-muted-foreground block">选项（至少2个，勾选✓标记正确答案；每个选项至少填中文）</span>
              <div className="space-y-2">
                {mcOptions.map((opt) => (
                  <div key={opt.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-2">
                    <button
                      type="button"
                      onClick={() => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, correct: !o.correct } : o)))}
                      className={`w-7 h-7 flex-shrink-0 rounded-md border-2 flex items-center justify-center text-xs font-bold transition-colors ${
                        opt.correct ? "border-emerald-500 bg-emerald-500 text-white" : "border-border bg-white text-transparent"
                      }`}
                    >
                      ✓
                    </button>
                    <Input placeholder="中文" value={opt.zh} onChange={(e) => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, zh: e.target.value } : o)))} className="flex-1" />
                    <Input placeholder="English" value={opt.en} onChange={(e) => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, en: e.target.value } : o)))} className="flex-1" />
                    <Input placeholder="Bahasa Melayu" value={opt.ms} onChange={(e) => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, ms: e.target.value } : o)))} className="flex-1" />
                    <button
                      type="button"
                      onClick={() => setMcOptions((arr) => (arr.length > 2 ? arr.filter((o) => o.id !== opt.id) : arr))}
                      disabled={mcOptions.length <= 2}
                      className="w-7 h-7 flex-shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => setMcOptions((arr) => [...arr, { id: `opt${Date.now()}`, zh: "", en: "", ms: "", correct: false }])}
              >
                + 加一个选项
              </Button>
            </div>
          </div>
        )}

        {moduleType === "fill_blank" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4 text-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <PencilLine size={16} className="text-primary" /> 填充题 · 内容设置
            </div>

            <div className="space-y-2">
              <span className="text-xs text-muted-foreground block">背景画面（选填）</span>
              <SceneEditor
                structuredMode presetModuleType="fill_blank"
                onSaveStructured={setFbScene} initial={fbScene ?? undefined}
              />
              {fbScene && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  ✓ 背景已确认（{fbScene.objects.length} 个物件），可以点上面"完成"重新调整
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>题目句子（中文必填，用 ___ 三个下划线标记空的位置，几个下划线就有几个空）</Label>
              <Input placeholder='中文，例如：1 + 1 = ___' value={fbSentenceZh} onChange={(e) => setFbSentenceZh(e.target.value)} />
              <Input placeholder="English（选填，下划线数量也要对应）" value={fbSentenceEn} onChange={(e) => setFbSentenceEn(e.target.value)} />
              <Input placeholder="Bahasa Melayu（选填）" value={fbSentenceMs} onChange={(e) => setFbSentenceMs(e.target.value)} />
            </div>

            <div className="space-y-2">
              <span className="text-xs text-muted-foreground block">
                每个空的正确答案（按中文句子里 ___ 的顺序，一空一行；一个空可以有好几种都算对的写法，用逗号隔开，比如"5,五"）
              </span>
              {(() => {
                const blankCount = (fbSentenceZh.match(/___/g) ?? []).length;
                if (blankCount === 0) return <p className="text-xs text-muted-foreground/60">先在上面句子里加至少一个 ___，这里才会出现对应的答案输入框</p>;
                return (
                  <div className="space-y-1.5">
                    {Array.from({ length: blankCount }, (_, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-14 flex-shrink-0">第{i + 1}个空</span>
                        <Input
                          placeholder="正确答案，多个写法用逗号隔开"
                          value={fbBlankAnswers[i] ?? ""}
                          onChange={(e) => setFbBlankAnswers((arr) => {
                            const next = [...arr];
                            while (next.length <= i) next.push("");
                            next[i] = e.target.value;
                            return next;
                          })}
                        />
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {moduleType === "word_problem" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block mb-1.5">题型（至少选一个，混合出题）</span>
              <div className="flex gap-2 flex-wrap">
                {[
                  { key: "chicken_rabbit", label: "🐔 鸡兔同笼" },
                  { key: "meeting_point", label: "🚗 相遇问题" },
                  { key: "cow_grass", label: "🐄 牛吃草" },
                  { key: "concentration", label: "🧂 浓度问题" },
                  { key: "queue_position", label: "🧍 排队序数" },
                  { key: "queue_count", label: "🧍‍♂️ 排队人数" },
                  { key: "time_calc", label: "🕐 时间计算" },
                ].map(({ key, label }) => (
                  <button
                    key={key} type="button"
                    onClick={() => setWpCategories(wpCategories.includes(key) ? wpCategories.filter((c) => c !== key) : [...wpCategories, key])}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      wpCategories.includes(key) ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3 flex-wrap items-center">
              <label className="flex items-center gap-1.5">作答方式
                <select value={wpAnswerMode} onChange={(e) => setWpAnswerMode(e.target.value as "select" | "input")} className={MINI_SELECT_CLASS}>
                  <option value="select">选择题</option><option value="input">键盘输入</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5">题数 <input type="number" value={totalQuestions} onChange={(e) => setTotalQuestions(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
            </div>
          </div>
        )}

        {moduleType === "maze" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Route size={16} className="text-primary" /> 迷宫 · 内容设置
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm flex-wrap pb-3 border-b border-border/60">
                <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">背景图片</span>
                {mazeBgUrl ? (
                  <div className="w-14 h-14 rounded-lg border border-border shadow-sm overflow-hidden bg-muted/30 shrink-0">
                    <img src={mazeBgUrl} alt="背景" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground/50 shrink-0">
                    <ImagePlus size={18} />
                  </div>
                )}
                <label className="flex items-center gap-1.5">
                  <input type="file" accept="image/*" className="text-xs" onChange={(e) => e.target.files?.[0] && handleMazeBgUpload(e.target.files[0])} />
                </label>
                <AssetPicker category="background" label={mazeBgUrl ? "换一张" : "🗂️ 从素材库选"} moduleType="maze" onSelect={handleMazeBgSelect} />
              </div>

              {mazeBgUrl && (
                <div className="flex items-center gap-3 flex-wrap pb-3 border-b border-border/60">
                  <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">编辑模式</span>
                  <div className="flex gap-1 bg-muted/50 p-1 rounded-lg">
                    <button
                      type="button" onClick={() => setMazeEditMode("path")}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${mazeEditMode === "path" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      🧭 画路径模式
                    </button>
                    <button
                      type="button" onClick={() => setMazeEditMode("decorate")}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${mazeEditMode === "decorate" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      🎨 装饰模式（不影响走路）
                    </button>
                  </div>
                </div>
              )}

              {mazeBgUrl && mazeEditMode === "path" && (
                <div className="flex items-start gap-3 flex-wrap pb-3 border-b border-border/60">
                  <span className="text-xs font-medium text-muted-foreground w-16 shrink-0 pt-1.5">工具</span>
                  <div className="flex-1 space-y-2 min-w-[240px]">
                    <div className="flex gap-1 flex-wrap bg-muted/50 p-1 rounded-lg w-fit">
                      {([["paint","🖌️ 画路径"],["erase","🧹 擦除"],["fill","🪣 填充"],["barrier","🚧 画分隔线"],["fillErase","🗑️ 删除颜色"],["start","🟠 设起点"],["end","🟢 设终点"]] as const).map(([key,label]) => (
                        <button
                          key={key} type="button" onClick={() => setMazeTool(key)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                            mazeTool === key ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button" onClick={undoMaze} disabled={mazeHistoryCount === 0}
                        className="px-2.5 py-1 rounded-md text-xs font-medium border bg-card border-border text-muted-foreground disabled:opacity-30"
                      >
                        ↩️ 撤销
                      </button>
                      <button
                        type="button" onClick={clearMazeBarriers}
                        className="px-2.5 py-1 rounded-md text-xs font-medium border bg-card border-border text-muted-foreground"
                        title="把画好的分隔线（红色）全部清掉，不影响已经填好的路径"
                      >
                        🧽 清除分隔线
                      </button>
                    </div>
                    {(mazeTool === "paint" || mazeTool === "erase" || mazeTool === "barrier") && (
                      <div className="flex items-center gap-4 flex-wrap pt-1">
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">笔刷宽度
                          <input
                            type="range" min={8} max={50} value={mazeBrushWidth}
                            onChange={(e) => setMazeBrushWidth(+e.target.value)}
                            className="w-24"
                          />
                          <span className="w-6 text-right">{mazeBrushWidth}</span>
                        </label>
                        {mazeTool === "erase" && (
                          <span className="text-xs text-amber-600" title="墙（没画到/被擦掉的部分）太细的话，游戏里球可能会直接穿过去——两条路径之间留的间隔建议不要小于笔刷宽度本身">
                            💡 两条路径中间留的墙要够宽，太细容易被穿过
                          </span>
                        )}
                        {mazeTool === "paint" && (
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="只是方便看清楚画了哪里，颜色本身不影响走不走得通">画笔颜色
                            <input type="color" value={mazePaintColor} onChange={(e) => setMazePaintColor(e.target.value)} className="w-7 h-7 rounded border border-border cursor-pointer p-0.5" />
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {mazeBgUrl && mazeEditMode === "path" && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground">起点/终点配对：</span>
                {mazePairs.map((p, i) => (
                  <button
                    key={i} type="button" onClick={() => setMazeActivePairIdx(i)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      i === mazeActivePairIdx ? "border-2 border-foreground" : "border-border"
                    }`}
                    style={{ background: `${MZ_BALL_COLORS[i % MZ_BALL_COLORS.length]}22` }}
                  >
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: MZ_BALL_COLORS[i % MZ_BALL_COLORS.length] }} />
                    第{i + 1}对{p.start && p.end ? " ✓" : ""}
                    {mazePairs.length > 1 && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setMazePairs((ps) => ps.filter((_, idx) => idx !== i));
                          setMazeActivePairIdx((idx) => Math.max(0, idx >= i ? idx - 1 : idx));
                        }}
                        className="ml-1 text-muted-foreground hover:text-destructive"
                      >
                        ✕
                      </span>
                    )}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setMazePairs((ps) => [...ps, { start: null, end: null }]); setMazeActivePairIdx(mazePairs.length); }}
                  className="px-2.5 py-1 rounded-full text-xs border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary"
                >
                  ➕ 加一对
                </button>
              </div>
            )}
            {mazeBgUrl && mazeEditMode === "path" && (
              <>
                <p className="text-xs text-muted-foreground">
                  用"画路径"在图上涂出孩子能走的路（按住拖动，笔刷宽度可以调到很小方便画细的路），画错了"擦除"修正。"填充"认的是背景图片本身画好的颜色和边界——如果背景图上已经有一条边界清楚的路（比如这张图这种），点一下路中间就能把整条路自动填满，不用重新描一遍轮廓；如果背景图没有清楚边界，填充还是可能顺着颜色相近的地方漏出去，这种情况建议直接用"画路径"手动涂。如果路是一整条连在一起、只想填其中一段（比如螺旋迷宫从头到尾没分岔），先用"🚧 画分隔线"在想切开的地方画一道红线当"墙"，再点"填充"，就只会填到墙为止，不会漫过去——分隔线画错了用"🧽 清除分隔线"整个清掉重画（这个没有单独的撤销，跟"↩️ 撤销"是分开的两套）。"删除颜色"是填充的反向操作，点一下能把蒙版上连在一起的一整块已填色区域清掉。"设起点"/"设终点"改的是上面选中的那一对——先点选一对，再点"设起点"/"设终点"，在图上点一下位置。
                  {mazePairs.every((p) => p.start && p.end) ? ` 全部 ${mazePairs.length} 对都设好了 ✓` : " 还有配对没设完。"}
                </p>
                <canvas
                  ref={mazeCanvasRef} width={MZ_W} height={MZ_H}
                  onPointerDown={handleMazePointerDown} onPointerMove={handleMazePointerMove}
                  onPointerUp={handleMazePointerUp} onPointerLeave={handleMazePointerUp}
                  style={{ touchAction: "none" }}
                  className="w-full h-auto rounded-lg bg-card cursor-crosshair border border-border"
                />
              </>
            )}
            {mazeBgUrl && mazeEditMode === "decorate" && (
              <MazeDecorator bgUrl={mazeBgUrl} onBgUpdated={handleMazeDecorationUpdate} />
            )}
          </div>
        )}

        {moduleType === "sudoku" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4 text-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Grid3x3 size={16} className="text-primary" /> 数独 · 内容设置
            </div>
            <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
              {(["photo", "grid"] as const).map((m) => (
                <button
                  key={m} type="button" onClick={() => setSudokuLayout(m)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    sudokuLayout === m ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "photo" ? "📷 传照片标空格" : "▦ 自己画网格"}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 text-sm pt-1 border-t border-border/60">难度（标签用，不影响玩法）
              <select value={sudokuDifficulty} onChange={(e) => setSudokuDifficulty(e.target.value as "easy" | "medium" | "hard" | "custom")} className={MINI_SELECT_CLASS}>
                <option value="easy">😊 简单</option>
                <option value="medium">🙂 中等</option>
                <option value="hard">😤 困难</option>
                <option value="custom">🎯 自定义</option>
              </select>
            </label>

            {sudokuLayout === "photo" ? (
              <SudokuCellDesigner bgUrl={sudokuBgUrl} setBgUrl={setSudokuBgUrl} cells={sudokuCells} setCells={setSudokuCells} />
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5">
                  点左边工具栏的"▦ 加网格"插入格子，点画布上的格子选中它、在右边填数字，勾选"留空给学生填"标出哪些格要学生自己填——不勾的格子直接显示数字给学生看。背景图、物件、画笔这些工具照常能用，可以自由装饰。
                </p>
                <SceneEditor
                  structuredMode presetModuleType="sudoku"
                  onSaveStructured={setSudokuScene} initial={sudokuScene ?? undefined}
                />
                {sudokuScene?.grids?.[0] && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    ✓ 网格 {sudokuScene.grids[0].rows}×{sudokuScene.grids[0].cols}，可以点上面"完成"重新调整
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {moduleType === "number_maze" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-3 text-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <GitBranch size={16} className="text-primary" /> 数字迷宫 · 内容设置
            </div>
            <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
              {(["path", "grid"] as const).map((m) => (
                <button
                  key={m} type="button" onClick={() => setNmLayout(m)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    nmLayout === m ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "path" ? "🧭 路径分岔（房间迷宫）" : "▦ 方格棋盘（跳格子）"}
                </button>
              ))}
            </div>

            {nmLayout === "path" ? (
              <>
                <p className="text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5">
                  跟走迷宫玩法基本一样（沿着画好的路径拖着走，碰不到障碍物），多了"分岔点"——学生走到分岔点，要先点对数字选项才能继续往前走，选错算一次失误、可以重选。
                </p>
                <NumberMazeDesigner
                  bgUrl={nmBgUrl} setBgUrl={setNmBgUrl}
                  maskDataUrl={nmMaskDataUrl} setMaskDataUrl={setNmMaskDataUrl}
                  start={nmStart} setStart={setNmStart}
                  end={nmEnd} setEnd={setNmEnd}
                  decisionPoints={nmDecisionPoints} setDecisionPoints={setNmDecisionPoints}
                />
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5">
                  点"▦ 加网格"插入棋盘，每格填一个数字。再点画布上要走的每一格，在右边"路径顺序"填第几步——起点填1，往后依次+1，一路连到终点（只能填相邻的格子，上下左右，不能斜着跳）。学生玩的时候要照这个顺序，从相邻格子一步步跳过去。
                </p>
                <SceneEditor
                  structuredMode presetModuleType="number_maze"
                  onSaveStructured={setNmScene} initial={nmScene ?? undefined}
                />
                {nmScene?.grids?.[0] && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    ✓ 网格 {nmScene.grids[0].rows}×{nmScene.grids[0].cols}，已标 {nmScene.grids[0].cells.flat().filter((c) => c.pathStep).length} 步路径，可以点上面"完成"重新调整
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {moduleType === "sticker_game" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-3 text-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sticker size={16} className="text-primary" /> 贴纸游戏 · 内容设置
            </div>
            <p className="text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5">
              选背景图、加贴纸物件（素材库选或直接上传），拖到"正确的位置"摆好——这个位置就是答案。学生玩的时候，这些贴纸会被打乱塞进旁边的贴纸盘，要一个个拖回你摆的这个位置上。
            </p>
            <SceneEditor
              structuredMode presetModuleType="sticker_game"
              onSaveStructured={setStickerScene} initial={stickerScene ?? undefined}
            />
            {stickerScene && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ 已摆 {stickerScene.objects.length} 个贴纸，可以点上面"完成"重新调整</p>
            )}
          </div>
        )}

        {moduleType === "line_match" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4 text-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Link2 size={16} className="text-primary" /> 连线配对 · 内容设置
            </div>
            <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
              {(["list", "scene"] as const).map((m) => (
                <button
                  key={m} type="button" onClick={() => setLineMatchLayout(m)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    lineMatchLayout === m ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "list" ? "📋 列表配对" : "🖼️ 自定义画面"}
                </button>
              ))}
            </div>

            {lineMatchLayout === "list" ? (
              <>
                <label className="flex items-center gap-2 text-sm pt-1 border-t border-border/60">
                  <input type="checkbox" checked={lineMatchShuffleRight} onChange={(e) => setLineMatchShuffleRight(e.target.checked)} />
                  右栏顺序打乱（推荐开启，不然一眼就能看穿答案）
                </label>

                <p className="text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5">
                  左右两边先各自加物件，加完之后点下面"连线"区块里的一个左边项目、再点一个右边项目，就连一条线——一个物件可以连好几条线，不限1对1。
                </p>

                <div className="grid grid-cols-2 gap-3">
                  {([["left", lineMatchLeftItems, setLineMatchLeftItems, "左"], ["right", lineMatchRightItems, setLineMatchRightItems, "右"]] as const).map(([side, items, setItems, label]) => (
                    <div key={side} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground">{label}边物件（{items.length}）</p>
                        <button
                          type="button"
                          onClick={() => setItems((arr) => [...arr, { id: uid(), type: "text", content: "" }])}
                          className="text-xs text-primary hover:underline"
                        >
                          + 加一个
                        </button>
                      </div>
                      {items.map((it, idx) => (
                        <div key={it.id} className="flex items-start gap-1.5 bg-card rounded-lg border border-border p-2">
                          <div className="flex-1 space-y-1">
                            <select
                              className="text-xs border rounded p-1"
                              value={it.type}
                              onChange={(e) => setItems((arr) => arr.map((x) => x.id === it.id ? { ...x, type: e.target.value as "text" | "image", content: "" } : x))}
                            >
                              <option value="text">文字</option>
                              <option value="image">图片</option>
                            </select>
                            {it.type === "text" ? (
                              <Input
                                placeholder={side === "left" ? "如：狗" : "如：汪汪"} value={it.content}
                                onChange={(e) => setItems((arr) => arr.map((x) => x.id === it.id ? { ...x, content: e.target.value } : x))}
                                className="h-8 text-sm"
                              />
                            ) : (
                              <div className="flex items-center gap-2">
                                {it.content && <img src={it.content} alt="" className="w-10 h-10 object-contain rounded border border-border" />}
                                <AssetPicker
                                  category="object" label={it.content ? "换一张" : "选图片"} moduleType="line_match"
                                  onSelect={(url) => setItems((arr) => arr.map((x) => x.id === it.id ? { ...x, content: url } : x))}
                                />
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setItems((arr) => arr.filter((x) => x.id !== it.id));
                              setLineMatchEdges((es) => es.filter((e) => e.leftId !== it.id && e.rightId !== it.id));
                              if (lineMatchConnectFrom === it.id) setLineMatchConnectFrom(null);
                            }}
                            disabled={items.length <= 1}
                            className="text-red-500 hover:text-red-600 text-xs disabled:opacity-30"
                          >
                            删除
                          </button>
                          <span className="text-[10px] text-muted-foreground/50 shrink-0">#{idx + 1}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-border/60 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">连线（{lineMatchEdges.length} 条）{lineMatchConnectFrom && <span className="text-primary">· 已选中一项，点对面一项完成连线</span>}</p>
                  <div className="grid grid-cols-2 gap-3">
                    {([["left", lineMatchLeftItems], ["right", lineMatchRightItems]] as const).map(([side, items]) => (
                      <div key={side} className="flex flex-wrap gap-1.5">
                        {items.map((it) => {
                          const isSelected = lineMatchConnectFrom === it.id;
                          const connCount = lineMatchEdges.filter((e) => e.leftId === it.id || e.rightId === it.id).length;
                          return (
                            <button
                              key={it.id} type="button"
                              onClick={() => {
                                if (!lineMatchConnectFrom) { setLineMatchConnectFrom(it.id); return; }
                                if (lineMatchConnectFrom === it.id) { setLineMatchConnectFrom(null); return; }
                                const fromIsLeft = lineMatchLeftItems.some((x) => x.id === lineMatchConnectFrom);
                                const thisIsLeft = side === "left";
                                if (fromIsLeft === thisIsLeft) { setLineMatchConnectFrom(it.id); return; } // 选了同一边的另一个，改选它
                                const leftId = fromIsLeft ? lineMatchConnectFrom : it.id;
                                const rightId = fromIsLeft ? it.id : lineMatchConnectFrom;
                                setLineMatchEdges((es) => es.some((e) => e.leftId === leftId && e.rightId === rightId) ? es : [...es, { leftId, rightId }]);
                                setLineMatchConnectFrom(null);
                              }}
                              className={`px-2 py-1 rounded-full text-xs border transition-colors flex items-center gap-1 ${
                                isSelected ? "bg-primary text-primary-foreground border-primary" : connCount > 0 ? "bg-primary/10 border-primary/40" : "bg-card border-border text-muted-foreground"
                              }`}
                            >
                              {it.type === "image" ? (it.content ? <img src={it.content} alt="" className="w-4 h-4 object-contain" /> : "🖼️") : (it.content || "（空）")}
                              {connCount > 0 && <span className="text-[9px] opacity-70">×{connCount}</span>}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  {lineMatchEdges.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {lineMatchEdges.map((edge, i) => {
                        const l = lineMatchLeftItems.find((x) => x.id === edge.leftId);
                        const r = lineMatchRightItems.find((x) => x.id === edge.rightId);
                        return (
                          <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-muted/60 text-muted-foreground">
                            {l?.type === "image" ? "🖼️" : l?.content ?? "?"} ↔ {r?.type === "image" ? "🖼️" : r?.content ?? "?"}
                            <button type="button" onClick={() => setLineMatchEdges((es) => es.filter((_, idx) => idx !== i))} className="hover:text-red-500">✕</button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="space-y-3 pt-1 border-t border-border/60">
                <p className="text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5">
                  选背景图（素材库选或直接从电脑上传都可以）、加物件自由摆放到想要的位置。要连在一起的物件，在右边属性面板的「配对标记」填一样的字（比如都填「1」）——一组可以是2个也可以是3个以上，同一组的物件保存时会检查是不是至少2个、最后播放时会互相连起来。连线怎么连（直的、弯的）不影响判分，只看两端有没有接对。
                </p>
                <SceneEditor
                  structuredMode presetModuleType="line_match"
                  onSaveStructured={setLineMatchScene} initial={lineMatchScene ?? undefined}
                />
                {lineMatchScene && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ 已摆 {lineMatchScene.objects.length} 个物件，可以点上面"完成"重新调整</p>
                )}
              </div>
            )}
          </div>
        )}

        {moduleType === "ppt_lecture" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4 text-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Presentation size={16} className="text-primary" /> PPT讲义 · 内容设置
            </div>
            <p className="text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5">
              上传 PPT 文件，后端会自动转换成一页页的幻灯片图片；也可以直接从素材库选一份已经上传过的 PPT。转换需要几秒钟，转换完成前选到的话幻灯片数量会是 0，重新打开这个选择器再选一次就有了。
            </p>
            <div className="flex items-center gap-3">
              <AssetPicker
                category="ppt" label={pptSlideUrls.length > 0 ? "换一份 PPT" : "🗂️ 选 / 上传 PPT"}
                onSelect={() => {}}
                onSelectAsset={(asset) => { setPptSlideUrls(asset.slideUrls ?? []); setPptOriginalFilename(asset.name ?? ""); }}
              />
              {pptOriginalFilename && <span className="text-xs text-muted-foreground truncate">{pptOriginalFilename}</span>}
            </div>
            {pptSlideUrls.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ 已转换 {pptSlideUrls.length} 页幻灯片</p>
                <div className="flex flex-wrap gap-2">
                  {pptSlideUrls.map((url, i) => (
                    <div key={i} className="w-20 h-14 rounded-lg border border-border shadow-sm overflow-hidden bg-muted/30 shrink-0">
                      <img src={url} alt={`第${i + 1}页`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ 还没有幻灯片——上传/选好 PPT 之后才能保存</p>
            )}
          </div>
        )}

        {moduleType === "video_lecture" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4 text-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Film size={16} className="text-primary" /> 视频讲义 · 内容设置
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">视频</p>
              <div className="flex items-center gap-3">
                {videoUrl ? (
                  <video src={videoUrl} controls className="w-40 rounded-lg border border-border shadow-sm bg-black" />
                ) : (
                  <div className="w-40 h-24 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground/50 shrink-0">
                    <Film size={22} />
                  </div>
                )}
                <AssetPicker category="video" label={videoUrl ? "换一个视频" : "🗂️ 选 / 上传视频"} onSelect={setVideoUrl} />
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">封面图（选填，不设的话播放前显示黑屏）</p>
              <div className="flex items-center gap-3">
                {videoPosterUrl ? (
                  <div className="relative w-24 h-24 rounded-lg border border-border shadow-sm overflow-hidden bg-muted/30 shrink-0">
                    <img src={videoPosterUrl} alt="封面" className="w-full h-full object-cover" />
                    <button
                      type="button" onClick={() => setVideoPosterUrl(null)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[11px] flex items-center justify-center hover:bg-red-500"
                    >✕</button>
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground/50 shrink-0">
                    <ImagePlus size={22} />
                  </div>
                )}
                <AssetPicker category="background" label={videoPosterUrl ? "换一张" : "🗂️ 选封面图"} onSelect={setVideoPosterUrl} />
              </div>
            </div>
          </div>
        )}

        {moduleType === "play_along" && (
          <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4 text-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Music2 size={16} className="text-primary" /> 跟弹练习 · 内容设置
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-muted-foreground">乐谱（{paSheetUrls.length} 页，按顺序）</p>
                <AssetPicker category="background" label="🗂️ 加一页" onSelect={(url) => setPaSheetUrls((arr) => [...arr, url])} />
              </div>
              {paSheetUrls.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {paSheetUrls.map((url, i) => (
                    <div key={i} className="relative w-16 h-20 rounded-lg border border-border shadow-sm bg-white overflow-hidden shrink-0">
                      <img src={url} alt={`第${i + 1}页`} className="w-full h-full object-cover" />
                      <span className="absolute top-0.5 left-0.5 bg-black/60 text-white text-[9px] px-1 rounded">{i + 1}</span>
                      <div className="absolute bottom-0 inset-x-0 flex justify-between bg-black/50">
                        <button
                          type="button" disabled={i === 0}
                          onClick={() => setPaSheetUrls((arr) => { const next = [...arr]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next; })}
                          className="text-white text-[10px] px-1 disabled:opacity-30"
                        >◀</button>
                        <button
                          type="button"
                          onClick={() => {
                            setPaSheetUrls((arr) => arr.filter((_, idx) => idx !== i));
                            setPaMarkers((ms) => ms.filter((m) => m.page !== i).map((m) => (m.page > i ? { ...m, page: m.page - 1 } : m)));
                            setPaEditorPage((p) => Math.min(p, Math.max(0, paSheetUrls.length - 2)));
                          }}
                          className="text-white text-[10px] px-1 hover:text-red-300"
                        >✕</button>
                        <button
                          type="button" disabled={i === paSheetUrls.length - 1}
                          onClick={() => setPaSheetUrls((arr) => { const next = [...arr]; [next[i], next[i + 1]] = [next[i + 1], next[i]]; return next; })}
                          className="text-white text-[10px] px-1 disabled:opacity-30"
                        >▶</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="w-16 h-20 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground/50">
                  <ImagePlus size={18} />
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">音频</p>
              <AssetPicker category="audio" label={paAudioUrl ? "换一个音频" : "🗂️ 选 / 上传音频"} onSelect={setPaAudioUrl} />
              {paAudioUrl && <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">✓ 已选好音频</p>}
            </div>

            <div>
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                原速 BPM
                <input
                  type="number" min={1} max={400} value={paOriginalBpm}
                  onChange={(e) => setPaOriginalBpm(Math.max(1, Math.round(+e.target.value) || 1))}
                  className={MINI_INPUT_CLASS}
                />
                拍/分钟
              </label>
              <p className="text-xs text-muted-foreground/70 mt-1">这首曲子正常速度是多少 BPM——学生调速度的时候是按 BPM 调（比如 120/100/80/45），不是按巴仙，得先知道原速才能换算。不确定的话先填个大概值，之后随时能改。</p>
            </div>

            {paSheetUrls.length > 0 && paAudioUrl ? (
              <PlayAlongMarkerEditor
                pages={paSheetUrls} audioUrl={paAudioUrl}
                markers={paMarkers} setMarkers={setPaMarkers}
                currentPage={Math.min(paEditorPage, paSheetUrls.length - 1)} setCurrentPage={setPaEditorPage}
              />
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2.5">⚠️ 先上传乐谱和音频，才能开始打时间标记</p>
            )}
          </div>
        )}

        {moduleType === "coloring" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <ColoringRegionDesigner
              bgUrl={coloringBgUrl} setBgUrl={setColoringBgUrl}
              regions={coloringRegions} setRegions={setColoringRegions}
              maskDataUrl={coloringMaskDataUrl} setMaskDataUrl={setColoringMaskDataUrl}
            />
          </div>
        )}
        </div>

        <div className={activeTab === "properties" ? "block space-y-4" : "hidden"}>
        <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles size={16} className="text-primary" /> Activity 属性
            <span className="text-xs font-normal text-muted-foreground">（选填）</span>
          </div>
          <div>
            <Label className="text-xs">卡片封面图（选填——列表卡片上显示的缩略图，跟"讲解图"是两回事）</Label>
            <div className="flex items-center gap-3 mt-1">
              {coverImageUrl ? (
                <div className="relative w-24 h-24 rounded-lg border border-border shadow-sm overflow-hidden bg-muted/30 shrink-0">
                  <img src={coverImageUrl} alt="封面图" className="w-full h-full object-cover" />
                  <button
                    type="button" onClick={() => setCoverImageUrl(null)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[11px] flex items-center justify-center hover:bg-red-500"
                  >✕</button>
                </div>
              ) : (
                <div className="w-24 h-24 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground/50 shrink-0">
                  <ImagePlus size={22} />
                </div>
              )}
              <AssetPicker category="other" label={coverImageUrl ? "换一张" : "🗂️ 加一张封面图"} onSelect={setCoverImageUrl} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-1.5 text-sm">活动类型
              <select value={activityType} onChange={(e) => setActivityType(e.target.value)} className={MINI_SELECT_CLASS}>
                <option value="interactive">Interactive</option>
                <option value="game">Game</option>
                <option value="exercise">Exercise</option>
                <option value="worksheet">Worksheet</option>
                <option value="assessment">Assessment</option>
                <option value="simulation">Simulation</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-sm">难度
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className={MINI_SELECT_CLASS}>
                <option value="">不设定</option>
                <option value="starter">Starter</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="expert">Expert</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-sm">语言
              <select value={activityLanguage} onChange={(e) => setActivityLanguage(e.target.value)} className={MINI_SELECT_CLASS}>
                <option value="universal">🌐 通用</option>
                <option value="zh">🇨🇳 中文</option>
                <option value="en">🇬🇧 英文</option>
              </select>
            </label>
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1.5">教学模式（可多选）</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: "classroom", label: "课堂" }, { key: "self_guided", label: "自主学习" },
                { key: "discovery", label: "探究学习" }, { key: "homework", label: "家庭作业" },
                { key: "assessment", label: "测验" }, { key: "revision", label: "复习" },
              ].map(({ key, label }) => (
                <button
                  key={key} type="button"
                  onClick={() => setTeachingModes((tm) => tm.includes(key) ? tm.filter((m) => m !== key) : [...tm, key])}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${teachingModes.includes(key) ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-1 border-t border-border/60">
            <p className="text-xs font-medium text-foreground mb-1.5">使用场景（可多选）</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: "in_person", label: "实体课" }, { key: "self_guided", label: "Self-Guided Learning" },
                { key: "public_course", label: "公开课" },
              ].map(({ key, label }) => (
                <button
                  key={key} type="button"
                  onClick={() => setUsageContexts((uc) => uc.includes(key) ? uc.filter((c) => c !== key) : [...uc, key])}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${usageContexts.includes(key) ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {usageContexts.includes("self_guided") && (
              <div className="mt-2.5 pl-3 border-l-2 border-primary/30 space-y-1.5">
                <p className="text-xs text-muted-foreground">开放给哪些 Programme 的学生（不选=不限制，所有 Programme 都看得到）</p>
                <div className="flex flex-wrap gap-1.5">
                  {allProgrammes.map((p) => (
                    <button
                      key={p.id} type="button"
                      onClick={() => setSelfGuidedProgrammeIds((ids) => ids.includes(p.id) ? ids.filter((id) => id !== p.id) : [...ids, p.id])}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${selfGuidedProgrammeIds.includes(p.id) ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
                    >
                      {p.name_zh}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-4 items-end pt-1 border-t border-border/60">
            <label className="text-sm">适合年龄
              <div className="flex items-center gap-1 mt-1">
                <Input type="number" value={ageGroupMin} onChange={(e) => setAgeGroupMin(e.target.value)} className="w-16 h-8" placeholder="4" />
                <span className="text-muted-foreground">～</span>
                <Input type="number" value={ageGroupMax} onChange={(e) => setAgeGroupMax(e.target.value)} className="w-16 h-8" placeholder="6" />
                <span className="text-xs text-muted-foreground">岁</span>
              </div>
            </label>
            <label className="text-sm">预计时间
              <div className="flex items-center gap-1 mt-1">
                <Input type="number" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} className="w-16 h-8" placeholder="10" />
                <span className="text-xs text-muted-foreground">分钟</span>
              </div>
            </label>
          </div>

          <div className="grid sm:grid-cols-1 gap-3 pt-1 border-t border-border/60">
            <div>
              <Label className="text-xs">学习成果</Label>
              <Input placeholder="如：能够正确数出1到10之间的物体数量" value={learningOutcomes} onChange={(e) => setLearningOutcomes(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">培养能力（顿号或逗号分隔）</Label>
              <Input placeholder="如：数感、专注力、手眼协调" value={skillsInput} onChange={(e) => setSkillsInput(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">标签（最多3个）</Label>
              <Input placeholder="如：入门、森林、冬天" value={activityTagsInput} onChange={(e) => setActivityTagsInput(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm pt-1 border-t border-border/60">
            <input type="checkbox" checked={parentPreviewEnabled} onChange={(e) => setParentPreviewEnabled(e.target.checked)} />
            开放给家长预览（家长订阅前，在"课程内容预览"页面能看到并试玩这个 Activity）
          </label>
        </div>
        </div>

        <div className={activeTab === "hints" ? "block space-y-4" : "hidden"}>
        <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <MessageSquareText size={16} className="text-primary" /> 提示栏
            <span className="text-xs font-normal text-muted-foreground">（游戏过程中一直显示的小提示，选填）</span>
          </div>
          <Input placeholder="如：数一数的时候可以用手指点着数" value={hintText} onChange={(e) => setHintText(e.target.value)} />
        </div>

        <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Volume2 size={16} className="text-primary" /> 朗读音频
            <span className="text-xs font-normal text-muted-foreground">（预录音频，选填，不是AI生成）</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="file" accept="audio/*" className="text-xs"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const dataUrl = await new Promise<string>((resolve, reject) => {
                  const fr = new FileReader();
                  fr.onload = () => resolve(fr.result as string);
                  fr.onerror = reject;
                  fr.readAsDataURL(file);
                });
                setAudioUrl(dataUrl); setAudioFileName(file.name);
              }}
            />
            {audioUrl && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                已选：{audioFileName} <button type="button" onClick={() => { setAudioUrl(null); setAudioFileName(""); }} className="text-muted-foreground hover:text-red-500">✕</button>
              </span>
            )}
          </div>
          {audioUrl && <audio controls src={audioUrl} className="w-full h-8" />}
        </div>

        <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BookOpenText size={16} className="text-primary" /> 讲解
            <span className="text-xs font-normal text-muted-foreground">（答完后可查看的讲解，选填）</span>
          </div>
          <textarea
            className="w-full border rounded-md p-2 text-sm min-h-[70px]"
            placeholder="如：数数的小技巧，可以把物体两两分组来数..."
            value={explanationText} onChange={(e) => setExplanationText(e.target.value)}
          />
          <div className="flex items-center gap-3">
            {explanationImageUrl ? (
              <div className="relative w-24 h-24 rounded-lg border border-border shadow-sm overflow-hidden bg-muted/30 shrink-0">
                <img src={explanationImageUrl} alt="讲解图" className="w-full h-full object-cover" />
                <button
                  type="button" onClick={() => setExplanationImageUrl(null)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[11px] flex items-center justify-center hover:bg-red-500"
                >✕</button>
              </div>
            ) : (
              <div className="w-24 h-24 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground/50 shrink-0">
                <ImagePlus size={22} />
              </div>
            )}
            <AssetPicker category="other" label={explanationImageUrl ? "换一张" : "🗂️ 加一张讲解图"} onSelect={setExplanationImageUrl} />
          </div>
          <div>
            <Label className="text-xs">讲解视频链接（选填，播放时会自动循环、可以暂停定格）</Label>
            <Input placeholder="https://..." value={explanationVideoUrl} onChange={(e) => setExplanationVideoUrl(e.target.value)} />
          </div>
        </div>
        </div>

        <Button className="w-full" onClick={handleSave}>保存</Button>
      </div>
    </Modal>
  );
}

// ── Main page: Activity 管理 — 全平台卡带式卡片网格，不再是"先选课程" ─────────────
type SortKey = "subject" | "topic" | "activity" | "exercise_number" | "created_at";

interface ActivityRow {
  id: string; course_id: string; module_type: string; title_i18n?: Record<string,string>;
  exercise_number?: string; created_at: string;
  course_title_i18n?: Record<string,string>;
  cover_image_url?: string; my_play_count?: number; total_play_count?: number;
  // 一个 Activity 现在可以同时挂好几个 Topic（多对多），不再是单一的
  // programme_name_zh/subject_name_zh/topic_name_zh 那几个字段。
  topics: Array<{
    category_id: string; topic_name_zh?: string;
    subject_id?: string; subject_name_zh?: string;
    programme_id?: string; programme_name_zh?: string;
  }>;
}

export default function CourseDesignerPage() {
  // 两层导航——默认先看模块类型卡片（每种类型一张卡+数量），点进去才是
  // 该类型底下的 Activity 列表（这个列表页保留原本就有的 search/
  // subject/topic/sort/分页 全套）。搜索框在两层都在，但含义会变：在
  // 类型卡片这层输入，会跳过类型直接显示跨类型的搜索结果（不用先猜是
  // 哪个类型）；进了某个类型的列表页之后，搜索框缩小范围成"在这个类型
  // 里面搜"。
  //
  // 用网址上的 ?type= 记住现在在第二层的哪个类型——不只是好看/能分享
  // 链接，更重要的是"试玩"从这里点出去之后，播放页那边如果要做"返回"，
  // 只要导回 /course-designer?type=xxx 这个网址，就能回到正确的第二层，
  // 不会掉回第一层的类型卡片。
  const [searchParams, setSearchParams] = useSearchParams();
  const urlType = searchParams.get("type");
  const [viewMode, setViewMode] = useState<"types" | "list">(urlType ? "list" : "types");
  const [activeModuleType, setActiveModuleType] = useState<string | null>(urlType);

  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });

  const [search, setSearch] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const [subjects, setSubjects] = useState<Array<{ id: string; programme_id?: string; name_zh: string }>>([]);
  const [topics, setTopics] = useState<Array<{ id: string; subject_id?: string; name_zh: string }>>([]);

  const [showLevelModal, setShowLevelModal] = useState(false);
  const [editingLevelId, setEditingLevelId] = useState<string | null>(null);

  // 类型卡片上显示的"这个类型有几个 Activity"——是全站准确数字，不是
  // "本页"这种近似值，所以额外拉一次数据专门算这个，不跟下面分页用的
  // activities/meta 混在一起。用一个够大的 limit 抓一次（目前平台规模
  // 下够用）；如果以后 Activity 总数远超这个数字，这里的计数会不准，
  // 到时候应该改成让后端出一个"按类型分组计数"的专用接口，而不是继续
  // 加大这个 limit 硬撑。
  const [typeCounts, setTypeCounts] = useState<Record<string, number> | null>(null);
  function fetchTypeCounts() {
    eduApi.listAllActivities({ page: 1, limit: 500 }).then((r) => {
      const counts: Record<string, number> = {};
      r.data.forEach((a) => { counts[a.module_type] = (counts[a.module_type] ?? 0) + 1; });
      setTypeCounts(counts);
    });
  }
  useEffect(() => { if (viewMode === "types" && !search.trim()) fetchTypeCounts(); }, [viewMode, search]);

  // 在类型卡片这层直接搜索——跳过类型，显示跨类型的扁平结果；进了某个
  // 类型的列表页之后，范围缩小到这个类型里。
  const showingSearchAcrossTypes = viewMode === "types" && search.trim() !== "";
  // eduApi.listAllActivities 这个接口本身不支持按 module_type 筛选（试过
  // 传这个参数，TS 类型都不认，说明后端压根没接这个筛选条件）。所以类型
  // 列表页这边干脆放弃指望服务器端分页对这个类型准——一次性多抓一批
  // （用跟类型计数同一个上限），筛出这个类型的，分页交给前端自己切，
  // 不然"第20条里混着各种类型，筛完剩没几条"会让翻页体验完全不对。
  // 缺点：这批数据量一旦超过下面这个 FETCH_LIMIT，末尾的会抓不到——
  // 等以后 Activity 规模真的大到这个量级，就该让后端出一个真的支持
  // module_type 筛选的接口，而不是继续加大这个上限硬撑。
  const TYPE_FILTERED_FETCH_LIMIT = 500;
  function refresh() {
    if (viewMode === "types" && !showingSearchAcrossTypes) return; // 类型卡片层、没在搜索——不用拉 activities
    const isTypeFiltered = viewMode === "list" && !!activeModuleType;
    eduApi.listAllActivities({
      search: search || undefined,
      subject_id: subjectId || undefined, category_id: categoryId || undefined,
      sort: sortKey, order: sortOrder,
      page: isTypeFiltered ? 1 : page, limit: isTypeFiltered ? TYPE_FILTERED_FETCH_LIMIT : PAGE_SIZE,
    }).then((r) => {
      if (!isTypeFiltered) { setActivities(r.data); setMeta(r.meta); return; }
      const filtered = r.data.filter((a) => a.module_type === activeModuleType);
      const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      const clampedPage = Math.min(page, totalPages);
      setActivities(filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE));
      setMeta({ page: clampedPage, limit: PAGE_SIZE, total: filtered.length, totalPages });
    });
  }
  useEffect(refresh, [search, subjectId, categoryId, sortKey, sortOrder, page, viewMode, activeModuleType]);
  // 筛选条件一变就跳回第1页——不然筛出来的结果如果比原本停留的页数少，
  // 会出现"明明有资料，画面却空白"的情况
  useEffect(() => { setPage(1); }, [search, subjectId, categoryId, viewMode, activeModuleType]);

  // Subject→Topic 两层级联筛选，跟建 Activity 表单里那组是同一套逻辑，
  // 只是这里是拿来筛选列表，不是拿来决定新 Activity 的分类。
  useEffect(() => { taxonomyApi.listSubjects().then((ss) => setSubjects(ss.map((s) => ({ id: s.id, programme_id: s.programme_id, name_zh: s.name_zh })))); }, []);
  useEffect(() => {
    setCategoryId("");
    if (subjectId) exerciseClassificationApi.listCategories(subjectId).then((cs) => setTopics(cs.map((c) => ({ id: c.id, subject_id: c.subject_id, name_zh: c.name_zh }))));
    else setTopics([]);
  }, [subjectId]);

  function openType(mt: string) {
    setActiveModuleType(mt); setViewMode("list");
    setSearch(""); setSubjectId(""); setCategoryId(""); setPage(1);
    setSearchParams({ type: mt });
  }
  function backToTypes() {
    setViewMode("types"); setActiveModuleType(null);
    setSearch(""); setSubjectId(""); setCategoryId(""); setPage(1);
    setSearchParams({});
  }

  async function handleDeleteLevel(levelId: string) {
    if (!window.confirm("确定要删除这个 Activity 吗？这个操作没办法撤销。")) return;
    try {
      await eduApi.deleteLevel(levelId);
      toast.success("已删除");
      refresh();
      if (viewMode === "list") fetchTypeCounts(); // 删完这个类型的数量会变，类型卡片那层的数字要跟着更新
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "删除失败";
      toast.error(msg);
    }
  }

  function handleModalSaved() {
    refresh();
    fetchTypeCounts();
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Activity 设计管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {viewMode === "types" && !showingSearchAcrossTypes
              ? "按模块类型分组——先选类型，再看该类型底下的 Activity；也可以直接在下面搜索框打字跳过类型"
              : "课程与课时管理、Programme/Subject/Topic 本身的建立，都在各自独立的页面"}
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditingLevelId(null); setShowLevelModal(true); }}>+ Add Activity</Button>
      </div>

      {viewMode === "list" && (
        <div className="flex items-center gap-2 text-sm">
          <button type="button" onClick={backToTypes} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground">
            ← 返回类型
          </button>
          {activeModuleType && (() => {
            const c = MODULE_COLORS[activeModuleType] ?? FALLBACK_COLOR;
            const Icon = MODULE_ICONS[activeModuleType];
            return (
              <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: c.text }}>
                {Icon ? <Icon size={16} /> : null} {MODULE_LABELS[activeModuleType]?.label ?? activeModuleType}
              </span>
            );
          })()}
        </div>
      )}

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              placeholder={viewMode === "types" ? "搜 Activity 名称/编号（跨类型直接找）..." : "Search..."}
              value={search} onChange={(e) => setSearch(e.target.value)} className="w-[220px] shrink-0"
            />
            {viewMode === "list" && (
              <>
                <select className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm font-medium shadow-sm w-[150px] shrink-0" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                  <option value="">全部 Subject</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name_zh}</option>)}
                </select>
                <select className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm font-medium shadow-sm w-[150px] shrink-0 disabled:opacity-50" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!subjectId}>
                  <option value="">全部 Topic</option>
                  {topics.map((t) => <option key={t.id} value={t.id}>{t.name_zh}</option>)}
                </select>
              </>
            )}
            {(viewMode === "list" || showingSearchAcrossTypes) && (
              <>
                <select className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm font-medium shadow-sm w-[140px] shrink-0" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                  <option value="created_at">按建立时间</option>
                  <option value="activity">按名称</option>
                  <option value="exercise_number">按编号</option>
                  <option value="subject">按 Subject</option>
                  <option value="topic">按 Topic</option>
                </select>
                <button
                  type="button" onClick={() => setSortOrder((o) => (o === "asc" ? "desc" : "asc"))}
                  className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm font-medium shadow-sm shrink-0 hover:bg-muted transition-colors"
                  title={sortOrder === "asc" ? "升序" : "降序"}
                >
                  {sortOrder === "asc" ? "↑ 升序" : "↓ 降序"}
                </button>
              </>
            )}
            {(subjectId || categoryId || search) && (
              <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setSubjectId(""); setCategoryId(""); }}>清空筛选</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {viewMode === "types" && !showingSearchAcrossTypes ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Object.entries(MODULE_LABELS).map(([mt, { label }]) => {
            const c = MODULE_COLORS[mt] ?? FALLBACK_COLOR;
            const Icon = MODULE_ICONS[mt];
            const count = typeCounts?.[mt] ?? 0;
            return (
              <button
                key={mt} type="button" onClick={() => openType(mt)}
                className="text-left rounded-2xl bg-white border border-border shadow-sm hover:shadow-md transition-shadow p-4"
                style={{ borderTopWidth: 4, borderTopColor: c.ring }}
              >
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3" style={{ background: c.bg }}>
                  {Icon ? <Icon size={22} strokeWidth={2} style={{ color: c.text }} /> : null}
                </div>
                <p className="font-semibold text-sm">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{typeCounts === null ? "…" : `${count} 个 Activity`}</p>
              </button>
            );
          })}
        </div>
      ) : activities.length === 0 ? (
        <Card><CardContent className="pt-6">
          <EmptyState title={search || subjectId ? "没有符合条件的 Activity" : "还没有 Activity"} description={search || subjectId ? "换个搜索词或筛选条件试试" : "点右上角 Add Activity 建第一个"} />
        </CardContent></Card>
      ) : (
        <>
          {/* 卡带式卡片网格——每张卡片用它自己游戏类型的颜色，一眼能从颜色分辨类型 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {activities.map((a) => {
              const c = MODULE_COLORS[a.module_type] ?? FALLBACK_COLOR;
              const Icon = MODULE_ICONS[a.module_type];
              // "返回设计器"用的是浏览器 history.back()，不需要额外带参数——
              // 点"试玩"之前停留的网址就是 /course-designer?type=xxx（第二
              // 层状态已经记在网址上了，见上面 openType/backToTypes），
              // 浏览器返回自然就落回那个网址，第二层状态跟着一起还原。
              const previewHref =
                a.module_type === "ppt_lecture" ? `/view/ppt?levelId=${a.id}`
                : a.module_type === "video_lecture" ? `/view/video?levelId=${a.id}`
                : a.module_type === "play_along" ? `/view/play-along?levelId=${a.id}`
                : `/play/${a.id}?from=designer`;
              const topicNames = Array.from(new Set(a.topics.map((t) => t.topic_name_zh).filter(Boolean)));
              const cover = a.cover_image_url;
              const myPlays = a.my_play_count ?? 0;
              const totalPlays = a.total_play_count ?? 0;
              const publishedDate = a.created_at ? new Date(a.created_at).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }) : null;
              return (
                <div
                  key={a.id}
                  className="group rounded-2xl bg-white border border-border shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
                  style={{ borderTopWidth: 4, borderTopColor: c.ring }}
                >
                  <div className="p-3 flex-1 flex gap-3">
                    {/* 左边：图标+标题+类型+Topic，比右边窄 */}
                    <div className="w-24 shrink-0 space-y-1.5">
                      <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
                        style={{ background: c.bg }}
                      >
                        {cover ? (
                          <img src={cover} alt="" className="w-full h-full object-cover" />
                        ) : Icon ? (
                          <Icon size={22} strokeWidth={2} style={{ color: c.text }} />
                        ) : null}
                      </div>
                      <p className="font-semibold text-sm leading-snug line-clamp-2">{a.title_i18n?.zh ?? a.title_i18n?.en ?? a.module_type}</p>
                      <p className="text-[11px] font-medium" style={{ color: c.text }}>{MODULE_LABELS[a.module_type]?.label ?? a.module_type}</p>
                      {topicNames.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {topicNames.slice(0, 1).map((t) => (
                            <span key={t} className="text-[10px] bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 truncate max-w-full">{t}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/60">还没挂 Topic</span>
                      )}
                    </div>

                    {/* 右边：内容预览图 + 玩过次数/发布日期 */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="relative w-full aspect-[4/3] rounded-lg overflow-hidden bg-muted">
                        {cover ? (
                          <img src={cover} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
                            {Icon ? <Icon size={28} strokeWidth={1.5} /> : null}
                          </div>
                        )}
                        <div className="absolute top-1 right-1 rounded-md bg-black/70 text-white text-[9px] leading-tight px-1.5 py-1 space-y-0.5">
                          <p>总玩次数：{totalPlays}</p>
                          <p>你试玩过 {myPlays} 次</p>
                        </div>
                        {a.exercise_number && (
                          <span className="absolute bottom-1 left-1 text-[9px] font-mono text-white bg-black/60 rounded px-1.5 py-0.5">{a.exercise_number}</span>
                        )}
                      </div>
                      {publishedDate && <p className="text-[10px] text-muted-foreground/70 text-right">发布日期：{publishedDate}</p>}
                    </div>
                  </div>
                  <div className="flex items-center border-t border-border divide-x divide-border text-xs font-medium">
                    <a href={previewHref} className="flex-1 text-center py-2.5 text-primary hover:bg-primary/5 transition-colors">▶ 试玩</a>
                    <button type="button" onClick={() => { setEditingLevelId(a.id); setShowLevelModal(true); }} className="flex-1 text-center py-2.5 text-muted-foreground hover:bg-muted transition-colors">✎ 编辑</button>
                    <button type="button" onClick={() => handleDeleteLevel(a.id)} className="flex-1 text-center py-2.5 text-red-500 hover:bg-red-50 transition-colors">🗑 删除</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <span>Number of Records: {meta.total}，第 {meta.page} / {meta.totalPages} 页</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</Button>
              <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
            </div>
          </div>
        </>
      )}

      <AddLevelModal
        open={showLevelModal} onClose={() => { setShowLevelModal(false); setEditingLevelId(null); }}
        editingLevelId={editingLevelId}
        presetModuleType={viewMode === "list" ? activeModuleType : null}
        onSaved={handleModalSaved}
      />
    </div>
  );
}


