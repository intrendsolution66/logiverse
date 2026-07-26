// frontend/src/pages/edu/TopicManagementPage.tsx
//
// 学习主题管理 (Topic = edu.exercise_categories) — the third level of the
// taxonomy, and the one that carries the exercise-numbering prefix (see
// migration 018). Its own page, separate from Programme/Subject management
// AND separate from Activity design — see ProgrammeManagementPage's header
// comment for the full reasoning on why these are split apart.
//
// Group (习题分类下的细分, = edu.exercise_groups) is a level BELOW Topic,
// not a taxonomy level in its own right (it's not in the
// Programme/Subject/Topic/Activity hierarchy the taxonomy doc defines) —
// it stays nested here rather than getting its own page, since it only
// ever makes sense in the context of "which Topic is this a sub-grouping
// of".
//
// Editing a prefix only affects exercise numbers generated AFTER the edit;
// existing course_levels rows keep whatever number they were assigned —
// see the backend comment in exerciseClassification.controller.ts for why.
//
// Table layout matches the Activity Management page's design (search,
// sortable headers, row numbers, Number of Records footer) — sort/search
// here are client-side since a Topic list per Subject is small.

import { useState, useEffect, useMemo } from "react";
import { exerciseClassificationApi, taxonomyApi } from "@/api/index";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

interface Programme { id: string; code: string; name_zh: string }
interface Subject { id: string; programme_id: string; code: string; name_zh: string }
interface Topic { id: string; code: string; name_zh: string; name_en?: string; prefix: string; subject_id?: string }
interface Group { id: string; category_id: string; code: string; name_zh: string; name_en?: string }
type SortKey = "code" | "name_zh" | "prefix";

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

