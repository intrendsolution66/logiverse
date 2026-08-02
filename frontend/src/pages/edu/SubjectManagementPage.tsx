// frontend/src/pages/edu/SubjectManagementPage.tsx
//
// 改成跟等级管理一样的独立列表——打开就显示全部Subject（不用先选
// Programme），表格里加"所属Programme"列。Programme筛选从"必选门槛"
// 改成"可选筛选下拉"。新增时在Modal里选归属Programme，不再依赖页面顶部
// 预先选好的那个。
//
// taxonomyApi.listSubjects() 不传programmeId本来就会返回全部（看
// api/index.ts的签名，programmeId是可选参数），所以这里不需要改后端。

import { useState, useEffect, useMemo } from "react";
import { taxonomyApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

interface Programme { id: string; code: string; name_zh: string }
interface Subject { id: string; programme_id?: string; code: string; name_zh: string; name_en?: string; prefix?: string }
type SortKey = "name_zh";
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

function AddSubjectModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [nameZh, setNameZh] = useState("");
  const [prefix, setPrefix] = useState("");

  async function handleSave() {
    if (!nameZh.trim() || !prefix.trim()) { toast.error("名称和编号前缀都要填"); return; }
    try {
      // 代号(code)不用手动打了，系统自动生成一个 UUID——纯粹给数据库当
      // 唯一键用。编号前缀(prefix)不一样，这个是真的会出现在 Activity
      // 编号最前面的东西（如 LOGIC-MK-NUM-10001 的"LOGIC"），所以还是要
      // 手动填、还是必填。
      await taxonomyApi.createSubject({ code: crypto.randomUUID(), name_zh: nameZh.trim(), prefix: prefix.trim() });
      toast.success("学习领域建好了——之后要归到哪个 Programme，去编辑那里补");
      setNameZh(""); setPrefix("");
      onSaved(); onClose();
    } catch { toast.error("建立失败"); }
  }

  return (
    <Modal open={open} onClose={onClose} title="新增学习领域 (Subject)" size="sm">
      <div className="space-y-3">
        <div><Label>名称</Label><Input placeholder="如：数与运算" value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></div>
        <div><Label>编号前缀（会出现在 Activity 编号最前面，如 LOGIC）</Label><Input placeholder="如：LOGIC" value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} className="font-mono" /></div>
        <p className="text-xs text-muted-foreground">先建好 Subject 就行，要归到哪个 Programme 之后编辑的时候再补，不影响现在建立。</p>
        <Button className="w-full" onClick={handleSave}>建立</Button>
      </div>
    </Modal>
  );
}

function ViewSubjectModal({ subj, programmeName, onClose }: { subj: Subject | null; programmeName?: string; onClose: () => void }) {
  return (
    <Modal open={!!subj} onClose={onClose} title="Subject 详情" size="sm">
      {subj && (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">所属 Programme</span><span className="font-medium">{programmeName ?? "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">名称</span><span className="font-medium">{subj.name_zh}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">编号前缀</span>{subj.prefix ? <span className="font-mono font-semibold text-primary">{subj.prefix}</span> : <span className="text-muted-foreground">未设置</span>}</div>
        </div>
      )}
    </Modal>
  );
}

