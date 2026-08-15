// frontend/src/components/IllustrationEditor.tsx
//
// 题目配图工具——独立组件，跟 ColoringQuestionEditor 类似的画布交互，
// 但这里的形状/文字/图片纯粹是装饰性插图(给选择题/填充题配一张示意
// 图，比如"数一数图里有几个方块")，没有可上色/判分这套逻辑，加了
// 图层(上移/下移)和文字元素，也支持上传图片当装饰物件。

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X, Square, Circle, Triangle, Box, Trash2, Type, ImagePlus, ArrowUp, ArrowDown } from "lucide-react";
import { IllustrationShapeSvg, type IllustrationElement, type Illustration } from "@/lib/illustrationShapes";

const CANVAS_W = 400, CANVAS_H = 300;
let idCounter = 0;
const genId = () => `el_${Date.now()}_${idCounter++}`;

export default function IllustrationEditor({ initial, onChange }: {
  initial?: Illustration; onChange: (illustration: Illustration) => void;
}) {
  const [elements, setElements] = useState<IllustrationElement[]>(initial?.elements ?? []);
  const [bgImageUrl, setBgImageUrl] = useState<string | undefined>(initial?.bg_image_url);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ mode: "move" | "resize"; groupId: string; startX: number; startY: number; orig: IllustrationElement[] } | null>(null);

  function commit(next: IllustrationElement[], nextBg?: string) {
    setElements(next);
    onChange({ canvas_width: CANVAS_W, canvas_height: CANVAS_H, bg_image_url: nextBg ?? bgImageUrl, elements: next });
  }

  function nextZ() { return elements.length === 0 ? 0 : Math.max(...elements.map((e) => e.z_index)) + 1; }

  function addShape(shape: "rectangle" | "circle" | "triangle" | "cube") {
    let created: IllustrationElement[];
    if (shape === "cube") {
      const groupId = genId();
      const z = nextZ();
      created = [
        { id: genId(), kind: "shape", shape: "cube-top", x: CANVAS_W / 2, y: CANVAS_H / 2, w: 50, h: 50, rotation: 0, fill: "#93C5FD", z_index: z, group_id: groupId },
        { id: genId(), kind: "shape", shape: "cube-left", x: CANVAS_W / 2, y: CANVAS_H / 2, w: 50, h: 50, rotation: 0, fill: "#60A5FA", z_index: z, group_id: groupId },
        { id: genId(), kind: "shape", shape: "cube-right", x: CANVAS_W / 2, y: CANVAS_H / 2, w: 50, h: 50, rotation: 0, fill: "#3B82F6", z_index: z, group_id: groupId },
      ];
    } else {
      created = [{ id: genId(), kind: "shape", shape, x: CANVAS_W / 2, y: CANVAS_H / 2, w: 70, h: 70, rotation: 0, fill: "#93C5FD", z_index: nextZ() }];
    }
    const next = [...elements, ...created];
    commit(next);
    setSelectedGroupId((created[0] as any).group_id ?? created[0].id);
  }

  function addText() {
    const el: IllustrationText2 = { id: genId(), kind: "text", text: "文字", x: CANVAS_W / 2, y: CANVAS_H / 2, font_size: 24, color: "#111827", rotation: 0, z_index: nextZ() };
    const next = [...elements, el];
    commit(next);
    setSelectedGroupId(el.id);
  }

  async function handleObjectUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const el: IllustrationObject2 = { id: genId(), kind: "object", image_url: reader.result as string, x: CANVAS_W / 2, y: CANVAS_H / 2, w: 80, h: 80, rotation: 0, z_index: nextZ() };
      const next = [...elements, el];
      commit(next);
      setSelectedGroupId(el.id);
    };
    reader.readAsDataURL(file);
  }

  async function handleBgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const url = reader.result as string; setBgImageUrl(url); commit(elements, url); };
    reader.readAsDataURL(file);
  }

  function svgPoint(e: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * CANVAS_W, y: ((e.clientY - rect.top) / rect.height) * CANVAS_H };
  }

  function handlePointerDown(e: React.PointerEvent, el: IllustrationElement, mode: "move" | "resize") {
    e.stopPropagation();
    const groupId = (el as any).group_id ?? el.id;
    setSelectedGroupId(groupId);
    const p = svgPoint(e);
    dragRef.current = { mode, groupId, startX: p.x, startY: p.y, orig: elements.map((x) => ({ ...x })) };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = svgPoint(e);
    const dx = p.x - drag.startX, dy = p.y - drag.startY;
    setElements(() =>
      drag.orig.map((el) => {
        const inGroup = ((el as any).group_id ?? el.id) === drag.groupId;
        if (!inGroup) return el;
        if (drag.mode === "move") return { ...el, x: el.x + dx, y: el.y + dy };
        if (el.kind === "text") return { ...el, font_size: Math.max(10, el.font_size + dx * 0.3) };
        const sizeDelta = dx;
        return { ...el, w: Math.max(15, el.w + sizeDelta), h: el.kind === "shape" && el.shape.startsWith("cube") ? el.h : Math.max(15, el.h + dy) };
      })
    );
  }, []);

  function handlePointerUp() {
    if (dragRef.current) { commit(elements); dragRef.current = null; }
  }

  function deleteSelected() {
    if (!selectedGroupId) return;
    commit(elements.filter((el) => ((el as any).group_id ?? el.id) !== selectedGroupId));
    setSelectedGroupId(null);
  }

  function updateSelected(patch: Record<string, unknown>) {
    if (!selectedGroupId) return;
    commit(elements.map((el) => (((el as any).group_id ?? el.id) === selectedGroupId ? { ...el, ...patch } : el)) as IllustrationElement[]);
  }

  function moveLayer(dir: "up" | "down") {
    if (!selectedGroupId) return;
    const selected = elements.filter((el) => ((el as any).group_id ?? el.id) === selectedGroupId);
    const delta = dir === "up" ? 1 : -1;
    commit(elements.map((el) => (((el as any).group_id ?? el.id) === selectedGroupId ? { ...el, z_index: el.z_index + delta * 100 } : el)));
  }

  const sorted = [...elements].sort((a, b) => a.z_index - b.z_index);
  const selectedElements = elements.filter((el) => ((el as any).group_id ?? el.id) === selectedGroupId);
  const rep = selectedElements[0];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button type="button" variant="outline" size="sm" onClick={() => addShape("rectangle")}><Square size={14} className="mr-1" /> 矩形</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => addShape("circle")}><Circle size={14} className="mr-1" /> 圆形</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => addShape("triangle")}><Triangle size={14} className="mr-1" /> 三角形</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => addShape("cube")}><Box size={14} className="mr-1" /> 立体方块</Button>
        <Button type="button" variant="outline" size="sm" onClick={addText}><Type size={14} className="mr-1" /> 文字</Button>
        <label className="text-xs text-muted-foreground cursor-pointer px-2 py-1.5 rounded-lg border border-border hover:bg-muted/40 flex items-center gap-1">
          <ImagePlus size={14} /> 上传物件<input type="file" accept="image/*" onChange={handleObjectUpload} className="hidden" />
        </label>
        <label className="text-xs text-muted-foreground cursor-pointer px-2 py-1.5 rounded-lg border border-border hover:bg-muted/40">
          背景图（选填）<input type="file" accept="image/*" onChange={handleBgUpload} className="hidden" />
        </label>
      </div>

      <div className="flex gap-4">
        <svg
          ref={svgRef} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          className="border border-border rounded-xl bg-white flex-shrink-0" style={{ width: 420, height: 315 }}
          onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
          onClick={() => setSelectedGroupId(null)}
        >
          {bgImageUrl && <image href={bgImageUrl} x={0} y={0} width={CANVAS_W} height={CANVAS_H} preserveAspectRatio="xMidYMid slice" />}
          {sorted.map((el) => {
            const isSelected = ((el as any).group_id ?? el.id) === selectedGroupId;
            if (el.kind === "shape") {
              return <g key={el.id}><IllustrationShapeSvg el={el} selected={isSelected} onPointerDown={(e: React.PointerEvent) => handlePointerDown(e, el, "move")} /></g>;
            }
            if (el.kind === "text") {
              return (
                <text
                  key={el.id} x={el.x} y={el.y} fontSize={el.font_size} fill={el.color} textAnchor="middle" dominantBaseline="middle"
                  transform={el.rotation ? `rotate(${el.rotation} ${el.x} ${el.y})` : undefined}
                  stroke={isSelected ? "#6366f1" : "none"} strokeWidth={isSelected ? 0.5 : 0}
                  onPointerDown={(e: React.PointerEvent) => handlePointerDown(e, el, "move")} style={{ cursor: "move" }}
                >{el.text}</text>
              );
            }
            return (
              <image
                key={el.id} href={el.image_url} x={el.x - el.w / 2} y={el.y - el.h / 2} width={el.w} height={el.h}
                transform={el.rotation ? `rotate(${el.rotation} ${el.x} ${el.y})` : undefined}
                onPointerDown={(e: React.PointerEvent) => handlePointerDown(e, el, "move")} style={{ cursor: "move" }}
              />
            );
          })}
          {rep && (
            <rect
              x={rep.x + (rep.kind === "text" ? rep.font_size : rep.w) / 2 - 6}
              y={rep.y + (rep.kind === "shape" && rep.shape.startsWith("cube") ? rep.w : rep.kind === "text" ? rep.font_size : rep.h) / 2 - 6}
              width={12} height={12} fill="#6366f1" style={{ cursor: "nwse-resize" }}
              onPointerDown={(e: React.PointerEvent) => handlePointerDown(e, rep, "resize")}
            />
          )}
        </svg>

        <div className="flex-1 space-y-3 min-w-[200px]">
          {rep ? (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">
                  {rep.kind === "text" ? "文字" : rep.kind === "object" ? "图片物件" : rep.shape.startsWith("cube") ? "立体方块（3个面）" : rep.shape === "rectangle" ? "矩形" : rep.shape === "circle" ? "圆形" : "三角形"}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => moveLayer("up")} className="text-muted-foreground hover:text-foreground" title="移到上一层"><ArrowUp size={14} /></button>
                  <button onClick={() => moveLayer("down")} className="text-muted-foreground hover:text-foreground" title="移到下一层"><ArrowDown size={14} /></button>
                  <button onClick={deleteSelected} className="text-muted-foreground hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              </div>
              {rep.kind === "text" && (
                <input value={rep.text} onChange={(e) => updateSelected({ text: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-border text-sm" placeholder="文字内容" />
              )}
              {rep.kind !== "object" && (
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">{rep.kind === "text" ? "文字颜色" : "填充颜色"}</span>
                  <input type="color" value={rep.kind === "text" ? rep.color : rep.fill} onChange={(e) => updateSelected(rep.kind === "text" ? { color: e.target.value } : { fill: e.target.value })} className="w-full h-8 rounded-lg border border-border cursor-pointer" />
                </div>
              )}
              <div>
                <span className="text-xs text-muted-foreground block mb-1">旋转角度</span>
                <input type="number" value={rep.rotation} onChange={(e) => updateSelected({ rotation: +e.target.value })} className="w-full px-2 py-1 rounded-lg border border-border text-sm" />
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/60">点画布上的元素可以编辑属性；拖本体移动位置，拖右下角紫色小方块调整大小/字号；图层用上移/下移按钮调整前后顺序</p>
          )}
        </div>
      </div>
    </div>
  );
}

type IllustrationText2 = Extract<IllustrationElement, { kind: "text" }>;
type IllustrationObject2 = Extract<IllustrationElement, { kind: "object" }>;
