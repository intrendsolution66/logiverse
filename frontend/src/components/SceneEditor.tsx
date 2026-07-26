// frontend/src/components/SceneEditor.tsx
//
// The actual editing engine behind 图片编辑工具 — pulled out of
// ImageEditorPage.tsx into its own component so it can be embedded
// ANYWHERE, not just on its own page. This is what makes "every game
// module uses the same editor" true: AssetPicker's "编辑" tab renders this
// exact component, so maze/spot_diff/focus_tap-custom (everywhere
// AssetPicker is already used) get full scene editing for free — no
// per-module integration needed, one editor, reused everywhere.
//
// Background, objects, and text are all draggable/resizable the same way —
// the background isn't a fixed backdrop, it's just the bottom-most layer.
// Objects and text can also be ROTATED (a second handle, top-center,
// separate from the resize corner) — hit-testing accounts for this by
// transforming the click point into the layer's own unrotated local space
// rather than testing against an axis-aligned box, so a rotated layer's
// clickable area actually matches what's drawn on screen.

import { useState, useRef, useCallback, useEffect } from "react";
import { assetsApi, eduApi } from "@/api/index";
import AssetPicker from "@/components/AssetPicker";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";
import { GAME_CANVAS_W, GAME_CANVAS_H } from "@/lib/gameCanvas";

const W = GAME_CANVAS_W, H = GAME_CANVAS_H;
const HANDLE_R = 10;
const ROTATE_HANDLE_DIST = 34; // px above the top edge, before rotation is applied
const BG_ID = "__background__";

interface BackgroundLayer { url: string; x: number; y: number; w: number; h: number }
interface ObjectLayer { id: string; type: "object"; imageUrl: string; x: number; y: number; w: number; h: number; rotation: number }
interface TextLayer { id: string; type: "text"; text: string; x: number; y: number; fontSize: number; color: string; fontFamily: string; rotation: number }
type Layer = ObjectLayer | TextLayer;
interface Stroke { color: string; width: number; points: { x: number; y: number }[] }
interface Bounds { x: number; y: number; w: number; h: number }

const FONT_OPTIONS = [
  { label: "圆体（Baloo 2）", value: "'Baloo 2', sans-serif" },
  { label: "友善体（Nunito）", value: "'Nunito', sans-serif" },
  { label: "漫画体（Comic Neue）", value: "'Comic Neue', cursive" },
  { label: "中文趣味体（ZCOOL KuaiLe）", value: "'ZCOOL KuaiLe', sans-serif" },
  { label: "系统默认", value: "sans-serif" },
];

type Tool = "select" | "draw";
const COLORS = ["#e8a33d", "#ff7a59", "#4fb06d", "#5b8def", "#8b7ae0", "#222222", "#ffffff"];
const LANGUAGES = [{ code: "universal", label: "🌐 通用（不含文字/双语通用）" }, { code: "zh", label: "🇨🇳 中文专用" }, { code: "en", label: "🇬🇧 英文专用" }];
const MODULE_OPTIONS = [
  { value: "", label: "不限模块" },
  { value: "maze", label: "🧭 迷宫" }, { value: "spot_diff", label: "🔍 找不同之处" },
  { value: "focus_tap", label: "🎯 专注力点数字" }, { value: "memory", label: "🃏 Memory配对" },
  { value: "counting", label: "🔢 点点数数" }, { value: "pattern", label: "🧩 找规律" },
  { value: "word_problem", label: "📝 应用题" },
];

function uid() { return Math.random().toString(36).slice(2, 10); }
function deg2rad(d: number) { return (d * Math.PI) / 180; }

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
  objects: Array<{ imageUrl: string; x: number; y: number; w: number; h: number; rotation: number }>;
  texts: Array<{ text: string; x: number; y: number; fontSize: number; color: string; fontFamily: string; rotation: number }>;
}

