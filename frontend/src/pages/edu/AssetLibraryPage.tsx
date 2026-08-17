// frontend/src/pages/edu/AssetLibraryPage.tsx
//
// 改成表格布局，符合项目规范：filter + search + sort + paging + record数量，
// 都用表格而不是卡片网格；新增/编辑走Modal，不整页滚动。
// 上传逻辑（含视频分片上传、PPT自动转幻灯片）完全不变，只是列表和筛选区
// 从网格卡片换成表格。

import { useState, useEffect } from "react";
import { assetsApi, eduApi } from "@/api/index";
import { useChunkedUpload } from "@/hooks/useChunkedUpload";
import { CollaboraViewer } from "@/components/CollaboraViewer";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import { ChevronUp, ChevronDown, Eye, Pencil, Trash2, Search } from "lucide-react";
import toast from "react-hot-toast";

interface Asset {
  id: string; category: string; name?: string; width?: number; height?: number; created_at: string; tags: string[];
  grade_tier_code?: string; usage_contexts?: string[]; parent_preview_enabled?: boolean;
}

interface GradeTier { id: string; code: string; name_i18n?: { zh?: string; en?: string } }

const CATEGORY_LABELS: Record<string, string> = { background: "🖼️ 背景图", object: "🧸 物件图案", icon: "⭐ 图标", video: "🎬 视频", ppt: "📊 PPT", ppt_interactive: "🎞️ PPT（真实动画版）", other: "📁 其他" };
const IMAGE_CATEGORIES = new Set(["background", "object", "icon", "other"]);
const ACCEPT_BY_CATEGORY: Record<string, string> = {
  video: "video/mp4,video/webm",
  ppt: ".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt_interactive: ".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

type SortKey = "name" | "category" | "created_at";

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function readAsDataURL(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const dataUrl = fr.result as string;
      const img = new Image();
      img.onload = () => resolve({ dataUrl, width: img.width, height: img.height });
      img.onerror = reject;
      img.src = dataUrl;
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// Simple 3-slot tag input — matches "每个素材3个可自定义标签" literally
function TagInputs({ tags, setTags, allTags }: { tags: string[]; setTags: (t: string[]) => void; allTags: string[] }) {
  function updateTag(i: number, val: string) {
    const next = [...tags]; next[i] = val.slice(0, 20);
    setTags(next);
  }
  const slots = [tags[0] ?? "", tags[1] ?? "", tags[2] ?? ""];
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        {slots.map((val, i) => (
          <Input key={i} placeholder={`标签${i + 1}`} value={val} onChange={(e) => updateTag(i, e.target.value)} list="asset-tag-suggestions" />
        ))}
      </div>
      <datalist id="asset-tag-suggestions">
        {allTags.map((t) => <option key={t} value={t} />)}
      </datalist>
      <p className="text-xs text-muted-foreground">最多3个，方便之后用主题搜索（比如"森林""生日""冬天"），不是分类。</p>
    </div>
  );
}

function UploadAssetModal({ open, onClose, onSaved, allTags }: { open: boolean; onClose: () => void; onSaved: () => void; allTags: string[] }) {
  const [category, setCategory] = useState("background");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const { uploadFile, progress, isUploading, error: chunkError } = useChunkedUpload();

  // 只有图片类分类才允许一次选多张——视频走分片上传、PPT要转幻灯片，
  // 这两种一次只处理一个文件，逻辑复杂很多，不在这次多选范围内。
  const isImageCategory = IMAGE_CATEGORIES.has(category);
  const busy = isUploading || batchProgress !== null;

  function resetForm() {
    setName(""); setFiles([]); setTags([]); setBatchProgress(null);
  }

  function removeFile(idx: number) {
    setFiles((fs) => fs.filter((_, i) => i !== idx));
  }

  async function uploadOne(file: File, nameOverride?: string) {
    const finalName = nameOverride ?? (name || undefined);
    if (category === "video" || category === "ppt" || category === "ppt_interactive") {
      // 视频/PPT(不管普通版还是真实动画版)都走分片上传——之前这里只有
      // video走了chunked upload，ppt走的是readFileAsDataURL整个转base64
      // 塞一个请求，跟"课时/Activity那边PPT传不上去"是完全一样的体量
      // 限制问题，只是这里是素材库自己独立的一套上传逻辑，之前修的时候
      // 没覆盖到这条路径，这次一起修掉。ppt_interactive不需要后端做
      // 幻灯片转换(保留原始文件给Collabora真实渲染用)，跟普通ppt共用
      // 同一条上传路径完全没问题，区别只在后端createAsset怎么处理这个
      // category，前端上传这一步是一样的。
      const result = await uploadFile(file);
      if (!result) throw new Error(chunkError || "上传失败");
      await assetsApi.createAsset({ category, name: finalName, file_data: result.url, tags: tags.filter(Boolean) });
    } else if (isImageCategory) {
      const { dataUrl, width, height } = await readAsDataURL(file);
      await assetsApi.createAsset({ category, name: finalName, file_data: dataUrl, width, height, tags: tags.filter(Boolean) });
    } else {
      const dataUrl = await readFileAsDataURL(file);
      await assetsApi.createAsset({ category, name: finalName, file_data: dataUrl, tags: tags.filter(Boolean) });
    }
  }

  async function handleSave() {
    if (files.length === 0) { toast.error(category === "ppt" || category === "ppt_interactive" ? "请选一个PPT文件" : category === "video" ? "请选一个视频文件" : "请选至少一张图片"); return; }

    // 单文件（或者非图片分类）——跟原本的行为完全一样
    if (!isImageCategory || files.length === 1) {
      try {
        await uploadOne(files[0]);
        toast.success("素材上传好了");
        resetForm();
        onSaved(); onClose();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "上传失败";
        toast.error(msg);
      }
      return;
    }

    // 多图批量上传——一张一张传，某一张失败不影响其他张；失败的留在列表
    // 里，用户可以直接点"上传"重试，不用重新选一遍全部文件。名称统一
    // 用各自的文件名（去掉副档名），共用同一批标签。
    setBatchProgress({ done: 0, total: files.length });
    const failed: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        await uploadOne(f, f.name.replace(/\.[^.]+$/, ""));
      } catch {
        failed.push(f);
      }
      setBatchProgress({ done: i + 1, total: files.length });
    }
    setBatchProgress(null);
    onSaved(); // 不管有没有全部成功，已经传上去的先刷新出来

    if (failed.length === 0) {
      toast.success(`${files.length} 张图片都上传好了`);
      resetForm();
      onClose();
    } else {
      toast.error(`${files.length - failed.length} 张成功，${failed.length} 张失败——已保留在列表里，可以直接重试`);
      setFiles(failed);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="上传素材" size="sm">
      <div className="space-y-3">
        <div>
          <Label>分类</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={category} onChange={(e) => { setCategory(e.target.value); setFiles([]); }} disabled={busy}>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        <div>
          <Label>名称{isImageCategory && files.length > 1 ? "（多选时会自动用各自的文件名，这栏不生效）" : "（选填，方便之后搜索）"}</Label>
          <Input placeholder="如：森林背景" value={name} onChange={(e) => setName(e.target.value)} disabled={busy || (isImageCategory && files.length > 1)} />
        </div>
        <div>
          <Label>{category === "ppt" ? "PPT文件" : category === "ppt_interactive" ? "PPT文件（会保留原始动画）" : category === "video" ? "视频文件" : "图片文件（可以一次多选）"}</Label>
          <input
            type="file"
            multiple={isImageCategory}
            accept={ACCEPT_BY_CATEGORY[category] ?? "image/*"}
            className="text-sm"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            disabled={busy}
          />
          {(category === "video" || category === "ppt" || category === "ppt_interactive") && <p className="text-xs text-muted-foreground mt-1">采用分片上传，支持较大文件</p>}

          {files.length > 0 && (
            <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs bg-muted rounded px-2 py-1">
                  <span className="truncate">{f.name}</span>
                  <button type="button" onClick={() => removeFile(i)} disabled={busy} className="text-muted-foreground hover:text-destructive ml-2 shrink-0">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div><Label>标签（选填{isImageCategory && files.length > 1 ? "，会套用到这一批所有图片" : ""}）</Label><TagInputs tags={tags} setTags={setTags} allTags={allTags} /></div>

        {isUploading && progress && (
          <div className="space-y-1">
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              上传中... {progress.uploadedChunks}/{progress.totalChunks} 片（{progress.percent}%）
            </p>
          </div>
        )}
        {batchProgress && (
          <div className="space-y-1">
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${Math.round((batchProgress.done / batchProgress.total) * 100)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">正在上传... {batchProgress.done} / {batchProgress.total} 张</p>
          </div>
        )}

        <Button className="w-full" onClick={handleSave} disabled={busy}>
          {busy ? "上传中..." : files.length > 1 ? `上传 ${files.length} 张图片` : "上传"}
        </Button>
      </div>
    </Modal>
  );
}

const USAGE_CONTEXT_LABELS: Record<string, string> = {
  in_person: "实体课", self_guided: "Self-Guided Learning", public_course: "公开课",
};

// 编辑已上传素材——名称/标签/等级/使用场景/家长预览这几个"标注类"栏位，
// 不改文件本身（换文件本质是删掉重传，见 assets.controller.ts#updateAsset
// 的注释）。打开时重新 getAsset 一次，拿到 file_data 之外的完整栏位。
function EditAssetModal({ assetId, open, onClose, onSaved, allTags, gradeTiers }: {
  assetId: string | null; open: boolean; onClose: () => void; onSaved: () => void;
  allTags: string[]; gradeTiers: GradeTier[];
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [gradeTierId, setGradeTierId] = useState("");
  const [usageContexts, setUsageContexts] = useState<string[]>([]);
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [previewSeconds, setPreviewSeconds] = useState("");

  useEffect(() => {
    if (!open || !assetId) return;
    setLoading(true);
    assetsApi.getAsset(assetId)
      .then((a) => {
        setCategory(a.category);
        setName(a.name ?? "");
        setTags(a.tags ?? []);
        setGradeTierId(a.grade_tier_id ?? "");
        setUsageContexts(a.usage_contexts ?? []);
        setPreviewEnabled(a.parent_preview_enabled ?? false);
        setPreviewSeconds(a.parent_preview_seconds ? String(a.parent_preview_seconds) : "");
      })
      .catch(() => toast.error("加载素材详情失败"))
      .finally(() => setLoading(false));
  }, [open, assetId]);

  function toggleUsageContext(ctx: string) {
    setUsageContexts((prev) => (prev.includes(ctx) ? prev.filter((c) => c !== ctx) : [...prev, ctx]));
  }

  async function handleSave() {
    if (!assetId) return;
    setSaving(true);
    try {
      await assetsApi.updateAsset(assetId, {
        name: name || undefined,
        tags: tags.filter(Boolean),
        grade_tier_id: gradeTierId || undefined,
        usage_contexts: usageContexts,
        parent_preview_enabled: previewEnabled,
        // 只有视频才让秒数生效；不是视频的话即使填了数字也不送，后端也会
        // 忽略（见 updateAsset 里 category !== "video" 的判断）
        parent_preview_seconds: category === "video"
          ? (previewSeconds.trim() ? Number(previewSeconds) : null)
          : undefined,
      });
      toast.success("已保存");
      onSaved(); onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "保存失败";
      toast.error(msg);
    } finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="编辑素材" size="sm">
      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">加载中...</p>
      ) : (
        <div className="space-y-3">
          <div><Label>名称</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：森林背景" /></div>
          <div><Label>标签</Label><TagInputs tags={tags} setTags={setTags} allTags={allTags} /></div>

          <div>
            <Label>等级</Label>
            <select className="w-full border rounded-md p-2 text-sm" value={gradeTierId} onChange={(e) => setGradeTierId(e.target.value)}>
              <option value="">不限等级</option>
              {gradeTiers.map((g) => <option key={g.id} value={g.id}>{g.name_i18n?.zh ?? g.name_i18n?.en ?? g.code}</option>)}
            </select>
          </div>

          <div>
            <Label>使用场景（可多选）</Label>
            <div className="flex flex-wrap gap-3 mt-1.5">
              {Object.entries(USAGE_CONTEXT_LABELS).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={usageContexts.includes(key)} onChange={() => toggleUsageContext(key)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={previewEnabled} onChange={(e) => setPreviewEnabled(e.target.checked)} />
              开放给家长预览
            </label>
            {category === "video" && previewEnabled && (
              <div className="mt-2">
                <Label>预览秒数上限（选填，不填=完整播放不截断）</Label>
                <Input type="number" min={1} placeholder="例如 30" value={previewSeconds} onChange={(e) => setPreviewSeconds(e.target.value)} />
              </div>
            )}
          </div>

          <Button className="w-full" onClick={handleSave} disabled={saving}>{saving ? "保存中..." : "保存"}</Button>
        </div>
      )}
    </Modal>
  );
}

export default function AssetLibraryPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 24, total: 0, totalPages: 1 });
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortKey>("created_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [showUpload, setShowUpload] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [viewingInteractiveId, setViewingInteractiveId] = useState<string | null>(null); // ppt_interactive"查看"点开的是本页面内弹窗，不是新页面
  const [gradeTiers, setGradeTiers] = useState<GradeTier[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => { eduApi.listGradeTiers().then(setGradeTiers).catch(() => {}); }, []);

  function refresh() {
    assetsApi.listAssets({ category: category || undefined, search: search || undefined, tag: tagFilter || undefined, sort, order, page, limit: 24 })
      .then((r) => { setAssets(r.data); setMeta(r.meta); });
    assetsApi.listAllTags().then(setAllTags);
  }
  useEffect(refresh, [category, search, tagFilter, sort, order, page]);
  useEffect(() => { setPage(1); }, [category, search, tagFilter, sort, order]);

  useEffect(() => {
    assets.forEach((a) => {
      if (previews[a.id]) return;
      if (a.category === "ppt" || a.category === "ppt_interactive") return; // PPT没有靠得住的缩略图数据，表格里不用抓
      assetsApi.getAsset(a.id).then((r) => setPreviews((p) => ({ ...p, [a.id]: r.file_data })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  async function handleDelete(id: string) {
    try {
      await assetsApi.deleteAsset(id);
      toast.success("已删除");
      refresh();
    } catch {
      toast.error("删除失败（可能不是你上传的）");
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">素材库</h1>
        <p className="text-sm text-muted-foreground mt-0.5">上传一次，之后重复选用——背景图、物件图案、视频、PPT 都存在这里</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>素材（共 {meta.total} 个）</CardTitle>
          <Button size="sm" onClick={() => setShowUpload(true)}>+ 上传素材</Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="relative max-w-[180px]">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input placeholder="搜索名称..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
            <select className="border rounded-md p-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">全部分类</option>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <select className="border rounded-md p-2 text-sm" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
              <option value="">全部标签</option>
              {allTags.map((t) => <option key={t} value={t}>#{t}</option>)}
            </select>
            {(search || category || tagFilter) && (
              <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setCategory(""); setTagFilter(""); }}>清空筛选</Button>
            )}
            <div className="flex items-center gap-1 ml-auto">
              <select className="border rounded-md p-2 text-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="created_at">按上传时间</option>
                <option value="name">按名称</option>
                <option value="category">按分类</option>
              </select>
              <button
                onClick={() => setOrder((o) => (o === "asc" ? "desc" : "asc"))}
                title={order === "asc" ? "升序" : "降序"}
                className="border rounded-md p-2 text-muted-foreground hover:text-foreground"
              >
                {order === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
          </div>

          {assets.length === 0 ? (
            <EmptyState title={search || category || tagFilter ? "没有符合条件的素材" : "还没有素材"} description={search || category || tagFilter ? "换个搜索词、分类、或标签试试" : "点右上角上传第一个"} />
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-4">
                {assets.map((a) => (
                  <div key={a.id} className="group relative">
                    <div className="w-full aspect-square rounded-xl bg-muted overflow-hidden relative">
                      {a.category === "ppt" ? (
                        <div className="w-full h-full flex items-center justify-center text-4xl">📊</div>
                      ) : a.category === "ppt_interactive" ? (
                        <div className="w-full h-full flex items-center justify-center text-4xl">🎞️</div>
                      ) : a.category === "video" ? (
                        previews[a.id]
                          ? <video src={previews[a.id]} className="w-full h-full object-contain" muted />
                          : <div className="w-full h-full flex items-center justify-center text-4xl">🎬</div>
                      ) : previews[a.id] ? (
                        <img src={previews[a.id]} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">...</div>
                      )}

                      {/* 左上角小徽章：等级 + 是否已开放家长预览 */}
                      {(a.grade_tier_code || a.parent_preview_enabled) && (
                        <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
                          {a.grade_tier_code && (
                            <span className="text-[10px] bg-black/50 text-white px-1.5 py-0.5 rounded-full">{a.grade_tier_code}</span>
                          )}
                          {a.parent_preview_enabled && <span title="已开放给家长预览" className="text-xs">👀</span>}
                        </div>
                      )}

                      {/* 悬浮操作层——鼠标移过去才出现，跟播放器悬浮控件同一个手法 */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        {(a.category === "video" || a.category === "ppt") && (
                          <a
                            href={a.category === "video" ? `/view/video?assetId=${a.id}` : `/view/ppt?assetId=${a.id}`}
                            target="_blank" rel="noreferrer" title="查看"
                            className="w-8 h-8 rounded-full bg-white/90 text-foreground flex items-center justify-center hover:bg-white"
                          >
                            <Eye size={15} />
                          </a>
                        )}
                        {a.category === "ppt_interactive" && (
                          <button
                            onClick={() => setViewingInteractiveId(a.id)} title="查看（真实动画）"
                            className="w-8 h-8 rounded-full bg-white/90 text-foreground flex items-center justify-center hover:bg-white"
                          >
                            <Eye size={15} />
                          </button>
                        )}
                        <button onClick={() => setEditingAssetId(a.id)} title="编辑" className="w-8 h-8 rounded-full bg-white/90 text-foreground flex items-center justify-center hover:bg-white">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => handleDelete(a.id)} title="删除" className="w-8 h-8 rounded-full bg-white/90 text-destructive flex items-center justify-center hover:bg-white">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs font-medium mt-1.5 truncate" title={a.name ?? "未命名"}>{a.name ?? "未命名"}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{CATEGORY_LABELS[a.category] ?? a.category}</Badge>
                      {a.tags[0] && (
                        <button onClick={() => setTagFilter(a.tags[0])} className="text-[10px] text-primary hover:underline truncate">#{a.tags[0]}</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between mt-6 text-sm">
                <span className="text-muted-foreground text-xs">Number of Records: {meta.total}，第 {meta.page} / {meta.totalPages} 页</span>
                <div className="flex items-center gap-3">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</Button>
                  <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <UploadAssetModal open={showUpload} onClose={() => setShowUpload(false)} onSaved={refresh} allTags={allTags} />
      <EditAssetModal
        assetId={editingAssetId}
        open={editingAssetId !== null}
        onClose={() => setEditingAssetId(null)}
        onSaved={refresh}
        allTags={allTags}
        gradeTiers={gradeTiers}
      />
      <Modal open={viewingInteractiveId !== null} onClose={() => setViewingInteractiveId(null)} title="PPT（真实动画版）" size="lg">
        {viewingInteractiveId && <CollaboraViewer assetId={viewingInteractiveId} />}
      </Modal>
    </div>
  );
}
