// frontend/src/pages/edu/ActivityCleanupPage.tsx
//
// 系统初期专用的"清场"工具——独立页面，跟日常的Activity设计管理分开，
// 因为这里做的是绕开安全机制的强制删除，需要更明显的警示和更高的操作
// 门槛（勾选批量删除时要求手动输入确认文字才能提交）。
//
// 列出全平台所有 Activity（不再只挑"已经有数据挂着"的那些）——不管有
// 没有人玩过、有没有被排课引用，都能从这里一次性强制删除，方便开发
// 测试阶段"想删哪个就删哪个"。有没有关联数据只是表格里的信息栏位，
// 不再是"能不能出现在列表里"的门槛。

import { useState, useEffect, useMemo } from "react";
import { dataCleanupApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

const MODULE_LABELS: Record<string, { emoji: string; label: string }> = {
  counting: { emoji: "🔢", label: "点点数数" }, spot_diff: { emoji: "🔍", label: "找不同之处" },
  focus_tap: { emoji: "🎯", label: "专注力点数字" }, memory: { emoji: "🃏", label: "Memory配对" },
  pattern: { emoji: "🧩", label: "找规律" }, word_problem: { emoji: "📝", label: "应用题" },
  maze: { emoji: "🧭", label: "迷宫" }, sudoku: { emoji: "🔢", label: "数独" },
  line_match: { emoji: "🔗", label: "连线配对" }, coloring: { emoji: "🎨", label: "填色游戏" },
  ppt_lecture: { emoji: "📊", label: "PPT讲义" }, video_lecture: { emoji: "🎬", label: "视频讲义" },
};

interface Activity {
  id: string; module_type: string; title_i18n?: Record<string,string>; exercise_number?: string;
  play_count: number; student_count: number; last_played_at?: string;
  assignment_count: number; lesson_step_count: number; topic_count: number;
}

const CONFIRM_PHRASE = "确认删除";

function BulkDeleteModal({ open, onClose, count, onConfirmed }: { open: boolean; onClose: () => void; count: number; onConfirmed: () => void }) {
  const [input, setInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { if (open) setInput(""); }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="确认批量删除" size="sm">
      <div className="space-y-4">
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          即将永久删除 <strong>{count}</strong> 个 Activity，以及它们的全部游玩记录、排课记录、Lesson步骤引用、Topic分类关联——这个操作没办法撤销。
        </div>
        <div>
          <p className="text-sm text-muted-foreground mb-1.5">请输入「{CONFIRM_PHRASE}」以确认：</p>
          <input
            value={input} onChange={(e) => setInput(e.target.value)}
            className="w-full border rounded-md p-2 text-sm font-mono"
            placeholder={CONFIRM_PHRASE}
          />
        </div>
        <Button
          className="w-full bg-red-600 hover:bg-red-700 text-white"
          disabled={input !== CONFIRM_PHRASE || deleting}
          onClick={async () => {
            setDeleting(true);
            try { await onConfirmed(); } finally { setDeleting(false); }
          }}
        >
          {deleting ? "删除中..." : `永久删除这 ${count} 个 Activity`}
        </Button>
      </div>
    </Modal>
  );
}

export default function ActivityCleanupPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  function refresh() {
    setLoading(true);
    dataCleanupApi.listPlayedActivities().then((r) => { setActivities(r); setSelected(new Set()); setLoading(false); });
  }
  useEffect(refresh, []);

  const allSelected = activities.length > 0 && selected.size === activities.length;

  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(activities.map((a) => a.id)));
  }

  async function handleDeleteOne(a: Activity) {
    const title = a.title_i18n?.zh ?? a.title_i18n?.en ?? a.module_type;
    if (!window.confirm(`确定要永久删除「${title}」吗？它的 ${a.play_count} 条游玩记录会一起被删除，没办法撤销。`)) return;
    try {
      await dataCleanupApi.purgeOne(a.id);
      toast.success("已删除");
      refresh();
    } catch { toast.error("删除失败"); }
  }

  async function handleBulkDelete() {
    try {
      const result = await dataCleanupApi.purgeBulk(Array.from(selected));
      toast.success(`已删除 ${result.deleted} 个${result.failed.length > 0 ? `，${result.failed.length} 个失败` : ""}`);
      setShowBulkConfirm(false);
      refresh();
    } catch { toast.error("批量删除失败"); }
  }

  const totalPlayCount = useMemo(() => activities.reduce((sum, a) => sum + a.play_count, 0), [activities]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-red-600">⚠️ Activity 数据清理</h1>
        <p className="text-sm text-muted-foreground mt-1">
          仅供系统初期清理测试数据使用——这里列出**全平台所有** Activity，不管有没有游玩记录、排课引用、Lesson步骤引用，都能从这里强制删除（正常的"Activity设计管理"页面只要有关联数据就会拦住不给删，这个页面绕开那层保护）。删除前请仔细核对每一栏的关联数据，操作前务必确认。
        </p>
      </div>

      <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
        共 {activities.length} 个 Activity，其中 {activities.filter((a) => a.play_count > 0 || a.assignment_count > 0 || a.lesson_step_count > 0).length} 个有相关数据（游玩记录/排课引用/Lesson步骤引用），累计 {totalPlayCount} 条游玩记录。删除后无法恢复，建议只在系统正式上线前的测试清理阶段使用。
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">加载中...</p>
          ) : activities.length === 0 ? (
            <EmptyState title="平台上还没有任何 Activity" description="去「Activity 设计管理」建一个" />
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                  全选
                </label>
                <Button
                  variant="destructive" size="sm" disabled={selected.size === 0}
                  onClick={() => setShowBulkConfirm(true)}
                >
                  批量删除选中的 {selected.size} 项
                </Button>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                      <th className="py-2.5 px-3 w-10"></th>
                      <th className="py-2.5 px-3 font-medium">Activity</th>
                      <th className="px-3 font-medium">游玩记录</th>
                      <th className="px-3 font-medium">排课引用</th>
                      <th className="px-3 font-medium">Lesson步骤引用</th>
                      <th className="px-3 font-medium">挂的Topic数</th>
                      <th className="px-3 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activities.map((a) => (
                      <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="px-3">
                          <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleOne(a.id)} />
                        </td>
                        <td className="px-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{MODULE_LABELS[a.module_type]?.emoji} {MODULE_LABELS[a.module_type]?.label ?? a.module_type}</Badge>
                            <span className="font-medium">{a.title_i18n?.zh ?? a.title_i18n?.en}</span>
                            {a.exercise_number && <span className="text-xs text-muted-foreground font-mono">{a.exercise_number}</span>}
                          </div>
                        </td>
                        <td className="px-3">
                          {a.play_count > 0 ? (
                            <span>{a.play_count} 次 · {a.student_count} 名学生</span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3">{a.assignment_count > 0 ? <Badge variant="outline">{a.assignment_count}</Badge> : "—"}</td>
                        <td className="px-3">
                          {a.lesson_step_count > 0 ? (
                            <span className="text-amber-600 text-xs">⚠️ 被 {a.lesson_step_count} 个Lesson步骤引用</span>
                          ) : "—"}
                        </td>
                        <td className="px-3">{a.topic_count > 0 ? <Badge variant="outline">{a.topic_count}</Badge> : "—"}</td>
                        <td className="px-3">
                          <button onClick={() => handleDeleteOne(a)} className="text-red-500 text-xs font-medium hover:text-red-600 hover:underline">删除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <BulkDeleteModal open={showBulkConfirm} onClose={() => setShowBulkConfirm(false)} count={selected.size} onConfirmed={handleBulkDelete} />
    </div>
  );
}

