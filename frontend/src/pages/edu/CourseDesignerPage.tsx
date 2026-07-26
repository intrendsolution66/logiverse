// frontend/src/pages/edu/CourseDesignerPage.tsx
//
// Table-list + modal pattern (see prior notes in README), this pass focuses
// on visual consistency: every input/select now shares the same Tailwind
// treatment as the design system's <Input> component (border-input,
// rounded-lg, focus ring), tables sit inside a bordered/rounded container
// with a muted header row and hover states, and spacing follows the app's
// existing scale instead of ad-hoc inline styles.

import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { eduApi, lessonsApi, exerciseClassificationApi, taxonomyApi } from "@/api/index";
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

const MODULE_LABELS: Record<string, { emoji: string; label: string }> = {
  counting:     { emoji: "🔢", label: "点点数数" },
  spot_diff:    { emoji: "🔍", label: "找不同之处" },
  focus_tap:    { emoji: "🎯", label: "专注力点数字" },
  memory:       { emoji: "🃏", label: "Memory配对" },
  pattern:      { emoji: "🧩", label: "找规律" },
  word_problem: { emoji: "📝", label: "应用题" },
  maze:         { emoji: "🧭", label: "迷宫" },
  sudoku:       { emoji: "🔢", label: "数独" },
  line_match:   { emoji: "🔗", label: "连线配对" },
  coloring:     { emoji: "🎨", label: "填色游戏" },
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

// ── Focus-tap custom mode: upload a scene, click to mark where numbers go ────
// Same "click to add, click existing to remove" interaction as spot_diff's
// hotspot marking — deliberately reused rather than inventing a new pattern,
// since it's already a proven, tested marking UX in this codebase.
const FT_W = GAME_CANVAS_W, FT_H = GAME_CANVAS_H;

function FocusTapCustomDesigner({ bgUrl, setBgUrl, positions, setPositions }: {
  bgUrl: string | null; setBgUrl: (u: string) => void;
  positions: { x: number; y: number }[]; setPositions: (p: { x: number; y: number }[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, FT_W, FT_H);
    ctx.fillStyle = "#f6faf7"; ctx.fillRect(0, 0, FT_W, FT_H);
    if (bgImgRef.current) ctx.drawImage(bgImgRef.current, 0, 0, FT_W, FT_H);
    positions.forEach((p, i) => {
      const x = p.x * FT_W, y = p.y * FT_H;
      ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(232,163,61,0.9)"; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
      ctx.font = "bold 18px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      ctx.fillText(String(i + 1), x, y + 6);
    });
  }, [positions]);

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
    const scaleX = FT_W / rect.width, scaleY = FT_H / rect.height;
    const px = (e.clientX - rect.left) * scaleX, py = (e.clientY - rect.top) * scaleY;
    const lx = px / FT_W, ly = py / FT_H;
    const hitIdx = positions.findIndex((p) => Math.hypot(p.x - lx, p.y - ly) * FT_W < 22);
    if (hitIdx >= 0) setPositions(positions.filter((_, i) => i !== hitIdx));
    else setPositions([...positions, { x: lx, y: ly }]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <label className="flex items-center gap-1.5">场景图片 <input type="file" accept="image/*" className="text-xs" onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} /></label>
        <AssetPicker category="background" label="🗂️ 从素材库选" moduleType="focus_tap" onSelect={handleSelect} />
      </div>
      <p className="text-xs text-muted-foreground">上传一张场景图后，点图上想放数字的位置（比如角色的头、手上的物件），点击顺序不影响玩法（每次玩数字会重新随机分配到这些位置）。点已有的标记可以移除。已标记 {positions.length} 个位置。</p>
      <canvas
        ref={canvasRef} width={FT_W} height={FT_H} onClick={handleClick}
        className="w-full h-auto rounded-lg bg-card cursor-crosshair border border-border"
      />
    </div>
  );
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


function SudokuCellDesigner({ bgUrl, setBgUrl, cells, setCells }: {
  bgUrl: string | null; setBgUrl: (u: string) => void;
  cells: SudokuCellDraft[]; setCells: (c: SudokuCellDraft[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgImgRef = useRef<HTMLImageElement | null>(null);

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, FT_W, FT_H);
    ctx.fillStyle = "#f6faf7"; ctx.fillRect(0, 0, FT_W, FT_H);
    if (bgImgRef.current) ctx.drawImage(bgImgRef.current, 0, 0, FT_W, FT_H);
    cells.forEach((c, i) => {
      const x = c.x * FT_W, y = c.y * FT_H;
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
    const scaleX = FT_W / rect.width, scaleY = FT_H / rect.height;
    const px = (e.clientX - rect.left) * scaleX, py = (e.clientY - rect.top) * scaleY;
    const lx = px / FT_W, ly = py / FT_H;
    const hitIdx = cells.findIndex((c) => Math.hypot(c.x - lx, c.y - ly) * FT_W < 22);
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
        ref={canvasRef} width={FT_W} height={FT_H} onClick={handleClick}
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

function AddLevelModal({ open, onClose, courseId, editingLevelId, onSaved }: {
  open: boolean; onClose: () => void; courseId: string | null; editingLevelId?: string | null; onSaved: () => void;
}) {


  const [moduleType, setModuleType] = useState<"counting" | "spot_diff" | "focus_tap" | "memory" | "pattern" | "word_problem" | "maze" | "sudoku" | "line_match" | "coloring">("counting");
  const [levelTitle, setLevelTitle] = useState("");
  const [explanationText, setExplanationText] = useState("");
  const [hintText, setHintText] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFileName, setAudioFileName] = useState("");
  const [explanationImageUrl, setExplanationImageUrl] = useState<string | null>(null);
  const [explanationVideoUrl, setExplanationVideoUrl] = useState("");

  // 这个 Activity 归到哪门课——之前这个信息是"父层已经选好了课程，直接当
  // prop 传进来"，现在 Activity 管理页面本身不再是"先选课程"这种浏览方式
  // 了（改成全平台Activity平铺列表），所以这个弹窗自己要有一个课程选择
  // 器。如果外部真的传了 courseId（比如以后从"某门课底下加一个Activity"
  // 这种情境呼叫这个弹窗），就用外部传的；没传的话，靠这里自己选。
  const [courses, setCourses] = useState<Array<{ id: string; title_i18n?: Record<string,string> }>>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");

  // 弹窗改成分页籤显示，不是全部塞在一个页面里一路往下滚——内容太长
  // （光是模块专属的设定就有八种模块各自一大块，加上分类、属性、提示栏），
  // 硬塞成一条长表单不好操作。保存按钮固定在分页籤外面，不管停在哪个
  // 分页籤都能直接保存，不用先切到"最后一个分页籤"才能存。
  type TabKey = "basic" | "classification" | "content" | "properties";
  const [activeTab, setActiveTab] = useState<TabKey>("basic");
  const effectiveCourseId = courseId ?? (selectedCourseId || null);
  useEffect(() => {
    if (open && !courseId) eduApi.listCourses({ limit: 200 }).then((r) => setCourses(r.data));
  }, [open, courseId]);

  // 习题分类 (exercise classification) — all optional; leaving these unset
  // just means the exercise has no auto-generated number yet, not an error.
  const [categories, setCategories] = useState<Array<{ id: string; code: string; name_zh: string; prefix: string; subject_id?: string }>>([]);
  const [groups, setGroups] = useState<Array<{ id: string; category_id: string; code: string; name_zh: string }>>([]);
  const [curriculumTypes, setCurriculumTypes] = useState<Array<{ id: string; code: string; name_zh: string }>>([]);
  const [programmes, setProgrammes] = useState<Array<{ id: string; code: string; name_zh: string }>>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; programme_id: string; code: string; name_zh: string }>>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [curriculumTypeId, setCurriculumTypeId] = useState("");

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

  useEffect(() => {
    if (!open) return;
    taxonomyApi.listProgrammes().then(setProgrammes);
    exerciseClassificationApi.listCategories().then(setCategories); // unfiltered — needed for the module_type→Topic auto-match below regardless of what Programme/Subject is currently picked
    exerciseClassificationApi.listCurriculumTypes().then(setCurriculumTypes);
  }, [open]);
  useEffect(() => {
    if (programmeId) taxonomyApi.listSubjects(programmeId).then(setSubjects);
    else setSubjects([]);
  }, [programmeId]);
  useEffect(() => {
    if (categoryId) exerciseClassificationApi.listGroups(categoryId).then(setGroups);
    else setGroups([]);
    setGroupId("");
  }, [categoryId]);
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
  useEffect(() => {
    if (!subjectId) return;
    const subject = subjects.find((s) => s.id === subjectId);
    if (subject) setProgrammeId((prev) => (prev === subject.programme_id ? prev : subject.programme_id));
    else {
      // subjectId points somewhere not in the currently-loaded `subjects`
      // list (e.g. it belongs to a different Programme than whatever
      // programmeId is currently set to) — look it up directly instead of
      // silently leaving Programme unset.
      taxonomyApi.listSubjects().then((all) => {
        const found = all.find((s) => s.id === subjectId);
        if (found) setProgrammeId(found.programme_id);
      });
    }
  }, [subjectId, subjects]);

  // counting fields
  const [theme, setTheme] = useState("apple");
  const [minVal, setMinVal] = useState(1);
  const [maxVal, setMaxVal] = useState(10);
  const [numChoices, setNumChoices] = useState(3);
  const [totalQuestions, setTotalQuestions] = useState(5);
  const [countingMode, setCountingMode] = useState<"random" | "custom_scene">("random");
  const [countingScene, setCountingScene] = useState<StructuredSceneOutput | null>(null);

  // focus_tap fields (grid mode only for now)
  const [gridSize, setGridSize] = useState(4);
  const [ftMode, setFtMode] = useState<"grid" | "custom">("grid");
  const [ftBgUrl, setFtBgUrl] = useState<string | null>(null);
  const [ftPositions, setFtPositions] = useState<{ x: number; y: number }[]>([]);

  // memory fields
  const [memoryTheme, setMemoryTheme] = useState("animal");
  const [pairsCount, setPairsCount] = useState(6);
  const [previewSeconds, setPreviewSeconds] = useState(3);
  const [memoryMode, setMemoryMode] = useState<"preset" | "custom">("preset");
  const [memoryCustomIcons, setMemoryCustomIcons] = useState<string[]>([]);
  const [memoryBgUrl, setMemoryBgUrl] = useState<string | null>(null);

  // pattern fields
  const [patternTheme, setPatternTheme] = useState("shape");
  const [patternTypes, setPatternTypes] = useState<string[]>(["AB", "ABC", "AAB", "ABB", "AABB"]);
  const [seqLength, setSeqLength] = useState(7);

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

  // line_match fields — each pair is authored directly, same "designer
  // writes the answer" shape as sudoku's cells. type/content per side lets
  // a pair mix text-to-image (e.g. 动物图片 → "汪汪" 文字), not just
  // text-to-text.
  interface LineMatchPairDraft { left: { type: "text" | "image"; content: string }; right: { type: "text" | "image"; content: string } }
  const [lineMatchPairs, setLineMatchPairs] = useState<LineMatchPairDraft[]>([{ left: { type: "text", content: "" }, right: { type: "text", content: "" } }]);
  const [lineMatchShuffleRight, setLineMatchShuffleRight] = useState(true);

  // coloring fields
  const [coloringBgUrl, setColoringBgUrl] = useState<string | null>(null);
  const [coloringRegions, setColoringRegions] = useState<ColoringRegionDraft[]>([]);
  const [coloringMaskDataUrl, setColoringMaskDataUrl] = useState<string | null>(null);

  // maze fields — authored, not generated: bg image + a hand-painted mask
  const [mazeBgUrl, setMazeBgUrl] = useState<string | null>(null);
  const [mazeTool, setMazeTool] = useState<"paint" | "erase" | "fill" | "fillErase" | "start" | "end">("paint");
  const [mazeBrushWidth, setMazeBrushWidth] = useState(22);
  const [mazeStart, setMazeStart] = useState<{ x: number; y: number } | null>(null);
  const [mazeEnd, setMazeEnd] = useState<{ x: number; y: number } | null>(null);
  const [mazeHistoryCount, setMazeHistoryCount] = useState(0); // just for enabling/disabling the undo button
  const mazeCanvasRef = useRef<HTMLCanvasElement>(null);
  const mazeMaskCanvasRef = useRef<HTMLCanvasElement | null>(null); // offscreen: accumulates the painted mask
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
  const [hotspots, setHotspots] = useState<{ x: number; y: number; r: number }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgARef = useRef<HTMLImageElement | null>(null);
  const imgBRef = useRef<HTMLImageElement | null>(null);

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SD_W, SD_H);
    ctx.fillStyle = "#fff";
    ctx.fillRect(SD_LEFT_X, SD_BOX_Y, SD_BOX_W, SD_BOX_H);
    ctx.fillRect(SD_RIGHT_X, SD_BOX_Y, SD_BOX_W, SD_BOX_H);
    if (imgARef.current) ctx.drawImage(imgARef.current, SD_LEFT_X, SD_BOX_Y, SD_BOX_W, SD_BOX_H);
    if (imgBRef.current) ctx.drawImage(imgBRef.current, SD_RIGHT_X, SD_BOX_Y, SD_BOX_W, SD_BOX_H);
    ctx.strokeStyle = "#dbe9e0"; ctx.lineWidth = 2;
    ctx.strokeRect(SD_LEFT_X, SD_BOX_Y, SD_BOX_W, SD_BOX_H);
    ctx.strokeRect(SD_RIGHT_X, SD_BOX_Y, SD_BOX_W, SD_BOX_H);
    hotspots.forEach((h) => {
      [SD_LEFT_X, SD_RIGHT_X].forEach((ox) => {
        ctx.beginPath();
        ctx.arc(ox + h.x * SD_BOX_W, SD_BOX_Y + h.y * SD_BOX_H, h.r * SD_BOX_W, 0, Math.PI * 2);
        ctx.setLineDash([6, 5]); ctx.strokeStyle = "rgba(255,122,89,0.9)"; ctx.lineWidth = 3; ctx.stroke();
        ctx.setLineDash([]);
      });
    });
  }, [hotspots]);

  useEffect(() => { if (open && moduleType === "spot_diff") redraw(); }, [open, moduleType, redraw, imgAUrl, imgBUrl]);

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
    if (mazeStart) {
      ctx.beginPath(); ctx.arc(mazeStart.x * MZ_W, mazeStart.y * MZ_H, 16, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,122,89,0.9)"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
    }
    if (mazeEnd) {
      ctx.beginPath(); ctx.arc(mazeEnd.x * MZ_W, mazeEnd.y * MZ_H, 16, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(46,158,91,0.9)"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.stroke();
    }
  }, [mazeStart, mazeEnd]);

  useEffect(() => { if (open && moduleType === "maze") mazeRedraw(); }, [open, moduleType, mazeRedraw, mazeBgUrl]);

  async function handleMazeBgUpload(file: File) {
    const dataUrl = await readAsDataURL(file);
    handleMazeBgSelect(dataUrl);
  }

  function handleMazeBgSelect(dataUrl: string) {
    const img = new Image();
    img.onload = () => {
      mazeBgImgRef.current = img;
      const mask = document.createElement("canvas");
      mask.width = MZ_W; mask.height = MZ_H;
      mazeMaskCanvasRef.current = mask;
      mazeHistoryRef.current = []; setMazeHistoryCount(0);
      mazeRedraw();
    };
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
    const mc = mazeMaskCanvasRef.current;
    if (!mc) return;
    const ctx = mc.getContext("2d")!;
    if (mazeTool === "paint") {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#4fb06d";
      ctx.beginPath(); ctx.arc(px, py, mazeBrushWidth, 0, Math.PI * 2); ctx.fill();
    } else if (mazeTool === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath(); ctx.arc(px, py, mazeBrushWidth, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
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

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const idx = (x: number, y: number) => (y * w + x) * 4;
    const targetIsEmpty = data[idx(startX, startY) + 3] < 10;

    const visited = new Uint8Array(w * h);
    const stack: [number, number][] = [[startX, startY]];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const vIdx = y * w + x;
      if (visited[vIdx]) continue;
      const i = idx(x, y);
      const matches = targetIsEmpty ? data[i + 3] < 10 : data[i + 3] >= 10;
      if (!matches) continue;
      visited[vIdx] = 1;
      if (erase) { data[i + 3] = 0; } // transparent → "not walkable" again
      else { data[i] = 79; data[i + 1] = 176; data[i + 2] = 109; data[i + 3] = 255; } // #4fb06d, matches the paint brush color
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    ctx.putImageData(imgData, 0, 0);
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
    if (mazeTool === "start") { setMazeStart({ x: x / MZ_W, y: y / MZ_H }); return; }
    if (mazeTool === "end") { setMazeEnd({ x: x / MZ_W, y: y / MZ_H }); return; }
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

  // reset when the modal is closed so re-opening starts fresh
  useEffect(() => {
    if (!open) {
      setLevelTitle(""); setModuleType("counting");
      setExplanationText(""); setExplanationImageUrl(null); setExplanationVideoUrl("");
      setHintText(""); setAudioUrl(null); setAudioFileName("");
      setProgrammeId(""); setSubjectId(""); setCategoryId(""); setGroupId(""); setCurriculumTypeId("");
      setActiveTab("basic");
      setSelectedCourseId("");
      setActivityType("game"); setTeachingModes([]); setDifficulty("");
      setAgeGroupMin(""); setAgeGroupMax(""); setDurationMinutes("");
      setLearningOutcomes(""); setSkillsInput(""); setActivityLanguage("universal"); setActivityTagsInput("");
      setTheme("apple"); setMinVal(1); setMaxVal(10); setNumChoices(3); setTotalQuestions(5);
      setCountingMode("random"); setCountingScene(null);
      setGridSize(4);
      setFtMode("grid"); setFtBgUrl(null); setFtPositions([]);
      setMemoryTheme("animal"); setPairsCount(6); setPreviewSeconds(3);
      setMemoryMode("preset"); setMemoryCustomIcons([]); setMemoryBgUrl(null);
      setPatternTheme("shape"); setPatternTypes(["AB","ABC","AAB","ABB","AABB"]); setSeqLength(7);
      setWpCategories(["chicken_rabbit"]); setWpAnswerMode("select");
      setMazeBgUrl(null); setMazeTool("paint"); setMazeBrushWidth(22); setMazeStart(null); setMazeEnd(null);
      mazeHistoryRef.current = []; setMazeHistoryCount(0);
      mazeMaskCanvasRef.current = null; mazeBgImgRef.current = null;
      setSudokuBgUrl(null); setSudokuCells([]); setSudokuDifficulty("medium");
      setLineMatchPairs([{ left: { type: "text", content: "" }, right: { type: "text", content: "" } }]); setLineMatchShuffleRight(true);
      setColoringBgUrl(null); setColoringRegions([]); setColoringMaskDataUrl(null);
      setImgAUrl(null); setImgBUrl(null); setHotspots([]);
      imgARef.current = null; imgBRef.current = null;
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
      setCategoryId(level.category_id ?? ""); setGroupId(level.group_id ?? ""); setCurriculumTypeId(level.curriculum_type_id ?? "");
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

      const cfg = level.config as Record<string, unknown>;
      if (level.module_type === "counting") {
        if (cfg.mode === "custom_scene") {
          setCountingMode("custom_scene");
          const positions = (cfg.positions as Array<{ x: number; y: number; image_url?: string; w?: number; h?: number; rotation?: number }>) ?? [];
          setCountingScene({
            bgUrl: (cfg.bg_image_url as string) ?? null,
            objects: positions.map((p) => ({
              imageUrl: p.image_url ?? (cfg.custom_icon_url as string) ?? "",
              x: p.x * GAME_CANVAS_W, y: p.y * GAME_CANVAS_H,
              w: p.w ?? 80, h: p.h ?? 80, rotation: p.rotation ?? 0,
            })),
            texts: ((cfg.texts as StructuredSceneOutput["texts"]) ?? []).map((t) => ({ ...t, x: t.x * GAME_CANVAS_W, y: t.y * GAME_CANVAS_H })),
          });
        } else {
          setCountingMode("random");
          setTheme((cfg.theme as string) ?? "apple");
          setMinVal((cfg.min_val as number) ?? 1); setMaxVal((cfg.max_val as number) ?? 10);
          setNumChoices((cfg.num_choices as number) ?? 3); setTotalQuestions((cfg.total_questions as number) ?? 5);
        }
      } else if (level.module_type === "spot_diff") {
        setImgAUrl((cfg.image_a_url as string) ?? null); setImgBUrl((cfg.image_b_url as string) ?? null);
        setHotspots((cfg.hotspots as { x: number; y: number; r: number }[]) ?? []);
        if (cfg.image_a_url) { const img = new Image(); img.onload = () => { imgARef.current = img; redraw(); }; img.src = cfg.image_a_url as string; }
        if (cfg.image_b_url) { const img = new Image(); img.onload = () => { imgBRef.current = img; redraw(); }; img.src = cfg.image_b_url as string; }
      } else if (level.module_type === "focus_tap") {
        setFtMode(((cfg.mode as string) ?? "grid") as "grid" | "custom");
        setGridSize((cfg.grid_size as number) ?? 4);
        setFtBgUrl((cfg.bg_image_url as string) ?? null);
        setFtPositions((cfg.positions as { x: number; y: number }[]) ?? []);
      } else if (level.module_type === "memory") {
        if (cfg.theme === "custom") {
          setMemoryMode("custom");
          setMemoryCustomIcons((cfg.custom_icons as string[]) ?? []);
          setMemoryBgUrl((cfg.bg_image_url as string) ?? null);
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
      } else if (level.module_type === "word_problem") {
        setWpCategories((cfg.categories as string[]) ?? ["chicken_rabbit"]);
        setWpAnswerMode(((cfg.answer_mode as string) ?? "select") as "select" | "input");
        setTotalQuestions((cfg.total_questions as number) ?? 5);
      } else if (level.module_type === "sudoku") {
        setSudokuBgUrl((cfg.bg_image_url as string) ?? null);
        setSudokuDifficulty(((cfg.difficulty as string) ?? "medium") as "easy" | "medium" | "hard" | "custom");
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
      } else if (level.module_type === "line_match") {
        const pairs = (cfg.pairs as Array<{ left: { type: "text" | "image"; content: string }; right: { type: "text" | "image"; content: string } }>) ?? [];
        setLineMatchPairs(pairs.length ? pairs : [{ left: { type: "text", content: "" }, right: { type: "text", content: "" } }]);
        setLineMatchShuffleRight((cfg.shuffle_right as boolean) ?? true);
      } else if (level.module_type === "coloring") {
        setColoringBgUrl((cfg.bg_image_url as string) ?? null);
        setColoringMaskDataUrl((cfg.region_mask_url as string) ?? null);
        setColoringRegions((cfg.regions as ColoringRegionDraft[]) ?? []);
      } else if (level.module_type === "maze") {
        setMazeBgUrl((cfg.bg_image_url as string) ?? null);
        setMazeStart(cfg.start_x != null ? { x: cfg.start_x as number, y: cfg.start_y as number } : null);
        setMazeEnd(cfg.end_x != null ? { x: cfg.end_x as number, y: cfg.end_y as number } : null);
        if (cfg.bg_image_url) {
          const bgImg = new Image();
          bgImg.onload = () => {
            mazeBgImgRef.current = bgImg;
            const mask = document.createElement("canvas");
            mask.width = MZ_W; mask.height = MZ_H;
            mazeMaskCanvasRef.current = mask;
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
    const img = new Image();
    img.onload = () => { if (side === "a") imgARef.current = img; else imgBRef.current = img; redraw(); };
    img.src = dataUrl;
    if (side === "a") setImgAUrl(dataUrl); else setImgBUrl(dataUrl);
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = SD_W / rect.width, scaleY = SD_H / rect.height;
    const px = (e.clientX - rect.left) * scaleX, py = (e.clientY - rect.top) * scaleY;
    let lx: number | null = null, ly: number | null = null;
    if (px >= SD_LEFT_X && px <= SD_LEFT_X + SD_BOX_W && py >= SD_BOX_Y && py <= SD_BOX_Y + SD_BOX_H) {
      lx = (px - SD_LEFT_X) / SD_BOX_W; ly = (py - SD_BOX_Y) / SD_BOX_H;
    } else if (px >= SD_RIGHT_X && px <= SD_RIGHT_X + SD_BOX_W && py >= SD_BOX_Y && py <= SD_BOX_Y + SD_BOX_H) {
      lx = (px - SD_RIGHT_X) / SD_BOX_W; ly = (py - SD_BOX_Y) / SD_BOX_H;
    }
    if (lx === null || ly === null) return;
    const hitIdx = hotspots.findIndex((h) => Math.hypot(h.x - lx!, h.y - ly!) < h.r);
    if (hitIdx >= 0) setHotspots(hotspots.filter((_, i) => i !== hitIdx));
    else setHotspots([...hotspots, { x: lx, y: ly, r: 0.06 }]);
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
    };
    const fullPayload = { ...payload, ...activityMeta };
    if (editingLevelId) await eduApi.updateLevel(editingLevelId, fullPayload);
    else if (effectiveCourseId) await eduApi.createLevel(effectiveCourseId, fullPayload);
  }

  async function handleSave() {
    if (!effectiveCourseId && !editingLevelId) { toast.error("请先选这个 Activity 归到哪门课"); return; }
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
            category_id: categoryId || undefined, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: {
              mode: "custom_scene", bg_image_url: countingScene.bgUrl,
              positions: countingScene.objects.map((o) => ({ x: o.x / GAME_CANVAS_W, y: o.y / GAME_CANVAS_H, w: o.w, h: o.h, rotation: o.rotation, image_url: o.imageUrl })),
              texts: countingScene.texts.map((t) => ({ ...t, x: t.x / GAME_CANVAS_W, y: t.y / GAME_CANVAS_H })),
              num_choices: numChoices, timer_mode: "stopwatch",
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
            category_id: categoryId || undefined, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
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

          category_id: categoryId || undefined, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { image_a_url: imgAUrl, image_b_url: imgBUrl, hotspots, timer_mode: "stopwatch" },
        });
      } else if (moduleType === "focus_tap") {
        if (ftMode === "custom") {
          if (!ftBgUrl) { toast.error("请上传背景图片"); return; }
          if (ftPositions.length < 2) { toast.error("请至少标记2个数字位置"); return; }
          await saveLevel({
            module_type: "focus_tap",
            title_i18n: { zh: levelTitle || "专注力点数字", en: levelTitle || "Focus Tap" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,

            category_id: categoryId || undefined, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: { mode: "custom", bg_image_url: ftBgUrl, positions: ftPositions, timer_mode: "stopwatch" },
          });
        } else {
          await saveLevel({
            module_type: "focus_tap",
            title_i18n: { zh: levelTitle || "专注力点数字", en: levelTitle || "Focus Tap" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,

            category_id: categoryId || undefined, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: { mode: "grid", grid_size: gridSize, timer_mode: "stopwatch" },
          });
        }
      } else if (moduleType === "memory") {
        if (memoryMode === "custom") {
          if (memoryCustomIcons.length < 2) { toast.error("请至少加2张配对图片"); return; }
          await saveLevel({
            module_type: "memory",
            title_i18n: { zh: levelTitle || "Memory配对", en: levelTitle || "Memory Match" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,
            category_id: categoryId || undefined, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: { theme: "custom", custom_icons: memoryCustomIcons, bg_image_url: memoryBgUrl || undefined, pairs_count: memoryCustomIcons.length, preview_seconds: previewSeconds, timer_mode: "stopwatch" },
          });
        } else {
          await saveLevel({
            module_type: "memory",
            title_i18n: { zh: levelTitle || "Memory配对", en: levelTitle || "Memory Match" },
            explanation_text: explanationText || undefined,
            explanation_image_url: explanationImageUrl || undefined,
            explanation_video_url: explanationVideoUrl || undefined,

            hint_text: hintText || undefined, audio_url: audioUrl || undefined,
            category_id: categoryId || undefined, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
            config: { theme: memoryTheme, pairs_count: pairsCount, preview_seconds: previewSeconds, timer_mode: "stopwatch" },
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

          category_id: categoryId || undefined, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { theme: patternTheme, pattern_types: patternTypes, seq_length: seqLength, num_choices: 3, total_questions: totalQuestions, timer_mode: "stopwatch" },
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

          category_id: categoryId || undefined, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: { categories: wpCategories, answer_mode: wpAnswerMode, num_choices: 3, total_questions: totalQuestions, timer_mode: "stopwatch" },
        });
      } else if (moduleType === "maze") { // authored: what gets saved IS the puzzle (bg + painted mask + start/end), not generation params
        if (!mazeBgUrl) { toast.error("请先上传背景图片"); return; }
        if (!mazeStart || !mazeEnd) { toast.error("请设定起点和终点"); return; }
        if (!mazeMaskCanvasRef.current) { toast.error("请先画出可以走的路径"); return; }
        const maskDataUrl = mazeMaskCanvasRef.current.toDataURL("image/png");
        await saveLevel({
          module_type: "maze",
          title_i18n: { zh: levelTitle || "迷宫", en: levelTitle || "Maze" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,

          hint_text: hintText || undefined, audio_url: audioUrl || undefined,

          category_id: categoryId || undefined, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: {
            bg_image_url: mazeBgUrl, mask_image_url: maskDataUrl,
            start_x: mazeStart.x, start_y: mazeStart.y, end_x: mazeEnd.x, end_y: mazeEnd.y,
            timer_mode: "stopwatch",
          },
        });
      } else if (moduleType === "line_match") { // authored: every pair IS the puzzle, same shape as maze/sudoku
        const cleanPairs = lineMatchPairs.filter((p) => p.left.content.trim() && p.right.content.trim());
        if (cleanPairs.length === 0) { toast.error("至少要有1组配对，左右两边都要填内容"); return; }
        await saveLevel({
          module_type: "line_match",
          title_i18n: { zh: levelTitle || "连线配对", en: levelTitle || "Line Match" },
          explanation_text: explanationText || undefined,
          explanation_image_url: explanationImageUrl || undefined,
          explanation_video_url: explanationVideoUrl || undefined,

          hint_text: hintText || undefined, audio_url: audioUrl || undefined,

          category_id: categoryId || undefined, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: {
            pairs: cleanPairs,
            shuffle_right: lineMatchShuffleRight,
            timer_mode: "stopwatch",
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

          category_id: categoryId || undefined, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: {
            bg_image_url: coloringBgUrl,
            region_mask_url: coloringMaskDataUrl,
            regions: coloringRegions,
            timer_mode: "stopwatch",
          },
        });
      } else { // sudoku — authored: a puzzle image + which cells are blank + each one's correct digit
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

          category_id: categoryId || undefined, group_id: groupId || undefined, curriculum_type_id: curriculumTypeId || undefined,
          config: {
            bg_image_url: sudokuBgUrl,
            cells: sudokuCells.map((c) => ({ x: c.x, y: c.y, answer: parseInt(c.answer, 10) })),
            difficulty: sudokuDifficulty,
            timer_mode: "stopwatch",
          },
        });
      }
      toast.success(editingLevelId ? "Activity 改好了" : "Activity 加好了");
      onSaved(); onClose();
    } catch {
      toast.error("新增失败（可能没有权限）");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editingLevelId ? "编辑 Activity" : "加 Activity"} size="full">
      <div className="space-y-4">
        <div className="flex gap-1 border-b border-border -mx-1 px-1">
          {([
            ["basic", "基本信息"],
            ["classification", "分类 (Programme/Subject/Topic)"],
            ["content", "内容设置"],
            ["properties", "属性与提示"],
          ] as [TabKey, string][]).map(([key, label]) => (
            <button
              key={key} type="button" onClick={() => setActiveTab(key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
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
        <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 space-y-2">
          <Label>这个 Activity 属于哪里？（选填）</Label>
          <p className="text-xs text-muted-foreground -mt-1">先选 Programme，再选 Subject，最后选 Topic——例如：学前幼教 → 数学 → 点点数数。这三层是一条链路，选错上一层，下一层的选项会跟着变。</p>
          <div className="flex flex-wrap gap-2">
            <select
              className="border rounded-md p-2 text-sm"
              value={programmeId}
              onChange={(e) => { setProgrammeId(e.target.value); setSubjectId(""); setCategoryId(""); }}
            >
              <option value="">Programme...</option>
              {programmes.map((p) => <option key={p.id} value={p.id}>{p.name_zh}</option>)}
            </select>
            <select
              className="border rounded-md p-2 text-sm" disabled={!programmeId}
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
          </div>
          {!categoryId && (
            <p className="text-xs text-muted-foreground">还没选 Topic 也能保存——选了的话，编号前缀（如 MK、CT）就是从这里的 Topic 决定的；没选可以先建好 Activity，之后再回来这个分页籤补上。</p>
          )}

          <div className="flex flex-wrap gap-2 pt-1 border-t border-border/50 mt-1">
            <select className="border rounded-md p-2 text-sm" value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={!categoryId}>
              <option value="">分类（选填）...</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name_zh}</option>)}
            </select>
            <select className="border rounded-md p-2 text-sm" value={curriculumTypeId} onChange={(e) => setCurriculumTypeId(e.target.value)}>
              <option value="">小分类（校内/奥数/其它，选填）...</option>
              {curriculumTypes.map((t) => <option key={t.id} value={t.id}>{t.name_zh}</option>)}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            选了 Topic 之后保存时会自动生成编号（如 MK-NUM-10001）；分类、小分类是选填的进一步细分。
            要新增 Topic 或分类，去「学习主题管理」页面——这里只负责选，不负责建。
          </p>
        </div>
        </div>

        <div className={activeTab === "basic" ? "block space-y-4" : "hidden"}>
        <div className="space-y-1.5">
          <Label>模块类型</Label>
          <select disabled={!!editingLevelId} className={SELECT_CLASS} value={moduleType} onChange={(e) => setModuleType(e.target.value as "counting" | "spot_diff" | "focus_tap" | "memory" | "pattern" | "word_problem" | "maze" | "sudoku" | "line_match" | "coloring")}>
            {Object.entries(MODULE_LABELS).map(([key, { emoji, label }]) => (
              <option key={key} value={key}>{emoji} {label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Activity 名称</Label>
          <Input placeholder="Activity 名称" value={levelTitle} onChange={(e) => setLevelTitle(e.target.value)} />
        </div>
        {!courseId && !editingLevelId && (
          <div className="space-y-1.5">
            <Label>归到哪门课</Label>
            <select className={SELECT_CLASS} value={selectedCourseId} onChange={(e) => setSelectedCourseId(e.target.value)}>
              <option value="">选一门课...</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.title_i18n?.zh ?? c.title_i18n?.en}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">课程是组织 Activity 的容器，跟这个 Activity 属于哪个 Programme/Subject/Topic 是两件独立的事——没有想要放的课程，去「Activity 设计管理」旁边的课程管理页面先建一个。</p>
          </div>
        )}
        </div>

        <div className={activeTab === "content" ? "block space-y-4" : "hidden"}>
        {moduleType === "counting" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3 text-sm">
            <div className="flex gap-1.5">
              {(["random", "custom_scene"] as const).map((m) => (
                <button
                  key={m} type="button" onClick={() => setCountingMode(m)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    countingMode === m ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                  }`}
                >
                  {m === "random" ? "🎲 随机生成" : "🖼️ 自定义画面"}
                </button>
              ))}
            </div>

            {countingMode === "random" ? (
              <div className="flex gap-3 flex-wrap items-center">
                <label className="flex items-center gap-1.5">主题
                  <select value={theme} onChange={(e) => setTheme(e.target.value)} className={MINI_SELECT_CLASS}>
                    <option value="apple">🍎 苹果</option><option value="star">⭐ 星星</option>
                    <option value="fish">🐟 鱼</option><option value="balloon">🎈 气球</option><option value="candy">🍬 糖果</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5">范围
                  <input type="number" value={minVal} onChange={(e) => setMinVal(+e.target.value)} className={MINI_INPUT_CLASS} /> ~
                  <input type="number" value={maxVal} onChange={(e) => setMaxVal(+e.target.value)} className={MINI_INPUT_CLASS} />
                </label>
                <label className="flex items-center gap-1.5">选项 <input type="number" value={numChoices} onChange={(e) => setNumChoices(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
                <label className="flex items-center gap-1.5">题数 <input type="number" value={totalQuestions} onChange={(e) => setTotalQuestions(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  选背景图、加物件（可以从素材库选，也可以直接上传——每次加的物件图片可以都不一样，数量不限），拖到想要的位置，还能旋转、缩放。加了几个物件，答案就是几个；文字是装饰用的，不算进答案里。
                </p>
                <SceneEditor
                  structuredMode presetModuleType="counting"
                  onSaveStructured={setCountingScene} initial={countingScene ?? undefined}
                />
                {countingScene && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ 场景已确认（{countingScene.objects.length} 个物件），可以点上面"完成"重新调整</p>
                )}
              </>
            )}
          </div>
        )}

        {moduleType === "spot_diff" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
            <div className="flex gap-4 text-sm flex-wrap items-center">
              <label className="flex items-center gap-1.5">原图 <input type="file" accept="image/*" className="text-xs" onChange={(e) => e.target.files?.[0] && handleUpload("a", e.target.files[0])} /></label>
              <AssetPicker category="background" label="🗂️ 选原图" moduleType="spot_diff" onSelect={(url) => handleSelect("a", url)} />
              <label className="flex items-center gap-1.5">找不同图 <input type="file" accept="image/*" className="text-xs" onChange={(e) => e.target.files?.[0] && handleUpload("b", e.target.files[0])} /></label>
              <AssetPicker category="background" label="🗂️ 选找不同图" moduleType="spot_diff" onSelect={(url) => handleSelect("b", url)} />
            </div>
            <p className="text-xs text-muted-foreground">上传两张图后，在下面画布上点一下就标记一个差异点，点已有的标记可以移除。已标记 {hotspots.length} 个。</p>
            <canvas
              ref={canvasRef} width={SD_W} height={SD_H} onClick={handleCanvasClick}
              className="w-full h-auto rounded-lg bg-card cursor-crosshair border border-border"
            />
          </div>
        )}

        {moduleType === "focus_tap" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3 text-sm">
            <div className="flex gap-1.5">
              {(["grid", "custom"] as const).map((m) => (
                <button
                  key={m} type="button" onClick={() => setFtMode(m)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    ftMode === m ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                  }`}
                >
                  {m === "grid" ? "🔲 格子模式" : "🖼️ 自定义场景"}
                </button>
              ))}
            </div>

            {ftMode === "grid" ? (
              <div className="flex gap-3 flex-wrap items-center">
                <label className="flex items-center gap-1.5">格子大小
                  <select value={gridSize} onChange={(e) => setGridSize(+e.target.value)} className={MINI_SELECT_CLASS}>
                    <option value={3}>3×3</option><option value={4}>4×4</option>
                    <option value={5}>5×5</option><option value={6}>6×6</option>
                  </select>
                </label>
                <span className="text-xs text-muted-foreground">共 {gridSize * gridSize} 个数字，玩的时候每次都会重新随机分配位置</span>
              </div>
            ) : (
              <FocusTapCustomDesigner bgUrl={ftBgUrl} setBgUrl={setFtBgUrl} positions={ftPositions} setPositions={setFtPositions} />
            )}
          </div>
        )}

        {moduleType === "memory" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3 text-sm">
            <div className="flex gap-1.5">
              {(["preset", "custom"] as const).map((m) => (
                <button
                  key={m} type="button" onClick={() => setMemoryMode(m)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    memoryMode === m ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                  }`}
                >
                  {m === "preset" ? "🎨 主题图库" : "🖼️ 自定义图片"}
                </button>
              ))}
            </div>

            {memoryMode === "preset" ? (
              <div className="flex gap-3 flex-wrap items-center">
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
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <AssetPicker category="object" label="🧸 加一张配对图片" moduleType="memory" onSelect={(url) => setMemoryCustomIcons((arr) => [...arr, url])} />
                  <AssetPicker category="background" label="🗂️ 选背景图（选填）" moduleType="memory" onSelect={setMemoryBgUrl} />
                  {memoryBgUrl && <span className="text-xs text-emerald-600 dark:text-emerald-400">已选背景</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {memoryCustomIcons.map((url, i) => (
                    <div key={i} className="relative w-12 h-12 rounded border border-border bg-muted/30 flex items-center justify-center overflow-hidden">
                      <img src={url} alt="" className="max-w-full max-h-full object-contain" />
                      <button
                        type="button" onClick={() => setMemoryCustomIcons((arr) => arr.filter((_, idx) => idx !== i))}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center"
                      >✕</button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">已加 {memoryCustomIcons.length} 张图片，至少需要2张。每张图片会出现两次（配对），保存时配对数会自动等于图片数量。</p>
                <label className="flex items-center gap-1.5">预览秒数 <input type="number" min={1} max={10} value={previewSeconds} onChange={(e) => setPreviewSeconds(+e.target.value)} className={MINI_INPUT_CLASS} /></label>
              </>
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
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
            <div className="flex items-center gap-3 text-sm flex-wrap">
              <label className="flex items-center gap-1.5">背景图片
                <input type="file" accept="image/*" className="text-xs" onChange={(e) => e.target.files?.[0] && handleMazeBgUpload(e.target.files[0])} />
              </label>
              <AssetPicker category="background" label="🗂️ 从素材库选" moduleType="maze" onSelect={handleMazeBgSelect} />
              {mazeBgUrl && (
                <div className="flex gap-1.5">
                  {([["paint","🖌️ 画路径"],["erase","🧹 擦除"],["fill","🪣 填充"],["fillErase","🗑️ 删除颜色"],["start","🟠 设起点"],["end","🟢 设终点"]] as const).map(([key,label]) => (
                    <button
                      key={key} type="button" onClick={() => setMazeTool(key)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                        mazeTool === key ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button" onClick={undoMaze} disabled={mazeHistoryCount === 0}
                    className="px-2.5 py-1 rounded-md text-xs font-medium border bg-card border-border text-muted-foreground disabled:opacity-30"
                  >
                    ↩️ 撤销
                  </button>
                </div>
              )}
              {mazeBgUrl && (mazeTool === "paint" || mazeTool === "erase") && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">笔刷宽度
                  <input
                    type="range" min={2} max={50} value={mazeBrushWidth}
                    onChange={(e) => setMazeBrushWidth(+e.target.value)}
                    className="w-24"
                  />
                  <span className="w-6 text-right">{mazeBrushWidth}</span>
                </label>
              )}
            </div>
            {mazeBgUrl && (
              <>
                <p className="text-xs text-muted-foreground">
                  用"画路径"在图上涂出孩子能走的路（按住拖动，笔刷宽度可以调到很小方便画细的路），画错了"擦除"修正。"填充"点一下封闭区域整块填满；如果画布还没有边界、点填充会覆盖整张图——不小心点错了，直接点"↩️ 撤销"就能退回上一步。"删除颜色"是填充的反向操作，点一下能把连在一起的一整块颜色清掉。分别点"设起点"/"设终点"在图上点一下位置。
                  {mazeStart && mazeEnd ? " 起点终点都设好了 ✓" : " 起点/终点还没设。"}
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
          </div>
        )}

        {moduleType === "sudoku" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm">难度（标签用，不影响玩法）
              <select value={sudokuDifficulty} onChange={(e) => setSudokuDifficulty(e.target.value as "easy" | "medium" | "hard" | "custom")} className={MINI_SELECT_CLASS}>
                <option value="easy">😊 简单</option>
                <option value="medium">🙂 中等</option>
                <option value="hard">😤 困难</option>
                <option value="custom">🎯 自定义</option>
              </select>
            </label>
            <SudokuCellDesigner bgUrl={sudokuBgUrl} setBgUrl={setSudokuBgUrl} cells={sudokuCells} setCells={setSudokuCells} />
          </div>
        )}

        {moduleType === "line_match" && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={lineMatchShuffleRight} onChange={(e) => setLineMatchShuffleRight(e.target.checked)} />
              右栏顺序打乱（推荐开启，不然一眼就能看穿答案）
            </label>
            <div className="space-y-2">
              {lineMatchPairs.map((pair, i) => (
                <div key={i} className="flex items-start gap-2 bg-card rounded-lg border border-border p-2">
                  <span className="text-xs text-muted-foreground mt-2 w-5">{i + 1}.</span>
                  {(["left", "right"] as const).map((side) => (
                    <div key={side} className="flex-1 space-y-1">
                      <div className="flex gap-1">
                        <select
                          className="text-xs border rounded p-1"
                          value={pair[side].type}
                          onChange={(e) => setLineMatchPairs((ps) => ps.map((p, idx) => idx === i ? { ...p, [side]: { type: e.target.value as "text" | "image", content: "" } } : p))}
                        >
                          <option value="text">文字</option>
                          <option value="image">图片</option>
                        </select>
                        {side === "left" ? <span className="text-xs text-muted-foreground mt-1">左</span> : <span className="text-xs text-muted-foreground mt-1">右</span>}
                      </div>
                      {pair[side].type === "text" ? (
                        <Input
                          placeholder={side === "left" ? "如：狗" : "如：汪汪"} value={pair[side].content}
                          onChange={(e) => setLineMatchPairs((ps) => ps.map((p, idx) => idx === i ? { ...p, [side]: { ...p[side], content: e.target.value } } : p))}
                          className="h-8 text-sm"
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          {pair[side].content && <img src={pair[side].content} alt="" className="w-10 h-10 object-contain rounded border border-border" />}
                          <AssetPicker
                            category="object" label={pair[side].content ? "换一张" : "选图片"} moduleType="line_match"
                            onSelect={(url) => setLineMatchPairs((ps) => ps.map((p, idx) => idx === i ? { ...p, [side]: { ...p[side], content: url } } : p))}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    type="button" onClick={() => setLineMatchPairs((ps) => ps.filter((_, idx) => idx !== i))}
                    disabled={lineMatchPairs.length <= 1}
                    className="text-red-500 hover:text-red-600 text-xs mt-2 disabled:opacity-30"
                  >删除</button>
                </div>
              ))}
            </div>
            <Button
              type="button" size="sm" variant="outline"
              onClick={() => setLineMatchPairs((ps) => [...ps, { left: { type: "text", content: "" }, right: { type: "text", content: "" } }])}
            >+ 加一组配对</Button>
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
        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
          <Label>Activity 属性（选填）</Label>
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

          <div className="flex flex-wrap gap-2 items-end">
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

          <div>
            <Label className="text-xs">学习成果（选填）</Label>
            <Input placeholder="如：能够正确数出1到10之间的物体数量" value={learningOutcomes} onChange={(e) => setLearningOutcomes(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">培养能力（选填，顿号或逗号分隔，不限数量）</Label>
            <Input placeholder="如：数感、专注力、手眼协调" value={skillsInput} onChange={(e) => setSkillsInput(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">标签（选填，最多3个，顿号或逗号分隔）</Label>
            <Input placeholder="如：入门、森林、冬天" value={activityTagsInput} onChange={(e) => setActivityTagsInput(e.target.value)} />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
          <Label>提示栏（玩的时候显示，选填）</Label>
          <p className="text-xs text-muted-foreground">跟"讲解"不一样——这个是玩的过程中一直显示在上面的小提示，不是答完才看到。写一句简单的引导就好，比如"仔细看清楚每个角落哦"。</p>
          <Input placeholder="如：数一数的时候可以用手指点着数" value={hintText} onChange={(e) => setHintText(e.target.value)} />
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
          <Label>朗读音频（选填，预录上传，不是AI生成）</Label>
          <p className="text-xs text-muted-foreground">上传一段预先录好的语音（题目说明、引导语都可以），玩的时候学生能点"🔊 听题目"播放——给还不太会读字的孩子用。</p>
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

        <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
          <Label>讲解（答案演示，选填）</Label>
          <p className="text-xs text-muted-foreground">玩完之后学生可以点"查看讲解"看到这里写的内容——写一段解题思路，或者选一张示意图，都可以。</p>
          <textarea
            className="w-full border rounded-md p-2 text-sm min-h-[70px]"
            placeholder="如：数数的小技巧，可以把物体两两分组来数..."
            value={explanationText} onChange={(e) => setExplanationText(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <AssetPicker category="other" label="🗂️ 加一张讲解图" onSelect={setExplanationImageUrl} />
            {explanationImageUrl && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                已选图片 <button type="button" onClick={() => setExplanationImageUrl(null)} className="text-muted-foreground hover:text-red-500">✕</button>
              </span>
            )}
          </div>
          <div>
            <Label>讲解视频链接（选填，播放时会自动循环、可以暂停定格）</Label>
            <Input placeholder="https://..." value={explanationVideoUrl} onChange={(e) => setExplanationVideoUrl(e.target.value)} />
          </div>
        </div>
        </div>

        <Button className="w-full" onClick={handleSave}>保存</Button>
      </div>
    </Modal>
  );
}

// ── Main page: Activity 管理 — 全平台平铺表格，不再是"先选课程" ─────────────────
function SortHeader({ label, active, order, onClick }: { label: string; active: boolean; order: "asc"|"desc"; onClick: () => void }) {
  return (
    <th className="py-2.5 px-3 font-medium cursor-pointer select-none hover:text-foreground transition-colors" onClick={onClick}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-[10px] transition-opacity ${active ? "opacity-100" : "opacity-0"}`}>{order === "asc" ? "▲" : "▼"}</span>
      </span>
    </th>
  );
}

type SortKey = "programme" | "subject" | "topic" | "activity" | "exercise_number" | "created_at";

interface ActivityRow {
  id: string; course_id: string; module_type: string; title_i18n?: Record<string,string>;
  exercise_number?: string; created_at: string;
  course_title_i18n?: Record<string,string>;
  programme_id?: string; programme_name_zh?: string;
  subject_id?: string; subject_name_zh?: string;
  category_id?: string; topic_name_zh?: string;
}

export default function CourseDesignerPage() {
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });

  const [search, setSearch] = useState("");
  const [programmeId, setProgrammeId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const [programmes, setProgrammes] = useState<Array<{ id: string; name_zh: string }>>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; programme_id: string; name_zh: string }>>([]);
  const [topics, setTopics] = useState<Array<{ id: string; subject_id?: string; name_zh: string }>>([]);

  const [showLevelModal, setShowLevelModal] = useState(false);
  const [editingLevelId, setEditingLevelId] = useState<string | null>(null);

  function refresh() {
    eduApi.listAllActivities({
      search: search || undefined,
      programme_id: programmeId || undefined, subject_id: subjectId || undefined, category_id: categoryId || undefined,
      sort: sortKey, order: sortOrder, page, limit: PAGE_SIZE,
    }).then((r) => { setActivities(r.data); setMeta(r.meta); });
  }
  useEffect(refresh, [search, programmeId, subjectId, categoryId, sortKey, sortOrder, page]);
  // 筛选条件一变就跳回第1页——不然筛出来的结果如果比原本停留的页数少，
  // 会出现"明明有资料，画面却空白"的情况
  useEffect(() => { setPage(1); }, [search, programmeId, subjectId, categoryId]);

  // Programme→Subject→Topic 三层级联筛选，跟建 Activity 表单里那组是同一套
  // 逻辑，只是这里是拿来筛选列表，不是拿来决定新 Activity 的分类。
  useEffect(() => { taxonomyApi.listProgrammes().then((ps) => setProgrammes(ps.map((p) => ({ id: p.id, name_zh: p.name_zh })))); }, []);
  useEffect(() => {
    setSubjectId(""); setCategoryId("");
    if (programmeId) taxonomyApi.listSubjects(programmeId).then((ss) => setSubjects(ss.map((s) => ({ id: s.id, programme_id: s.programme_id, name_zh: s.name_zh }))));
    else setSubjects([]);
  }, [programmeId]);
  useEffect(() => {
    setCategoryId("");
    if (subjectId) exerciseClassificationApi.listCategories(subjectId).then((cs) => setTopics(cs.map((c) => ({ id: c.id, subject_id: c.subject_id, name_zh: c.name_zh }))));
    else setTopics([]);
  }, [subjectId]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortOrder("desc"); }
  }

  async function handleDeleteLevel(levelId: string) {
    if (!window.confirm("确定要删除这个 Activity 吗？这个操作没办法撤销。")) return;
    try {
      await eduApi.deleteLevel(levelId);
      toast.success("已删除");
      refresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "删除失败";
      toast.error(msg);
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Activity 设计管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">全平台 Activity，按 Programme / Subject / Topic 搜索、筛选、排序——课程与课时管理、Programme/Subject/Topic 本身的建立，都在各自独立的页面</p>
        </div>
        <Button size="sm" onClick={() => { setEditingLevelId(null); setShowLevelModal(true); }}>+ Add Activity</Button>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[240px]" />
          <div className="flex flex-wrap gap-2">
            <select className={`${SELECT_CLASS} w-auto`} value={programmeId} onChange={(e) => setProgrammeId(e.target.value)}>
              <option value="">全部 Programme</option>
              {programmes.map((p) => <option key={p.id} value={p.id}>{p.name_zh}</option>)}
            </select>
            <select className={`${SELECT_CLASS} w-auto`} value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!programmeId}>
              <option value="">全部 Subject</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name_zh}</option>)}
            </select>
            <select className={`${SELECT_CLASS} w-auto`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!subjectId}>
              <option value="">全部 Topic</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name_zh}</option>)}
            </select>
            {(programmeId || subjectId || categoryId || search) && (
              <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setProgrammeId(""); setSubjectId(""); setCategoryId(""); }}>清空筛选</Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {activities.length === 0 ? (
            <EmptyState title={search || programmeId ? "没有符合条件的 Activity" : "还没有 Activity"} description={search || programmeId ? "换个搜索词或筛选条件试试" : "点右上角 Add Activity 建第一个"} />
          ) : (
            <>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                      <th className="py-2.5 px-3 font-medium w-12">no</th>
                      <SortHeader label="programme" active={sortKey === "programme"} order={sortOrder} onClick={() => toggleSort("programme")} />
                      <SortHeader label="subject" active={sortKey === "subject"} order={sortOrder} onClick={() => toggleSort("subject")} />
                      <SortHeader label="topic" active={sortKey === "topic"} order={sortOrder} onClick={() => toggleSort("topic")} />
                      <SortHeader label="activity" active={sortKey === "activity"} order={sortOrder} onClick={() => toggleSort("activity")} />
                      <th className="py-2.5 px-3 font-medium">view</th>
                      <th className="py-2.5 px-3 font-medium">edit</th>
                      <th className="py-2.5 px-3 font-medium">delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activities.map((a, i) => (
                      <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 px-3 text-muted-foreground">{(meta.page - 1) * meta.limit + i + 1}</td>
                        <td className="px-3">{a.programme_name_zh ?? "—"}</td>
                        <td className="px-3">{a.subject_name_zh ?? "—"}</td>
                        <td className="px-3">{a.topic_name_zh ?? "—"}</td>
                        <td className="px-3 font-medium">
                          {a.title_i18n?.zh ?? a.title_i18n?.en ?? a.module_type}
                          {a.exercise_number && <span className="text-xs text-muted-foreground font-mono ml-2">{a.exercise_number}</span>}
                          <Badge variant="outline" className="ml-2">{MODULE_LABELS[a.module_type]?.emoji} {MODULE_LABELS[a.module_type]?.label ?? a.module_type}</Badge>
                          <span className="text-xs text-muted-foreground ml-2">({a.course_title_i18n?.zh ?? a.course_title_i18n?.en})</span>
                        </td>
                        <td className="px-3">
                          <a href={`/play/${a.id}`} target="_blank" rel="noreferrer" className="text-primary text-xs font-medium hover:underline">试玩</a>
                        </td>
                        <td className="px-3">
                          <button type="button" onClick={() => { setEditingLevelId(a.id); setShowLevelModal(true); }} className="text-muted-foreground text-xs font-medium hover:text-foreground hover:underline">编辑</button>
                        </td>
                        <td className="px-3">
                          <button type="button" onClick={() => handleDeleteLevel(a.id)} className="text-red-500 text-xs font-medium hover:text-red-600 hover:underline">删除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
        </CardContent>
      </Card>

      <AddLevelModal
        open={showLevelModal} onClose={() => { setShowLevelModal(false); setEditingLevelId(null); }}
        courseId={null} editingLevelId={editingLevelId}
        onSaved={refresh}
      />
    </div>
  );
}
