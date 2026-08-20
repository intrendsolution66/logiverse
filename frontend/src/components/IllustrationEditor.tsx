// frontend/src/components/IllustrationEditor.tsx
//
// 题目配图工具——独立组件，纯装饰性插图(给选择题/填充题配一张示意图，
// 比如"数一数图里有几个方块")，没有判分逻辑。
//
// 交互模型：单击选中一个元素(画布上出现移动/缩放/旋转手柄，方便直接
// 拖拽操作)；双击才弹出独立的属性弹窗(颜色/字体/翻转/复制/删除这些
// 精确设置放在弹窗里，不是像之前那样常驻在侧边)。画布右键菜单屏蔽掉
// 浏览器自己的菜单(改用双击代替右键，避免跟系统菜单冲突)。

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X, Square, Circle, Triangle, Box, Trash2, Type, ImagePlus, Image as ImageIcon, ArrowUp, ArrowDown, Copy, FlipHorizontal, FlipVertical } from "lucide-react";
import { IllustrationShapeSvg, ILLUSTRATION_FONTS, type IllustrationElement, type IllustrationShape, type IllustrationText, type IllustrationObject, type Illustration } from "@/lib/illustrationShapes";

const CANVAS_W = 400, CANVAS_H = 300; // 内部坐标空间不变，只是下面显示尺寸放大1.5倍
const DISPLAY_W = 630; // 之前是420，按反馈放大1.5倍

let idCounter = 0;
const genId = () => `el_${Date.now()}_${idCounter++}`;

function elementGroupId(el: IllustrationElement): string {
  return (el as any).group_id ?? el.id;
}

function elementHalfExtent(el: IllustrationElement): number {
  if (el.kind === "text") return el.font_size / 2;
  if (el.kind === "shape" && el.shape.startsWith("cube")) return el.w / 2;
  return el.h / 2;
}

