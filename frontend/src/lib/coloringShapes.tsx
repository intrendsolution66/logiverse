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
export function shapePoints(r: ColoringRegion): { tag: "rect" | "ellipse" | "polygon"; attrs: Record<string, number | string> } {
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
