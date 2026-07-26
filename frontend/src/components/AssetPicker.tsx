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

import { useState, useEffect } from "react";
import { assetsApi } from "@/api/index";
import { Button } from "@/components/ui/button";
import { Input, Label, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import SceneEditor from "@/components/SceneEditor";
import toast from "react-hot-toast";

interface Asset { id: string; category: string; name?: string; created_at: string }

const CATEGORY_LABELS: Record<string, string> = { background: "🖼️ 背景图", object: "🧸 物件图案", icon: "⭐ 图标", other: "📁 其他" };

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

export default function AssetPicker({ category, label, moduleType, onSelect }: {
  category: "background" | "object" | "icon" | "other";
  label: string; // button text, e.g. "选背景图片"
  moduleType?: string; // pre-tags assets saved via the edit tab with this module (e.g. "maze")
  onSelect: (dataUrl: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"library" | "upload" | "edit">("library");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [uploadName, setUploadName] = useState("");
  const [uploadTags, setUploadTags] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open || tab !== "library") return;
    assetsApi.listAssets({ category, limit: 40 }).then((r) => setAssets(r.data));
  }, [open, tab, category]);

  useEffect(() => {
    assets.forEach((a) => {
      if (previews[a.id]) return;
      assetsApi.getAsset(a.id).then((r) => setPreviews((p) => ({ ...p, [a.id]: r.file_data })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  function handlePick(id: string) {
    const dataUrl = previews[id];
    if (!dataUrl) return;
    onSelect(dataUrl);
    setOpen(false);
  }

  async function handleUploadAndUse() {
    if (!uploadFile) { toast.error("请选一张图片"); return; }
    try {
      const { dataUrl, width, height } = await readAsDataURL(uploadFile);
      const tags = uploadTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 3);
      const res = await assetsApi.createAsset({ category, name: uploadName || undefined, file_data: dataUrl, width, height, module_type: moduleType, tags });
      // 用后端刚存好的那个网址，不要用本地读到的原始base64——不然素材库
      // 里明明已经是文件存在磁盘上了，这个习题自己的设定却又把整张图
      // 塞了一次，等于同一张图片存了两份。
      onSelect(res.data.data.file_data);
      toast.success("素材已上传并保存到素材库");
      setUploadName(""); setUploadTags(""); setUploadFile(null);
      setOpen(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "上传失败";
      toast.error(msg);
    }
  }

  function handleEdited(dataUrl: string) {
    onSelect(dataUrl);
    setOpen(false);
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(true); setTab("library"); }}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={label} size={tab === "edit" ? "full" : "md"}>
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {([["library", "从素材库选"], ["upload", "上传新图片"], ["edit", "🎨 编辑/制作"]] as const).map(([key, l]) => (
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
            assets.length === 0 ? (
              <EmptyState title={`还没有${CATEGORY_LABELS[category] ?? "素材"}`} description="切到「上传新图片」或「编辑/制作」加第一个" />
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2 max-h-80 overflow-y-auto">
                {assets.map((a) => (
                  <button
                    key={a.id} type="button" onClick={() => handlePick(a.id)}
                    className="aspect-square rounded-lg border border-border overflow-hidden bg-muted/30 hover:border-primary transition-colors flex items-center justify-center p-1"
                  >
                    {previews[a.id] ? <img src={previews[a.id]} alt={a.name ?? ""} className="max-w-full max-h-full object-contain" /> : null}
                  </button>
                ))}
              </div>
            )
          )}

          {tab === "upload" && (
            <div className="space-y-3">
              <div><Label>名称（选填）</Label><Input placeholder="如：森林背景" value={uploadName} onChange={(e) => setUploadName(e.target.value)} /></div>
              <div><Label>标签（选填，最多3个，逗号分隔）</Label><Input placeholder="如：森林,冬天" value={uploadTags} onChange={(e) => setUploadTags(e.target.value)} /></div>
              <div><Label>图片文件</Label><input type="file" accept="image/*" className="text-sm" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} /></div>
              <Button className="w-full" onClick={handleUploadAndUse}>上传并使用</Button>
            </div>
          )}

          {tab === "edit" && (
            <SceneEditor presetCategory={category} presetModuleType={moduleType} onSaved={handleEdited} />
          )}
        </div>
      </Modal>
    </>
  );
}
