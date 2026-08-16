// frontend/src/components/AssetPicker.tsx
//
// Reusable "pick an image" widget for module designer forms. Three tabs:
// pick from the saved 素材库, upload a new file, or open the FULL scene
// editor right here (SceneEditor.tsx — same component the standalone
// 图片编辑工具 page uses). That third tab is what makes "every game module
// uses the same editor" literally true — wherever AssetPicker is already
// used (maze background, spot_diff's two images, focus_tap custom
// background), the full editor becomes available automatically, no
// per-module integration needed.
//
// 改动：
//   1) 之前"从素材库选"这个tab是一次性抓 limit:40、不分页、不能搜索——
//      素材库超过40个之后，剩下的那些永远选不到，这也是家长预览/编辑器
//      里看到的数量跟素材库页面本身对不上的原因。现在加了搜索框 +
//      "加载更多"（不是完整分页UI，picker弹窗里滚动加载更符合这个场景）。
//   2) 加了可选的 multiple 模式——库里选图从"点一下立刻选中关掉"改成
//      "点击勾选、累积、按确认才一次性传回去"；上传tab在多选模式下也
//      能一次选多个文件。不开多选的地方（背景图、maze/spot_diff这些）
//      行为完全不变，multiple默认false。

import { useState, useEffect } from "react";
import { assetsApi, assetChunkUploadApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input, Label, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import SceneEditor from "@/components/SceneEditor";
import { Music } from "lucide-react";
import toast from "react-hot-toast";

interface Asset { id: string; category: string; name?: string; created_at: string; slide_urls?: string[] }

const CATEGORY_LABELS: Record<string, string> = {
  background: "🖼️ 背景图", object: "🧸 物件图案", icon: "⭐ 图标", other: "📁 其他",
  video: "🎬 视频", ppt: "📊 PPT", audio: "🎵 音频",
};
// 图片以外的类别——不能用 <img> 预览、文件选择器 accept 也不一样、"编辑/
// 制作"那个画布工具对它们没有意义（画布是画图片的，不是剪视频/编PPT/
// 剪音频）
const NON_IMAGE_CATEGORIES = new Set(["video", "ppt", "audio"]);
const ACCEPT_BY_CATEGORY: Record<string, string> = {
  video: "video/*",
  ppt: ".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation",
  audio: "audio/*",
};
const PAGE_SIZE = 40;

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

// 视频走分片上传——之前这里跟图片/PPT一样，整个文件读成base64塞进一个
// HTTP请求发给createAsset，视频稍微大一点（比如173MB）转成base64会
// 膨胀到230MB+，这么大的请求体在到达Node后端之前就会被Nginx/Cloudflare
// Tunnel这层反向代理拒绝（代理默认的请求体大小限制通常远小于这个），
// 浏览器只会看到笼统的"CORS blocked / net::ERR_FAILED"，看不出真正
// 原因是文件太大——后端其实早就有分片上传的接口(assetChunkUploadApi)，
// 只是之前没有从这里接上，纯粹是"接线没接"的问题，不是没做过。
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB一片，后端单片上限是8MB，留一点余量

async function uploadVideoChunked(file: File, onProgress: (pct: number) => void): Promise<string> {
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const { uploadId } = await assetChunkUploadApi.init({
    fileName: file.name, fileSize: file.size, totalChunks, mimeType: file.type || "video/mp4",
  });
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = file.slice(start, start + CHUNK_SIZE);
    await assetChunkUploadApi.uploadChunk(uploadId, i, chunk);
    onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }
  const { url } = await assetChunkUploadApi.complete(uploadId);
  return url;
}

