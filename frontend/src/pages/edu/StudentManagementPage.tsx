// frontend/src/pages/edu/StudentManagementPage.tsx
//
// 学生管理 — operator-facing roster of every student account, with
// 报读类型 (enrollment type: 线上自由课/实体课/线上正规课) editable inline,
// plus 查看/编辑/删除/新增 via the shared managed-user endpoints (a
// student/teacher/parent are all "auth.users with a specific role" under
// the hood, and this platform's students/parents don't self-register —
// an operator or teacher creates the account for them using the
// student's IC/birth-certificate number as the username, skipping the
// mobile-OTP step self-registration would normally require, since the
// creator here is presumed to have already verified identity through
// school administrative process — but the IC number's FORMAT is still
// validated server-side, this isn't a bypass of all checks. See
// backend/src/modules/auth/auth.controller.ts's createManagedUser for the
// full account-creation logic (temp password generation, role assignment,
// guardian linking).
//
// Distinct from FamilyDashboardPage (a parent's view of just their own
// kids) and TeacherClassesPage (a teacher's view of just their own class
// roster) — this is the platform-wide view across every student
// regardless of which parent/teacher they're connected to.

import { useState, useEffect } from "react";
import { adminUsersApi, adminUserDetailApi, managedUserApi } from "@/api";
import { Input, Label, Card, CardContent, Badge, EmptyState } from "@/components/ui/index";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

