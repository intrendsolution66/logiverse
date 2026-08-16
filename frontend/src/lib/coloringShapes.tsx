// frontend/src/lib/coloringShapes.tsx
//
// 填色题用的形状定义 + 渲染——设计器画布、学生作答画布、成绩回看画布
// 三个地方都要用这同一套坐标公式，不能各自实现一份，不然设计师摆的
// 形状跟学生实际点击的区域会对不上（后端 PDF 生成那边也有一份完全
// 对应的公式，见 backend/src/modules/edu/examPaper.controller.ts 里的
// renderColoringShapeSvg——改这里的公式，那边也要跟着改）。

export type ColoringShapeType = "rectangle" | "circle" | "triangle" | "cube-top" | "cube-left" | "cube-right";

export interface ColoringRegion {
  id: string;
  shape: ColoringShapeType;
  x: number; y: number; w: number; h: number; rotation: number;
  colorable: boolean;
  correct_color?: string;   // colorable=true 时才有，学生作答/回看阶段这个字段可能被后端strip掉
  decoration_color?: string; // colorable=false 时的固定显示色
  group_id?: string;         // 立体方块三个面共用一个group_id，一起拖动/删除
}

export interface ColoringConfig {
  canvas_width: number; canvas_height: number;
  bg_image_url?: string;
  palette: string[];
  regions: ColoringRegion[];
}

// 算出一个形状实际要画的SVG几何——立体方块用最简单的等距投影：顶面
// 是个菱形，左右两面各是一个平行四边形，三个面共享同一个中心点(x,y)
// 和边长(w，h不使用)。
// 只要求几何计算真正用到的字段——colorable/correct_color这些判分相关
// 字段跟坐标计算无关，收窄成这个精简类型，这样填色题(ColoringRegion)
// 和纯装饰插图工具(IllustrationShape，见illustrationShapes.tsx)都能
// 共用这个函数，不用互相牵扯对方的类型。
export interface ShapeGeometry { shape: ColoringShapeType; x: number; y: number; w: number; h: number }