function AddTopicModal({ open, onClose, subjectId, onSaved }: { open: boolean; onClose: () => void; subjectId: string | null; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [prefix, setPrefix] = useState("");

  async function handleSave() {
    if (!subjectId) { toast.error("请先在上面选一个 Subject"); return; }
    if (!code.trim() || !nameZh.trim() || !prefix.trim()) { toast.error("代号、名称、前缀都要填"); return; }
    try {
      await exerciseClassificationApi.createCategory({ code: code.trim(), name_zh: nameZh.trim(), prefix: prefix.trim(), subject_id: subjectId });
      toast.success("Topic建好了");
      setCode(""); setNameZh(""); setPrefix("");
      onSaved(); onClose();
    } catch {
      toast.error("建立失败（代号可能重复，或没有权限）");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="新增学习主题 (Topic)" size="sm">
      <div className="space-y-3">
        <div><Label>代号（英文，用于内部识别，如 puzzle）</Label><Input value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <div><Label>名称</Label><Input placeholder="如：拼图" value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></div>
        <div><Label>编号前缀</Label><Input placeholder="如：PZ" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} /></div>
        <p className="text-xs text-muted-foreground">这个一般对应一个新的游戏模块，不是每天都会用到——大部分情况下八个模块自带的Topic已经够用了。</p>
        <Button className="w-full" onClick={handleSave}>建立</Button>
      </div>
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
    } catch {
      toast.error("建立失败");
    }
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

function ViewTopicModal({ topic, onClose }: { topic: Topic | null; onClose: () => void }) {
  return (
    <Modal open={!!topic} onClose={onClose} title="Topic 详情" size="sm">
      {topic && (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">代号</span><Badge variant="outline">{topic.code}</Badge></div>
          <div className="flex justify-between"><span className="text-muted-foreground">名称</span><span className="font-medium">{topic.name_zh}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">编号前缀</span><span className="font-mono font-semibold text-primary">{topic.prefix}</span></div>
        </div>
      )}
    </Modal>
  );
}

function TopicRow({ no, topic, expanded, onToggleExpand, groups, onView, onDelete, onRefresh }: {
  no: number; topic: Topic; expanded: boolean; onToggleExpand: () => void; groups: Group[];
  onView: () => void; onDelete: () => void; onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [nameZh, setNameZh] = useState(topic.name_zh);
  const [prefix, setPrefix] = useState(topic.prefix);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupNameZh, setGroupNameZh] = useState("");
  const [groupCode, setGroupCode] = useState("");

  async function saveTopic() {
    try {
      await exerciseClassificationApi.updateCategory(topic.id, { name_zh: nameZh, prefix });
      toast.success("已更新");
      setEditing(false); onRefresh();
    } catch { toast.error("更新失败"); }
  }

  function startEditGroup(g: Group) {
    setEditingGroupId(g.id); setGroupNameZh(g.name_zh); setGroupCode(g.code);
  }
  async function saveGroup(id: string) {
    try {
      await exerciseClassificationApi.updateGroup(id, { name_zh: groupNameZh, code: groupCode });
      toast.success("已更新");
      setEditingGroupId(null); onRefresh();
    } catch { toast.error("更新失败"); }
  }
  async function removeGroup(id: string) {
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
        <td className="px-3"><Badge variant="outline">{topic.code}</Badge></td>
        <td className="px-3 font-medium">
          {editing ? <Input value={nameZh} onChange={(e) => setNameZh(e.target.value)} className="h-8 max-w-[140px]" /> : topic.name_zh}
        </td>
        <td className="px-3">
          {editing
            ? <Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} className="h-8 max-w-[100px] font-mono" />
            : <span className="font-mono font-semibold text-primary">{topic.prefix}</span>}
        </td>
        <td className="px-3">
          <button type="button" onClick={onView} className="text-primary text-xs font-medium hover:underline">查看</button>
        </td>
        <td className="px-3">
          {editing ? (
            <div className="flex gap-1.5">
              <Button size="sm" onClick={saveTopic}>保存</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setNameZh(topic.name_zh); setPrefix(topic.prefix); }}>取消</Button>
            </div>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="text-muted-foreground text-xs font-medium hover:text-foreground hover:underline">编辑</button>
          )}
        </td>
        <td className="px-3">
          <button type="button" onClick={onDelete} className="text-red-500 text-xs font-medium hover:text-red-600 hover:underline">删除</button>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={8} className="bg-muted/30 px-3 py-3">
            <div className="pl-6 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">{topic.code} 底下的分类（跟 Topic 前缀组合成完整编号，如 {topic.prefix}-NUM-10001）</p>
                <Button size="sm" variant="outline" onClick={() => setShowAddGroup(true)}>+ 新增分类</Button>
              </div>
              {groups.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">还没有分类——不选分类也能正常建 Activity，编号会省略这一段。</p>
              ) : (
                <div className="space-y-1.5">
                  {groups.map((g) => (
                    <div key={g.id} className="flex items-center gap-2 bg-card rounded-lg border border-border px-3 py-1.5">
                      {editingGroupId === g.id ? (
                        <>
                          <Input value={groupNameZh} onChange={(e) => setGroupNameZh(e.target.value)} className="h-7 max-w-[140px] text-sm" />
                          <Input value={groupCode} onChange={(e) => setGroupCode(e.target.value.toUpperCase())} className="h-7 max-w-[100px] text-sm font-mono" />
                          <div className="flex-1" />
                          <Button size="sm" onClick={() => saveGroup(g.id)}>保存</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingGroupId(null)}>取消</Button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm">{g.name_zh}</span>
                          <span className="text-xs font-mono text-muted-foreground">{g.code}</span>
                          <div className="flex-1" />
                          <Button size="sm" variant="ghost" onClick={() => startEditGroup(g)}>编辑</Button>
                          <Button size="sm" variant="ghost" onClick={() => removeGroup(g.id)} className="text-red-500 hover:text-red-600">删除</Button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}

      <AddGroupModal open={showAddGroup} onClose={() => setShowAddGroup(false)} topicId={topic.id} onSaved={onRefresh} />
    </>
  );
}

export default function TopicManagementPage() {
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [groupsByTopic, setGroupsByTopic] = useState<Record<string, Group[]>>({});
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [viewingTopic, setViewingTopic] = useState<Topic | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  useEffect(() => { taxonomyApi.listProgrammes().then(setProgrammes); }, []);
  useEffect(() => {
    setSubjectId("");
    if (programmeId) taxonomyApi.listSubjects(programmeId).then(setSubjects);
    else setSubjects([]);
  }, [programmeId]);

  function refresh() {
    if (!subjectId) { setTopics([]); return; }
    exerciseClassificationApi.listCategories(subjectId).then(setTopics);
    exerciseClassificationApi.listGroups().then((groups) => {
      const byTopic: Record<string, Group[]> = {};
      groups.forEach((g) => { (byTopic[g.category_id] ??= []).push(g); });
      setGroupsByTopic(byTopic);
    });
  }
  useEffect(refresh, [subjectId]);

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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? topics.filter((t) => t.name_zh.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) || t.prefix.toLowerCase().includes(q)) : topics;
    return [...filtered].sort((a, b) => {
      const cmp = (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "");
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [topics, search, sortKey, sortOrder]);

  const selectedSubject = subjects.find((s) => s.id === subjectId);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">学习主题管理 (Topic)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            先选 Programme → Subject，再管理它底下的 Topic。Topic 带编号前缀，改前缀只影响之后新建的 Activity 编号，已经生成的编号不会跟着变。
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)} disabled={!subjectId}>+ Add Topic</Button>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex flex-wrap gap-2">
            <select className="border rounded-md p-2 text-sm min-w-[180px]" value={programmeId} onChange={(e) => setProgrammeId(e.target.value)}>
              <option value="">选 Programme...</option>
              {programmes.map((p) => <option key={p.id} value={p.id}>{p.name_zh}</option>)}
            </select>
            <select className="border rounded-md p-2 text-sm min-w-[180px]" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!programmeId}>
              <option value="">选 Subject...</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name_zh}</option>)}
            </select>
          </div>
          {subjectId && <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[240px]" />}
        </CardContent>
      </Card>

      {subjectId && (
        <Card>
          <CardContent className="pt-6">
            {visible.length === 0 ? (
              <EmptyState title={search ? "没有符合条件的Topic" : "这个 Subject 底下还没有Topic"} description={search ? "换个搜索词试试" : "点右上角新增一个"} />
            ) : (
              <>
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                        <th className="py-2.5 px-3 font-medium w-12">no</th>
                        <th className="py-2.5 px-3 w-8"></th>
                        <SortHeader label="代号" active={sortKey === "code"} order={sortOrder} onClick={() => toggleSort("code")} />
                        <SortHeader label="名称" active={sortKey === "name_zh"} order={sortOrder} onClick={() => toggleSort("name_zh")} />
                        <SortHeader label="编号前缀" active={sortKey === "prefix"} order={sortOrder} onClick={() => toggleSort("prefix")} />
                        <th className="py-2.5 px-3 font-medium">view</th>
                        <th className="py-2.5 px-3 font-medium">edit</th>
                        <th className="py-2.5 px-3 font-medium">delete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((t, i) => (
                        <TopicRow
                          key={t.id} no={i + 1} topic={t}
                          expanded={expandedTopicId === t.id}
                          onToggleExpand={() => setExpandedTopicId((id) => (id === t.id ? null : t.id))}
                          groups={groupsByTopic[t.id] ?? []}
                          onView={() => setViewingTopic(t)}
                          onDelete={() => handleDeleteTopic(t)}
                          onRefresh={refresh}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">Number of Records: {visible.length}</div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <AddTopicModal open={showAdd} onClose={() => setShowAdd(false)} subjectId={subjectId || null} onSaved={refresh} />
      <ViewTopicModal topic={viewingTopic} onClose={() => setViewingTopic(null)} />
    </div>
  );
}