export default function SceneEditor({ presetCategory, presetModuleType, onSaved, structuredMode, onSaveStructured, initial }: {
  presetCategory?: string; presetModuleType?: string; onSaved?: (dataUrl: string) => void;
  // structuredMode: for consumers (点点数数自定义场景) that need to know
  // WHERE each object/text is and what it IS, not a single flattened
  // picture — e.g. counting has to know exactly how many object layers
  // exist (that's the answer), which a merged PNG can't tell you.
  // onSaveStructured fires with the raw layer data instead of uploading
  // anything to the asset library — this scene is being embedded directly
  // into an exercise's config, not saved as a reusable asset.
  structuredMode?: boolean;
  onSaveStructured?: (data: StructuredSceneOutput) => void;
  initial?: StructuredSceneOutput;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [, forceRedraw] = useState(0);

  const [background, setBackground] = useState<BackgroundLayer | null>(
    initial?.bgUrl ? { url: initial.bgUrl, x: W / 2, y: H / 2, w: W, h: H } : null
  );
  const [layers, setLayers] = useState<Layer[]>(() => {
    if (!initial) return [];
    const objectLayers: ObjectLayer[] = initial.objects.map((o) => ({ id: uid(), type: "object", imageUrl: o.imageUrl, x: o.x, y: o.y, w: o.w, h: o.h, rotation: o.rotation }));
    const textLayers: TextLayer[] = initial.texts.map((t) => ({ id: uid(), type: "text", text: t.text, x: t.x, y: t.y, fontSize: t.fontSize, color: t.color, fontFamily: t.fontFamily, rotation: t.rotation }));
    return [...objectLayers, ...textLayers];
  });
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [drawColor, setDrawColor] = useState("#e8a33d");
  const [drawWidth, setDrawWidth] = useState(6);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
    img.onload = () => forceRedraw((n) => n + 1);
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

  function objectBounds(l: ObjectLayer | BackgroundLayer): Bounds {
    return { x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h };
  }
  function layerBounds(l: Layer, ctx: CanvasRenderingContext2D): Bounds {
    if (l.type === "object") return objectBounds(l);
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
      if (img?.complete) ctx.drawImage(img, b.x, b.y, b.w, b.h);
      if (selectedId === BG_ID) drawSelectionBox(ctx, b, 0);
    }

    strokes.forEach((s) => {
      ctx.beginPath();
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.lineCap = "round"; ctx.lineJoin = "round";
      s.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    });

    layers.forEach((l) => {
      const rot = layerRotation(l);
      ctx.save();
      ctx.translate(l.x, l.y); ctx.rotate(deg2rad(rot)); ctx.translate(-l.x, -l.y);
      if (l.type === "object") {
        const img = imgCacheRef.current.get(l.imageUrl);
        const b = objectBounds(l);
        if (img?.complete) ctx.drawImage(img, b.x, b.y, b.w, b.h);
      } else {
        ctx.font = `${l.fontSize}px ${l.fontFamily}`;
        ctx.fillStyle = l.color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(l.text, l.x, l.y);
      }
      ctx.restore();
      if (l.id === selectedId) drawSelectionBox(ctx, layerBounds(l, ctx), rot);
    });
  }, [background, layers, strokes, selectedId]);

  useEffect(() => { redraw(); });

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
      pushHistory();
      const stroke: Stroke = { color: drawColor, width: drawWidth, points: [{ x, y }] };
      dragRef.current = { mode: "draw", startX: x, startY: y, stroke };
      setStrokes((s) => [...s, stroke]);
      return;
    }
    const hit = hitTest(x, y);
    if (!hit) { setSelectedId(null); return; }
    setSelectedId(hit.id);
    pushHistory();
    if (hit.id === BG_ID && background) {
      dragRef.current = { mode: hit.onHandle === "resize" ? "resize" : "move", startX: x, startY: y, origBg: { ...background } };
    } else {
      const l = layers.find((l2) => l2.id === hit.id);
      if (l) dragRef.current = { mode: hit.onHandle === "resize" ? "resize" : hit.onHandle === "rotate" ? "rotate" : "move", startX: x, startY: y, origLayer: { ...l } };
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
      if (l.type === "object") {
        const orig = d.origLayer as ObjectLayer;
        return { ...l, w: Math.max(20, orig.w + dx), h: Math.max(20, orig.h + dy) };
      }
      const orig = d.origLayer as TextLayer;
      return { ...l, fontSize: Math.max(10, orig.fontSize + dy) };
    }));
  }

  function handlePointerUp() { dragRef.current = null; }

  function setBackgroundFromAsset(url: string) {
    pushHistory();
    ensureImgLoaded(url);
    setBackground({ url, x: W / 2, y: H / 2, w: W, h: H });
    setSelectedId(BG_ID);
  }

  function addObjectFromAsset(imageUrl: string) {
    pushHistory();
    const newLayer: ObjectLayer = { id: uid(), type: "object", imageUrl, x: W / 2, y: H / 2, w: 120, h: 120, rotation: 0 };
    ensureImgLoaded(imageUrl);
    setLayers((ls) => [...ls, newLayer]);
    setSelectedId(newLayer.id);
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
    return "🧸 物件";
  }

  function updateSelectedText(text: string) {
    setLayers((ls) => ls.map((l) => (l.id === selectedId && l.type === "text" ? { ...l, text } : l)));
  }

  function handleSaveStructured() {
    const objects = layers.filter((l): l is ObjectLayer => l.type === "object")
      .map((l) => ({ imageUrl: l.imageUrl, x: l.x, y: l.y, w: l.w, h: l.h, rotation: l.rotation ?? 0 }));
    const texts = layers.filter((l): l is TextLayer => l.type === "text")
      .map((l) => ({ text: l.text, x: l.x, y: l.y, fontSize: l.fontSize, color: l.color, fontFamily: l.fontFamily, rotation: l.rotation ?? 0 }));
    onSaveStructured?.({ bgUrl: background?.url ?? null, objects, texts });
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
      // 同样的原因：传后端刚存好的那个网址，不要传本地拍平出来的原始
      // base64——否则素材库里是文件存磁盘，调用这个编辑器的模块（比如
      // 迷宫背景）自己那份设定却还是整张图。
      onSaved?.(res.data.data.file_data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "保存失败";
      toast.error(msg);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/40 p-3 flex flex-wrap items-center gap-3">
        {!structuredMode && (
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setTool("select")} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${tool === "select" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}>🖱️ 选择/移动</button>
            <button type="button" onClick={() => { setTool("draw"); setSelectedId(null); }} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${tool === "draw" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}>🖌️ 画笔</button>
          </div>
        )}

        {!structuredMode && tool === "draw" && (
          <div className="flex items-center gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setDrawColor(c)} className={`w-6 h-6 rounded-full border-2 ${drawColor === c ? "border-primary" : "border-border"}`} style={{ background: c }} />
            ))}
            <input type="range" min={2} max={20} value={drawWidth} onChange={(e) => setDrawWidth(+e.target.value)} className="w-20" />
          </div>
        )}

        <div className="h-5 w-px bg-border" />

        <AssetPicker category="background" label="🖼️ 背景" onSelect={setBackgroundFromAsset} />
        <AssetPicker category="object" label="🧸 加物件" onSelect={addObjectFromAsset} />
        <Button size="sm" variant="outline" onClick={addText}>🔤 加文字</Button>

        <div className="h-5 w-px bg-border" />
        <Button size="sm" variant="outline" onClick={undo} disabled={history.length === 0}>↩️ 撤销</Button>
        {selectedLayer && <Button size="sm" variant="outline" onClick={resetRotation}>↺ 归零角度</Button>}
        {selectedLayer && <Button size="sm" variant="outline" onClick={deleteSelected}>🗑️ 删除选中</Button>}
        <div className="flex-1" />
        {structuredMode
          ? <Button size="sm" onClick={handleSaveStructured}>✅ 完成</Button>
          : <Button size="sm" onClick={() => setShowSave(true)}>💾 存到素材库</Button>}
      </div>

      {selectedLayer?.type === "text" && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 flex flex-wrap items-center gap-3">
          <Label className="shrink-0">文字内容</Label>
          <Input value={selectedLayer.text} onChange={(e) => updateSelectedText(e.target.value)} className="max-w-xs" />
          <label className="flex items-center gap-1.5 text-sm">字体
            <select
              value={selectedLayer.fontFamily}
              onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId ? { ...l, fontFamily: e.target.value } : l)))}
              className="border rounded-md p-1.5 text-sm"
            >
              {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-sm">大小
            <input
              type="number" min={12} max={120} value={selectedLayer.fontSize}
              onChange={(e) => setLayers((ls) => ls.map((l) => (l.id === selectedId ? { ...l, fontSize: +e.target.value } : l)))}
              className="w-16 border rounded-md p-1.5 text-sm"
            />
          </label>
          <div className="flex items-center gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setLayers((ls) => ls.map((l) => (l.id === selectedId ? { ...l, color: c } : l)))} className={`w-6 h-6 rounded-full border-2 ${(selectedLayer as TextLayer).color === c ? "border-primary" : "border-border"}`} style={{ background: c }} />
            ))}
          </div>
        </div>
      )}

      {structuredMode && (
        <p className="text-sm font-medium text-primary bg-primary/10 rounded-lg px-3 py-2">
          🔢 目前共有 {layers.filter((l) => l.type === "object").length} 个物件——这就是这一题的答案，文字不算在内
        </p>
      )}

      {layers.length >= 2 && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground mb-1">图层（由上到下：最上面的盖在最下面上面）</p>
          {[...layers].reverse().map((l) => (
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
          ))}
        </div>
      )}

      {backgroundSelected && (
        <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-3">
          🖼️ 背景已选中——拖动可以移动位置，拖右下角的蓝点可以缩放大小（背景不用"删除"，选新背景会直接换掉，背景本身不能旋转）
        </p>
      )}

      <canvas
        ref={canvasRef} width={W} height={H}
        onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp} onPointerLeave={handlePointerUp}
        style={{ touchAction: "none" }}
        className="w-full h-auto rounded-2xl border border-border bg-card cursor-crosshair shadow-lg ring-1 ring-black/5"
      />
      <p className="text-xs text-muted-foreground text-center">选择模式下：点背景、物件、或文字都可以选中，拖动移动；蓝点缩放（斜拖可以宽高分开调整）；绿点拖着转圈可以旋转</p>

      <SaveModal open={showSave} onClose={() => setShowSave(false)} presetCategory={presetCategory} presetModuleType={presetModuleType} onSave={handleSave} />
    </div>
  );
}
