// frontend/src/components/ColoringQuestionEditor.tsx
//
// 填色题专用编辑画布——独立组件，不复用共享的 SceneEditor(那个组件被
// 太多其他模块依赖，这次新功能刻意不碰它，见开发时的讨论)。
//
// 交互：工具栏加形状(矩形/圆形/三角形/立体方块) → 点选形状(立体方块的
// 三个面共用一个group_id，拖动/删除会一起动) → 拖动body移动，拖右下角
// 手柄调整大小(统一正方形缩放，不支持长宽分开调) → 右侧面板设"是否
// 可上色"+对应颜色 → 顶部调色盘管理这道题允许用的颜色。

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X, Square, Circle, Triangle, Box, Trash2 } from "lucide-react";
import { ColoringShapeSvg, makeDefaultShapes, type ColoringRegion, type ColoringConfig } from "@/lib/coloringShapes";

const CANVAS_W = 400, CANVAS_H = 300;
let idCounter = 0;
const genId = () => `region_${Date.now()}_${idCounter++}`;

const DEFAULT_PALETTE = ["#EF4444", "#F97316", "#EAB308", "#22C55E", "#3B82F6", "#A855F7", "#78350F", "#111827"];

export default function ColoringQuestionEditor({ initial, onChange }: {
  initial?: ColoringConfig; onChange: (config: ColoringConfig) => void;
}) {
  const [regions, setRegions] = useState<ColoringRegion[]>(initial?.regions ?? []);
  const [palette, setPalette] = useState<string[]>(initial?.palette ?? DEFAULT_PALETTE);
  const [bgImageUrl, setBgImageUrl] = useState<string | undefined>(initial?.bg_image_url);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null); // 单个形状用自己的id当group_id处理，统一逻辑
  const [newPaletteColor, setNewPaletteColor] = useState("#EF4444");
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ mode: "move" | "resize"; groupId: string; startX: number; startY: number; origRegions: ColoringRegion[] } | null>(null);

  function commit(nextRegions: ColoringRegion[], nextPalette: string[], nextBg?: string) {
    setRegions(nextRegions);
    onChange({ canvas_width: CANVAS_W, canvas_height: CANVAS_H, bg_image_url: nextBg ?? bgImageUrl, palette: nextPalette, regions: nextRegions });
  }

  function addShape(type: "rectangle" | "circle" | "triangle" | "cube") {
    const created = makeDefaultShapes(type, CANVAS_W / 2, CANVAS_H / 2, genId);
    const next = [...regions, ...created];
    commit(next, palette);
    setSelectedGroupId(created[0].group_id ?? created[0].id);
  }

  function svgPoint(e: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * CANVAS_W, y: ((e.clientY - rect.top) / rect.height) * CANVAS_H };
  }

  function handlePointerDown(e: React.PointerEvent, region: ColoringRegion, mode: "move" | "resize") {
    e.stopPropagation();
    const groupId = region.group_id ?? region.id;
    setSelectedGroupId(groupId);
    const p = svgPoint(e);
    dragRef.current = { mode, groupId, startX: p.x, startY: p.y, origRegions: regions.map((r) => ({ ...r })) };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = svgPoint(e);
    const dx = p.x - drag.startX, dy = p.y - drag.startY;
    setRegions(() => {
      const next = drag.origRegions.map((r) => {
        const inGroup = (r.group_id ?? r.id) === drag.groupId;
        if (!inGroup) return r;
        if (drag.mode === "move") return { ...r, x: r.x + dx, y: r.y + dy };
        // resize：立体方块三个面共用一个size(存在各自的w里)，一起变大变小；单形状只改自己
        const sizeDelta = dx; // 拖右下角，往右拖变大
        return { ...r, w: Math.max(15, r.w + sizeDelta), h: r.shape.startsWith("cube") ? r.h : Math.max(15, r.h + dy) };
      });
      return next;
    });
  }, []);

  function handlePointerUp() {
    if (dragRef.current) { commit(regions, palette); dragRef.current = null; }
  }

  function deleteSelected() {
    if (!selectedGroupId) return;
    const next = regions.filter((r) => (r.group_id ?? r.id) !== selectedGroupId);
    commit(next, palette);
    setSelectedGroupId(null);
  }

  function updateSelected(patch: Partial<ColoringRegion>) {
    if (!selectedGroupId) return;
    const next = regions.map((r) => ((r.group_id ?? r.id) === selectedGroupId ? { ...r, ...patch } : r));
    commit(next, palette);
  }

  function addPaletteColor() {
    if (palette.includes(newPaletteColor)) return;
    const next = [...palette, newPaletteColor];
    setPalette(next);
    commit(regions, next);
  }

  function removePaletteColor(color: string) {
    const next = palette.filter((c) => c !== color);
    setPalette(next);
    commit(regions, next);
  }

  async function handleBgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setBgImageUrl(url);
      commit(regions, palette, url);
    };
    reader.readAsDataURL(file);
  }

  const selectedRegions = regions.filter((r) => (r.group_id ?? r.id) === selectedGroupId);
  const selectedRepresentative = selectedRegions[0]; // 立体方块的3个面属性统一编辑，取第一个面代表整组

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button type="button" variant="outline" size="sm" onClick={() => addShape("rectangle")}><Square size={14} className="mr-1" /> 矩形</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => addShape("circle")}><Circle size={14} className="mr-1" /> 圆形</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => addShape("triangle")}><Triangle size={14} className="mr-1" /> 三角形</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => addShape("cube")}><Box size={14} className="mr-1" /> 立体方块</Button>
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
          {regions.map((r) => {
            const isSelected = (r.group_id ?? r.id) === selectedGroupId;
            const fill = r.colorable ? "#f8fafc" : (r.decoration_color ?? "#e2e8f0");
            return (
              <g key={r.id}>
                <ColoringShapeSvg region={r} fill={fill} selected={isSelected} onPointerDown={(e) => handlePointerDown(e, r, "move")} />
                {isSelected && r.id === selectedRepresentative?.id && (
                  <rect x={r.x + r.w / 2 - 6} y={r.y + (r.shape.startsWith("cube") ? r.w : r.h) / 2 - 6} width={12} height={12}
                    fill="#6366f1" style={{ cursor: "nwse-resize" }} onPointerDown={(e) => handlePointerDown(e, r, "resize")} />
                )}
              </g>
            );
          })}
        </svg>

        <div className="flex-1 space-y-3 min-w-[200px]">
          <div>
            <span className="text-xs text-muted-foreground block mb-1.5">调色盘（学生作答时能选的颜色）</span>
            <div className="flex flex-wrap gap-1.5">
              {palette.map((c) => (
                <div key={c} className="relative group">
                  <div className="w-7 h-7 rounded-md border border-border" style={{ backgroundColor: c }} />
                  <button onClick={() => removePaletteColor(c)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white border border-border opacity-0 group-hover:opacity-100 flex items-center justify-center">
                    <X size={9} />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-1">
                <input type="color" value={newPaletteColor} onChange={(e) => setNewPaletteColor(e.target.value)} className="w-7 h-7 rounded-md border border-border cursor-pointer" />
                <button onClick={addPaletteColor} className="text-xs text-primary hover:underline">加入</button>
              </div>
            </div>
          </div>

          {selectedRepresentative ? (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">
                  {selectedRepresentative.shape.startsWith("cube") ? "立体方块（3个面）" : selectedRepresentative.shape === "rectangle" ? "矩形" : selectedRepresentative.shape === "circle" ? "圆形" : "三角形"}
                </span>
                <button onClick={deleteSelected} className="text-muted-foreground hover:text-red-600"><Trash2 size={14} /></button>
              </div>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={selectedRepresentative.colorable} onChange={(e) => updateSelected({ colorable: e.target.checked })} />
                需要学生上色
              </label>
              {selectedRepresentative.colorable ? (
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">正确颜色</span>
                  <div className="flex flex-wrap gap-1">
                    {palette.map((c) => (
                      <button key={c} onClick={() => updateSelected({ correct_color: c })}
                        className={`w-6 h-6 rounded-md border-2 ${selectedRepresentative.correct_color === c ? "border-primary" : "border-transparent"}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">装饰颜色（固定显示，学生不能改）</span>
                  <div className="flex flex-wrap gap-1">
                    {palette.map((c) => (
                      <button key={c} onClick={() => updateSelected({ decoration_color: c })}
                        className={`w-6 h-6 rounded-md border-2 ${selectedRepresentative.decoration_color === c ? "border-primary" : "border-transparent"}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/60">点画布上的形状可以编辑属性；拖形状本体移动位置，拖右下角紫色小方块调整大小</p>
          )}
        </div>
      </div>
    </div>
  );
}
