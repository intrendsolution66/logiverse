// frontend/src/pages/edu/TeacherManagementPage.tsx
//
// 老师管理 — platform-wide teacher roster, showing each teacher's class
// and student counts at a glance, plus 查看/编辑/删除/新增 via the shared
// managed-user endpoints — see StudentManagementPage's header comment for
// why teachers (like students/parents) are admin-created with IC as
// username rather than self-registering.

import { useState, useEffect } from "react";
import { adminUsersApi, adminUserDetailApi, managedUserApi } from "@/api/index";
import { Input, Label, Card, CardContent, Badge, EmptyState } from "@/components/ui/index";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

type SortKey = "name" | "username" | "created_at";
type Teacher = Awaited<ReturnType<typeof adminUsersApi.listTeachers>>["data"][number];

function SortHeader({ label, active, order, onClick }: { label: string; active: boolean; order: "asc"|"desc"; onClick: () => void }) {
  return (
    <th className="py-2.5 px-3 font-medium cursor-pointer select-none hover:text-foreground transition-colors" onClick={onClick}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-[10px] transition-opacity ${active ? "opacity-100" : "opacity-0"}`}>{order === "asc" ? "▲" : "▼"}</span>
      </span>
    </th>
  );
}

function AddTeacherModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [icNumber, setIcNumber] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [result, setResult] = useState<{ username: string; temp_password?: string } | null>(null);

  function reset() { setIcNumber(""); setNameZh(""); setResult(null); }

  async function handleCreate() {
    if (!icNumber.trim()) { toast.error("请填 IC 号码"); return; }
    try {
      const r = await managedUserApi.create({ ic_number: icNumber.trim(), full_name_zh: nameZh.trim() || undefined, role_code: "TEACHER" });
      setResult(r);
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "建立失败";
      toast.error(msg);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="新增老师帐号" size="sm">
      {result ? (
        <div className="space-y-3">
          <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">✅ 帐号建好了</p>
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">帐号</span><span className="font-mono">{result.username}</span></div>
            {result.temp_password && (
              <div className="flex justify-between"><span className="text-muted-foreground">临时密码</span><span className="font-mono font-semibold">{result.temp_password}</span></div>
            )}
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ 临时密码现在不记下来，之后就查不到了——只有这一次看得到，要交给老师本人。</p>
          <Button className="w-full" onClick={() => { reset(); onClose(); }}>完成</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>IC 号码</Label>
            <Input placeholder="如 850505-14-5566（12位数字）" value={icNumber} onChange={(e) => setIcNumber(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>姓名（选填）</Label>
            <Input placeholder="老师姓名" value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">帐号会用这个 IC 号码当用户名，系统会自动生成一个临时密码——建立后马上显示，记得交给老师本人。</p>
          <Button className="w-full" onClick={handleCreate}>建立</Button>
        </div>
      )}
    </Modal>
  );
}

function ViewUserModal({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof adminUserDetailApi.get>> | null>(null);
  useEffect(() => { if (userId) adminUserDetailApi.get(userId).then(setDetail); else setDetail(null); }, [userId]);

  return (
    <Modal open={!!userId} onClose={onClose} title="老师详情" size="sm">
      {detail ? (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">姓名</span><span className="font-medium">{detail.full_name_zh ?? detail.full_name_en ?? "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">帐号</span><span className="font-mono">{detail.username}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">邮箱</span><span>{detail.email ?? "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">状态</span><Badge variant="outline">{detail.status}</Badge></div>
          <div className="flex justify-between"><span className="text-muted-foreground">建立时间</span><span>{new Date(detail.created_at).toLocaleDateString()}</span></div>
        </div>
      ) : <p className="text-sm text-muted-foreground">加载中...</p>}
    </Modal>
  );
}

function EditUserModal({ userId, onClose, onSaved }: { userId: string | null; onClose: () => void; onSaved: () => void }) {
  const [nameZh, setNameZh] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => {
    if (userId) adminUserDetailApi.get(userId).then((d) => { setNameZh(d.full_name_zh ?? ""); setNameEn(d.full_name_en ?? ""); setEmail(d.email ?? ""); });
  }, [userId]);

  async function handleSave() {
    if (!userId) return;
    try {
      await adminUserDetailApi.update(userId, { full_name_zh: nameZh, full_name_en: nameEn, email });
      toast.success("已更新");
      onSaved(); onClose();
    } catch { toast.error("更新失败"); }
  }

  return (
    <Modal open={!!userId} onClose={onClose} title="编辑老师资料" size="sm">
      <div className="space-y-3">
        <div><Label>中文姓名</Label><Input value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></div>
        <div><Label>英文姓名</Label><Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></div>
        <div><Label>邮箱</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <Button className="w-full" onClick={handleSave}>保存</Button>
      </div>
    </Modal>
  );
}

export default function TeacherManagementPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 30, total: 0, totalPages: 1 });
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  function refresh() {
    adminUsersApi.listTeachers({ search: search || undefined, sort: sortKey, order: sortOrder, page, limit: 30 }).then((r) => { setTeachers(r.data); setMeta(r.meta); });
  }
  useEffect(refresh, [search, sortKey, sortOrder, page]);
  useEffect(() => { setPage(1); }, [search, sortKey, sortOrder]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortOrder("desc"); }
  }

  async function handleDelete(t: Teacher) {
    if (!window.confirm(`确定要删除「${t.full_name_zh ?? t.username}」这个老师帐号吗？这个操作没办法撤销。`)) return;
    try {
      await adminUserDetailApi.deactivate(t.id);
      toast.success("已删除");
      refresh();
    } catch { toast.error("删除失败"); }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">老师管理</h1>
          <p className="text-sm text-muted-foreground mt-1">全平台老师名单，每位老师带几个班、教几个学生一目了然。</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>+ Add Teacher</Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[240px]" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {teachers.length === 0 ? (
            <EmptyState title="没有符合条件的老师" description="换个搜索词试试" />
          ) : (
            <>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                      <th className="py-2.5 px-3 font-medium w-12">no</th>
                      <SortHeader label="姓名" active={sortKey === "name"} order={sortOrder} onClick={() => toggleSort("name")} />
                      <SortHeader label="帐号 / 邮箱" active={sortKey === "username"} order={sortOrder} onClick={() => toggleSort("username")} />
                      <th className="px-3 font-medium">班级数</th>
                      <th className="px-3 font-medium">学生数</th>
                      <th className="px-3 font-medium">view</th>
                      <th className="px-3 font-medium">edit</th>
                      <th className="px-3 font-medium">delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teachers.map((t, i) => (
                      <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 px-3 text-muted-foreground">{(meta.page - 1) * meta.limit + i + 1}</td>
                        <td className="px-3 font-medium">{t.full_name_zh ?? t.full_name_en ?? "—"}</td>
                        <td className="px-3 text-muted-foreground text-xs">
                          <div className="font-mono">{t.username}</div>
                          {t.email && <div>{t.email}</div>}
                        </td>
                        <td className="px-3"><Badge variant="outline">{t.class_count} 班</Badge></td>
                        <td className="px-3"><Badge variant="outline">{t.student_count} 人</Badge></td>
                        <td className="px-3">
                          <button type="button" onClick={() => setViewingId(t.id)} className="text-primary text-xs font-medium hover:underline">查看</button>
                        </td>
                        <td className="px-3">
                          <button type="button" onClick={() => setEditingId(t.id)} className="text-muted-foreground text-xs font-medium hover:text-foreground hover:underline">编辑</button>
                        </td>
                        <td className="px-3">
                          <button type="button" onClick={() => handleDelete(t)} className="text-red-500 text-xs font-medium hover:text-red-600 hover:underline">删除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                <span>Number of Records: {meta.total}，第 {meta.page} / {meta.totalPages} 页</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</Button>
                  <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ViewUserModal userId={viewingId} onClose={() => setViewingId(null)} />
      <EditUserModal userId={editingId} onClose={() => setEditingId(null)} onSaved={refresh} />
      <AddTeacherModal open={showAdd} onClose={() => setShowAdd(false)} onSaved={refresh} />
    </div>
  );
}