// 算出一组形状实际占用的边界框——渲染时用来自动裁剪掉画布里没用到的
// 空白区域，不强求设计师把图案摆满整个canvas_width×canvas_height。
// 不考虑rotation(按未旋转时的包围盒算，是保守估算——大多数填色题的
// 形状不会转很大角度，这个简化足够用；真要精确算旋转后的包围盒需要
// 把4个角点转出来取min/max，这里为了代码简单没做，视觉上差异很小)。
// 立体方块的三个面(cube-top/left/right)统一按"边长w、以x,y为共同
// 中心"估一个偏大的包围盒(±0.87w水平、±w垂直)——因为三个面实际共享
// 同一个中心点，各自套用这个偏大范围后取并集，刚好等于三个面拼起来的
// 真实整体范围，不会裁过头。
export function getRegionsBoundingBox(regions: ShapeGeometry[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (regions.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of regions) {
    const isCube = r.shape.startsWith("cube");
    const halfW = isCube ? r.w * 0.87 : r.w / 2;
    const halfH = isCube ? r.w : r.h / 2;
    minX = Math.min(minX, r.x - halfW); maxX = Math.max(maxX, r.x + halfW);
    minY = Math.min(minY, r.y - halfH); maxY = Math.max(maxY, r.y + halfH);
  }
  return { minX, minY, maxX, maxY };
}

// 渲染时统一用这个算出裁剪后的viewBox字符串——有背景图的话不裁(裁了
// 会把背景图相关的部分也一起挡住，背景图场景下画布尺寸通常是设计师
// 特意配合背景图定的，不属于"空画布留白"问题)；padding是裁剪后四周
// 留的缓冲空间(用canvas坐标系单位，不是像素)，避免图案贴着边缘显得
// 太挤。裁剪范围永远不会超出原始canvas_width×canvas_height。
export function getCroppedViewBox(config: ColoringConfig, padding = 20): string {
  if (config.bg_image_url || (config.regions ?? []).length === 0) {
    return `0 0 ${config.canvas_width} ${config.canvas_height}`;
  }
  const box = getRegionsBoundingBox(config.regions);
  if (!box) return `0 0 ${config.canvas_width} ${config.canvas_height}`;
  const minX = Math.max(0, box.minX - padding);
  const minY = Math.max(0, box.minY - padding);
  const maxX = Math.min(config.canvas_width, box.maxX + padding);
  const maxY = Math.min(config.canvas_height, box.maxY + padding);
  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
}

export function shapePoints(r: ShapeGeometry): { tag: "rect" | "ellipse" | "polygon"; attrs: Record<string, number | string> } {
  const { shape, x, y, w, h } = r;
  if (shape === "rectangle") return { tag: "rect", attrs: { x: x - w / 2, y: y - h / 2, width: w, height: h } };
  if (shape === "circle") return { tag: "ellipse", attrs: { cx: x, cy: y, rx: w / 2, ry: h / 2 } };
  if (shape === "triangle") {
    const points = `${x},${y - h / 2} ${x + w / 2},${y + h / 2} ${x - w / 2},${y + h / 2}`;
    return { tag: "polygon", attrs: { points } };
  }
  const s = w; // 立体方块的"边长"存在w里
  let points = "";
  if (shape === "cube-top") points = `${x},${y - s} ${x + s * 0.87},${y - s * 0.5} ${x},${y} ${x - s * 0.87},${y - s * 0.5}`;
  else if (shape === "cube-left") points = `${x - s * 0.87},${y - s * 0.5} ${x},${y} ${x},${y + s} ${x - s * 0.87},${y + s * 0.5}`;
  else points = `${x},${y} ${x + s * 0.87},${y - s * 0.5} ${x + s * 0.87},${y + s * 0.5} ${x},${y + s}`;
  return { tag: "polygon", attrs: { points } };
}

// 一个新加进画布的形状默认长什么样——立体方块固定用3个面一起加，共享
// 同一个group_id，size统一放在w里(h对立体方块没意义，随便给个占位值)。
export function makeDefaultShapes(shape: "rectangle" | "circle" | "triangle" | "cube", cx: number, cy: number, id: () => string): ColoringRegion[] {
  if (shape === "cube") {
    const groupId = id();
    return [
      { id: id(), shape: "cube-top", x: cx, y: cy, w: 50, h: 50, rotation: 0, colorable: true, group_id: groupId },
      { id: id(), shape: "cube-left", x: cx, y: cy, w: 50, h: 50, rotation: 0, colorable: true, group_id: groupId },
      { id: id(), shape: "cube-right", x: cx, y: cy, w: 50, h: 50, rotation: 0, colorable: true, group_id: groupId },
    ];
  }
  return [{ id: id(), shape, x: cx, y: cy, w: 70, h: 70, rotation: 0, colorable: true }];
}

export function ColoringShapeSvg({ region, fill, onPointerDown, onClick, selected }: {
  region: ColoringRegion; fill: string;
  onPointerDown?: (e: React.PointerEvent) => void; onClick?: () => void; selected?: boolean;
}) {
  const { tag, attrs } = shapePoints(region);
  const rot = region.rotation ? `rotate(${region.rotation} ${region.x} ${region.y})` : undefined;
  const commonProps = {
    fill, stroke: selected ? "#6366f1" : "#333", strokeWidth: selected ? 3 : 1.5,
    transform: rot, onPointerDown, onClick, style: { cursor: onClick ? "pointer" : undefined },
  };
  if (tag === "rect") return <rect {...(attrs as any)} {...commonProps} />;
  if (tag === "ellipse") return <ellipse {...(attrs as any)} {...commonProps} />;
  return <polygon {...(attrs as any)} {...commonProps} />;
}
