// frontend/src/pages/edu/AssetLibraryPage.tsx
//
// 素材库 — browse, upload, tag, and delete reusable images. Tags are a
// separate axis from category/module_type/language: those describe WHAT
// KIND of thing an asset is; tags describe a THEME that cuts across all of
// them ("森林", "生日", "冬天"), for finding things later by association
// rather than by classification.

import { useState, useEffect } from "react";
import { assetsApi } from "@/api/index";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

interface Asset { id: string; category: string; name?: string; width?: number; height?: number; created_at: string; tags: string[] }

const CATEGORY_LABELS: Record<string, string> = { background: "🖼️ 背景图", object: "🧸 物件图案", icon: "⭐ 图标", video: "🎬 视频", ppt: "📊 PPT", other: "📁 其他" };
const IMAGE_CATEGORIES = new Set(["background", "object", "icon", "other"]);
const ACCEPT_BY_CATEGORY: Record<string, string> = {
  video: "video/mp4,video/webm",
  ppt: ".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

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
// rather than a free-form tag-chip-adder, so it's obvious at a glance how
// many you can still add.
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
  const [file, setFile] = useState<File | null>(null);
  const [tags, setTags] = useState<string[]>([]);

  async function handleSave() {
    if (!file) { toast.error(category === "ppt" ? "请选一个PPT文件" : category === "video" ? "请选一个视频文件" : "请选一张图片"); return; }
    try {
      if (IMAGE_CATEGORIES.has(category)) {
        const { dataUrl, width, height } = await readAsDataURL(file);
        await assetsApi.createAsset({ category, name: name || undefined, file_data: dataUrl, width, height, tags: tags.filter(Boolean) });
      } else {
        // 视频、PPT不是图片，没办法用 new Image() 去量宽高（会直接
        // onerror 或永远卡在加载中）——直接读成 data URL 存进去，宽高
        // 栏位留空，反正这两类素材的网格预览用的是播放器/图标，不是
        // 靠宽高去撑版面。
        const dataUrl = await readFileAsDataURL(file);
        await assetsApi.createAsset({ category, name: name || undefined, file_data: dataUrl, tags: tags.filter(Boolean) });
      }
      toast.success("素材上传好了");
      setName(""); setFile(null); setTags([]);
      onSaved(); onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "上传失败";
      toast.error(msg);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="上传素材" size="sm">
      <div className="space-y-3">
        <div>
          <Label>分类</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={category} onChange={(e) => { setCategory(e.target.value); setFile(null); }}>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        <div><Label>名称（选填，方便之后搜索）</Label><Input placeholder="如：森林背景" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div>
          <Label>{category === "ppt" ? "PPT文件" : category === "video" ? "视频文件" : "图片文件"}</Label>
          <input type="file" accept={ACCEPT_BY_CATEGORY[category] ?? "image/*"} className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {category === "video" && <p className="text-xs text-muted-foreground mt-1">视频文件比较大，上限 100MB</p>}
        </div>
        <div><Label>标签（选填）</Label><TagInputs tags={tags} setTags={setTags} allTags={allTags} /></div>
        <Button className="w-full" onClick={handleSave}>上传</Button>
      </div>
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
  const [showUpload, setShowUpload] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  function refresh() {
    assetsApi.listAssets({ category: category || undefined, search: search || undefined, tag: tagFilter || undefined, page, limit: 24 })
      .then((r) => { setAssets(r.data); setMeta(r.meta); });
    assetsApi.listAllTags().then(setAllTags);
  }
  useEffect(refresh, [category, search, tagFilter, page]);
  // filters changing should reset back to page 1 — otherwise you can land
  // on "page 3" of a filtered set that only has 1 page and see nothing.
  useEffect(() => { setPage(1); }, [category, search, tagFilter]);

  useEffect(() => {
    assets.forEach((a) => {
      if (previews[a.id]) return;
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
            <Input placeholder="搜索名称..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[180px]" />
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
          </div>

          {assets.length === 0 ? (
            <EmptyState title={search || category || tagFilter ? "没有符合条件的素材" : "还没有素材"} description={search || category || tagFilter ? "换个搜索词、分类、或标签试试" : "点右上角上传第一个"} />
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 gap-3">
                {assets.map((a) => (
                  <div key={a.id} className="group relative rounded-lg border border-border overflow-hidden bg-muted/30">
                    <div className="aspect-square flex items-center justify-center bg-card p-1.5">
                      {previews[a.id] ? (
                        a.category === "video" ? (
                          <video src={previews[a.id]} className="max-w-full max-h-full" muted controls={false} />
                        ) : a.category === "ppt" ? (
                          <div className="flex flex-col items-center gap-1 text-muted-foreground">
                            <span className="text-3xl">📊</span>
                            <span className="text-[9px]">PPT</span>
                          </div>
                        ) : (
                          <img src={previews[a.id]} alt={a.name ?? ""} className="max-w-full max-h-full object-contain" />
                        )
                      ) : (
                        <span className="text-muted-foreground text-xs">加载中...</span>
                      )}
                    </div>
                    <div className="p-1.5 space-y-0.5">
                      <p className="text-xs font-medium truncate">{a.name ?? "未命名"}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{CATEGORY_LABELS[a.category] ?? a.category}</p>
                      {a.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {a.tags.slice(0, 2).map((t) => (
                            <button key={t} onClick={() => setTagFilter(t)} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20">
                              #{t}
                            </button>
                          ))}
                          {a.tags.length > 2 && <span className="text-[10px] text-muted-foreground px-0.5">+{a.tags.length - 2}</span>}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDelete(a.id)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {meta.totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-4 text-sm">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</Button>
                  <span className="text-muted-foreground">第 {meta.page} / {meta.totalPages} 页</span>
                  <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <UploadAssetModal open={showUpload} onClose={() => setShowUpload(false)} onSaved={refresh} allTags={allTags} />
    </div>
  );
}
