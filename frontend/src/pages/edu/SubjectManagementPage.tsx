// frontend/src/pages/edu/SubjectManagementPage.tsx
//
// 学习领域管理 (Subject) — the second level of the taxonomy, sitting
// between Programme and Topic. Its own page, separate from Programme
// management and Topic management — see ProgrammeManagementPage's header
// comment for why these are split apart instead of one combined page.
//
// Table layout matches the Activity Management page's design: separate
// view/edit/delete columns, search box, sortable headers, row numbers,
// Number of Records footer.

import { useState, useEffect, useMemo } from "react";
import { taxonomyApi } from "@/api/index";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

interface Programme { id: string; code: string; name_zh: string }
interface Subject { id: string; programme_id: string; code: string; name_zh: string; name_en?: string }
type SortKey = "code" | "name_zh";

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

function AddSubjectModal({ open, onClose, programmeId, onSaved }: { open: boolean; onClose: () => void; programmeId: string | null; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [nameZh, setNameZh] = useState("");

  async function handleSave() {
    if (!programmeId) { toast.error("请先在上面选一个 Programme"); return; }
    if (!code.trim() || !nameZh.trim()) { toast.error("代号和名称都要填"); return; }
    try {
      await taxonomyApi.createSubject({ programme_id: programmeId, code: code.trim(), name_zh: nameZh.trim() });
      toast.success("学习领域建好了");
      setCode(""); setNameZh("");
      onSaved(); onClose();
    } catch { toast.error("建立失败"); }
  }

  return (
    <Modal open={open} onClose={onClose} title="新增学习领域 (Subject)" size="sm">
      <div className="space-y-3">
        <div><Label>代号（如 numbers）</Label><Input value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <div><Label>名称</Label><Input placeholder="如：数与运算" value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></div>
        <Button className="w-full" onClick={handleSave}>建立</Button>
      </div>
    </Modal>
  );
}

function ViewSubjectModal({ subj, onClose }: { subj: Subject | null; onClose: () => void }) {
  return (
    <Modal open={!!subj} onClose={onClose} title="Subject 详情" size="sm">
      {subj && (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">代号</span><Badge variant="outline">{subj.code}</Badge></div>
          <div className="flex justify-between"><span className="text-muted-foreground">名称</span><span className="font-medium">{subj.name_zh}</span></div>
        </div>
      )}
    </Modal>
  );
}

function EditSubjectModal({ subj, onClose, onSaved }: { subj: Subject | null; onClose: () => void; onSaved: () => void }) {
  const [nameZh, setNameZh] = useState("");
  useEffect(() => { if (subj) setNameZh(subj.name_zh); }, [subj]);

  async function handleSave() {
    if (!subj) return;
    if (!nameZh.trim()) { toast.error("名称不能空着"); return; }
    try {
      await taxonomyApi.updateSubject(subj.id, { name_zh: nameZh });
      toast.success("已更新");
      onSaved(); onClose();
    } catch { toast.error("更新失败"); }
  }

  return (
    <Modal open={!!subj} onClose={onClose} title="编辑 Subject" size="sm">
      {subj && (
        <div className="space-y-3">
          <div><Label>名称</Label><Input value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></div>
          <Button className="w-full" onClick={handleSave}>保存</Button>
        </div>
      )}
    </Modal>
  );
}

export default function SubjectManagementPage() {
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [viewingSubj, setViewingSubj] = useState<Subject | null>(null);
  const [editingSubj, setEditingSubj] = useState<Subject | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  useEffect(() => { taxonomyApi.listProgrammes().then(setProgrammes); }, []);
  function refresh() { if (programmeId) taxonomyApi.listSubjects(programmeId).then(setSubjects); else setSubjects([]); }
  useEffect(refresh, [programmeId]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortOrder("asc"); }
  }

  async function handleDelete(subj: Subject) {
    if (!window.confirm(`确定要删除「${subj.name_zh}」这个学习领域吗？这个操作没办法撤销。`)) return;
    try {
      await taxonomyApi.deleteSubject(subj.id);
      toast.success("已删除");
      refresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "删除失败";
      toast.error(msg);
    }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? subjects.filter((s) => s.name_zh.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)) : subjects;
    return [...filtered].sort((a, b) => {
      const cmp = (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "");
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [subjects, search, sortKey, sortOrder]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">学习领域管理 (Subject)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            先选一个 Programme，再管理它底下的 Subject——每个 Subject 底下会挂着若干 Topic（学习主题管理→独立页面）。
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)} disabled={!programmeId}>+ Add Subject</Button>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <select className="border rounded-md p-2 text-sm min-w-[200px]" value={programmeId} onChange={(e) => setProgrammeId(e.target.value)}>
            <option value="">选一个 Programme...</option>
            {programmes.map((p) => <option key={p.id} value={p.id}>{p.name_zh}</option>)}
          </select>
          {programmeId && <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[240px]" />}
        </CardContent>
      </Card>

      {programmeId && (
        <Card>
          <CardContent className="pt-6">
            {visible.length === 0 ? (
              <EmptyState title={search ? "没有符合条件的 Subject" : "这个 Programme 底下还没有 Subject"} description={search ? "换个搜索词试试" : "点右上角新增一个，Topic才有地方挂"} />
            ) : (
              <>
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                        <th className="py-2.5 px-3 font-medium w-12">no</th>
                        <SortHeader label="代号" active={sortKey === "code"} order={sortOrder} onClick={() => toggleSort("code")} />
                        <SortHeader label="名称" active={sortKey === "name_zh"} order={sortOrder} onClick={() => toggleSort("name_zh")} />
                        <th className="py-2.5 px-3 font-medium">view</th>
                        <th className="py-2.5 px-3 font-medium">edit</th>
                        <th className="py-2.5 px-3 font-medium">delete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((s, i) => (
                        <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                          <td className="py-2.5 px-3 text-muted-foreground">{i + 1}</td>
                          <td className="px-3"><Badge variant="outline">{s.code}</Badge></td>
                          <td className="px-3 font-medium">{s.name_zh}</td>
                          <td className="px-3">
                            <button type="button" onClick={() => setViewingSubj(s)} className="text-primary text-xs font-medium hover:underline">查看</button>
                          </td>
                          <td className="px-3">
                            <button type="button" onClick={() => setEditingSubj(s)} className="text-muted-foreground text-xs font-medium hover:text-foreground hover:underline">编辑</button>
                          </td>
                          <td className="px-3">
                            <button type="button" onClick={() => handleDelete(s)} className="text-red-500 text-xs font-medium hover:text-red-600 hover:underline">删除</button>
                          </td>
                        </tr>
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

      <AddSubjectModal open={showAdd} onClose={() => setShowAdd(false)} programmeId={programmeId || null} onSaved={refresh} />
      <ViewSubjectModal subj={viewingSubj} onClose={() => setViewingSubj(null)} />
      <EditSubjectModal subj={editingSubj} onClose={() => setEditingSubj(null)} onSaved={refresh} />
    </div>
  );
}
