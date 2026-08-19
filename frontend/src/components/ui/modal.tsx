import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl" | "full" | "screen" | "fullscreen";
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
          className={cn(
            size === "fullscreen"
              // 真正贴边——不居中、没有圆角、没有最大宽度限制，撑满整个
              // 视口(浏览器自己的地址栏/标签页不受影响，那是浏览器的UI，
              // 网页内容本来就盖不到)。flex flex-col 让下面 title区块
              // (flex-shrink-0)和内容区(flex-1)能正确按比例分配高度，
              // 不是简单的block排列。
              ? "fixed inset-0 z-50 w-screen h-screen max-w-none rounded-none border-0 bg-card flex flex-col"
              : size === "screen"
              // 介于 full 和 fullscreen 之间——几乎贴满整个视口(左右上下
              // 都不留大片空白)，但顶部留一点距离，让LogiVerse自己的
              // 页面头部(logo+导航)还能透出来，不会被完全盖住。留16(4rem)
              // 顶部间距是个折中值，没有精确对齐头部的确切高度，但足够
              // 让头部看得见、不至于被裁掉一半。
              ? "fixed left-1/2 top-14 z-50 -translate-x-1/2 w-[calc(100vw-0.5rem)] h-[calc(100vh-3.75rem)] max-w-none rounded-xl border bg-card shadow-2xl flex flex-col"
              : cn(
                  "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
                  "w-[calc(100%-2rem)] rounded-xl border bg-card shadow-2xl",
                  "data-[state=open]:animate-slide-up",
                  "focus:outline-none max-h-[90vh] overflow-y-auto",
                  sizes[size]
                ),
            className
          )}
        >
          {(title || description) && (
            <div className={cn("flex items-start justify-between px-5 border-b", (size === "fullscreen" || size === "screen") ? "flex-shrink-0 py-2.5" : "py-4 px-6")}>
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
          {/* fullscreen/screen模式下这一层要撑满剩余高度、自己的滚动条
              (万一某个标签页内容比可视区域高，比如"基本信息"表单字段
              很多)，并且是flex容器，才能把真实高度一路传给 children 里
              CourseDesignerPage.tsx 那边的 flex-1 元素(最终传到
              SceneEditor)。其他size维持原来的简单padding包裹，不影响
              其他所有用 size="sm"/"md" 等等的现有弹窗。 */}
          <div className={(size === "fullscreen" || size === "screen") ? "flex-1 min-h-0 overflow-y-auto px-3 py-2 flex flex-col" : "px-6 py-5"}>{children}</div>
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