const ENROLLMENT_LABELS: Record<string, string> = {
  online_casual: "🌐 线上自由课",
  offline: "🏫 实体课",
  online_formal: "📚 线上正规课",
};
const SUBSCRIPTION_LABELS: Record<string, { label: string; color: string }> = {
  trial: { label: "试用中", color: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400" },
  active: { label: "订阅中", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" },
  past_due: { label: "已逾期", color: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" },
  cancelled: { label: "已取消", color: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" },
};

type SortKey = "name" | "username" | "enrollment_type" | "created_at";
type Student = Awaited<ReturnType<typeof adminUsersApi.listStudents>>["data"][number];

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

function ViewUserModal({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof adminUserDetailApi.get>> | null>(null);
  useEffect(() => { if (userId) adminUserDetailApi.get(userId).then(setDetail); else setDetail(null); }, [userId]);

  return (
    <Modal open={!!userId} onClose={onClose} title="学生详情" size="sm">
      {detail ? (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">姓名</span><span className="font-medium">{detail.full_name_zh ?? detail.full_name_en ?? "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">帐号</span><span className="font-mono">{detail.username}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">邮箱</span><span>{detail.email ?? "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">状态</span><Badge variant="outline">{detail.status}</Badge></div>
          <div className="flex justify-between"><span className="text-muted-foreground">建立时间</span><span>{new Date(detail.created_at).toLocaleDateString()}</span></div>
          <div className="pt-2 border-t border-border">
            <span className="text-muted-foreground">所属家长</span>
            {detail.guardians && detail.guardians.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {detail.guardians.map((g) => <li key={g.id}>{g.full_name_zh ?? g.full_name_en ?? "（未填姓名）"} <span className="text-muted-foreground font-mono text-xs">{g.username}</span></li>)}
              </ul>
            ) : <p className="mt-1 text-muted-foreground">还没有连结任何家长</p>}
          </div>
        </div>
      ) : <p className="text-sm text-muted-foreground">加载中...</p>}
    </Modal>
  );
}

function AddStudentModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [icNumber, setIcNumber] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [result, setResult] = useState<{ username: string; temp_password?: string } | null>(null);

  function reset() { setIcNumber(""); setNameZh(""); setResult(null); }

  async function handleCreate() {
    if (!icNumber.trim()) { toast.error("请填 IC 或出生证字号"); return; }
    try {
      const r = await managedUserApi.create({ ic_number: icNumber.trim(), full_name_zh: nameZh.trim() || undefined, role_code: "STUDENT" });
      setResult(r);
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "建立失败";
      toast.error(msg);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="新增学生帐号" size="sm">
      {result ? (
        <div className="space-y-3">
          <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">✅ 帐号建好了</p>
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">帐号</span><span className="font-mono">{result.username}</span></div>
            {result.temp_password && (
              <div className="flex justify-between"><span className="text-muted-foreground">临时密码</span><span className="font-mono font-semibold">{result.temp_password}</span></div>
            )}
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ 临时密码现在不记下来，之后就查不到了——只有这一次看得到，要交给学生或家长本人。</p>
          <Button className="w-full" onClick={() => { reset(); onClose(); }}>完成</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>IC 或出生证字号</Label>
            <Input placeholder="如 120101-14-5566（12位数字）" value={icNumber} onChange={(e) => setIcNumber(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>姓名（选填）</Label>
            <Input placeholder="学生姓名" value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">帐号会用这个 IC 号码当用户名，系统会自动生成一个临时密码——建立后马上显示，记得交给学生或家长。</p>
          <Button className="w-full" onClick={handleCreate}>建立</Button>
        </div>
      )}
    </Modal>
  );
}

function EditUserModal({ userId, onClose, onSaved }: { userId: string | null; onClose: () => void; onSaved: () => void }) {
  const [nameZh, setNameZh] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [email, setEmail] = useState("");
  const [guardians, setGuardians] = useState<Array<{ id: string; username: string; full_name_zh?: string; full_name_en?: string }>>([]);
  const [parentSearch, setParentSearch] = useState("");
  const [parentOptions, setParentOptions] = useState<Array<{ id: string; username: string; full_name_zh?: string; full_name_en?: string }>>([]);

  function refreshDetail() {
    if (!userId) return;
    adminUserDetailApi.get(userId).then((d) => {
      setNameZh(d.full_name_zh ?? ""); setNameEn(d.full_name_en ?? ""); setEmail(d.email ?? "");
      setGuardians(d.guardians ?? []);
    });
  }
  useEffect(refreshDetail, [userId]);

  useEffect(() => {
    if (!parentSearch.trim()) { setParentOptions([]); return; }
    const t = setTimeout(() => {
      adminUsersApi.listParents({ search: parentSearch.trim(), limit: 5 }).then((r) => setParentOptions(r.data));
    }, 300);
    return () => clearTimeout(t);
  }, [parentSearch]);

  async function handleSave() {
    if (!userId) return;
    try {
      await adminUserDetailApi.update(userId, { full_name_zh: nameZh, full_name_en: nameEn, email });
      toast.success("已更新");
      onSaved(); onClose();
    } catch { toast.error("更新失败"); }
  }

  async function handleLinkParent(parentId: string) {
    if (!userId) return;
    try {
      await adminUserDetailApi.linkGuardian(parentId, userId);
      toast.success("已连结");
      setParentSearch(""); setParentOptions([]);
      refreshDetail(); onSaved();
    } catch { toast.error("连结失败"); }
  }

  async function handleUnlinkParent(parentId: string) {
    if (!userId) return;
    try {
      await adminUserDetailApi.unlinkGuardian(parentId, userId);
      toast.success("已解除连结");
      refreshDetail(); onSaved();
    } catch { toast.error("解除失败"); }
  }

  return (
    <Modal open={!!userId} onClose={onClose} title="编辑学生资料" size="sm">
      <div className="space-y-4">
        <div className="space-y-3">
          <div><Label>中文姓名</Label><Input value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></div>
          <div><Label>英文姓名</Label><Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></div>
          <div><Label>邮箱</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <Button className="w-full" onClick={handleSave}>保存资料</Button>
        </div>

        <div className="pt-3 border-t border-border space-y-2">
          <Label>所属家长</Label>
          {guardians.length === 0 ? (
            <p className="text-xs text-muted-foreground">还没有连结任何家长</p>
          ) : (
            <div className="space-y-1.5">
              {guardians.map((g) => (
                <div key={g.id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm">
                  <span>{g.full_name_zh ?? g.full_name_en ?? "（未填姓名）"} <span className="text-muted-foreground font-mono text-xs">{g.username}</span></span>
                  <button type="button" onClick={() => handleUnlinkParent(g.id)} className="text-red-500 hover:text-red-600 text-xs">解除</button>
                </div>
              ))}
            </div>
          )}
          <Input placeholder="搜索家长姓名或帐号，连结新的家长..." value={parentSearch} onChange={(e) => setParentSearch(e.target.value)} />
          {parentOptions.length > 0 && (
            <div className="border border-border rounded-md divide-y divide-border max-h-32 overflow-y-auto">
              {parentOptions.map((p) => (
                <button
                  key={p.id} type="button" onClick={() => handleLinkParent(p.id)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50"
                >
                  {p.full_name_zh ?? p.full_name_en ?? "（未填姓名）"} <span className="text-muted-foreground font-mono text-xs">{p.username}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ExtendSubscriptionModal({ student, onClose, onSaved }: { student: Student | null; onClose: () => void; onSaved: () => void }) {
  const [days, setDays] = useState(7);
  const [saving, setSaving] = useState(false);

  async function handleExtend() {
    if (!student) return;
    if (!days || days <= 0) { toast.error("天数要大于0"); return; }
    setSaving(true);
    try {
      await adminUsersApi.extendStudentSubscription(student.id, days);
      toast.success(`已经给「${student.full_name_zh ?? student.username}」延长 ${days} 天`);
      onSaved(); onClose();
    } catch { toast.error("延长失败"); } finally { setSaving(false); }
  }

  return (
    <Modal open={!!student} onClose={onClose} title="延长订阅" size="sm">
      {student && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">给「{student.full_name_zh ?? student.username}」延长使用权限，不管现在订阅状态是什么（试用中/已过期/被取消），都会从今天算起给这么多天。</p>
          <div className="space-y-1.5">
            <Label>天数</Label>
            <div className="flex gap-2">
              <Input type="number" min={1} value={days} onChange={(e) => setDays(+e.target.value)} className="w-24" />
              <div className="flex gap-1.5">
                {[7, 14, 30].map((d) => (
                  <button key={d} type="button" onClick={() => setDays(d)} className="px-2.5 py-1 rounded-md text-xs border border-border hover:bg-muted">{d}天</button>
                ))}
              </div>
            </div>
          </div>
          <Button className="w-full" onClick={handleExtend} disabled={saving}>{saving ? "处理中..." : "确认延长"}</Button>
        </div>
      )}
    </Modal>
  );
}

export default function StudentManagementPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [meta, setMeta] = useState({ page: 1, limit: 30, total: 0, totalPages: 1 });
  const [search, setSearch] = useState("");
  const [enrollmentFilter, setEnrollmentFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [extendingStudent, setExtendingStudent] = useState<Student | null>(null);
  const [blockingId, setBlockingId] = useState<string | null>(null);

  function refresh() {
    adminUsersApi.listStudents({ search: search || undefined, enrollment_type: enrollmentFilter || undefined, sort: sortKey, order: sortOrder, page, limit: 30 })
      .then((r) => { setStudents(r.data); setMeta(r.meta); });
  }
  useEffect(refresh, [search, enrollmentFilter, sortKey, sortOrder, page]);
  useEffect(() => { setPage(1); }, [search, enrollmentFilter, sortKey, sortOrder]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortOrder("desc"); }
  }

  async function handleEnrollmentChange(studentId: string, value: string) {
    setSavingId(studentId);
    try {
      await adminUsersApi.updateStudentEnrollment(studentId, value);
      setStudents((ss) => ss.map((s) => (s.id === studentId ? { ...s, enrollment_type: value } : s)));
      toast.success("已更新");
    } catch {
      toast.error("更新失败");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(s: Student) {
    if (!window.confirm(`确定要删除「${s.full_name_zh ?? s.username}」这个学生帐号吗？这个操作没办法撤销。`)) return;
    try {
      await adminUserDetailApi.deactivate(s.id);
      toast.success("已删除");
      refresh();
    } catch { toast.error("删除失败"); }
  }

  async function handleBlock(s: Student) {
    if (!window.confirm(`确定要封锁「${s.full_name_zh ?? s.username}」这个账号吗？封锁后这个学生没办法登录，账号资料不会不见，之后可以再解封。`)) return;
    setBlockingId(s.id);
    try {
      await adminUserDetailApi.block(s.id);
      toast.success("已封锁");
      refresh();
    } catch { toast.error("操作失败"); } finally { setBlockingId(null); }
  }

  async function handleUnblock(s: Student) {
    setBlockingId(s.id);
    try {
      await adminUserDetailApi.unblock(s.id);
      toast.success("已解封");
      refresh();
    } catch { toast.error("操作失败"); } finally { setBlockingId(null); }
  }

  async function handleExpireSubscription(s: Student) {
    if (!window.confirm(`确定要把「${s.full_name_zh ?? s.username}」现在的订阅直接设成过期吗？设完之后这个学生马上就不能玩需要订阅的内容了。`)) return;
    try {
      await adminUsersApi.expireStudentSubscription(s.id);
      toast.success("已设成过期");
      refresh();
    } catch { toast.error("操作失败"); }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">学生管理</h1>
          <p className="text-sm text-muted-foreground mt-1">全平台学生名单，不分家长或班级——报读类型可以在这里直接调整。</p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>+ Add Student</Button>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[240px]" />
          <select className="border rounded-md p-2 text-sm" value={enrollmentFilter} onChange={(e) => setEnrollmentFilter(e.target.value)}>
            <option value="">全部报读类型</option>
            {Object.entries(ENROLLMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {students.length === 0 ? (
            <EmptyState title="没有符合条件的学生" description="换个搜索词或筛选条件试试" />
          ) : (
            <>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                      <th className="py-2.5 px-3 font-medium w-12">no</th>
                      <SortHeader label="姓名" active={sortKey === "name"} order={sortOrder} onClick={() => toggleSort("name")} />
                      <SortHeader label="帐号" active={sortKey === "username"} order={sortOrder} onClick={() => toggleSort("username")} />
                      <SortHeader label="报读类型" active={sortKey === "enrollment_type"} order={sortOrder} onClick={() => toggleSort("enrollment_type")} />
                      <th className="px-3 font-medium">班级</th>
                      <th className="px-3 font-medium">家长</th>
                      <th className="px-3 font-medium">订阅状态</th>
                      <th className="px-3 font-medium">账号状态</th>
                      <th className="px-3 font-medium">view</th>
                      <th className="px-3 font-medium">edit</th>
                      <th className="px-3 font-medium">delete</th>
                      <th className="px-3 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s, i) => {
                      const sub = s.subscription_status ? SUBSCRIPTION_LABELS[s.subscription_status] : null;
                      return (
                        <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                          <td className="py-2.5 px-3 text-muted-foreground">{(meta.page - 1) * meta.limit + i + 1}</td>
                          <td className="px-3 font-medium">{s.full_name_zh ?? s.full_name_en ?? "—"}</td>
                          <td className="px-3 text-muted-foreground font-mono text-xs">{s.username}</td>
                          <td className="px-3">
                            <select
                              value={s.enrollment_type} disabled={savingId === s.id}
                              onChange={(e) => handleEnrollmentChange(s.id, e.target.value)}
                              className="border rounded-md p-1.5 text-xs bg-card"
                            >
                              {Object.entries(ENROLLMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                            </select>
                          </td>
                          <td className="px-3 text-muted-foreground">{s.class_names ?? "—"}</td>
                          <td className="px-3 text-muted-foreground">{s.guardian_name ?? "—"}</td>
                          <td className="px-3">
                            {sub ? <Badge className={sub.color}>{sub.label}</Badge> : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3">
                            {s.status === "BLOCKED" ? (
                              <Badge className="bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">已封锁</Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">正常</span>
                            )}
                          </td>
                          <td className="px-3">
                            <button type="button" onClick={() => setViewingId(s.id)} className="text-primary text-xs font-medium hover:underline">查看</button>
                          </td>
                          <td className="px-3">
                            <button type="button" onClick={() => setEditingId(s.id)} className="text-muted-foreground text-xs font-medium hover:text-foreground hover:underline">编辑</button>
                          </td>
                          <td className="px-3">
                            <button type="button" onClick={() => handleDelete(s)} className="text-red-500 text-xs font-medium hover:text-red-600 hover:underline">删除</button>
                          </td>
                          <td className="px-3">
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => setExtendingStudent(s)} className="text-teal-600 text-xs font-medium hover:underline whitespace-nowrap">延长订阅</button>
                              {sub && (
                                <button type="button" onClick={() => handleExpireSubscription(s)} className="text-orange-600 text-xs font-medium hover:underline whitespace-nowrap">设为过期</button>
                              )}
                              {s.status === "BLOCKED" ? (
                                <button type="button" disabled={blockingId === s.id} onClick={() => handleUnblock(s)} className="text-emerald-600 text-xs font-medium hover:underline disabled:opacity-50 whitespace-nowrap">解封</button>
                              ) : (
                                <button type="button" disabled={blockingId === s.id} onClick={() => handleBlock(s)} className="text-amber-600 text-xs font-medium hover:underline disabled:opacity-50 whitespace-nowrap">封锁</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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
      <AddStudentModal open={showAdd} onClose={() => setShowAdd(false)} onSaved={refresh} />
      <ExtendSubscriptionModal student={extendingStudent} onClose={() => setExtendingStudent(null)} onSaved={refresh} />
    </div>
  );
}