export default function IllustrationEditor({ initial, onChange }: {
  initial?: Illustration; onChange: (illustration: Illustration) => void;
}) {
  const [elements, setElements] = useState<IllustrationElement[]>(initial?.elements ?? []);
  const [bgImageUrl, setBgImageUrl] = useState<string | undefined>(initial?.bg_image_url);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [popupGroupId, setPopupGroupId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ mode: "move" | "resize" | "rotate"; groupId: string; startX: number; startY: number; orig: IllustrationElement[] } | null>(null);

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
    commit([...elements, ...created]);
    setSelectedGroupId((created[0] as any).group_id ?? created[0].id);
  }

  function addText() {
    const el: IllustrationText = { id: genId(), kind: "text", text: "文字", x: CANVAS_W / 2, y: CANVAS_H / 2, font_size: 24, font_family: ILLUSTRATION_FONTS[0].value, color: "#111827", rotation: 0, z_index: nextZ() };
    commit([...elements, el]);
    setSelectedGroupId(el.id);
  }

  async function handleObjectUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const el: IllustrationObject = { id: genId(), kind: "object", image_url: reader.result as string, x: CANVAS_W / 2, y: CANVAS_H / 2, w: 80, h: 80, rotation: 0, z_index: nextZ() };
      commit([...elements, el]);
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

  function handlePointerDown(e: React.PointerEvent, el: IllustrationElement, mode: "move" | "resize" | "rotate") {
    e.stopPropagation();
    const groupId = elementGroupId(el);
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
        if (elementGroupId(el) !== drag.groupId) return el;
        if (drag.mode === "move") return { ...el, x: el.x + dx, y: el.y + dy };
        if (drag.mode === "rotate") {
          const angle = (Math.atan2(p.y - el.y, p.x - el.x) * 180) / Math.PI + 90;
          return { ...el, rotation: Math.round(angle) };
        }
        if (el.kind === "text") return { ...el, font_size: Math.max(10, el.font_size + dx * 0.3) };
        const sizeDelta = dx;
        return { ...el, w: Math.max(15, el.w + sizeDelta), h: el.kind === "shape" && el.shape.startsWith("cube") ? el.h : Math.max(15, el.h + dy) };
      })
    );
  }, []);

  function handlePointerUp() {
    if (dragRef.current) { commit(elements); dragRef.current = null; }
  }

  function deleteGroup(groupId: string) {
    commit(elements.filter((el) => elementGroupId(el) !== groupId));
    if (selectedGroupId === groupId) setSelectedGroupId(null);
    if (popupGroupId === groupId) setPopupGroupId(null);
  }

  function updateGroup(groupId: string, patch: Record<string, unknown>) {
    commit(elements.map((el) => (elementGroupId(el) === groupId ? { ...el, ...patch } : el)) as IllustrationElement[]);
  }

  function moveLayer(groupId: string, dir: "up" | "down") {
    const delta = dir === "up" ? 1 : -1;
    commit(elements.map((el) => (elementGroupId(el) === groupId ? { ...el, z_index: el.z_index + delta * 100 } : el)));
  }

  function duplicateGroup(groupId: string) {
    const group = elements.filter((el) => elementGroupId(el) === groupId);
    if (group.length === 0) return;
    const newGroupId = group.length > 1 ? genId() : undefined;
    const copies = group.map((el) => ({
      ...el, id: genId(), x: el.x + 15, y: el.y + 15, z_index: nextZ(), ...(newGroupId ? { group_id: newGroupId } : {}),
    })) as IllustrationElement[];
    commit([...elements, ...copies]);
    const newSelected = newGroupId ?? copies[0].id;
    setSelectedGroupId(newSelected);
    setPopupGroupId(newSelected);
  }

  const sorted = [...elements].sort((a, b) => a.z_index - b.z_index);
  const selectedElements = elements.filter((el) => elementGroupId(el) === selectedGroupId);
  const selRep = selectedElements[0];
  const popupElements = elements.filter((el) => elementGroupId(el) === popupGroupId);
  const popupRep = popupElements[0];

  return (
    <div className="flex gap-3 items-start">
      {/* 左侧图标工具栏——跟 SceneEditor 同一套布局思路：纯图标竖排，
          hover 显示文字提示，不占横向空间，画布能挪到旁边占满剩余宽度。
          前5个是"点一下就插入一个"的形状/文字工具，中间一条分隔线，
          "上传物件"和"背景图（选填）"用 label 包着隐藏的 file input，
          点图标直接跳文件选择框，交互不变，只是外观从按钮变图标。 */}
      <div className="flex-shrink-0 w-11 flex flex-col gap-1 p-1.5 bg-muted/30 rounded-xl border border-border">
        <button type="button" title="矩形" onClick={() => addShape("rectangle")} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white hover:shadow-sm transition-colors">
          <Square size={16} />
        </button>
        <button type="button" title="圆形" onClick={() => addShape("circle")} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white hover:shadow-sm transition-colors">
          <Circle size={16} />
        </button>
        <button type="button" title="三角形" onClick={() => addShape("triangle")} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white hover:shadow-sm transition-colors">
          <Triangle size={16} />
        </button>
        <button type="button" title="立体方块" onClick={() => addShape("cube")} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white hover:shadow-sm transition-colors">
          <Box size={16} />
        </button>
        <button type="button" title="文字" onClick={addText} className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white hover:shadow-sm transition-colors">
          <Type size={16} />
        </button>
        <div className="h-px bg-border/60 mx-1 my-0.5" />
        <label title="上传物件" className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white hover:shadow-sm cursor-pointer transition-colors">
          <ImagePlus size={16} />
          <input type="file" accept="image/*" onChange={handleObjectUpload} className="hidden" />
        </label>
        <label title="背景图（选填）" className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-white hover:shadow-sm cursor-pointer transition-colors">
          <ImageIcon size={16} />
          <input type="file" accept="image/*" onChange={handleBgUpload} className="hidden" />
        </label>
      </div>

      <div className="flex-1 min-w-0 space-y-2">
      <p className="text-xs text-muted-foreground/70">单击选中拖动/缩放/旋转；双击弹出详细属性（颜色、字体、翻转、复制等）</p>

      <div className="flex-1 min-w-0 flex items-center justify-center">
        <div className="relative w-full" style={{ maxWidth: DISPLAY_W }}>
        <svg
          ref={svgRef} viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          className="border border-border rounded-xl bg-white" style={{ width: "100%", height: "auto", aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
          onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
          onClick={() => setSelectedGroupId(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {bgImageUrl && <image href={bgImageUrl} x={0} y={0} width={CANVAS_W} height={CANVAS_H} preserveAspectRatio="xMidYMid meet" />}
          {sorted.map((el) => {
            const isSelected = elementGroupId(el) === selectedGroupId;
            const onDbl = () => setPopupGroupId(elementGroupId(el));
            if (el.kind === "shape") {
              return <g key={el.id}><IllustrationShapeSvg el={el} selected={isSelected} onPointerDown={(e) => handlePointerDown(e, el, "move")} onDoubleClick={onDbl} /></g>;
            }
            if (el.kind === "text") {
              return (
                <text
                  key={el.id} x={el.x} y={el.y} fontSize={el.font_size} fontFamily={el.font_family} fill={el.color} textAnchor="middle" dominantBaseline="middle"
                  transform={el.rotation ? `rotate(${el.rotation} ${el.x} ${el.y})` : undefined}
                  stroke={isSelected ? "#6366f1" : "none"} strokeWidth={isSelected ? 0.5 : 0}
                  onPointerDown={(e) => handlePointerDown(e, el, "move")} onDoubleClick={onDbl} style={{ cursor: "move" }}
                >{el.text}</text>
              );
            }
            const flipTransform = `${el.rotation ? `rotate(${el.rotation} ${el.x} ${el.y})` : ""} ${el.flip_x || el.flip_y ? `translate(${el.x} ${el.y}) scale(${el.flip_x ? -1 : 1} ${el.flip_y ? -1 : 1}) translate(${-el.x} ${-el.y})` : ""}`.trim();
            return (
              <image
                key={el.id} href={el.image_url} x={el.x - el.w / 2} y={el.y - el.h / 2} width={el.w} height={el.h}
                transform={flipTransform || undefined}
                onPointerDown={(e) => handlePointerDown(e, el, "move")} onDoubleClick={onDbl} style={{ cursor: "move" }}
              />
            );
          })}
          {selRep && (() => {
            const half = elementHalfExtent(selRep);
            return (
              <>
                <rect
                  x={selRep.x + half - 6} y={selRep.y + half - 6} width={12} height={12}
                  fill="#6366f1" style={{ cursor: "nwse-resize" }}
                  onPointerDown={(e) => handlePointerDown(e, selRep, "resize")}
                />
                <line x1={selRep.x} y1={selRep.y - half} x2={selRep.x} y2={selRep.y - half - 24} stroke="#22c55e" strokeWidth={1.5} />
                <circle
                  cx={selRep.x} cy={selRep.y - half - 24} r={7} fill="#22c55e" style={{ cursor: "grab" }}
                  onPointerDown={(e) => handlePointerDown(e, selRep, "rotate")}
                />
              </>
            );
          })()}
        </svg>
      </div>
      </div>
      </div>

      {popupRep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setPopupGroupId(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-4 w-80 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">
                {popupRep.kind === "text" ? "文字属性" : popupRep.kind === "object" ? "图片物件属性" : popupRep.shape.startsWith("cube") ? "立体方块属性（3个面）" : "形状属性"}
              </span>
              <button onClick={() => setPopupGroupId(null)} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
            </div>

            {popupRep.kind === "text" && (
              <>
                <input
                  value={popupRep.text} onChange={(e) => updateGroup(popupGroupId!, { text: e.target.value })}
                  className="w-full px-2 py-1.5 rounded-lg border border-border text-sm" placeholder="文字内容"
                />
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">字体</span>
                  <select value={popupRep.font_family ?? ILLUSTRATION_FONTS[0].value} onChange={(e) => updateGroup(popupGroupId!, { font_family: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-border text-sm">
                    {ILLUSTRATION_FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">字号</span>
                  <input type="number" min={10} max={120} value={popupRep.font_size} onChange={(e) => updateGroup(popupGroupId!, { font_size: Math.max(10, +e.target.value) })} className="w-full px-2 py-1.5 rounded-lg border border-border text-sm" />
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">文字颜色</span>
                  <input type="color" value={popupRep.color} onChange={(e) => updateGroup(popupGroupId!, { color: e.target.value })} className="w-full h-8 rounded-lg border border-border cursor-pointer" />
                </div>
              </>
            )}

            {popupRep.kind === "shape" && (
              <div>
                <span className="text-xs text-muted-foreground block mb-1">填充颜色</span>
                <input type="color" value={popupRep.fill} onChange={(e) => updateGroup(popupGroupId!, { fill: e.target.value })} className="w-full h-8 rounded-lg border border-border cursor-pointer" />
              </div>
            )}

            {popupRep.kind !== "text" && (
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => updateGroup(popupGroupId!, { flip_x: !popupRep.flip_x })} className={popupRep.flip_x ? "border-primary text-primary" : ""}>
                  <FlipHorizontal size={14} className="mr-1" /> 水平翻转
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => updateGroup(popupGroupId!, { flip_y: !popupRep.flip_y })} className={popupRep.flip_y ? "border-primary text-primary" : ""}>
                  <FlipVertical size={14} className="mr-1" /> 垂直翻转
                </Button>
              </div>
            )}

            <div>
              <span className="text-xs text-muted-foreground block mb-1">旋转角度</span>
              <input type="number" value={popupRep.rotation} onChange={(e) => updateGroup(popupGroupId!, { rotation: +e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-border text-sm" />
              <p className="text-[11px] text-muted-foreground/70 mt-1">也可以直接在画布上拖绿色圆点旋转</p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border/60">
              <div className="flex gap-1">
                <button onClick={() => moveLayer(popupGroupId!, "up")} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md" title="移到上一层"><ArrowUp size={16} /></button>
                <button onClick={() => moveLayer(popupGroupId!, "down")} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md" title="移到下一层"><ArrowDown size={16} /></button>
                <button onClick={() => duplicateGroup(popupGroupId!)} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md" title="复制"><Copy size={16} /></button>
              </div>
              <button onClick={() => deleteGroup(popupGroupId!)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-md" title="删除"><Trash2 size={16} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
