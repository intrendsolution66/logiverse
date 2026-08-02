// frontend/src/pages/edu/TopicManagementPage.tsx
//
// 这个页面不再管 Programme——Topic 只挂 Subject，Programme 那层从这个
// 页面（表格列、筛选框、新增/编辑弹窗）整个拿掉了；Subject 本身是不是
// 归属某个 Programme，属于「学习领域管理」那个页面的事，跟这里无关。
//
// "代号"(code)也不再手动填——后端自动生成一个 UUID 当内部唯一键，跟
// 真正会出现在编号里的 prefix（如 MK-NUM-10001 的"MK"）是两回事。

import { useState, useEffect, useMemo } from "react";
import { exerciseClassificationApi, taxonomyApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

interface Subject { id: string; programme_id?: string; code: string; name_zh: string }
interface Topic { id: string; code: string; name_zh: string; name_en?: string; prefix: string; subject_id?: string }
interface Group { id: string; category_id: string; code: string; name_zh: string; name_en?: string }
type SortKey = "name_zh" | "prefix";
const PAGE_SIZE = 20;

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

function AddTopicModal({ open, onClose, subjects, onSaved }: {
  open: boolean; onClose: () => void; subjects: Subject[]; onSaved: () => void;
}) {
  const [subjectId, setSubjectId] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [prefix, setPrefix] = useState("");

  async function handleSave() {
    if (!subjectId) { toast.error("请先选所属 Subject"); return; }
    if (!nameZh.trim() || !prefix.trim()) { toast.error("名称和前缀都要填"); return; }
    try {
      // code 不用填了——后端自动生成一个 UUID 当内部唯一键，跟真正会出现
      // 在编号里的 prefix 是两回事。
      await exerciseClassificationApi.createCategory({ name_zh: nameZh.trim(), prefix: prefix.trim(), subject_id: subjectId });
      toast.success("Topic建好了");
      setSubjectId(""); setNameZh(""); setPrefix("");
      onSaved(); onClose();
    } catch {
      toast.error("建立失败");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="新增学习主题 (Topic)" size="sm">
      <div className="space-y-3">
        <div>
          <Label>所属 Subject</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">选 Subject...</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name_zh}</option>)}
          </select>
        </div>
        <div><Label>名称</Label><Input placeholder="如：拼图" value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></div>
        <div><Label>编号前缀</Label><Input placeholder="如：PZ" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} /></div>
        <Button className="w-full" onClick={handleSave}>建立</Button>
      </div>
    </Modal>
  );
}

function ViewTopicModal({ topic, subjectName, onClose }: { topic: Topic | null; subjectName?: string; onClose: () => void }) {
  return (
    <Modal open={!!topic} onClose={onClose} title="Topic 详情" size="sm">
      {topic && (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">所属 Subject</span><span className="font-medium">{subjectName ?? "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">名称</span><span className="font-medium">{topic.name_zh}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">编号前缀</span><span className="font-mono font-semibold text-primary">{topic.prefix}</span></div>
        </div>
      )}
    </Modal>
  );
}

function EditTopicModal({ topic, subjects, onClose, onSaved }: {
  topic: Topic | null; subjects: Subject[]; onClose: () => void; onSaved: () => void;
}) {
  const [nameZh, setNameZh] = useState("");
  const [prefix, setPrefix] = useState("");
  const [subjectId, setSubjectId] = useState("");

  useEffect(() => {
    if (!topic) return;
    setNameZh(topic.name_zh);
    setPrefix(topic.prefix);
    setSubjectId(topic.subject_id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic]);

  async function handleSave() {
    if (!topic) return;
    if (!nameZh.trim() || !prefix.trim()) { toast.error("名称和编号前缀都不能空着"); return; }
    if (!subjectId) { toast.error("请选所属 Subject"); return; }
    try {
      await exerciseClassificationApi.updateCategory(topic.id, { name_zh: nameZh, prefix, subject_id: subjectId });
      toast.success("已更新");
      onSaved(); onClose();
    } catch { toast.error("更新失败"); }
  }

  return (
    <Modal open={!!topic} onClose={onClose} title="编辑 Topic" size="sm">
      {topic && (
        <div className="space-y-3">
          <div>
            <Label>所属 Subject</Label>
            <select className="w-full border rounded-md p-2 text-sm" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">选 Subject...</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name_zh}</option>)}
            </select>
          </div>
          <div><Label>名称</Label><Input value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></div>
          <div><Label>编号前缀</Label><Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} className="font-mono" /></div>
          <p className="text-xs text-muted-foreground">改前缀只影响之后新建的 Activity 编号，已经生成的编号不会跟着变。改所属Subject只影响这个Topic自己挂在哪，底下已经建好的 Activity 不会跟着搬。</p>
          <Button className="w-full" onClick={handleSave}>保存</Button>
        </div>
      )}
    </Modal>
  );
}

function AddGroupModal({ open, onClose, topicId, onSaved }: { open: boolean; onClose: () => void; topicId: string | null; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [nameZh, setNameZh] = useState("");

  async function handleSave() {
    if (!topicId) return;
    if (!code.trim() || !nameZh.trim()) { toast.error("代号和名称都要填"); return; }
    try {
      await exerciseClassificationApi.createGroup({ category_id: topicId, code: code.trim(), name_zh: nameZh.trim() });
      toast.success("分类建好了");
      setCode(""); setNameZh("");
      onSaved(); onClose();
    } catch { toast.error("建立失败"); }
  }

  return (
    <Modal open={open} onClose={onClose} title="新增分类" size="sm">
      <div className="space-y-3">
        <div><Label>代号（用于编号，如 NUM）</Label><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
        <div><Label>名称</Label><Input placeholder="如：数字迷宫" value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></div>
        <Button className="w-full" onClick={handleSave}>建立</Button>
      </div>
    </Modal>
  );
}

function EditGroupModal({ group, onClose, onSaved }: { group: Group | null; onClose: () => void; onSaved: () => void }) {
  const [nameZh, setNameZh] = useState("");
  const [code, setCode] = useState("");
  useEffect(() => { if (group) { setNameZh(group.name_zh); setCode(group.code); } }, [group]);

  async function handleSave() {
    if (!group) return;
    if (!nameZh.trim() || !code.trim()) { toast.error("代号和名称都不能空着"); return; }
    try {
      await exerciseClassificationApi.updateGroup(group.id, { name_zh: nameZh, code });
      toast.success("已更新");
      onSaved(); onClose();
    } catch { toast.error("更新失败"); }
  }

  return (
    <Modal open={!!group} onClose={onClose} title="编辑分类" size="sm">
      {group && (
        <div className="space-y-3">
          <div><Label>名称</Label><Input value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></div>
          <div><Label>代号</Label><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="font-mono" /></div>
          <Button className="w-full" onClick={handleSave}>保存</Button>
        </div>
      )}
    </Modal>
  );
}

function TopicRow({ no, topic, subjectName, expanded, onToggleExpand, groups, onView, onEdit, onDelete, onRefresh }: {
  no: number; topic: Topic; subjectName?: string; expanded: boolean; onToggleExpand: () => void; groups: Group[];
  onView: () => void; onEdit: () => void; onDelete: () => void; onRefresh: () => void;
}) {
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);

  async function removeGroup(id: string) {
    if (!window.confirm("确定要删除这个分类吗？")) return;
    try {
      await exerciseClassificationApi.deleteGroup(id);
      toast.success("已删除");
      onRefresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "删除失败";
      toast.error(msg);
    }
  }

  return (
    <>
      <tr className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
        <td className="py-2.5 px-3 text-muted-foreground">{no}</td>
        <td className="px-3">
          <button onClick={onToggleExpand} className="text-muted-foreground hover:text-foreground">{expanded ? "▾" : "▸"}</button>
        </td>
        <td className="px-3 font-medium">{topic.name_zh}</td>
        <td className="px-3"><span className="font-mono font-semibold text-primary">{topic.prefix}</span></td>
        <td className="px-3 text-muted-foreground text-xs">{subjectName ?? "—"}</td>
        <td className="px-3">
          <button type="button" onClick={onView} className="text-primary text-xs font-medium hover:underline">查看</button>
        </td>
        <td className="px-3">
          <button type="button" onClick={onEdit} className="text-muted-foreground text-xs font-medium hover:text-foreground hover:underline">编辑</button>
        </td>
        <td className="px-3">
          <button type="button" onClick={onDelete} className="text-red-500 text-xs font-medium hover:text-red-600 hover:underline">删除</button>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={10} className="bg-muted/30 px-3 py-3">
            <div className="pl-6 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">{topic.name_zh} 底下的分类（跟 Topic 前缀组合成完整编号，如 {topic.prefix}-NUM-10001）</p>
                <Button size="sm" variant="outline" onClick={() => setShowAddGroup(true)}>+ 新增分类</Button>
              </div>
              {groups.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">还没有分类——不选分类也能正常建 Activity，编号会省略这一段。</p>
              ) : (
                <div className="space-y-1.5">
                  {groups.map((g) => (
                    <div key={g.id} className="flex items-center gap-2 bg-card rounded-lg border border-border px-3 py-1.5">
                      <span className="text-sm">{g.name_zh}</span>
                      <span className="text-xs font-mono text-muted-foreground">{g.code}</span>
                      <div className="flex-1" />
                      <Button size="sm" variant="ghost" onClick={() => setEditingGroup(g)}>编辑</Button>
                      <Button size="sm" variant="ghost" onClick={() => removeGroup(g.id)} className="text-red-500 hover:text-red-600">删除</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}

      <AddGroupModal open={showAddGroup} onClose={() => setShowAddGroup(false)} topicId={topic.id} onSaved={onRefresh} />
      <EditGroupModal group={editingGroup} onClose={() => setEditingGroup(null)} onSaved={onRefresh} />
    </>
  );
}

export default function TopicManagementPage() {
  const [allSubjects, setAllSubjects] = useState<Subject[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [groupsByTopic, setGroupsByTopic] = useState<Record<string, Group[]>>({});
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [viewingTopic, setViewingTopic] = useState<Topic | null>(null);
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);

  const [filterSubjectId, setFilterSubjectId] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name_zh");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  useEffect(() => { taxonomyApi.listSubjects().then(setAllSubjects); }, []);

  function refresh() {
    exerciseClassificationApi.listCategories().then(setTopics);
    exerciseClassificationApi.listGroups().then((groups) => {
      const byTopic: Record<string, Group[]> = {};
      groups.forEach((g) => { (byTopic[g.category_id] ??= []).push(g); });
      setGroupsByTopic(byTopic);
    });
  }
  useEffect(refresh, []);
  useEffect(() => { setPage(1); }, [filterSubjectId, search, sortKey, sortOrder]);

  function subjectOf(topic: Topic): Subject | undefined { return allSubjects.find((s) => s.id === topic.subject_id); }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortOrder("asc"); }
  }

  async function handleDeleteTopic(topic: Topic) {
    if (!window.confirm(`确定要删除「${topic.name_zh}」这个 Topic 吗？这个操作没办法撤销。`)) return;
    try {
      await exerciseClassificationApi.deleteCategory(topic.id);
      toast.success("已删除");
      refresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "删除失败";
      toast.error(msg);
    }
  }

  const filtered = useMemo(() => {
    let f = topics;
    if (filterSubjectId) f = f.filter((t) => t.subject_id === filterSubjectId);
    const q = search.trim().toLowerCase();
    if (q) f = f.filter((t) => t.name_zh.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) || t.prefix.toLowerCase().includes(q));
    return [...f].sort((a, b) => {
      const cmp = (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "");
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [topics, filterSubjectId, search, sortKey, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">学习主题管理 (Topic)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            系统里所有的 Topic，不分 Subject 一次看全。Topic 带编号前缀，改前缀只影响之后新建的 Activity 编号，已经生成的编号不会跟着变。
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>+ Add Topic</Button>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[240px]" />
            <select className="border rounded-md p-2 text-sm min-w-[160px]" value={filterSubjectId} onChange={(e) => setFilterSubjectId(e.target.value)}>
              <option value="">全部 Subject</option>
              {allSubjects.map((s) => <option key={s.id} value={s.id}>{s.name_zh}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {visible.length === 0 ? (
            <EmptyState title={search || filterSubjectId ? "没有符合条件的Topic" : "还没有Topic"} description={search || filterSubjectId ? "换个搜索词或筛选条件试试" : "点右上角新增一个"} />
          ) : (
            <>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                      <th className="py-2.5 px-3 font-medium w-12">no</th>
                      <th className="py-2.5 px-3 w-8"></th>
                      <SortHeader label="名称" active={sortKey === "name_zh"} order={sortOrder} onClick={() => toggleSort("name_zh")} />
                      <SortHeader label="编号前缀" active={sortKey === "prefix"} order={sortOrder} onClick={() => toggleSort("prefix")} />
                      <th className="py-2.5 px-3 font-medium">所属 Subject</th>
                      <th className="py-2.5 px-3 font-medium">view</th>
                      <th className="py-2.5 px-3 font-medium">edit</th>
                      <th className="py-2.5 px-3 font-medium">delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((t, i) => (
                      <TopicRow
                        key={t.id} no={(page - 1) * PAGE_SIZE + i + 1} topic={t}
                        subjectName={subjectOf(t)?.name_zh}
                        expanded={expandedTopicId === t.id}
                        onToggleExpand={() => setExpandedTopicId((id) => (id === t.id ? null : t.id))}
                        groups={groupsByTopic[t.id] ?? []}
                        onView={() => setViewingTopic(t)}
                        onEdit={() => setEditingTopic(t)}
                        onDelete={() => handleDeleteTopic(t)}
                        onRefresh={refresh}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                <span>Number of Records: {filtered.length}</span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</Button>
                  <span>第 {page} / {totalPages} 页</span>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>下一页</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AddTopicModal open={showAdd} onClose={() => setShowAdd(false)} subjects={allSubjects} onSaved={refresh} />
      <ViewTopicModal topic={viewingTopic} subjectName={viewingTopic ? subjectOf(viewingTopic)?.name_zh : undefined} onClose={() => setViewingTopic(null)} />
      <EditTopicModal topic={editingTopic} subjects={allSubjects} onClose={() => setEditingTopic(null)} onSaved={refresh} />
    </div>
  );
}