function EditSubjectModal({ subj, programmes, onClose, onSaved }: { subj: Subject | null; programmes: Programme[]; onClose: () => void; onSaved: () => void }) {
  const [nameZh, setNameZh] = useState("");
  const [programmeId, setProgrammeId] = useState("");
  const [prefix, setPrefix] = useState("");
  useEffect(() => { if (subj) { setNameZh(subj.name_zh); setProgrammeId(subj.programme_id ?? ""); setPrefix(subj.prefix ?? ""); } }, [subj]);

  async function handleSave() {
    if (!subj) return;
    if (!nameZh.trim()) { toast.error("名称不能空着"); return; }
    try {
      await taxonomyApi.updateSubject(subj.id, { name_zh: nameZh, programme_id: programmeId || undefined, prefix: prefix.trim() || undefined });
      toast.success("已更新");
      onSaved(); onClose();
    } catch { toast.error("更新失败"); }
  }

  return (
    <Modal open={!!subj} onClose={onClose} title="编辑 Subject" size="sm">
      {subj && (
        <div className="space-y-3">
          <div><Label>名称</Label><Input value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></div>
          <div>
            <Label>编号前缀（会出现在 Activity 编号最前面，如 LOGIC）</Label>
            <Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} className="font-mono" placeholder="还没设置——编号会自动省略这一段" />
          </div>
          <div>
            <Label>所属 Programme（选填）</Label>
            <select className="w-full border rounded-md p-2 text-sm" value={programmeId} onChange={(e) => setProgrammeId(e.target.value)}>
              <option value="">先不选...</option>
              {programmes.map((p) => <option key={p.id} value={p.id}>{p.name_zh}</option>)}
            </select>
          </div>
          <Button className="w-full" onClick={handleSave}>保存</Button>
        </div>
      )}
    </Modal>
  );
}

export default function SubjectManagementPage() {
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [viewingSubj, setViewingSubj] = useState<Subject | null>(null);
  const [editingSubj, setEditingSubj] = useState<Subject | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name_zh");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  useEffect(() => { taxonomyApi.listProgrammes().then(setProgrammes); }, []);
  function refresh() { taxonomyApi.listSubjects().then(setSubjects); } // 不传programmeId = 全部
  useEffect(refresh, []);
  useEffect(() => { setPage(1); }, [search, sortKey, sortOrder]);

  function programmeName(id: string | undefined) { return id ? programmes.find((p) => p.id === id)?.name_zh : undefined; }

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

  const filtered = useMemo(() => {
    let f = subjects;
    const q = search.trim().toLowerCase();
    if (q) f = f.filter((s) => s.name_zh.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
    return [...f].sort((a, b) => {
      const cmp = (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "");
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [subjects, search, sortKey, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">学习领域管理 (Subject)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            系统里所有的 Subject，不分 Programme 一次看全——每个 Subject 底下会挂着若干 Topic（学习主题管理→独立页面）。
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>+ Add Subject</Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[240px]" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {visible.length === 0 ? (
            <EmptyState title={search ? "没有符合条件的 Subject" : "还没有 Subject"} description={search ? "换个搜索词试试" : "点右上角新增一个，Topic才有地方挂"} />
          ) : (
            <>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                      <th className="py-2.5 px-3 font-medium w-12">no</th>
                      <SortHeader label="名称" active={sortKey === "name_zh"} order={sortOrder} onClick={() => toggleSort("name_zh")} />
                      <th className="py-2.5 px-3 font-medium">编号前缀</th>
                      <th className="py-2.5 px-3 font-medium">view</th>
                      <th className="py-2.5 px-3 font-medium">edit</th>
                      <th className="py-2.5 px-3 font-medium">delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((s, i) => (
                      <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 px-3 text-muted-foreground">{(page - 1) * PAGE_SIZE + i + 1}</td>
                        <td className="px-3 font-medium">{s.name_zh}</td>
                        <td className="px-3">{s.prefix ? <span className="font-mono text-xs font-semibold text-primary">{s.prefix}</span> : <span className="text-xs text-muted-foreground">—</span>}</td>
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

      <AddSubjectModal open={showAdd} onClose={() => setShowAdd(false)} onSaved={refresh} />
      <ViewSubjectModal subj={viewingSubj} programmeName={viewingSubj ? programmeName(viewingSubj.programme_id) : undefined} onClose={() => setViewingSubj(null)} />
      <EditSubjectModal subj={editingSubj} programmes={programmes} onClose={() => setEditingSubj(null)} onSaved={refresh} />
    </div>
  );
}
