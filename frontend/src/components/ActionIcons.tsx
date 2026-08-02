// frontend/src/components/ActionIcons.tsx
//
// 表格每行的 查看/编辑/删除——参考截图里那种小圆形图标按钮（青色眼睛/
// 橙色铅笔/红色垃圾桶），代替之前纯文字的"查看 编辑 删除"链接。

import { Eye, Pencil, Trash2 } from "lucide-react";

const BASE = "w-7 h-7 rounded-full flex items-center justify-center transition-colors shrink-0";

export function ViewIconButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`${BASE} bg-teal-50 text-teal-600 hover:bg-teal-100`} title="查看">
      <Eye size={14} />
    </button>
  );
}

export function EditIconButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`${BASE} bg-amber-50 text-amber-600 hover:bg-amber-100`} title="编辑">
      <Pencil size={13} />
    </button>
  );
}

export function DeleteIconButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`${BASE} bg-red-50 text-red-500 hover:bg-red-100`} title="删除">
      <Trash2 size={13} />
    </button>
  );
}

export function ActionIcons({ onView, onEdit, onDelete }: { onView?: () => void; onEdit?: () => void; onDelete?: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {onView && <ViewIconButton onClick={onView} />}
      {onEdit && <EditIconButton onClick={onEdit} />}
      {onDelete && <DeleteIconButton onClick={onDelete} />}
    </div>
  );
}