// 视频/PPT 不是图片，没有"宽高"这个概念，也不能拿去 new Image() 解码
// （会直接触发 onerror）——单独一个读法，只读成 dataURL，不量尺寸。
function readFileAsDataURLOnly(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

export default function AssetPicker({ category, label, moduleType, onSelect, multiple = false, onSelectMultiple, seedFromUrl, onSelectAsset }: {
  category: "background" | "object" | "icon" | "other" | "video" | "ppt" | "audio";
  label: string; // button text, e.g. "选背景图片"
  moduleType?: string; // pre-tags assets saved via the edit tab with this module (e.g. "maze")
  onSelect: (dataUrl: string) => void; // 单选模式用；multiple=true 时改用 onSelectMultiple
  /** 开启多选——素材库网格改成勾选累积，上传tab也能一次选多个文件。 */
  multiple?: boolean;
  /** multiple=true 时用这个把选好的一批URL一次性传回去（先勾选/多选文件，再按"添加"才触发）。 */
  onSelectMultiple?: (dataUrls: string[]) => void;
  /** "编辑/制作"这个tab打开时，先把这张图当背景加载进去，而不是空白画布——
   *  给"找不同之处"这种"第二张图要在第一张基础上改几处"的场景用，两张
   *  图的 AssetPicker 各自独立，这个只是第二张的起点，不是强制关联。 */
  seedFromUrl?: string;
  /** 选填——调用方需要拿到完整 asset 记录时用这个代替 onSelect（比如 PPT
   *  讲义需要 slide_urls 这个阵列，光一个 url 字符串不够）。传了这个的话，
   *  单选场景下改叫 onSelectAsset 而不叫 onSelect（multiple 模式不受影响，
   *  还是走 onSelectMultiple，多选批量场景目前没有"每张都要完整对象"的
   *  用例）。 */
  onSelectAsset?: (asset: { url: string; slideUrls?: string[]; name?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"library" | "upload" | "edit">("library");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploadName, setUploadName] = useState("");
  const [uploadTags, setUploadTags] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null); // 只有视频走分片上传时才有值，其他类型走原本的一次性上传，没有进度概念

  // 弹窗关掉时清空搜索/多选状态，下次打开是干净的
  useEffect(() => {
    if (!open) { setSearch(""); setSelectedIds(new Set()); }
  }, [open]);

  // 打开、切到"从素材库选"这个tab、或者搜索词变了——都从第1页重新抓
  useEffect(() => {
    if (!open || tab !== "library") return;
    setPage(1);
    assetsApi.listAssets({ category, limit: PAGE_SIZE, page: 1, search: search || undefined }).then((r) => {
      setAssets(r.data);
      setHasMore(r.data.length === PAGE_SIZE);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, category, search]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const r = await assetsApi.listAssets({ category, limit: PAGE_SIZE, page: nextPage, search: search || undefined });
      setAssets((prev) => [...prev, ...r.data]);
      setPage(nextPage);
      setHasMore(r.data.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    assets.forEach((a) => {
      if (previews[a.id]) return;
      assetsApi.getAsset(a.id).then((r) => {
        // PPT 用第一页幻灯片当缩略图（转换完成之前还没有，先退回原始文件
        // 网址——一份还没转换好的 pptx 直接当 <img> src 会显示不出来，
        // 是已知的降级，等转换跑完、缓存过期后重新打开选择器就会有缩略图了）
        const thumb = a.category === "ppt" ? (r.slide_urls?.[0] ?? r.file_data) : r.file_data;
        setPreviews((p) => ({ ...p, [a.id]: thumb }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handlePick(id: string) {
    if (multiple) { toggleSelect(id); return; }
    if (onSelectAsset) {
      const full = await assetsApi.getAsset(id);
      onSelectAsset({ url: full.file_data, slideUrls: full.slide_urls ?? undefined, name: full.name });
      setOpen(false);
      return;
    }
    const dataUrl = previews[id];
    if (!dataUrl) return;
    onSelect(dataUrl);
    setOpen(false);
  }

  function confirmMultiSelection() {
    const urls = Array.from(selectedIds).map((id) => previews[id]).filter((u): u is string => !!u);
    if (urls.length === 0) { toast.error("先选至少一张图片"); return; }
    onSelectMultiple?.(urls);
    setSelectedIds(new Set());
    setOpen(false);
  }

  async function handleUploadAndUse() {
    if (uploadProgress !== null) return; // 正在上传中，避免重复点击触发第二次上传
    if (uploadFiles.length === 0) { toast.error(multiple ? "请选至少一张图片" : "请选一个文件"); return; }
    const tags = uploadTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 3);
    const isNonImage = NON_IMAGE_CATEGORIES.has(category);

    // 单文件（或者没开多选）——原本的行为，不变；video/ppt 一定走这条，
    // 这两类目前不支持批量多选上传。
    if (!multiple || uploadFiles.length === 1) {
      try {
        let res;
        if (category === "video") {
          // 视频走分片上传——见 uploadVideoChunked 上面的说明。上传完成后
          // 拿到的是一个真实URL（不是data:开头的base64），createAsset那边
          // 已经能识别"已经是URL了，原样存，不重复处理"这种情况。
          setUploadProgress(0);
          const url = await uploadVideoChunked(uploadFiles[0], setUploadProgress);
          res = await assetsApi.createAsset({ category, name: uploadName || undefined, file_data: url, width: 0, height: 0, module_type: moduleType, tags });
          setUploadProgress(null);
        } else if (isNonImage) {
          const dataUrl = await readFileAsDataURLOnly(uploadFiles[0]);
          res = await assetsApi.createAsset({ category, name: uploadName || undefined, file_data: dataUrl, width: 0, height: 0, module_type: moduleType, tags });
        } else {
          const { dataUrl, width, height } = await readAsDataURL(uploadFiles[0]);
          res = await assetsApi.createAsset({ category, name: uploadName || undefined, file_data: dataUrl, width, height, module_type: moduleType, tags });
        }
        // 用后端刚存好的那个网址，不要用本地读到的原始base64——不然素材库
        // 里明明已经是文件存在磁盘上了，这个习题自己的设定却又把整张图
        // 塞了一次，等于同一张图片存了两份。
        const finalUrl = res.data.data.file_data;
        if (onSelectAsset) {
          // PPT 需要转好的幻灯片图片阵列，不是上传接口马上就有——转换可能
          // 要几秒，重新查一次这个 asset，查到就用，查不到就先给个空阵列，
          // 提醒用户等一下再重新打开选择器挑一次（不在这里做轮询，避免
          // 弹窗还开着的时候卡住等不确定时长的转换）。
          const fresh = await assetsApi.getAsset(res.data.data.id);
          onSelectAsset({ url: finalUrl, slideUrls: fresh.slide_urls ?? undefined, name: fresh.name });
          if (category === "ppt" && !fresh.slide_urls?.length) {
            toast("PPT已上传，正在转换幻灯片——转换完之后从「从素材库选」里重新选一次这个文件就有了", { icon: "⏳" });
          }
        } else if (multiple) {
          onSelectMultiple?.([finalUrl]);
        } else {
          onSelect(finalUrl);
        }
        toast.success("素材已上传并保存到素材库");
        setUploadName(""); setUploadTags(""); setUploadFiles([]);
        setOpen(false);
      } catch (err: unknown) {
        setUploadProgress(null);
        const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "上传失败";
        toast.error(msg);
      }
      return;
    }

    // 多文件批量上传——一张失败不影响其他张，失败的留着方便重试。
    // 名称统一用各自的文件名（去掉副档名），跟素材库页面的批量上传是同一个规则。
    const uploadedUrls: string[] = [];
    const failed: File[] = [];
    for (const f of uploadFiles) {
      try {
        const { dataUrl, width, height } = await readAsDataURL(f);
        const autoName = f.name.replace(/\.[^.]+$/, "");
        const res = await assetsApi.createAsset({ category, name: autoName, file_data: dataUrl, width, height, module_type: moduleType, tags });
        uploadedUrls.push(res.data.data.file_data);
      } catch {
        failed.push(f);
      }
    }
    if (uploadedUrls.length > 0) onSelectMultiple?.(uploadedUrls);

    if (failed.length === 0) {
      toast.success(`${uploadFiles.length} 张都上传好了`);
      setUploadName(""); setUploadTags(""); setUploadFiles([]);
      setOpen(false);
    } else {
      toast.error(`${uploadedUrls.length} 张成功，${failed.length} 张失败——已保留在列表里，可以直接重试`);
      setUploadFiles(failed);
    }
  }

  function handleEdited(dataUrl: string) {
    if (multiple) { onSelectMultiple?.([dataUrl]); } else { onSelect(dataUrl); }
    setOpen(false);
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(true); setTab("library"); }}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={label} size={tab === "edit" ? "full" : "md"} modal={false}>
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {([["library", "从素材库选"], ["upload", "上传新文件"], ["edit", "🎨 编辑/制作"]] as const)
              .filter(([key]) => key !== "edit" || !NON_IMAGE_CATEGORIES.has(category))
              .map(([key, l]) => (
              <button
                key={key} type="button" onClick={() => setTab(key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  tab === key ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {tab === "library" && (
            <div className="space-y-2">
              <Input placeholder="搜索名称..." value={search} onChange={(e) => setSearch(e.target.value)} />

              {assets.length === 0 ? (
                <EmptyState title={`还没有${CATEGORY_LABELS[category] ?? "素材"}`} description="切到「上传新文件」或「编辑/制作」加第一个" />
              ) : (
                <>
                  <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2 max-h-80 overflow-y-auto">
                    {assets.map((a) => {
                      const picked = multiple && selectedIds.has(a.id);
                      return (
                        <button
                          key={a.id} type="button" onClick={() => handlePick(a.id)}
                          className={`relative aspect-square rounded-lg border overflow-hidden bg-muted/30 transition-colors flex flex-col items-center justify-center p-1 ${
                            picked ? "border-primary border-2 ring-2 ring-primary/30" : "border-border hover:border-primary"
                          }`}
                        >
                          {category === "audio" ? (
                            <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground">
                              <Music className="w-6 h-6" />
                            </div>
                          ) : previews[a.id] ? (
                            category === "video" ? (
                              <video src={previews[a.id]} muted preload="metadata" className="max-w-full max-h-full object-contain" />
                            ) : (
                              <img src={previews[a.id]} alt={a.name ?? ""} className="max-w-full max-h-full object-contain" />
                            )
                          ) : null}
                          {(category === "ppt" || category === "audio") && a.name && (
                            <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] px-1 py-0.5 truncate">{a.name}</span>
                          )}
                          {picked && (
                            <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary text-white text-[10px] flex items-center justify-center">✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {hasMore && (
                    <div className="text-center">
                      <Button type="button" size="sm" variant="outline" onClick={loadMore} disabled={loadingMore}>
                        {loadingMore ? "加载中..." : "加载更多"}
                      </Button>
                    </div>
                  )}
                </>
              )}

              {multiple && (
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground">已选 {selectedIds.size} 张</span>
                  <Button type="button" size="sm" onClick={confirmMultiSelection} disabled={selectedIds.size === 0}>
                    添加选中的 {selectedIds.size} 张
                  </Button>
                </div>
              )}
            </div>
          )}

          {tab === "upload" && (
            <div className="space-y-3">
              <div>
                <Label>名称{multiple && uploadFiles.length > 1 ? "（多选时会自动用各自文件名，这栏不生效）" : "（选填）"}</Label>
                <Input placeholder="如：森林背景" value={uploadName} onChange={(e) => setUploadName(e.target.value)} disabled={multiple && uploadFiles.length > 1} />
              </div>
              <div><Label>标签（选填，最多3个，逗号分隔）</Label><Input placeholder="如：森林,冬天" value={uploadTags} onChange={(e) => setUploadTags(e.target.value)} /></div>
              <div>
                <Label>{category === "video" ? "视频文件" : category === "ppt" ? "PPT文件" : category === "audio" ? "音频文件" : "图片文件"}{multiple ? "（可以一次多选）" : ""}</Label>
                <input
                  type="file" accept={ACCEPT_BY_CATEGORY[category] ?? "image/*"} multiple={multiple} className="text-sm"
                  onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []))}
                />
                {multiple && uploadFiles.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-28 overflow-y-auto">
                    {uploadFiles.map((f, i) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-muted rounded px-2 py-1">
                        <span className="truncate">{f.name}</span>
                        <button type="button" onClick={() => setUploadFiles((fs) => fs.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive ml-2 shrink-0">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {uploadProgress !== null && (
                <div className="space-y-1">
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground text-center">上传中… {uploadProgress}%（视频较大，请耐心等待，不要关闭这个窗口）</p>
                </div>
              )}
              <Button className="w-full" onClick={handleUploadAndUse} disabled={uploadProgress !== null}>
                {uploadProgress !== null ? `上传中… ${uploadProgress}%` : multiple && uploadFiles.length > 1 ? `上传并使用 ${uploadFiles.length} 张` : "上传并使用"}
              </Button>
            </div>
          )}

          {tab === "edit" && (
            <SceneEditor
              presetCategory={category} presetModuleType={moduleType} onSaved={handleEdited}
              initial={seedFromUrl ? { bgUrl: seedFromUrl, objects: [], texts: [] } : undefined}
            />
          )}
        </div>
      </Modal>
    </>
  );
}

