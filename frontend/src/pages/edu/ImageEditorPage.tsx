// frontend/src/pages/edu/ImageEditorPage.tsx
//
// Standalone entry point for the scene editor — the actual editing engine
// lives in components/SceneEditor.tsx so it can ALSO be embedded inside
// AssetPicker's "编辑" tab, which is what makes "every game module uses the
// same editor" true (see AssetPicker.tsx). This page is just the page
// chrome around it for when someone navigates here directly.

import SceneEditor from "@/components/SceneEditor";

export default function ImageEditorPage() {
  return (
    <div className="max-w-7xl mx-auto space-y-4 pb-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">图片编辑工具</h1>
        <p className="text-sm text-muted-foreground mt-0.5">加背景、从素材库拖物件进来摆位置、手绘、加文字，完成后存回素材库</p>
      </div>
      <SceneEditor />
    </div>
  );
}
