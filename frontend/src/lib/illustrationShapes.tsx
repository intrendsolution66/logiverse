// frontend/src/lib/illustrationShapes.tsx
//
// "题目配图"工具用的类型定义——给选择题/填充题配一张纯装饰性插图用
// (比如"数一数图里有几个方块"这种题目需要的示意图)，不是互动题型，
// 学生只是看图，不能点/不能上色，答案还是走选择题/填充题原本的逻辑。
//
// 形状几何复用 coloringShapes.tsx 的 shapePoints 坐标公式(矩形/圆形/
// 三角形/立体方块三面)，但这里的元素没有 colorable/correct_color 这套
// 判分语义——纯粹是"画出来给学生看"，加了图层(z_index)排序和文字元素，
// 填色题编辑器没有这两样。

import { shapePoints, type ColoringShapeType } from "@/lib/coloringShapes";

export interface IllustrationShape {
  id: string;
  kind: "shape";
  shape: ColoringShapeType;
  x: number; y: number; w: number; h: number; rotation: number;
  fill: string;
  flip_x?: boolean; flip_y?: boolean;
  z_index: number;
  group_id?: string; // 立体方块三个面共用一个group_id，一起拖动/删除
}

export const ILLUSTRATION_FONTS = [
  { value: "'PingFang SC', 'Microsoft YaHei', sans-serif", label: "默认（黑体）" },
  { value: "'Noto Serif SC', 'SimSun', serif", label: "宋体/衬线" },
  { value: "'ZCOOL KuaiLe', cursive", label: "可爱手写体" },
  { value: "Georgia, serif", label: "Georgia（英文衬线）" },
  { value: "Arial, sans-serif", label: "Arial（英文无衬线）" },
];

export interface IllustrationText {
  id: string;
  kind: "text";
  text: string; x: number; y: number; font_size: number; font_family?: string; color: string; rotation: number;
  z_index: number;
}

export interface IllustrationObject {
  id: string;
  kind: "object";
  image_url: string; x: number; y: number; w: number; h: number; rotation: number;
  flip_x?: boolean; flip_y?: boolean;
  z_index: number;
}

export type IllustrationElement = IllustrationShape | IllustrationText | IllustrationObject;

export interface Illustration {
  canvas_width: number; canvas_height: number;
  bg_image_url?: string;
  elements: IllustrationElement[];
}

// 翻转用scale(-1,1)/scale(1,-1)配合旋转一起算成一个transform字符串——
// 顺序是先翻转再旋转(以元素中心点为基准)，这样翻转不会因为先转了角度
// 而变得直觉上很奇怪。
function flipRotateTransform(x: number, y: number, rotation: number, flipX?: boolean, flipY?: boolean): string | undefined {
  const parts: string[] = [];
  if (rotation) parts.push(`rotate(${rotation} ${x} ${y})`);
  if (flipX || flipY) parts.push(`translate(${x} ${y}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1}) translate(${-x} ${-y})`);
  return parts.length ? parts.join(" ") : undefined;
}

export function IllustrationShapeSvg({ el, onPointerDown, onDoubleClick, selected }: {
  el: IllustrationShape; onPointerDown?: (e: React.PointerEvent) => void; onDoubleClick?: () => void; selected?: boolean;
}) {
  const { tag, attrs } = shapePoints(el);
  const transform = flipRotateTransform(el.x, el.y, el.rotation, el.flip_x, el.flip_y);
  const common = { fill: el.fill, stroke: selected ? "#6366f1" : "#333", strokeWidth: selected ? 3 : 1.5, transform, onPointerDown, onDoubleClick, style: { cursor: onPointerDown ? "move" : undefined } };
  if (tag === "rect") return <rect {...(attrs as any)} {...common} />;
  if (tag === "ellipse") return <ellipse {...(attrs as any)} {...common} />;
  return <polygon {...(attrs as any)} {...common} />;
}

// 只读展示——学生作答画面/成绩回看画面用，纯粹显示，不能点/不能拖动。
// 只读展示组件——给学生作答画面、成绩回看画面用，不带任何拖动/编辑
// 交互，纯粹按z_index顺序把元素画出来。
export function IllustrationView({ illustration, className, style }: {
  illustration: Illustration; className?: string; style?: React.CSSProperties;
}) {
  const sorted = [...(illustration.elements ?? [])].sort((a, b) => a.z_index - b.z_index);
  return (
    <svg viewBox={`0 0 ${illustration.canvas_width} ${illustration.canvas_height}`} className={className} style={style}>
      {illustration.bg_image_url && (
        <image href={illustration.bg_image_url} x={0} y={0} width={illustration.canvas_width} height={illustration.canvas_height} preserveAspectRatio="xMidYMid meet" />
      )}
      {sorted.map((el) => {
        if (el.kind === "shape") return <IllustrationShapeSvg key={el.id} el={el} />;
        if (el.kind === "text") {
          return (
            <text
              key={el.id} x={el.x} y={el.y} fontSize={el.font_size} fontFamily={el.font_family} fill={el.color} textAnchor="middle" dominantBaseline="middle"
              transform={el.rotation ? `rotate(${el.rotation} ${el.x} ${el.y})` : undefined}
            >{el.text}</text>
          );
        }
        return (
          <image
            key={el.id} href={el.image_url} x={el.x - el.w / 2} y={el.y - el.h / 2} width={el.w} height={el.h}
            transform={flipRotateTransform(el.x, el.y, el.rotation, el.flip_x, el.flip_y)}
          />
        );
      })}
    </svg>
  );
}
