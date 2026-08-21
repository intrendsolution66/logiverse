// frontend/src/components/SceneEditor.tsx
//
// 改动：给 structuredMode（目前只有点点数数在用）的物件加一个可选的
// "类型"标签（比如"苹果"/"橙子"/"西瓜"），存在 ObjectLayer.objectType /
// StructuredSceneOutput.objects[].objectType 上。非structuredMode的用法
// （迷宫背景、找不同素材等，走扁平化PNG导出的那条路）完全不受影响——
// objectType只在structuredMode下才会在UI里露出来。
//
// 之所以叫 objectType 而不是 type，是因为 ObjectLayer 本来就有一个
// `type: "object"` 字段用来区分"这是物件层还是文字层"，不能重名。

import { useState, useRef, useCallback, useEffect } from "react";
import { assetsApi, eduApi } from "@/api";
import AssetPicker from "@/components/AssetPicker";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";
import { GAME_CANVAS_W, GAME_CANVAS_H, STICKER_CANVAS_SIZE } from "@/lib/gameCanvas";

const HANDLE_R = 10;
const ROTATE_HANDLE_DIST = 34; // px above the top edge, before rotation is applied
const BG_ID = "__background__";

// 背景图专用的绘制方式——按图片自己的原始长宽比"裁剪居中"画满目标框，
// 不拉伸变形（跟 CSS 的 background-size:cover / object-fit:cover 是同一
// 个效果，canvas 原生没有这个功能，自己算源图裁剪区域）。只用在背景图
// 上；物件/贴纸图标不用这个，那些是设计师主动调整过大小的，需要精确
// 匹配用户设的宽高，不该被裁剪。
function drawImageCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, dx: number, dy: number, dw: number, dh: number) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) { ctx.drawImage(img, dx, dy, dw, dh); return; } // 图片还没加载出真实尺寸，退回拉伸，避免报错
  const srcRatio = iw / ih, dstRatio = dw / dh;
  let sx = 0, sy = 0, sw = iw, sh = ih;
  if (srcRatio > dstRatio) { sw = ih * dstRatio; sx = (iw - sw) / 2; } // 图片比目标框更"宽"——裁掉左右两边
  else { sh = iw / dstRatio; sy = (ih - sh) / 2; } // 图片比目标框更"高"——裁掉上下两边
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

interface BackgroundLayer { url: string; x: number; y: number; w: number; h: number }
interface ObjectLayer { id: string; type: "object"; imageUrl: string; x: number; y: number; w: number; h: number; rotation: number; objectType?: string; flipX?: boolean; flipY?: boolean; opacity?: number; isTarget?: boolean }
interface TextLayer { id: string; type: "text"; text: string; x: number; y: number; fontSize: number; color: string; fontFamily: string; rotation: number; bold?: boolean; italic?: boolean; underline?: boolean }
interface ShapeLayer {
  id: string; type: "shape"; shape: "rect" | "ellipse" | "line" | "triangle";
  x: number; y: number; w: number; h: number; rotation: number;
  fillColor: string; fillEnabled: boolean;
  borderColor: string; borderEnabled: boolean; borderWidth: number;
  radius?: number; // 只有 rect 用得到——四角圆角半径(px)，line/ellipse/triangle 忽略这个值
  opacity?: number; // 0-100，不传视为100（不透明）
}
// 网格图层——给数独这种"自己画格子"的场景用。跟物件/形状一样有包围盒
// (x,y,w,h,rotation)，缩放/旋转/拖动走的是同一套通用机制；rows×cols
// 定义几行几列，cells 是一个 rows×cols 的二维阵列，每格记着填的数字
// (value，可以留空)跟这一格是不是"留给学生填"(blank)。
// pathStep 是给"数字迷宫·方格棋盘"模式用的——这一格是不是解题路径的一部分、
// 第几步(1起算，起点=1)。跟 blank/answer(数独专用)是两码事，互不冲突，
// 同一个 GridLayer 结构两边共用，各自只填自己关心的字段。
interface GridCellData { value: string; blank: boolean; answer?: string; pathStep?: number }
interface GridLayer {
  id: string; type: "grid";
  x: number; y: number; w: number; h: number; rotation: number;
  rows: number; cols: number;
  boxRows: number; boxCols: number; // "宫"——每隔几行/几列画粗分隔线，经典数独=3×3宫(boxRows=boxCols=3, rows=cols=9)。等于rows/cols时不分宫，只有外框是粗线(旧行为)。
  cells: GridCellData[][]; // [row][col]
  lineColor: string; givenColor: string; blankBg: string;
  bgColor: string; bgEnabled: boolean; // 整个网格底色（选填，跟blankBg是两回事——blankBg只填空格那一小块，这个是整个网格范围的底色）
  opacity?: number; // 0-100，不传视为100
}
type Layer = ObjectLayer | TextLayer | ShapeLayer | GridLayer;
interface Stroke { color: string; width: number; opacity: number; isEraser?: boolean; points: { x: number; y: number }[] }
interface Bounds { x: number; y: number; w: number; h: number }

const FONT_OPTIONS = [
  { label: "圆体（Baloo 2）", value: "'Baloo 2', sans-serif" },
  { label: "友善体（Nunito）", value: "'Nunito', sans-serif" },
  { label: "漫画体（Comic Neue）", value: "'Comic Neue', cursive" },
  { label: "中文趣味体（ZCOOL KuaiLe）", value: "'ZCOOL KuaiLe', sans-serif" },
  { label: "系统默认", value: "sans-serif" },
];

type Tool = "select" | "draw";
type DrawSubTool = "pencil" | "brush" | "bucket" | "eraser";
const COLORS = ["#e8a33d", "#ff7a59", "#4fb06d", "#5b8def", "#8b7ae0", "#222222", "#ffffff"];
const LANGUAGES = [{ code: "universal", label: "🌐 通用（不含文字/双语通用）" }, { code: "zh", label: "🇨🇳 中文专用" }, { code: "en", label: "🇬🇧 英文专用" }];
const MODULE_OPTIONS = [
  { value: "", label: "不限模块" },
  { value: "maze", label: "🧭 迷宫" }, { value: "spot_diff", label: "🔍 找不同之处" },
  { value: "focus_tap", label: "🎯 专注力点数字" }, { value: "memory", label: "🃏 Memory配对" },
  { value: "counting", label: "🔢 点点数数" }, { value: "pattern", label: "🧩 找规律" },
  { value: "word_problem", label: "📝 应用题" }, { value: "shape_count", label: "🔲 数方块(平面图形)" },
];

function uid() { return Math.random().toString(36).slice(2, 10); }
function deg2rad(d: number) { return (d * Math.PI) / 180; }

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  return [parseInt(m.slice(0, 2), 16) || 0, parseInt(m.slice(2, 4), 16) || 0, parseInt(m.slice(4, 6), 16) || 0];
}

// 填色桶——经典的栈式泛洪填充（不用递归，画布大了会爆栈）。tolerance 是
// 颜色容差，允许边缘抗锯齿造成的轻微色差也被当成"同一块区域"，不然一
// 圈毛边会漏填。
function floodFillImageData(imageData: ImageData, startX: number, startY: number, fillRgb: [number, number, number], tolerance: number) {
  const { width, height, data } = imageData;
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;
  const startIdx = (startY * width + startX) * 4;
  const sr = data[startIdx], sg = data[startIdx + 1], sb = data[startIdx + 2], sa = data[startIdx + 3];
  const [fr, fg, fb] = fillRgb;
  if (Math.abs(sr - fr) <= 2 && Math.abs(sg - fg) <= 2 && Math.abs(sb - fb) <= 2 && sa > 200) return; // 已经是目标色，不用填
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

function toLocalSpace(px: number, py: number, cx: number, cy: number, rotationDeg: number) {
  if (!rotationDeg) return { x: px, y: py };
  const rad = deg2rad(-rotationDeg);
  const dx = px - cx, dy = py - cy;
  return { x: dx * Math.cos(rad) - dy * Math.sin(rad) + cx, y: dx * Math.sin(rad) + dy * Math.cos(rad) + cy };
}
function toWorldSpace(lx: number, ly: number, cx: number, cy: number, rotationDeg: number) {
  const rad = deg2rad(rotationDeg);
  const dx = lx - cx, dy = ly - cy;
  return { x: dx * Math.cos(rad) - dy * Math.sin(rad) + cx, y: dx * Math.sin(rad) + dy * Math.cos(rad) + cy };
}

// 圆角矩形——半径不能超过短边的一半，不然四个角会自己撞在一起画出奇怪的形状
function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// 三角形——顶点在包围盒顶边中点，底边跟包围盒底边齐平，跟其它形状一样
// 缩放/旋转都是对整个包围盒操作，不用另外写一套变换逻辑
function trianglePath(ctx: CanvasRenderingContext2D, b: Bounds) {
  ctx.beginPath();
  ctx.moveTo(b.x + b.w / 2, b.y);
  ctx.lineTo(b.x + b.w, b.y + b.h);
  ctx.lineTo(b.x, b.y + b.h);
  ctx.closePath();
}

function SaveModal({ open, onClose, presetCategory, presetModuleType, onSave }: {
  open: boolean; onClose: () => void; presetCategory?: string; presetModuleType?: string;
  onSave: (b: { name: string; category: string; moduleType: string; gradeTierId: string; language: string; tags: string[] }) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(presetCategory ?? "background");
  const [moduleType, setModuleType] = useState(presetModuleType ?? "");
  const [gradeTierId, setGradeTierId] = useState("");
  const [language, setLanguage] = useState("universal");
  const [tagsInput, setTagsInput] = useState("");
  const [tiers, setTiers] = useState<Array<{ id: string; code: string; name_i18n: Record<string,string> }>>([]);

  useEffect(() => { if (open) eduApi.listGradeTiers().then(setTiers); }, [open]);
  useEffect(() => { if (open) { setCategory(presetCategory ?? "background"); setModuleType(presetModuleType ?? ""); } }, [open, presetCategory, presetModuleType]);

  return (
    <Modal open={open} onClose={onClose} title="保存到素材库" size="sm">
      <div className="space-y-3">
        <div><Label>名称</Label><Input placeholder="如：森林寻宝场景" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>标签（选填，最多3个，逗号分隔）</Label><Input placeholder="如：森林,冬天" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} /></div>
        <div>
          <Label>分类</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="background">🖼️ 背景图</option>
            <option value="object">🧸 物件图案</option>
            <option value="other">📁 其他</option>
          </select>
        </div>
        <div>
          <Label>适用游戏模块（选填）</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={moduleType} onChange={(e) => setModuleType(e.target.value)}>
            {MODULE_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div>
          <Label>适用等级（选填）</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={gradeTierId} onChange={(e) => setGradeTierId(e.target.value)}>
            <option value="">不限等级</option>
            {tiers.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name_i18n?.zh ?? t.name_i18n?.en}</option>)}
          </select>
        </div>
        <div>
          <Label>语言</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <p className="text-xs text-muted-foreground mt-1">如果图里有嵌入文字（比如画了中文字），选对应语言；纯图案、没有文字的选"通用"。</p>
        </div>
        <Button className="w-full" onClick={() => {
          if (!name.trim()) { toast.error("请输入名称"); return; }
          const tags = tagsInput.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 3);
          onSave({ name: name.trim(), category, moduleType, gradeTierId, language, tags });
        }}>保存</Button>
      </div>
    </Modal>
  );
}

