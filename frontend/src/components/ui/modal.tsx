import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { isSceneEditorOpen } from "@/lib/sceneEditorOpenState";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  // Radix Dialog 默认是"modal"模式——接管焦点、锁背景滚动、拦截外部指针
  // 事件。这套机制在"弹窗里面还开另一个弹窗"（比如 AssetPicker 的选择
  // 器，本来就是嵌在别的内容设置面板里用的）会互相打架：两层都在抢
  // "谁能拦截指针事件"，结果内层弹窗的触发按钮点了没反应，连遮罩都不
  // 出现。传 false 关掉这层弹窗自己的 modal 焦点锁定/指针拦截，让它跟
  // 外层弹窗和平共处——这是 Radix 官方文档对嵌套 Dialog 场景给的建议
  // 做法，不是我们自己发明的取巧写法。默认 true，保持所有现有单层用法
  // 不变，只有真的会嵌套使用的地方（比如 AssetPicker）才需要传 false。
  modal?: boolean;
}

const sizes = {
  sm:   "max-w-sm",
  md:   "max-w-md",
  lg:   "max-w-lg",
  xl:   "max-w-2xl",
  full: "max-w-6xl", // sized to comfortably fit GAME_CANVAS_W (1100px) + padding — same width the play page (LevelPlayerPage) uses, so designer and play views aren't different sizes
};

export function Modal({ open, onClose, title, description, children, className, size = "md", modal = true }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()} modal={modal}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <Dialog.Content
          // onPointerDownOutside/onInteractOutside——只要有任何一个
          // SceneEditor(全屏场景编辑器，比如拖拽游戏摆物件那个)正开着，
          // 就跳过"点击外部自动关闭"这条判断。SceneEditor自己用Portal
          // 搬到了document.body最外层，DOM结构上已经不算在这个弹窗
          // 范围内了，Radix默认会把点它任何地方都判定成"点了外面"，
          // 直接把这层弹窗关掉——但SceneEditor本身是要求先点自己的
          // "撤销/完成"按钮才退出的强引导流程，这段时间里本来就不该
          // 有任何"点外部关闭弹窗"的合理场景，所以直接整体跳过判断，
          // 不用去猜DOM结构对不对，isSceneEditorOpen()是一个模块级的
          // 挂载计数器，只要有实例在，读到的值就是true，不依赖DOM树
          // 实际长什么样。
          onPointerDownOutside={(e) => { if (isSceneEditorOpen()) e.preventDefault(); }}
          onInteractOutside={(e) => { if (isSceneEditorOpen()) e.preventDefault(); }}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "w-[calc(100%-2rem)] rounded-xl border bg-card shadow-2xl",
            "data-[state=open]:animate-slide-up",
            "focus:outline-none max-h-[90vh] overflow-y-auto",
            sizes[size],
            className
          )}
        >
          {(title || description) && (
            <div className="flex items-start justify-between px-6 py-4 border-b">
              <div>
                {title && <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>}
                {description && <Dialog.Description className="text-sm text-muted-foreground mt-1">{description}</Dialog.Description>}
              </div>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 -mt-0.5 -mr-1">
                  <X className="h-4 w-4" />
                </Button>
              </Dialog.Close>
            </div>
          )}
          <div className="px-6 py-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Confirm Dialog ────────────────────────────────────────────────────────────
export function ConfirmDialog({ open, onClose, onConfirm, title, description, loading }: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; description?: string; loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} description={description} size="sm">
      <div className="flex justify-end gap-3 mt-2">
        <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant="destructive" onClick={onConfirm} loading={loading}>Confirm</Button>
      </div>
    </Modal>
  );
}
