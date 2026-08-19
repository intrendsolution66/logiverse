// frontend/src/lib/sceneEditorOpenState.ts
//
// 独立的小文件，专门只放这一个共享状态——SceneEditor.tsx 和
// components/ui/modal.tsx 都要用到它，但这两个文件本身互相 import 对方
// (SceneEditor.tsx 的"存到素材库"弹窗用的就是 ui/modal.tsx 的
// <Modal>)，如果让其中一个直接 import 另一个来拿这个状态，会形成循环
// 依赖(A引用B、B又引用A)——这种问题在打包时不一定会报错，但模块加载
// 顺序不对的时候，其中一边可能拿到 undefined，运行时莫名其妙崩溃，
// 很难查。单独抽一个两边都不互相依赖的中立文件，从根上避免这个问题。

let openCount = 0;

export function markSceneEditorOpen(): void {
  openCount++;
}

export function markSceneEditorClosed(): void {
  openCount = Math.max(0, openCount - 1);
}

export function isSceneEditorOpen(): boolean {
  return openCount > 0;
}