export interface StructuredSceneOutput {
  bgUrl: string | null;
  /** 背景在画布里的位置/大小——不传的话默认铺满整个画布（W×H）。
   *  传了的话背景只占这一块区域，外面留白——给"背景其实是游戏里一个
   *  比例特定的方框，不是整个画布"这种场景用（比如找不同之处的两个
   *  对比框）。这个值也会出现在 onSaveStructured 的回传结果里，读取
   *  设计师确认后背景实际的最终位置（万一背景被手动拖动/缩放过）。 */
  bgBounds?: { x: number; y: number; w: number; h: number };
  objects: Array<{ imageUrl: string; x: number; y: number; w: number; h: number; rotation: number; objectType?: string; flipX?: boolean; flipY?: boolean; opacity?: number; isTarget?: boolean }>;
  texts: Array<{ text: string; x: number; y: number; fontSize: number; color: string; fontFamily: string; rotation: number; bold?: boolean; italic?: boolean; underline?: boolean }>;
  // 网格（数独这种"自己画格子"用）——不像形状会被烤进背景图，网格要
  // 保持可交互（学生要能填空），所以走跟 objects/texts 一样的结构化
  // 导出，不是扁平化 PNG 的那条路。
  grids?: Array<{ x: number; y: number; w: number; h: number; rotation: number; rows: number; cols: number; boxRows: number; boxCols: number; cells: { value: string; blank: boolean; answer?: string; pathStep?: number }[][]; lineColor: string; givenColor: string; blankBg: string; bgColor: string; bgEnabled: boolean; opacity?: number }>;
  // 形状（画方形/圆形/三角形等）——之前一直是"烤进背景图"那条路(跟
  // 画笔涂鸦一样处理)，只有需要"这个游戏要把形状当成独立可数的物件"
  // (比如数方块/圆形/三角形一共有几个，形状还可能互相重叠)才会用到
  // 这个字段，一般用途(纯装饰性的形状，比如给拼图场景加个边框)还是走
  // 烤进背景图那条路，不进这个数组——见 handleSaveStructured 里的判断。
  shapes?: Array<{
    shape: "rect" | "ellipse" | "line" | "triangle";
    x: number; y: number; w: number; h: number; rotation: number;
    fillColor: string; fillEnabled: boolean; borderColor: string; borderEnabled: boolean; borderWidth: number;
    radius?: number; opacity?: number;
  }>;
}

export default function SceneEditor({ presetCategory, presetModuleType, onSaved, structuredMode, onSaveStructured, initial, fillHeight, headerLabel }: {
  presetCategory?: string; presetModuleType?: string; onSaved?: (dataUrl: string) => void;
  structuredMode?: boolean;
  onSaveStructured?: (data: StructuredSceneOutput) => void;
  initial?: StructuredSceneOutput;
  // 外层父容器已经改造成 flex flex-col、能给这个组件分配一个确定的
  // 剩余高度时才传 true——这时用 min-h-0 把高度完全交给外层flex决定，
  // 画布会通过内部 maxHeight:100% 正确收缩，不会撑破外层紧凑布局逼出
  // scroll条。父容器还是普通 block/space-y 布局(没有确定高度可分配)
  // 的老用法就不要传，保持默认 false，走 min-h-[70vh] 兜底，行为不变。
  fillHeight?: boolean;
  // 外层想把自己的模块标题+说明文字（比如"拖拽游戏（位置版）· 内容设置
  // 选背景图、加物件..."）直接塞进这个组件自带的工具条里、跟撤销/完成
  // 按钮合用同一行，省掉外层自己再占一整行的空间——传了就替换掉默认的
  // "🎨 场景编辑器"文字；不传的话行为不变。
  headerLabel?: React.ReactNode;
}) {
  // 贴纸游戏用独立的正方形坐标系统，不跟其他模块共用长方形的 GAME_CANVAS_W/H——
  // 上传的背景图很少天生是1100:700这种比例，硬套共享画布会导致背景被拉伸变形，
  // 或者裁剪后跟贴纸坐标对不上。下面组件内所有引用W,H的地方都会自动用这里的值。
  const W = presetModuleType === "sticker_game" ? STICKER_CANVAS_SIZE : GAME_CANVAS_W;
  const H = presetModuleType === "sticker_game" ? STICKER_CANVAS_SIZE : GAME_CANVAS_H;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // 画布内部坐标系(W×H)跟它实际渲染在屏幕上的CSS像素大小不是1:1的
  // （aspectRatio+maxWidth/maxHeight会让浏览器自动缩放画布的显示尺寸）。
  // 文字所见即所得那个叠加在画布上的输入框，字号必须按这个缩放比例换
  // 算，不然输入框里的字看起来会比画布上实际画出来的字大一圈或小一圈，
  // 跟"实时预览"这个目的正好相反。用ResizeObserver盯着画布，窗口缩放/
  // 全屏切换的时候这个比例会跟着更新。
  const [canvasScale, setCanvasScale] = useState(1);
  // 双击文字才进入"原地编辑"模式(叠加输入框才会真正接收点击/拖拽事件)；
  // 单击还是走原来canvas自己的拖动/选中逻辑——不然叠加层会挡住"点文字
  // 拖动移动它"这个手势，单击瞬间就跑去输入框里放光标了，拖不动。
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => setCanvasScale(el.getBoundingClientRect().width / W);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W]);
  const imgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const [, forceRedraw] = useState(0);

  const [background, setBackground] = useState<BackgroundLayer | null>(
    initial?.bgUrl
      ? { url: initial.bgUrl, x: initial.bgBounds?.x ?? W / 2, y: initial.bgBounds?.y ?? H / 2, w: initial.bgBounds?.w ?? W, h: initial.bgBounds?.h ?? H }
      : null
  );
  const [layers, setLayers] = useState<Layer[]>(() => {
    if (!initial) return [];
    const objectLayers: ObjectLayer[] = initial.objects.map((o) => ({ id: uid(), type: "object", imageUrl: o.imageUrl, x: o.x, y: o.y, w: o.w, h: o.h, rotation: o.rotation, objectType: o.objectType ?? "", flipX: o.flipX, flipY: o.flipY, opacity: o.opacity, isTarget: o.isTarget }));
    const textLayers: TextLayer[] = initial.texts.map((t) => ({ id: uid(), type: "text", text: t.text, x: t.x, y: t.y, fontSize: t.fontSize, color: t.color, fontFamily: t.fontFamily, rotation: t.rotation, bold: t.bold, italic: t.italic, underline: t.underline }));
    const gridLayers: GridLayer[] = (initial.grids ?? []).map((g) => ({
      id: uid(), type: "grid", x: g.x, y: g.y, w: g.w, h: g.h, rotation: g.rotation,
      rows: g.rows, cols: g.cols, boxRows: g.boxRows ?? g.rows, boxCols: g.boxCols ?? g.cols,
      cells: g.cells, lineColor: g.lineColor, givenColor: g.givenColor, blankBg: g.blankBg,
      bgColor: g.bgColor ?? "#ffffff", bgEnabled: g.bgEnabled ?? false, opacity: g.opacity,
    }));
    // 形状——之前的版本里形状从来不会出现在initial.shapes里(因为之前
    // 一直被烤进bgUrl)，这里只是让"重新打开一个已经用新逻辑存过的
    // 自定义场景"能正确还原，旧数据(没有shapes字段)自然走??[]的空数组。
    const shapeLayers: ShapeLayer[] = (initial.shapes ?? []).map((s) => ({
      id: uid(), type: "shape", shape: s.shape, x: s.x, y: s.y, w: s.w, h: s.h, rotation: s.rotation,
      fillColor: s.fillColor, fillEnabled: s.fillEnabled, borderColor: s.borderColor, borderEnabled: s.borderEnabled,
      borderWidth: s.borderWidth, radius: s.radius, opacity: s.opacity,
    }));
    return [...objectLayers, ...textLayers, ...gridLayers, ...shapeLayers];
  });
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [drawSubTool, setDrawSubTool] = useState<DrawSubTool>("pencil");
  // 左侧图标栏点了哪个分类——不是立刻执行动作，是展开对应的选项面板到
  // 图标栏右侧(跟Canva一样)。null=收起，没有面板展开，图标栏保持窄条。
  const [activePanel, setActivePanel] = useState<"background" | "elements" | "text" | "shapes" | "draw" | null>(null);
  const [drawColor, setDrawColor] = useState("#e8a33d");
  const [drawWidth, setDrawWidth] = useState(6);
  const [drawOpacity, setDrawOpacity] = useState(100); // 只有"毛笔"用得到，铅笔固定100%不透明
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedGridCell, setSelectedGridCell] = useState<{ row: number; col: number } | null>(null);
  const [showSave, setShowSave] = useState(false);
  const [history, setHistory] = useState<{ background: BackgroundLayer | null; layers: Layer[]; strokes: Stroke[] }[]>([]);

  const dragRef = useRef<{
    mode: "move" | "resize" | "rotate" | "draw";
    startX: number; startY: number;
    origBg?: BackgroundLayer; origLayer?: Layer; stroke?: Stroke;
  } | null>(null);

  function ensureImgLoaded(url: string) {
    if (imgCacheRef.current.has(url)) return;
    const img = new Image();
    // crossOrigin 只在图片真的来自"别的源"（比如素材库选的图，网址指向
    // 后端服务器）时才需要——不设的话画到canvas上之后会被浏览器判定
    // "跨域污染"，之后所有 toDataURL/getImageData 都会报错。但本地上传
    // 生成的是 data: 网址(base64编码的图片数据，不是真正的网络请求)，
    // 本身就不存在跨域这回事——给 data: 网址也设 crossOrigin 反而会导致
    // 浏览器加载失败(而且失败得无声无息，因为下面这行以前没有 onerror
    // 处理，图裂了都不会有任何提示，这正是"从电脑上传背景图卡住、完全
    // 没反应"这个问题的根源——素材库选图不受影响是因为那边给的一直是
    // 真正的HTTP网址，只有本地上传这条路径会踩到这个坑)。
    if (!url.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => forceRedraw((n) => n + 1);
    img.onerror = () => {
      imgCacheRef.current.delete(url); // 加载失败别缓存住，不然下次同一张图连重试的机会都没有
      toast.error("图片加载失败，请换一张再试");
    };
    img.src = url;
    imgCacheRef.current.set(url, img);
  }

  useEffect(() => { if (background) ensureImgLoaded(background.url); }, [background]);
  useEffect(() => { layers.forEach((l) => { if (l.type === "object") ensureImgLoaded(l.imageUrl); }); }, [layers]);

  const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;
  const backgroundSelected = selectedId === BG_ID && !!background;

  function pushHistory() {
    setHistory((h) => [...h.slice(-19), { background, layers, strokes }]);
  }
  function undo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setBackground(last.background); setLayers(last.layers); setStrokes(last.strokes);
      setSelectedId(null);
      return h.slice(0, -1);
    });
  }

  function objectBounds(l: ObjectLayer | ShapeLayer | GridLayer | BackgroundLayer): Bounds {
    return { x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h };
  }
  // 网格里某一格的中心点——先按未旋转的本地坐标算出格子中心(cellW/cellH
  // 是均分整个网格宽高)，再绕网格自己的中心(l.x, l.y)转过rotation角度，
  // 得到它在画布上真正的像素位置。跟canvas实际绘制网格时的变换顺序
  // (ctx.translate(l.x,l.y) → ctx.rotate → 画格子 → translate回去)完全
  // 对应，格子没转的话(rotation=0)算出来跟直接线性定位是一样的。
  function gridCellCenter(l: GridLayer, row: number, col: number): { x: number; y: number } {
    const b = objectBounds(l);
    const cellW = b.w / l.cols, cellH = b.h / l.rows;
    const localX = b.x + (col + 0.5) * cellW, localY = b.y + (row + 0.5) * cellH;
    const rad = deg2rad(l.rotation ?? 0);
    const dx = localX - l.x, dy = localY - l.y;
    return { x: l.x + dx * Math.cos(rad) - dy * Math.sin(rad), y: l.y + dx * Math.sin(rad) + dy * Math.cos(rad) };
  }
  function layerBounds(l: Layer, ctx: CanvasRenderingContext2D): Bounds {
    if (l.type === "object" || l.type === "shape" || l.type === "grid") return objectBounds(l);
    ctx.font = `${l.fontSize}px ${l.fontFamily}`;
    const width = ctx.measureText(l.text).width;
    return { x: l.x - width / 2, y: l.y - l.fontSize / 2, w: width, h: l.fontSize };
  }
  function layerRotation(l: Layer): number { return l.rotation ?? 0; }

  function drawSelectionBox(ctx: CanvasRenderingContext2D, b: Bounds, rotationDeg: number) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(deg2rad(rotationDeg)); ctx.translate(-cx, -cy);

    ctx.strokeStyle = "#5b8def"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(b.x + b.w, b.y + b.h, HANDLE_R, 0, Math.PI * 2);
    ctx.fillStyle = "#5b8def"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    const handleX = cx, handleY = b.y - ROTATE_HANDLE_DIST;
    ctx.beginPath(); ctx.moveTo(cx, b.y); ctx.lineTo(handleX, handleY);
    ctx.strokeStyle = "#5b8def"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(handleX, handleY, HANDLE_R - 1, 0, Math.PI * 2);
    ctx.fillStyle = "#4fb06d"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();

    ctx.restore();
  }

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#f6faf7"; ctx.fillRect(0, 0, W, H);

    if (background) {
      const img = imgCacheRef.current.get(background.url);
      const b = objectBounds(background);
      if (img?.complete) drawImageCover(ctx, img, b.x, b.y, b.w, b.h);
      if (selectedId === BG_ID) drawSelectionBox(ctx, b, 0);
    }

    strokes.forEach((s) => {
      ctx.save();
      ctx.globalAlpha = s.opacity ?? 1;
      ctx.globalCompositeOperation = s.isEraser ? "destination-out" : "source-over";
      ctx.beginPath();
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
      s.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.restore();
    });

    layers.forEach((l) => {
      const rot = layerRotation(l);
      ctx.save();
      ctx.translate(l.x, l.y); ctx.rotate(deg2rad(rot)); ctx.translate(-l.x, -l.y);
      if (l.type === "object" || l.type === "shape" || l.type === "grid") ctx.globalAlpha = (l.opacity ?? 100) / 100;
      if (l.type === "object") {
        const img = imgCacheRef.current.get(l.imageUrl);
        const b = objectBounds(l);
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
      } else if (l.type === "shape") {
        const b = objectBounds(l);
        if (l.shape === "line") {
          // 直线没有"填充"这个概念，粗细/颜色借用边框那两个属性，中心
          // 在自己的包围盒里画一条水平线，长度=w，旋转跟其它形状一样由
          // 外层的 rotate 统一处理——这样直线也能直接沿用现成的缩放/
          // 旋转/复制/图层排序，不用另外写一套。
          ctx.beginPath();
          ctx.moveTo(b.x, l.y); ctx.lineTo(b.x + b.w, l.y);
          ctx.lineCap = "round";
          ctx.strokeStyle = l.borderColor; ctx.lineWidth = Math.max(1, l.borderWidth); ctx.stroke();
        } else {
          if (l.shape === "ellipse") {
            ctx.beginPath();
            ctx.ellipse(l.x, l.y, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
          } else if (l.shape === "triangle") {
            trianglePath(ctx, b);
          } else if (l.radius && l.radius > 0) {
            roundedRectPath(ctx, b.x, b.y, b.w, b.h, l.radius);
          } else {
            ctx.beginPath();
            ctx.rect(b.x, b.y, b.w, b.h);
          }
          if (l.fillEnabled) { ctx.fillStyle = l.fillColor; ctx.fill(); }
          if (l.borderEnabled && l.borderWidth > 0) {
            ctx.strokeStyle = l.borderColor; ctx.lineWidth = l.borderWidth; ctx.stroke();
          }
        }
      } else if (l.type === "grid") {
        const b = objectBounds(l);
        const cellW = b.w / l.cols, cellH = b.h / l.rows;
        if (l.bgEnabled) { ctx.fillStyle = l.bgColor; ctx.fillRect(b.x, b.y, b.w, b.h); }
        // 外框
        ctx.strokeStyle = l.lineColor; ctx.lineWidth = 2;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        for (let r = 0; r < l.rows; r++) {
          for (let c = 0; c < l.cols; c++) {
            const cellX = b.x + c * cellW, cellY = b.y + r * cellH;
            const cell = l.cells[r]?.[c] ?? { value: "", blank: false };
            if (cell.blank) {
              ctx.fillStyle = l.blankBg;
              ctx.fillRect(cellX + 2, cellY + 2, cellW - 4, cellH - 4);
            }
            // 内部分隔线——"宫"边界(每隔boxRows行/boxCols列)用跟外框一样
            // 粗的线，其余格子之间是细线，让设计师在编辑器里就能看到
            // 跟实际游戏里一致的宫结构（经典数独3×3宫）。
            const isBoxBottom = (r + 1) % l.boxRows === 0 && r + 1 < l.rows;
            const isBoxRight = (c + 1) % l.boxCols === 0 && c + 1 < l.cols;
            ctx.strokeStyle = l.lineColor; ctx.lineWidth = 1;
            ctx.strokeRect(cellX, cellY, cellW, cellH);
            if (isBoxBottom || isBoxRight) {
              ctx.lineWidth = 2;
              ctx.beginPath();
              if (isBoxBottom) { ctx.moveTo(cellX, cellY + cellH); ctx.lineTo(cellX + cellW, cellY + cellH); }
              if (isBoxRight) { ctx.moveTo(cellX + cellW, cellY); ctx.lineTo(cellX + cellW, cellY + cellH); }
              ctx.stroke();
            }
            if (cell.blank) {
              // 答案只在编辑器里给设计师自己看一眼核对用（淡色小字，
              // 跟给定数字的粗体正常颜色明显区分），不会真的画进保存的
              // 图片/发给运行时——运行时只拿得到 blank_cells 的位置，
              // 答案是server端核对，这里纯粹是编辑器的可视化辅助。
              if (cell.answer) {
                ctx.font = `${Math.floor(Math.min(cellW, cellH) * 0.4)}px sans-serif`;
                ctx.fillStyle = "#00000055";
                ctx.textAlign = "center"; ctx.textBaseline = "middle";
                ctx.fillText(cell.answer, cellX + cellW / 2, cellY + cellH / 2);
              }
            } else if (cell.value) {
              ctx.font = `bold ${Math.floor(Math.min(cellW, cellH) * 0.55)}px sans-serif`;
              ctx.fillStyle = l.givenColor;
              ctx.textAlign = "center"; ctx.textBaseline = "middle";
              ctx.fillText(cell.value, cellX + cellW / 2, cellY + cellH / 2);
            }
            if (cell.pathStep) {
              // 数字迷宫·方格棋盘模式——这一格在解题路径上，画个橙色圈
              // 框住整格 + 左上角一个小圆点标"第几步"，方便设计师核对
              // 路径顺序对不对，不会真的画进保存结果（结构化模式下这个
              // 网格是结构化数据，不是烤进背景图，运行时自己会画光标/
              // 高亮，不需要编辑器的这个视觉提示）。
              ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 3;
              ctx.strokeRect(cellX + 3, cellY + 3, cellW - 6, cellH - 6);
              ctx.beginPath(); ctx.arc(cellX + 10, cellY + 10, 8, 0, Math.PI * 2);
              ctx.fillStyle = "#f59e0b"; ctx.fill();
              ctx.font = "bold 10px sans-serif"; ctx.fillStyle = "#fff";
              ctx.textAlign = "center"; ctx.textBaseline = "middle";
              ctx.fillText(String(cell.pathStep), cellX + 10, cellY + 10);
            }
          }
        }
        // 选中格子的高亮框——比内部分隔线粗、颜色也不一样(用选中框同一个
        // 蓝色)，一眼能看出现在编辑的是哪一格，不用去数行列。只有这个
        // 网格本身也被选中的时候才画（避免切到别的图层了，另一个网格上
        // 还留着一个不相关的高亮框）。
        if (l.id === selectedId && selectedGridCell && selectedGridCell.row < l.rows && selectedGridCell.col < l.cols) {
          const hx = b.x + selectedGridCell.col * cellW, hy = b.y + selectedGridCell.row * cellH;
          ctx.strokeStyle = "#5b8def"; ctx.lineWidth = 3;
          ctx.strokeRect(hx + 1.5, hy + 1.5, cellW - 3, cellH - 3);
        }
      } else {
        ctx.font = `${l.italic ? "italic " : ""}${l.bold ? "bold " : ""}${l.fontSize}px ${l.fontFamily}`;
        ctx.fillStyle = l.color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(l.text, l.x, l.y);
        if (l.underline) {
          const width = ctx.measureText(l.text).width;
          ctx.beginPath();
          ctx.moveTo(l.x - width / 2, l.y + l.fontSize / 2 + 2);
          ctx.lineTo(l.x + width / 2, l.y + l.fontSize / 2 + 2);
          ctx.strokeStyle = l.color; ctx.lineWidth = Math.max(1, l.fontSize / 20);
          ctx.stroke();
        }
      }
      ctx.restore();
      if (l.id === selectedId) drawSelectionBox(ctx, layerBounds(l, ctx), rot);
    });
  }, [background, layers, strokes, selectedId, selectedGridCell]);

  useEffect(() => { redraw(); });

  // 键盘快捷键——只在没有焦点落在输入框/下拉框里的时候生效，不然打字打到
  // 一半按了空格/退格会被这里拦走，变成删物件而不是打字。
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, layers]);

  function toCanvasXY(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = W / rect.width, scaleY = H / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function hitTest(x: number, y: number): { id: string; onHandle: "resize" | "rotate" | false } | null {
    const ctx = canvasRef.current!.getContext("2d")!;
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      const rot = layerRotation(l);
      const b = layerBounds(l, ctx);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const handleWorld = toWorldSpace(cx, b.y - ROTATE_HANDLE_DIST, cx, cy, rot);
      if (Math.hypot(x - handleWorld.x, y - handleWorld.y) < HANDLE_R + 4) return { id: l.id, onHandle: "rotate" };
      const local = toLocalSpace(x, y, cx, cy, rot);
      if (Math.hypot(local.x - (b.x + b.w), local.y - (b.y + b.h)) < HANDLE_R + 4) return { id: l.id, onHandle: "resize" };
      if (local.x >= b.x && local.x <= b.x + b.w && local.y >= b.y && local.y <= b.y + b.h) return { id: l.id, onHandle: false };
    }
    if (background) {
      const b = objectBounds(background);
      if (Math.hypot(x - (b.x + b.w), y - (b.y + b.h)) < HANDLE_R + 4) return { id: BG_ID, onHandle: "resize" };
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { id: BG_ID, onHandle: false };
    }
    return null;
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const { x, y } = toCanvasXY(e);
    if (tool === "draw") {
      if (drawSubTool === "bucket") {
        bucketFillBackground(x, y);
        return;
      }
      pushHistory();
      const opacity = drawSubTool === "brush" ? drawOpacity / 100 : 1;
      const stroke: Stroke = { color: drawColor, width: drawWidth, opacity, isEraser: drawSubTool === "eraser", points: [{ x, y }] };
      dragRef.current = { mode: "draw", startX: x, startY: y, stroke };
      setStrokes((s) => [...s, stroke]);
      return;
    }
    const hit = hitTest(x, y);
    if (!hit) { setSelectedId(null); setSelectedGridCell(null); return; }
    setSelectedId(hit.id);
    pushHistory();
    if (hit.id === BG_ID && background) {
      dragRef.current = { mode: hit.onHandle === "resize" ? "resize" : "move", startX: x, startY: y, origBg: { ...background } };
    } else {
      const l = layers.find((l2) => l2.id === hit.id);
      if (l) dragRef.current = { mode: hit.onHandle === "resize" ? "resize" : hit.onHandle === "rotate" ? "rotate" : "move", startX: x, startY: y, origLayer: { ...l } };
      // 点在网格里面（不是拖手柄）——顺便算出点的是哪一格，给属性面板
      // 那个"选中格子编辑"用。旋转过的网格要先把点击坐标转回网格自己
      // 的本地坐标系再算行列，不然网格转了角度之后点哪格会算错。
      if (l && l.type === "grid" && hit.onHandle === false) {
        const b = objectBounds(l);
        const local = toLocalSpace(x, y, l.x, l.y, l.rotation ?? 0);
        const col = Math.floor((local.x - b.x) / (b.w / l.cols));
        const row = Math.floor((local.y - b.y) / (b.h / l.rows));
        if (row >= 0 && row < l.rows && col >= 0 && col < l.cols) setSelectedGridCell({ row, col });
      } else {
        setSelectedGridCell(null);
      }
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return;
    const { x, y } = toCanvasXY(e);
    const d = dragRef.current;

    if (d.mode === "draw" && d.stroke) {
      d.stroke.points.push({ x, y });
      setStrokes((s) => [...s]);
      return;
    }

    if (d.mode === "rotate" && d.origLayer) {
      const cx = d.origLayer.x, cy = d.origLayer.y;
      const angleDeg = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
      setLayers((ls) => ls.map((l) => (l.id === d.origLayer!.id ? { ...l, rotation: Math.round(angleDeg) } : l)));
      return;
    }

    const dx = x - d.startX, dy = y - d.startY;

    if (d.origBg) {
      const orig = d.origBg;
      setBackground(
        d.mode === "move"
          ? { ...orig, x: orig.x + dx, y: orig.y + dy }
          : { ...orig, w: Math.max(40, orig.w + dx), h: Math.max(40, orig.h + dy) }
      );
      return;
    }
    if (!d.origLayer) return;
    setLayers((ls) => ls.map((l) => {
      if (l.id !== d.origLayer!.id) return l;
      if (d.mode === "move") return { ...l, x: d.origLayer!.x + dx, y: d.origLayer!.y + dy };
      if (l.type === "object" || l.type === "shape" || l.type === "grid") {
        const orig = d.origLayer as ObjectLayer | ShapeLayer | GridLayer;
        return { ...l, w: Math.max(20, orig.w + dx), h: Math.max(20, orig.h + dy) };
      }
      const orig = d.origLayer as TextLayer;
      return { ...l, fontSize: Math.max(10, orig.fontSize + dy) };
    }));
  }

  function handlePointerUp() { dragRef.current = null; }

  // 双击文字图层——进入"原地编辑"模式，叠加输入框这时才真正接收点击/
  // 打字。双击画布上别的地方(或者别的类型图层)就退出编辑模式，回到
  // 普通拖动/选中。
  function handleCanvasDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (tool !== "select") return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = W / rect.width, scaleY = H / rect.height;
    const x = (e.clientX - rect.left) * scaleX, y = (e.clientY - rect.top) * scaleY;
    const hit = hitTest(x, y);
    const layer = hit ? layers.find((l) => l.id === hit.id) : null;
    if (layer?.type === "text") { setSelectedId(layer.id); setEditingTextId(layer.id); }
    else { setEditingTextId(null); }
  }

  function setBackgroundFromAsset(url: string) {
    pushHistory();
    ensureImgLoaded(url);
    setBackground({ url, x: W / 2, y: H / 2, w: W, h: H });
    setSelectedId(BG_ID);
  }

  // 从电脑直接上传背景图——跟素材库选图（setBackgroundFromAsset）走的是
  // 同一条路径，区别只是图片来源是本地文件读成 dataURL，而不是素材库
  // 已经存好的网址。跟迷宫、找不同那些模块的"上传/从素材库选"是同一种
  // 两选一模式，这里补齐让所有用到 SceneEditor 的模块（包括以后的连线
  // 配对）背景图都能两种方式都用。
  async function handleBackgroundUpload(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
    setBackgroundFromAsset(dataUrl);
  }

  function addObjectFromAsset(imageUrl: string) {
    pushHistory();
    const newLayer: ObjectLayer = { id: uid(), type: "object", imageUrl, x: W / 2, y: H / 2, w: 120, h: 120, rotation: 0, objectType: "" };
    ensureImgLoaded(imageUrl);
    setLayers((ls) => [...ls, newLayer]);
    setSelectedId(newLayer.id);
  }

  // 多选加物件——一次选好几张图片一起加进画布。稍微错开位置，不然全部
  // 重叠在画布正中间，还得一个个拖开才看得出加了几个。只 pushHistory 一
  // 次，撤销的时候整批一起撤，不用点好几次撤销。
  function addObjectsFromAssets(imageUrls: string[]) {
    if (imageUrls.length === 0) return;
    pushHistory();
    const newLayers: ObjectLayer[] = imageUrls.map((imageUrl, i) => {
      ensureImgLoaded(imageUrl);
      const offset = (i % 6) * 24;
      return { id: uid(), type: "object", imageUrl, x: W / 2 + offset, y: H / 2 + offset, w: 120, h: 120, rotation: 0, objectType: "" };
    });
    setLayers((ls) => [...ls, ...newLayers]);
    setSelectedId(newLayers[newLayers.length - 1].id);
  }

  // 填色桶——只对背景图起作用（背景通常是设计师放的插画/线稿，填色桶
  // 是"往这张图的某块区域灌颜色"这个意思，跟移动中的物件/文字是两回事）。
  // 做法：把背景当前显示的样子（含它自己被拖过的位置/大小）画到一张跟
  // 主画布同尺寸的离屏canvas上，在那上面做泛洪填充，填完的结果整个变成
  // 新背景——填色桶操作完之后背景会变成"铺满整个画布"，如果填色前背景
  // 被缩小过/挪过位置，这个操作会把它复位成铺满，这是这个实现方式的
  // 已知取舍，不影响填色本身的准确性。
  function bucketFillBackground(x: number, y: number) {
    if (!background) { toast.error("先选一张背景图，填色桶是往背景图里灌颜色的"); return; }
    const img = imgCacheRef.current.get(background.url);
    if (!img?.complete) return;

    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const octx = off.getContext("2d");
    if (!octx) return;
    const b = objectBounds(background);
    drawImageCover(octx, img, b.x, b.y, b.w, b.h);

    const imageData = octx.getImageData(0, 0, W, H);
    floodFillImageData(imageData, Math.round(x), Math.round(y), hexToRgb(drawColor), 32);
    octx.putImageData(imageData, 0, 0);

    const newUrl = off.toDataURL("image/png");
    pushHistory();
    const newImg = new Image();
    newImg.crossOrigin = "anonymous";
    newImg.onload = () => forceRedraw((n) => n + 1);
    newImg.src = newUrl;
    imgCacheRef.current.set(newUrl, newImg);
    setBackground({ url: newUrl, x: W / 2, y: H / 2, w: W, h: H });
  }

  // 整张画布翻转（左右/上下）——注意这个是"翻整张画"，跟物件面板上的
  // 翻转不是一回事（那个只翻单一个选中的物件）。做法跟填色桶一样：把
  // 背景+目前画的所有笔画先合成到一张离屏canvas上，再翻转这张合成结果，
  // 存成新背景。笔画本身会被清空（已经烤进新背景里了，不清空会重复
  // 显示一次）；物件/文字/形状这些独立图层不受影响，翻转只作用在
  // "背景+笔画"这一层。
  function flipCanvas(axis: "x" | "y") {
    if (!background && strokes.length === 0) { toast.error("画布是空的，没有背景或笔画可以翻转"); return; }

    const baked = document.createElement("canvas");
    baked.width = W; baked.height = H;
    const bctx = baked.getContext("2d");
    if (!bctx) return;

    if (background) {
      const img = imgCacheRef.current.get(background.url);
      if (img?.complete) {
        const b = objectBounds(background);
        drawImageCover(bctx, img, b.x, b.y, b.w, b.h);
      }
    }
    strokes.forEach((s) => {
      bctx.save();
      bctx.globalAlpha = s.opacity ?? 1;
      bctx.globalCompositeOperation = s.isEraser ? "destination-out" : "source-over";
      bctx.beginPath();
      bctx.strokeStyle = s.color; bctx.lineWidth = s.width; bctx.lineCap = "round"; bctx.lineJoin = "round";
      s.points.forEach((p, i) => (i === 0 ? bctx.moveTo(p.x, p.y) : bctx.lineTo(p.x, p.y)));
      bctx.stroke();
      bctx.restore();
    });

    const flipped = document.createElement("canvas");
    flipped.width = W; flipped.height = H;
    const fctx = flipped.getContext("2d");
    if (!fctx) return;
    fctx.save();
    if (axis === "x") { fctx.translate(W, 0); fctx.scale(-1, 1); } else { fctx.translate(0, H); fctx.scale(1, -1); }
    fctx.drawImage(baked, 0, 0);
    fctx.restore();

    const newUrl = flipped.toDataURL("image/png");
    pushHistory();
    const newImg = new Image();
    newImg.crossOrigin = "anonymous";
    newImg.onload = () => forceRedraw((n) => n + 1);
    newImg.src = newUrl;
    imgCacheRef.current.set(newUrl, newImg);
    setBackground({ url: newUrl, x: W / 2, y: H / 2, w: W, h: H });
    setStrokes([]);
  }

  // 加形状——方形/长方形/圆形/椭圆形/三角形/直线，底层其实只有四种(rect/
  // ellipse/triangle/line)，方形是长方形w=h的特例、圆形是椭圆w=h的特例，
  // 加完之后一样可以自由缩放，不受初始比例限制。
  function addShape(kind: "square" | "rect" | "circle" | "ellipse" | "triangle" | "line") {
    pushHistory();
    const isEllipse = kind === "circle" || kind === "ellipse";
    const isSquareish = kind === "square" || kind === "circle";
    const shape = kind === "line" ? "line" : kind === "triangle" ? "triangle" : isEllipse ? "ellipse" : "rect";
    const w = kind === "line" ? 200 : isSquareish ? 120 : 160;
    const h = kind === "line" ? 4 : isSquareish ? 120 : kind === "triangle" ? 140 : 100;
    const newLayer: ShapeLayer = {
      id: uid(), type: "shape", shape,
      x: W / 2, y: H / 2, w, h, rotation: 0,
      fillColor: drawColor, fillEnabled: kind !== "line",
      // 直线本质上就是一条"边框"，默认必须打开，不然加进去是条看不见的线
      borderColor: drawColor, borderEnabled: kind === "line" ? true : false, borderWidth: kind === "line" ? 4 : 4,
      radius: 0, opacity: 100,
    };
    setLayers((ls) => [...ls, newLayer]);
    setSelectedId(newLayer.id);
  }

  // 加网格——数独这种"自己画格子"用。默认 4×4（比经典数独的9×9更适合
  // 4-12岁小朋友），格子默认全部标"留空"（blank:true）——设计师再挑几格
  // 填上数字、把那几格的 blank 改回 false，标成"给定的"，逻辑上比反过来
  // (默认全部是"给定"，再一个个挑要留空的)更符合"先搭好空格子、再填几
  // 个提示数字"这个自然的做题思路。
  function addGrid() {
    pushHistory();
    const rows = 4, cols = 4;
    const cells: GridCellData[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ value: "", blank: true }))
    );
    const newLayer: GridLayer = {
      id: uid(), type: "grid",
      x: W / 2, y: H / 2, w: 320, h: 320, rotation: 0,
      rows, cols, boxRows: rows, boxCols: cols, cells,
      lineColor: "#333333", givenColor: "#222222", blankBg: "#fff3d6",
      bgColor: "#ffffff", bgEnabled: false, opacity: 100,
    };
    setLayers((ls) => [...ls, newLayer]);
    setSelectedId(newLayer.id);
    setSelectedGridCell({ row: 0, col: 0 });
  }

  function addText() {
    pushHistory();
    const newLayer: TextLayer = { id: uid(), type: "text", text: "文字", x: W / 2, y: H / 2, fontSize: 40, color: "#222222", fontFamily: FONT_OPTIONS[0].value, rotation: 0 };
    setLayers((ls) => [...ls, newLayer]);
    setSelectedId(newLayer.id);
  }

  function deleteSelected() {
    if (!selectedId || selectedId === BG_ID) return;
    pushHistory();
    setLayers((ls) => ls.filter((l) => l.id !== selectedId));
    setSelectedId(null);
  }

  function resetRotation() {
    if (!selectedId) return;
    pushHistory();
    setLayers((ls) => ls.map((l) => (l.id === selectedId ? { ...l, rotation: 0 } : l)));
  }

  // 快速旋转——90度一档，配合原本拖绿点的自由旋转，急用的时候不用慢慢拖
  function rotateBy(delta: number) {
    if (!selectedId) return;
    pushHistory();
    setLayers((ls) => ls.map((l) => (l.id === selectedId ? { ...l, rotation: (((l.rotation ?? 0) + delta) % 360 + 360) % 360 } : l)));
  }

  // 水平/垂直翻转——只对物件（图片）有意义，文字镜像了没法读，不开放
  function toggleFlip(axis: "x" | "y") {
    if (!selectedId) return;
    pushHistory();
    setLayers((ls) => ls.map((l) => {
      if (l.id !== selectedId || l.type !== "object") return l;
      return axis === "x" ? { ...l, flipX: !l.flipX } : { ...l, flipY: !l.flipY };
    }));
  }

  // 复制选中的物件/文字——原地偏移一点位置，不然跟原本的完全重叠在一起，
  // 使用者会以为复制没反应。背景不能复制（背景本来就只有一个，且不在
  // layers阵列里）。
  function duplicateSelected() {
    if (!selectedId || selectedId === BG_ID) return;
    const l = layers.find((x) => x.id === selectedId);
    if (!l) return;
    pushHistory();
    const copy: Layer = { ...l, id: uid(), x: l.x + 24, y: l.y + 24 };
    setLayers((ls) => [...ls, copy]);
    setSelectedId(copy.id);
  }

  function moveLayer(id: string, dir: "up" | "down" | "front" | "back") {
    pushHistory();
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.id === id);
      if (i === -1) return ls;
      const next = [...ls];
      if (dir === "up" && i < next.length - 1) { [next[i], next[i + 1]] = [next[i + 1], next[i]]; }
      else if (dir === "down" && i > 0) { [next[i], next[i - 1]] = [next[i - 1], next[i]]; }
      else if (dir === "front") { const [item] = next.splice(i, 1); next.push(item); }
      else if (dir === "back") { const [item] = next.splice(i, 1); next.unshift(item); }
      return next;
    });
  }

  function layerLabel(l: Layer): string {
    if (l.type === "text") return `🔤 ${l.text.slice(0, 8) || "文字"}`;
    if (l.type === "grid") return `▦ 网格 ${l.rows}×${l.cols}`;
    if (l.type === "shape") {
      const shapeNames: Record<string, string> = { rect: "方块", ellipse: "圆/椭圆", triangle: "三角形", line: "直线" };
      return `▦ ${shapeNames[l.shape] ?? "形状"}`;
    }
    if (l.isTarget) return l.objectType ? `🎯 目标：${l.objectType}` : "🎯 目标物件（未标配对标记）";
    return l.objectType ? `🧸 ${l.objectType}` : "🧸 物件（未标类型）";
  }

  function updateSelectedText(text: string) {
    setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "text" ? { ...l, text } : l)));
  }

  function updateSelectedObjectType(objectType: string) {
    setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "object" ? { ...l, objectType } : l)));
  }

  function updateSelectedIsTarget(isTarget: boolean) {
    setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "object" ? { ...l, isTarget } : l)));
  }

  // 改行数/列数——尽量保留原有格子的内容，缩小的话超出范围的格子直接
  // 丢掉，放大的话新增的格子默认"留空"（跟 addGrid 的默认值一致）。
  function setSelectedGridSize(rows: number, cols: number) {
    setLayers((ls) => ls.map((l) => {
      if (l.id !== selectedId || l.type !== "grid") return l;
      const nextCells: GridCellData[][] = Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => l.cells[r]?.[c] ?? { value: "", blank: true })
      );
      return { ...l, rows, cols, boxRows: Math.min(l.boxRows, rows), boxCols: Math.min(l.boxCols, cols), cells: nextCells };
    }));
  }

  // 改"宫"的大小——只影响粗分隔线画在哪，不动格子内容。夹在1和总行/列
  // 数之间，等于总行/列数就是"不分宫"(只有外框是粗线，退回旧行为)。
  function setSelectedBoxSize(boxRows: number, boxCols: number) {
    setLayers((ls) => ls.map((l) => {
      if (l.id !== selectedId || l.type !== "grid") return l;
      return { ...l, boxRows: Math.max(1, Math.min(boxRows, l.rows)), boxCols: Math.max(1, Math.min(boxCols, l.cols)) };
    }));
  }

  function updateSelectedGridCell(patch: Partial<GridCellData>) {
    if (!selectedGridCell) return;
    const { row, col } = selectedGridCell;
    setLayers((ls) => ls.map((l) => {
      if (l.id !== selectedId || l.type !== "grid") return l;
      const nextCells = l.cells.map((rowArr, r) => rowArr.map((cell, c) => (r === row && c === col ? { ...cell, ...patch } : cell)));
      return { ...l, cells: nextCells };
    }));
  }

  // 结构化模式（Counting用）存档专用——objects/texts之外的东西（画的线、
  // 加的形状）不是"可数物件"，没地方单独存，所以存档前先跟背景合并成
  // 一张图。没有背景、也没画任何东西、也没加形状的话，直接跳过，返回
  // 原本的背景URL（或null），不用无端把一张普通图片重新编码一遍。
  function bakeBackgroundWithDecorations(): string | null {
    const bg = background; // 存一个本地引用，下面全用这个——直接反复用 state 变量 background 在这种 if 判断组合下，TS 会把它错误收窄成 never，改用普通局部变量就不会有这个问题
    // 形状不再在这里烤——这个函数现在只有 handleSaveStructured 一个调用
    // 方，形状在那边被单独抽成结构化数据保留(见 handleSaveStructured)，
    // 不能连带在这里又画进背景图，不然会变成"背景图里一份、structured
    // shapes数组里又一份"的重复。非结构化的保存路径(handleSave)走的是
    // canvasRef.current.toDataURL() 直接截live画布，形状照常会画在那张
    // 图里，不受这个改动影响。
    if (!bg && strokes.length === 0) return null; // 这个分支里 bg 已经确定是 null 了，不用再判断一次

    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const octx = off.getContext("2d");
    if (!octx) return bg ? bg.url : null;

    if (bg) {
      const img = imgCacheRef.current.get(bg.url);
      if (img?.complete) {
        const b = objectBounds(bg);
        drawImageCover(octx, img, b.x, b.y, b.w, b.h);
      }
    }

    strokes.forEach((s) => {
      octx.save();
      octx.globalAlpha = s.opacity ?? 1;
      octx.globalCompositeOperation = s.isEraser ? "destination-out" : "source-over";
      octx.beginPath();
      octx.strokeStyle = s.color; octx.lineWidth = s.width; octx.lineCap = "round"; octx.lineJoin = "round";
      s.points.forEach((p, i) => (i === 0 ? octx.moveTo(p.x, p.y) : octx.lineTo(p.x, p.y)));
      octx.stroke();
      octx.restore();
    });

    return off.toDataURL("image/png");
  }

  function handleSaveStructured() {
    const objects = layers.filter((l): l is ObjectLayer => l.type === "object")
      .map((l) => ({ imageUrl: l.imageUrl, x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation ?? 0, objectType: l.objectType || undefined, flipX: l.flipX || undefined, flipY: l.flipY || undefined, opacity: l.opacity !== undefined && l.opacity !== 100 ? l.opacity : undefined, isTarget: l.isTarget || undefined }));
    const texts = layers.filter((l): l is TextLayer => l.type === "text")
      .map((l) => ({ text: l.text, x: l.x, y: l.y, fontSize: l.fontSize, color: l.color, fontFamily: l.fontFamily, rotation: l.rotation ?? 0, bold: l.bold || undefined, italic: l.italic || undefined, underline: l.underline || undefined }));
    const grids = layers.filter((l): l is GridLayer => l.type === "grid")
      .map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation ?? 0, rows: l.rows, cols: l.cols, boxRows: l.boxRows, boxCols: l.boxCols, cells: l.cells, lineColor: l.lineColor, givenColor: l.givenColor, blankBg: l.blankBg, bgColor: l.bgColor, bgEnabled: l.bgEnabled, opacity: l.opacity }));
    // 结构化模式下形状不再烤进背景图(见 bakeBackgroundWithDecorations
    // 的改动)——保持成独立数据，运行时才有办法把每个形状当成一个可数
    // 的物件(比如数方块/圆形/三角形，形状还可能互相重叠)，不是死死画
    // 进一张图里数不出来。
    const shapes = layers.filter((l): l is ShapeLayer => l.type === "shape")
      .map((l) => ({ shape: l.shape, x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation ?? 0, fillColor: l.fillColor, fillEnabled: l.fillEnabled, borderColor: l.borderColor, borderEnabled: l.borderEnabled, borderWidth: l.borderWidth, radius: l.radius, opacity: l.opacity }));
    onSaveStructured?.({
      bgUrl: bakeBackgroundWithDecorations(),
      bgBounds: background ? { x: background.x, y: background.y, w: background.w, h: background.h } : undefined,
      objects, texts, grids, shapes,
    });
  }

  async function handleSave(b: { name: string; category: string; moduleType: string; gradeTierId: string; language: string; tags: string[] }) {
    const dataUrl = canvasRef.current!.toDataURL("image/png");
    try {
      const res = await assetsApi.createAsset({
        category: b.category, name: b.name, file_data: dataUrl, width: W, height: H,
        module_type: b.moduleType || undefined, grade_tier_id: b.gradeTierId || undefined, language: b.language, tags: b.tags,
      });
      toast.success("已存进素材库");
      setShowSave(false);
      onSaved?.(res.data.data.file_data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "保存失败";
      toast.error(msg);
    }
  }

  // structuredMode下按类型汇总的物件数量——给设计师一个直观的"每种放了几个"
  // 的反馈，不用自己数。未标类型的物件算进"未分类"；形状按shape种类
  // 自动归类(rect→正方形、ellipse→圆形、triangle→三角形)，line不算进
  // 计数(直线通常是装饰用的分隔线，不是"要数的物件")。
  const SHAPE_TYPE_LABEL: Record<string, string> = { rect: "正方形", ellipse: "圆形", triangle: "三角形" };
  const typeCounts = (() => {
    if (!structuredMode) return null;
    const counts: Record<string, number> = {};
    layers.forEach((l) => {
      if (l.type === "object") {
        const key = l.objectType?.trim() || "未分类";
        counts[key] = (counts[key] ?? 0) + 1;
      } else if (l.type === "shape" && l.shape !== "line") {
        const key = SHAPE_TYPE_LABEL[l.shape] ?? l.shape;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    });
    return counts;
  })();

  const toolBtnClass = (active: boolean) =>
    `w-10 h-10 flex items-center justify-center rounded-lg text-lg border transition-colors ${
      active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/50"
    }`;

  // min-h-[70vh] 兜底 + flex-1 可伸展的混合写法——SceneEditor 在这个项目
  // 里一共被用在12个不同的地方(不同module_type各自的"内容设置"面板)。
  // 之前 min-h-[70vh] 对全部12处都无条件生效，这就导致就算外层
  // (CourseDesignerPage.tsx那几处已经改成flex flex-col的面板)已经把
  // 标题/说明文字都压缩到极致腾出了空间，SceneEditor自己仍然会强行
  // 撑到70%视口高度——外层实际能分配的空间一旦小于70vh就会撑破布局，
  // 逼出一层滚动条，"scroll down 才能看完整个画布"的体验问题根源就在
  // 这。现在用新增的 fillHeight prop 显式控制：外层父容器已经改造成
  // flex flex-col、能给这个组件分配确定剩余高度的面板才传 fillHeight，
  // 这时用 min-h-0 完全交给外层flex决定实际高度；其余还没改造成flex
  // 布局的老面板不传，维持 min-h-[70vh] 兜底，行为完全不变，不会因为
  // 换prop名字就意外影响到还没来得及改造的那些面板。
  return (
    <div className={`w-full flex-1 bg-background border border-border rounded-xl overflow-hidden flex flex-col ${fillHeight ? "min-h-0" : "min-h-[70vh]"}`}>
      {/* ── 顶部条：标题 + 主操作按钮 ── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border bg-card">
        <div className="flex-1 min-w-0">
          {headerLabel ?? <span className="text-xs font-semibold text-foreground">🎨 场景编辑器</span>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={undo} disabled={history.length === 0} title="撤销">↩️ 撤销</Button>
          {structuredMode
            ? <Button size="sm" className="h-7 px-2 text-xs" onClick={handleSaveStructured}>✅ 完成</Button>
            : <Button size="sm" className="h-7 px-2 text-xs" onClick={() => setShowSave(true)}>💾 存到素材库</Button>}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-row">
        {/* ── 左侧图标栏：窄条，点一下展开对应分类的选项面板到右边（跟Canva一样，
             不是点了立刻执行动作）── */}
        <div className="w-16 shrink-0 flex flex-col items-center gap-1.5 border-r border-border bg-muted/40 p-2 overflow-y-auto">
          <button
            type="button" title="选择/移动"
            onClick={() => { setTool("select"); setActivePanel(null); }}
            className={toolBtnClass(tool === "select" && activePanel === null)}
          >
            🖱️
          </button>
          <button
            type="button" title="画笔"
            onClick={() => { setTool("draw"); setSelectedId(null); setActivePanel("draw"); }}
            className={toolBtnClass(activePanel === "draw")}
          >
            🖌️
          </button>
          <div className="w-full h-px bg-border my-0.5" />
          <button type="button" title="背景" onClick={() => setActivePanel(activePanel === "background" ? null : "background")} className={toolBtnClass(activePanel === "background")}>🖼️</button>
          <button type="button" title="物件" onClick={() => setActivePanel(activePanel === "elements" ? null : "elements")} className={toolBtnClass(activePanel === "elements")}>🧸</button>
          <button type="button" title="文字" onClick={() => setActivePanel(activePanel === "text" ? null : "text")} className={toolBtnClass(activePanel === "text")}>🔤</button>
          <button type="button" title="形状/网格" onClick={() => setActivePanel(activePanel === "shapes" ? null : "shapes")} className={toolBtnClass(activePanel === "shapes")}>⬜</button>
        </div>

        {/* ── 展开的分类面板：点了左侧图标栏某个分类会出现；选中了画布上的
             背景/物件/文字/形状/网格时，也会自动展开，改成显示"这个东西
             的属性"（优先于分类内容——选中了东西，说明用户想调整它，不是
             想加新内容）。跟点分类图标是同一个位置，不是分开两块。 ── */}
        {(activePanel || selectedLayer || backgroundSelected) && (
          <div className="w-64 shrink-0 border-r border-border bg-card p-3 space-y-3 overflow-y-auto">
            {(selectedLayer || backgroundSelected) ? (
              <>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">属性</p>

          {!selectedLayer && !backgroundSelected && (
            <p className="text-xs text-muted-foreground">点选画布上的背景、物件、或文字，在这里查看和调整它的属性</p>
          )}

          {selectedLayer?.type === "object" && (
            <div className="space-y-3">
              {structuredMode && presetModuleType === "drag_match" && (
                <div>
                  <Label>物件角色</Label>
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button" onClick={() => updateSelectedIsTarget(false)}
                      className={`flex-1 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                        !selectedLayer.isTarget ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                      }`}
                    >
                      🧲 被拖拽物件
                    </button>
                    <button
                      type="button" onClick={() => updateSelectedIsTarget(true)}
                      className={`flex-1 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                        selectedLayer.isTarget ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                      }`}
                    >
                      🎯 目标物件
                    </button>
                  </div>
                </div>
              )}
              {structuredMode && (
                <div>
                  <Label>
                    {presetModuleType === "line_match" ? "配对标记（选填）"
                      : presetModuleType === "drag_match" ? "配对标记"
                      : "物件类型（选填）"}
                  </Label>
                  <Input
                    value={selectedLayer.objectType ?? ""}
                    onChange={(e) => updateSelectedObjectType(e.target.value)}
                    placeholder={
                      presetModuleType === "line_match" ? "如：1（两边填一样的字就算一对）"
                      : presetModuleType === "drag_match" ? (selectedLayer.isTarget ? "如：红色盒子（目标的标记要唯一）" : "如：红色盒子（跟要拖进去的目标填一样）")
                      : "如：苹果"
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {presetModuleType === "line_match"
                      ? "要连在一起的两个物件，填一样的标记（比如都填「1」）——保存时会检查每个标记正好出现两次。"
                      : presetModuleType === "drag_match"
                      ? "「被拖拽物件」拖到标记相同的「目标物件」上才算对。同一个标记可以有多个被拖拽物件（多对一，比如分类），但目标物件同一个标记只能有1个，不然系统不知道该判给哪个。"
                      : "同一种物件用同一个名字标（比如都叫\"苹果\"），之后可以按类型出题（数一种，或几种加起来）。不标的话默认算总数。"}
                  </p>
                </div>
              )}
              <div>
                <Label>翻转</Label>
                <div className="flex gap-2 mt-1">
                  <button
                    type="button" onClick={() => toggleFlip("x")}
                    className={`flex-1 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      selectedLayer.flipX ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                    }`}
                  >
                    ↔️ 水平翻转
                  </button>
                  <button
                    type="button" onClick={() => toggleFlip("y")}
                    className={`flex-1 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      selectedLayer.flipY ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                    }`}
                  >
                    ↕️ 垂直翻转
                  </button>
                </div>
              </div>
              <div>
                <Label>不透明度</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="range" min={10} max={100} value={selectedLayer.opacity ?? 100}
                    onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "object" ? { ...l, opacity: +e.target.value } : l)))}
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">{selectedLayer.opacity ?? 100}%</span>
                </div>
              </div>
            </div>
          )}

          {selectedLayer?.type === "shape" && (
            <div className="space-y-3">
              {selectedLayer.shape !== "line" && (
                <div>
                  <div className="flex items-center justify-between">
                    <Label>填充</Label>
                    <input
                      type="checkbox" checked={selectedLayer.fillEnabled}
                      onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "shape" ? { ...l, fillEnabled: e.target.checked } : l)))}
                    />
                  </div>
                  {selectedLayer.fillEnabled && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {COLORS.map((c) => (
                        <button key={c} type="button" onClick={() => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "shape" ? { ...l, fillColor: c } : l)))} className={`w-6 h-6 rounded-full border-2 ${selectedLayer.fillColor === c ? "border-primary" : "border-border"}`} style={{ background: c }} />
                      ))}
                      <input
                        type="color" value={selectedLayer.fillColor}
                        onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "shape" ? { ...l, fillColor: e.target.value } : l)))}
                        className="w-7 h-7 rounded-md border border-border cursor-pointer p-0.5"
                      />
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <Label>{selectedLayer.shape === "line" ? "线条颜色/粗细" : "边框"}</Label>
                  {selectedLayer.shape !== "line" && (
                    <input
                      type="checkbox" checked={selectedLayer.borderEnabled}
                      onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "shape" ? { ...l, borderEnabled: e.target.checked } : l)))}
                    />
                  )}
                </div>
                {(selectedLayer.shape === "line" || selectedLayer.borderEnabled) && (
                  <div className="space-y-1.5 mt-1.5">
                    <div className="flex items-center gap-1.5">
                      {COLORS.map((c) => (
                        <button key={c} type="button" onClick={() => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "shape" ? { ...l, borderColor: c } : l)))} className={`w-6 h-6 rounded-full border-2 ${selectedLayer.borderColor === c ? "border-primary" : "border-border"}`} style={{ background: c }} />
                      ))}
                      <input
                        type="color" value={selectedLayer.borderColor}
                        onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "shape" ? { ...l, borderColor: e.target.value } : l)))}
                        className="w-7 h-7 rounded-md border border-border cursor-pointer p-0.5"
                      />
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {selectedLayer.shape === "line" ? "粗细" : "边框粗细"}
                      <input
                        type="range" min={1} max={30} value={selectedLayer.borderWidth}
                        onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "shape" ? { ...l, borderWidth: +e.target.value } : l)))}
                        className="w-20"
                      />
                      <span className="tabular-nums">{selectedLayer.borderWidth}px</span>
                    </label>
                  </div>
                )}
              </div>

              {selectedLayer.shape === "rect" && (
                <div>
                  <Label>圆角</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="range" min={0} max={80} value={selectedLayer.radius ?? 0}
                      onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "shape" ? { ...l, radius: +e.target.value } : l)))}
                      className="flex-1"
                    />
                    <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">{selectedLayer.radius ?? 0}px</span>
                  </div>
                </div>
              )}

              <div>
                <Label>不透明度</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="range" min={10} max={100} value={selectedLayer.opacity ?? 100}
                    onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "shape" ? { ...l, opacity: +e.target.value } : l)))}
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">{selectedLayer.opacity ?? 100}%</span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">缩放：拖右下角蓝点；旋转：拖顶部绿点，或用左侧 ↺/↻ 快速转90°</p>
            </div>
          )}

          {selectedLayer?.type === "grid" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>行数</Label>
                  <input
                    type="number" min={1} max={12} value={selectedLayer.rows}
                    onChange={(e) => setSelectedGridSize(Math.max(1, Math.min(12, +e.target.value || 1)), selectedLayer.cols)}
                    className="w-full border rounded-md p-1.5 text-sm"
                  />
                </div>
                <div>
                  <Label>列数</Label>
                  <input
                    type="number" min={1} max={12} value={selectedLayer.cols}
                    onChange={(e) => setSelectedGridSize(selectedLayer.rows, Math.max(1, Math.min(12, +e.target.value || 1)))}
                    className="w-full border rounded-md p-1.5 text-sm"
                  />
                </div>
              </div>

              <div>
                <Label>宫（粗线分隔的小方块，比如经典数独=3×3宫）</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <input
                    type="number" min={1} max={selectedLayer.rows} value={selectedLayer.boxRows}
                    onChange={(e) => setSelectedBoxSize(+e.target.value || 1, selectedLayer.boxCols)}
                    className="w-full border rounded-md p-1.5 text-sm"
                    placeholder="每几行一条粗线"
                  />
                  <input
                    type="number" min={1} max={selectedLayer.cols} value={selectedLayer.boxCols}
                    onChange={(e) => setSelectedBoxSize(selectedLayer.boxRows, +e.target.value || 1)}
                    className="w-full border rounded-md p-1.5 text-sm"
                    placeholder="每几列一条粗线"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {([
                    ["1个2×2", 2, 2, 2, 2], ["4个2×2", 4, 4, 2, 2],
                    ["1个3×3", 3, 3, 3, 3], ["4个3×3", 6, 6, 3, 3], ["9个3×3(经典数独)", 9, 9, 3, 3],
                    ["1个4×4", 4, 4, 4, 4], ["4个4×4", 8, 8, 4, 4],
                  ] as const).map(([label, rows, cols, boxRows, boxCols]) => (
                    <button
                      key={label} type="button"
                      onClick={() => { setSelectedGridSize(rows, cols); setSelectedBoxSize(boxRows, boxCols); }}
                      className="px-2 py-1 rounded-md text-[11px] border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">跟行数/列数相等就是"不分宫"——只有最外框是粗线，格子内部全部细线。</p>
              </div>

              <p className="text-xs text-muted-foreground">直接在画布上点一个格子来选中它（跟点物件、点形状是一样的操作），选中的格子在下面编辑。</p>

              {selectedGridCell ? (
                <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">第 {selectedGridCell.row + 1} 行 · 第 {selectedGridCell.col + 1} 列</p>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedLayer.cells[selectedGridCell.row]?.[selectedGridCell.col]?.blank ?? false}
                      onChange={(e) => updateSelectedGridCell({ blank: e.target.checked })}
                    />
                    留空给学生填
                  </label>
                  {selectedLayer.cells[selectedGridCell.row]?.[selectedGridCell.col]?.blank ? (
                    <div>
                      <Label>答案（学生该填的数字，不会显示在格子里，只用来核对）</Label>
                      <Input
                        value={selectedLayer.cells[selectedGridCell.row]?.[selectedGridCell.col]?.answer ?? ""}
                        onChange={(e) => updateSelectedGridCell({ answer: e.target.value.slice(0, 2) })}
                        placeholder="如：5"
                      />
                    </div>
                  ) : (
                    <div>
                      <Label>给定的数字（直接显示给学生看）</Label>
                      <Input
                        value={selectedLayer.cells[selectedGridCell.row]?.[selectedGridCell.col]?.value ?? ""}
                        onChange={(e) => updateSelectedGridCell({ value: e.target.value.slice(0, 2) })}
                        placeholder="留空=空白格"
                      />
                    </div>
                  )}

                  <div className="pt-2 border-t border-border/60">
                    <Label>路径顺序（数字迷宫·方格棋盘模式用，起点填1，往后依次+1，不在路径上的格子留空）</Label>
                    <input
                      type="number" min={1}
                      value={selectedLayer.cells[selectedGridCell.row]?.[selectedGridCell.col]?.pathStep ?? ""}
                      onChange={(e) => updateSelectedGridCell({ pathStep: e.target.value ? +e.target.value : undefined })}
                      className="w-full border rounded-md p-1.5 text-sm"
                      placeholder="不在路径上留空"
                    />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2.5">还没选中格子——点画布上网格里的任意一格</p>
              )}

              <div>
                <Label>线条颜色</Label>
                <div className="flex items-center gap-1.5 mt-1">
                  {COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "grid" ? { ...l, lineColor: c } : l)))} className={`w-6 h-6 rounded-full border-2 ${selectedLayer.lineColor === c ? "border-primary" : "border-border"}`} style={{ background: c }} />
                  ))}
                  <input
                    type="color" value={selectedLayer.lineColor}
                    onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "grid" ? { ...l, lineColor: e.target.value } : l)))}
                    className="w-6 h-6 rounded border border-border cursor-pointer"
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm mb-1.5">
                  <input
                    type="checkbox" checked={selectedLayer.bgEnabled}
                    onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "grid" ? { ...l, bgEnabled: e.target.checked } : l)))}
                  />
                  网格底色
                </label>
                {selectedLayer.bgEnabled && (
                  <div className="flex items-center gap-1.5">
                    {COLORS.map((c) => (
                      <button key={c} type="button" onClick={() => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "grid" ? { ...l, bgColor: c } : l)))} className={`w-6 h-6 rounded-full border-2 ${selectedLayer.bgColor === c ? "border-primary" : "border-border"}`} style={{ background: c }} />
                    ))}
                    <input
                      type="color" value={selectedLayer.bgColor}
                      onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "grid" ? { ...l, bgColor: e.target.value } : l)))}
                      className="w-6 h-6 rounded border border-border cursor-pointer"
                    />
                  </div>
                )}
              </div>

              <div>
                <Label>不透明度</Label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="range" min={10} max={100} value={selectedLayer.opacity ?? 100}
                    onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "grid" ? { ...l, opacity: +e.target.value } : l)))}
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground tabular-nums w-9 text-right">{selectedLayer.opacity ?? 100}%</span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">缩放：拖右下角蓝点；旋转：拖顶部绿点，或用左侧 ↺/↻ 快速转90°</p>
            </div>
          )}

          {selectedLayer?.type === "text" && (
            <div className="space-y-3">
              <div><Label>文字内容</Label><Input value={selectedLayer.text} onChange={(e) => updateSelectedText(e.target.value)} /></div>

              <div>
                <Label>字体</Label>
                <select
                  value={selectedLayer.fontFamily}
                  onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId ? { ...l, fontFamily: e.target.value } : l)))}
                  className="w-full border rounded-md p-2 text-sm"
                >
                  {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>

              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Label>字号</Label>
                  <input
                    type="number" min={12} max={120} value={selectedLayer.fontSize}
                    onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId ? { ...l, fontSize: +e.target.value } : l)))}
                    className="w-full border rounded-md p-2 text-sm"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button" title="粗体"
                    onClick={() => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "text" ? { ...l, bold: !l.bold } : l)))}
                    className={`w-9 h-9 rounded-md border text-sm font-bold transition-colors ${
                      selectedLayer.bold ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                    }`}
                  >
                    B
                  </button>
                  <button
                    type="button" title="斜体"
                    onClick={() => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "text" ? { ...l, italic: !l.italic } : l)))}
                    className={`w-9 h-9 rounded-md border text-sm italic transition-colors ${
                      selectedLayer.italic ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                    }`}
                  >
                    I
                  </button>
                  <button
                    type="button" title="底线"
                    onClick={() => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "text" ? { ...l, underline: !l.underline } : l)))}
                    className={`w-9 h-9 rounded-md border text-sm underline transition-colors ${
                      selectedLayer.underline ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                    }`}
                  >
                    U
                  </button>
                </div>
              </div>

              <div>
                <Label>颜色</Label>
                <div className="flex items-center gap-2 mt-1">
                  {COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => setLayers((ls) => ls.map((l) => (l.id === selectedId ? { ...l, color: c } : l)))} className={`w-6 h-6 rounded-full border-2 ${(selectedLayer as TextLayer).color === c ? "border-primary" : "border-border"}`} style={{ background: c }} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {structuredMode && typeCounts && (
            <div className="text-xs font-medium text-primary bg-primary/10 rounded-lg px-2.5 py-2">
              🔢 共 {layers.filter((l) => l.type === "object" || (l.type === "shape" && l.shape !== "line")).length} 个物件/形状
              {Object.keys(typeCounts).length > 0 && (
                <>：{Object.entries(typeCounts).map(([k, v]) => `${k}×${v}`).join("、")}</>
              )}
              <p className="text-muted-foreground font-normal mt-0.5">文字不算在内。答案由下面"这一题要问哪几种"决定，不一定是总数</p>
            </div>
          )}
              </>
            ) : (
              <>
            {activePanel === "background" && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">背景</p>
                <div title="背景（素材库）"><AssetPicker category="background" label="🗂️ 从素材库选" onSelect={setBackgroundFromAsset} /></div>
                <input
                  ref={bgFileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBackgroundUpload(f); e.target.value = ""; }}
                />
                <Button size="sm" variant="outline" className="w-full" onClick={() => bgFileInputRef.current?.click()}>📁 从电脑上传</Button>
              </div>
            )}

            {activePanel === "elements" && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">物件</p>
                <div title="加物件（可多选）"><AssetPicker category="object" label="🧸 从素材库选（可多选）" onSelect={addObjectFromAsset} multiple onSelectMultiple={addObjectsFromAssets} /></div>
              </div>
            )}

            {activePanel === "text" && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">文字</p>
                <Button size="sm" className="w-full" onClick={addText}>🔤 加一段文字</Button>
              </div>
            )}

            {activePanel === "shapes" && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">形状 / 网格</p>
                <div className="grid grid-cols-3 gap-2">
                  <Button size="sm" variant="outline" className="h-12 text-base" onClick={() => addShape("square")} title="方形">⬜</Button>
                  <Button size="sm" variant="outline" className="h-12 text-base" onClick={() => addShape("rect")} title="长方形">▭</Button>
                  <Button size="sm" variant="outline" className="h-12 text-base" onClick={() => addShape("circle")} title="圆形">⚫</Button>
                  <Button size="sm" variant="outline" className="h-12 text-base" onClick={() => addShape("ellipse")} title="椭圆形">⬭</Button>
                  <Button size="sm" variant="outline" className="h-12 text-base" onClick={() => addShape("triangle")} title="三角形">🔺</Button>
                  <Button size="sm" variant="outline" className="h-12 text-base" onClick={() => addShape("line")} title="直线">／</Button>
                </div>
                <Button size="sm" variant="outline" className="w-full" onClick={addGrid}>▦ 加网格（数独这种自己画格子用）</Button>
              </div>
            )}

            {activePanel === "draw" && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">画笔</p>
                <div className="grid grid-cols-4 gap-1.5">
                  <button type="button" title="铅笔（固定不透明，适合精细线条）" onClick={() => setDrawSubTool("pencil")} className={toolBtnClass(drawSubTool === "pencil")} style={{ width: "100%", height: 36 }}>✏️</button>
                  <button type="button" title="毛笔（可调不透明度，适合大面积上色）" onClick={() => setDrawSubTool("brush")} className={toolBtnClass(drawSubTool === "brush")} style={{ width: "100%", height: 36 }}>🖌️</button>
                  <button type="button" title="橡皮擦（擦掉背景图/已经画的笔画）" onClick={() => setDrawSubTool("eraser")} className={toolBtnClass(drawSubTool === "eraser")} style={{ width: "100%", height: 36 }}>🧽</button>
                  <button type="button" title="填色桶（点击背景图里的区域灌颜色）" onClick={() => setDrawSubTool("bucket")} className={toolBtnClass(drawSubTool === "bucket")} style={{ width: "100%", height: 36 }}>🪣</button>
                </div>

                {drawSubTool !== "eraser" && (
                  <div>
                    <Label>颜色</Label>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {COLORS.map((c) => (
                        <button key={c} type="button" onClick={() => setDrawColor(c)} className={`w-6 h-6 rounded-full border-2 ${drawColor === c ? "border-primary" : "border-border"}`} style={{ background: c }} />
                      ))}
                      <input type="color" value={drawColor} onChange={(e) => setDrawColor(e.target.value)} title="自定义颜色" className="w-7 h-7 rounded-md border border-border cursor-pointer p-0.5" />
                    </div>
                  </div>
                )}

                {drawSubTool !== "bucket" && (
                  <div>
                    <Label>{drawSubTool === "eraser" ? "橡皮大小" : "粗细"}</Label>
                    <input type="range" min={2} max={40} value={drawWidth} onChange={(e) => setDrawWidth(+e.target.value)} className="w-full" />
                  </div>
                )}

                {drawSubTool === "brush" && (
                  <div>
                    <Label>不透明度 {drawOpacity}%</Label>
                    <input type="range" min={10} max={100} value={drawOpacity} onChange={(e) => setDrawOpacity(+e.target.value)} className="w-full" />
                  </div>
                )}

                <div className="h-px bg-border" />
                <Button size="sm" variant="outline" className="w-full" onClick={() => flipCanvas("x")} title="整张画布左右翻转（背景+笔画一起翻，不影响物件/文字/形状）">↔️ 整张画布左右翻转</Button>
                <Button size="sm" variant="outline" className="w-full" onClick={() => flipCanvas("y")} title="整张画布上下翻转（背景+笔画一起翻，不影响物件/文字/形状）">↕️ 整张画布上下翻转</Button>
              </div>
            )}
              </>
            )}
          </div>
        )}

        {/* ── 中间：画布 ── */}
        <div className="flex-1 min-w-0 flex flex-col p-3 overflow-auto">
          {/* 选中某个物件/文字/形状时的小工具条——复制/旋转/删除这些是针对
              "当前选中的东西"，不是"加什么新内容"，跟左侧图标栏的分类
              性质不一样，浮在画布上方更贴近Canva选中元素后的操作习惯 */}
          {selectedLayer && (
            <div className="flex items-center gap-1.5 mb-2">
              <Button size="sm" variant="outline" onClick={duplicateSelected} title="复制（Ctrl/Cmd+D）">📋 复制</Button>
              <Button size="sm" variant="outline" onClick={() => rotateBy(-90)} title="逆时针转90°">↺</Button>
              <Button size="sm" variant="outline" onClick={() => rotateBy(90)} title="顺时针转90°">↻</Button>
              <Button size="sm" variant="outline" onClick={resetRotation} title="角度归零">0°</Button>
              <Button size="sm" variant="outline" className="text-destructive" onClick={deleteSelected} title="删除（Delete）">🗑️ 删除</Button>
            </div>
          )}

          {backgroundSelected && (
            <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-3 mb-2">
              🖼️ 背景已选中——拖动可以移动位置，拖右下角的蓝点可以缩放大小（背景不用"删除"，选新背景会直接换掉，背景本身不能旋转）
            </p>
          )}

          <div className="flex-1 flex items-center justify-center min-h-0">
            <div className="relative" style={{ maxWidth: "100%", maxHeight: "100%" }}>
              <canvas
                ref={canvasRef} width={W} height={H}
                onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
                onDoubleClick={handleCanvasDoubleClick}
                style={{
                  touchAction: "none",
                  aspectRatio: `${W} / ${H}`, // W,H已经在组件顶部按模块类型算好了（贴纸游戏是正方形STICKER_CANVAS_SIZE，其他模块是长方形GAME_CANVAS_W/H），这里不用再额外判断
                  width: "auto",
                  height: "auto",
                  maxWidth: "100%",
                  maxHeight: "100%", // 全屏模式下，画布高度上限就是这个中间区域实际能给多少，不用再手动算calc(100vh - 220px)这种魔术数字
                }}
                className="rounded-2xl border border-border bg-card cursor-crosshair shadow-lg ring-1 ring-black/5"
              />

              {/* 文字所见即所得——选中文字图层时，直接在画布上它所在的
                  位置叠一个输入框，打字的时候画布本身也会实时重绘(layers
                  state一变，draw()这个effect就会重画)，看到的就是真实
                  渲染出来的字体效果，不用先在旁边的表单里打完字、再切
                  回画布看结果。字号按canvasScale换算，位置用百分比对齐
                  画布内部坐标(x,y是文字的锚点，canvas那边textAlign=
                  center/textBaseline=middle，这里也用同一个居中对齐)。
                  没双击进入编辑模式时 pointer-events 关掉，让点击穿透
                  到canvas，不挡"点文字拖动移动它"这个手势。 */}
              {tool === "select" && selectedLayer?.type === "text" && (
                <input
                  key={selectedLayer.id}
                  value={selectedLayer.text}
                  autoFocus={editingTextId === selectedLayer.id}
                  onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "text" ? { ...l, text: e.target.value } : l)))}
                  onBlur={() => setEditingTextId(null)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
                  className={`absolute outline-none border-2 border-dashed rounded px-1 ${
                    editingTextId === selectedLayer.id ? "bg-white/70 border-primary pointer-events-auto" : "bg-transparent border-transparent pointer-events-none"
                  }`}
                  style={{
                    left: `${(selectedLayer.x / W) * 100}%`,
                    top: `${(selectedLayer.y / H) * 100}%`,
                    transform: `translate(-50%, -50%) rotate(${selectedLayer.rotation ?? 0}deg)`,
                    fontSize: `${selectedLayer.fontSize * canvasScale}px`,
                    fontFamily: selectedLayer.fontFamily,
                    color: selectedLayer.color,
                    fontWeight: selectedLayer.bold ? "bold" : "normal",
                    fontStyle: selectedLayer.italic ? "italic" : "normal",
                    textDecoration: selectedLayer.underline ? "underline" : "none",
                    textAlign: "center",
                    width: `${Math.max(4, selectedLayer.text.length + 2)}ch`,
                    caretColor: selectedLayer.color,
                  }}
                />
              )}

              {/* 网格格子直接打字——点哪格选中哪格，叠加输入框立刻出现在
                  那一格上并自动聚焦，不用再跑去左侧属性栏找输入框，跟
                  填Excel表格一样的体验。方向键/Tab/Enter能连续跳到下一
                  格，整排数字可以不用每格重新点一次鼠标。留空格子(blank)
                  打的是"答案"（学生该填的数字，编辑器里半透明小字提示
                  设计师自己看），非留空格子打的是"给定数字"（直接显示
                  给学生看的）——跟左侧属性栏那两个输入框改的是同一份
                  数据，双向同步，两边改哪边都行。旋转过的网格用
                  gridCellCenter算出格子转过之后的真实屏幕位置，输入框
                  本身也跟着CSS rotate，不会跟画布上转过的格子对不上。 */}
              {tool === "select" && selectedLayer?.type === "grid" && selectedGridCell &&
                selectedGridCell.row < selectedLayer.rows && selectedGridCell.col < selectedLayer.cols && (() => {
                const gridLayer = selectedLayer as GridLayer;
                const { row, col } = selectedGridCell;
                const cell = gridLayer.cells[row]?.[col] ?? { value: "", blank: false };
                const pos = gridCellCenter(gridLayer, row, col);
                const b = objectBounds(gridLayer);
                const cellW = b.w / gridLayer.cols, cellH = b.h / gridLayer.rows;
                const isBlank = cell.blank;

                function moveTo(dr: number, dc: number) {
                  let r = row + dr, c = col + dc;
                  if (c >= gridLayer.cols) { c = 0; r++; }
                  if (c < 0) { c = gridLayer.cols - 1; r--; }
                  if (r < 0 || r >= gridLayer.rows) return;
                  setSelectedGridCell({ row: r, col: c });
                }

                return (
                  <input
                    key={`${gridLayer.id}-${row}-${col}`}
                    autoFocus
                    value={isBlank ? (cell.answer ?? "") : cell.value}
                    onChange={(e) => updateSelectedGridCell(isBlank ? { answer: e.target.value.slice(0, 2) } : { value: e.target.value.slice(0, 2) })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Tab" || e.key === "ArrowRight") { e.preventDefault(); moveTo(0, 1); }
                      else if (e.key === "ArrowLeft") { e.preventDefault(); moveTo(0, -1); }
                      else if (e.key === "ArrowDown") { e.preventDefault(); moveTo(1, 0); }
                      else if (e.key === "ArrowUp") { e.preventDefault(); moveTo(-1, 0); }
                      else if (e.key === "Escape") (e.target as HTMLInputElement).blur();
                    }}
                    className={`absolute outline-none border-2 rounded text-center font-bold pointer-events-auto ${
                      isBlank ? "bg-amber-50/90 border-primary text-foreground" : "bg-white/85 border-primary/60 text-foreground"
                    }`}
                    style={{
                      left: `${(pos.x / W) * 100}%`,
                      top: `${(pos.y / H) * 100}%`,
                      width: `${cellW * canvasScale * 0.8}px`,
                      height: `${cellH * canvasScale * 0.8}px`,
                      transform: `translate(-50%, -50%) rotate(${gridLayer.rotation ?? 0}deg)`,
                      fontSize: `${Math.min(cellW, cellH) * canvasScale * 0.5}px`,
                    }}
                  />
                );
              })()}
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-center flex-shrink-0 mt-2">选择模式下：点背景、物件、或文字都可以选中，拖动移动；蓝点缩放（斜拖可以宽高分开调整）；绿点拖着转圈可以旋转；双击文字可以原地编辑内容；点网格里的格子能直接打字，方向键/Tab/Enter连续跳到下一格</p>
        </div>

      {/* ── 右侧：只剩图层列表——属性面板已经搬到左侧图标栏旁边 ── */}
      <div className="w-80 shrink-0 border-l border-border bg-card p-3 space-y-3 overflow-y-auto">
        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">图层（由上到下：最上面的盖在最下面上面）</p>
          {layers.length === 0 ? (
            <p className="text-xs text-muted-foreground">还没有图层——从左边加背景、物件、或文字</p>
          ) : (
            [...layers].reverse().map((l) => (
              <div
                key={l.id}
                onClick={() => setSelectedId(l.id)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm cursor-pointer transition-colors ${
                  selectedId === l.id ? "bg-primary/10 border border-primary/40" : "bg-card border border-transparent hover:border-border"
                }`}
              >
                <span className="truncate">{layerLabel(l)}</span>
                <div className="flex gap-1 shrink-0">
                  <button type="button" onClick={(e) => { e.stopPropagation(); moveLayer(l.id, "front"); }} title="移到最上面" className="w-6 h-6 rounded hover:bg-muted text-xs">⏫</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); moveLayer(l.id, "up"); }} title="上移一层" className="w-6 h-6 rounded hover:bg-muted text-xs">🔼</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); moveLayer(l.id, "down"); }} title="下移一层" className="w-6 h-6 rounded hover:bg-muted text-xs">🔽</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); moveLayer(l.id, "back"); }} title="移到最下面" className="w-6 h-6 rounded hover:bg-muted text-xs">⏬</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      </div>

      <SaveModal open={showSave} onClose={() => setShowSave(false)} presetCategory={presetCategory} presetModuleType={presetModuleType} onSave={handleSave} />
    </div>
  );
}


