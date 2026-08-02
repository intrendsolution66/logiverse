// frontend/src/pages/edu/ProgrammeManagementPage.tsx
//
// 去掉之前误加的 <AdminLayout> 包裹——全局侧边栏已经由 AppLayout.tsx
// （通过 App.tsx 里的 <Outlet />）统一提供，这个页面不用自己再包一层。
// 保留圆形操作图标（ActionIcons）的改动。

import { useState, useEffect, useMemo } from "react";
import { taxonomyApi } from "@/api";
import { ActionIcons } from "@/components/ActionIcons";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

interface Programme { id: string; code: string; name_zh: string; name_en?: string; description?: string }
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

function AddProgrammeModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [description, setDescription] = useState("");

  async function handleSave() {
    if (!code.trim() || !nameZh.trim()) { toast.error("代号和名称都要填"); return; }
    try {
      await taxonomyApi.createProgramme({ code: code.trim(), name_zh: nameZh.trim(), description: description.trim() || undefined });
      toast.success("课程体系建好了");
      setCode(""); setNameZh(""); setDescription("");
      onSaved(); onClose();
    } catch { toast.error("建立失败（代号可能重复）"); }
  }

  return (
    <Modal open={open} onClose={onClose} title="新增课程体系 (Programme)" size="sm">
      <div className="space-y-3">
        <div><Label>代号（英文，如 olympiad_math）</Label><Input value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <div><Label>名称</Label><Input placeholder="如：奥数" value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></div>
        <div><Label>描述（选填）</Label><Input placeholder="如：面向小学高年级的竞赛数学" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <Button className="w-full" onClick={handleSave}>建立</Button>
      </div>
    </Modal>
  );
}

function ViewProgrammeModal({ prog, onClose }: { prog: Programme | null; onClose: () => void }) {
  return (
    <Modal open={!!prog} onClose={onClose} title="Programme 详情" size="sm">
      {prog && (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">名称</span><span className="font-medium">{prog.name_zh}</span></div>
          <div><span className="text-muted-foreground">描述</span><p className="mt-1">{prog.description || "—"}</p></div>
        </div>
      )}
    </Modal>
  );
}

function EditProgrammeModal({ prog, onClose, onSaved }: { prog: Programme | null; onClose: () => void; onSaved: () => void }) {
  const [nameZh, setNameZh] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => { if (prog) { setNameZh(prog.name_zh); setDescription(prog.description ?? ""); } }, [prog]);

  async function handleSave() {
    if (!prog) return;
    if (!nameZh.trim()) { toast.error("名称不能空着"); return; }
    try {
      await taxonomyApi.updateProgramme(prog.id, { name_zh: nameZh, description });
      toast.success("已更新");
      onSaved(); onClose();
    } catch { toast.error("更新失败"); }
  }

  return (
    <Modal open={!!prog} onClose={onClose} title="编辑 Programme" size="sm">
      {prog && (
        <div className="space-y-3">
          <div><Label>名称</Label><Input value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></div>
          <div><Label>描述</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <Button className="w-full" onClick={handleSave}>保存</Button>
        </div>
      )}
    </Modal>
  );
}

export default function ProgrammeManagementPage() {
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [viewingProg, setViewingProg] = useState<Programme | null>(null);
  const [editingProg, setEditingProg] = useState<Programme | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name_zh");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  function refresh() { taxonomyApi.listProgrammes().then(setProgrammes); }
  useEffect(refresh, []);
  useEffect(() => { setPage(1); }, [search, sortKey, sortOrder]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortOrder("asc"); }
  }

  async function handleDelete(prog: Programme) {
    if (!window.confirm(`确定要删除「${prog.name_zh}」这个课程体系吗？这个操作没办法撤销。`)) return;
    try {
      await taxonomyApi.deleteProgramme(prog.id);
      toast.success("已删除");
      refresh();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "删除失败";
      toast.error(msg);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const f = q ? programmes.filter((p) => p.name_zh.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)) : programmes;
    return [...f].sort((a, b) => {
      const cmp = (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "");
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [programmes, search, sortKey, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-teal-600 uppercase tracking-wide mb-1">LogiVerse Education Taxonomy</p>
          <h1 className="text-2xl font-bold tracking-tight">课程体系管理 (Programme)</h1>
          <p className="text-sm text-muted-foreground mt-1">每个 Programme 底下挂着若干 Subject，Subject 底下挂着 Topic。</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>+ Add Programme</Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[240px]" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {visible.length === 0 ? (
            <EmptyState title={search ? "没有符合条件的课程体系" : "还没有课程体系"} description={search ? "换个搜索词试试" : "点右上角新增一个"} />
          ) : (
            <>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                      <th className="py-2.5 px-3 font-medium w-12">no</th>
                      <SortHeader label="名称" active={sortKey === "name_zh"} order={sortOrder} onClick={() => toggleSort("name_zh")} />
                      <th className="py-2.5 px-3 font-medium">描述</th>
                      <th className="py-2.5 px-3 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p, i) => (
                      <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 px-3 text-muted-foreground">{(page - 1) * PAGE_SIZE + i + 1}</td>
                        <td className="px-3 font-medium">{p.name_zh}</td>
                        <td className="px-3 text-muted-foreground text-xs">{p.description ?? "—"}</td>
                        <td className="px-3">
                          <ActionIcons onView={() => setViewingProg(p)} onEdit={() => setEditingProg(p)} onDelete={() => handleDelete(p)} />
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

      <AddProgrammeModal open={showAdd} onClose={() => setShowAdd(false)} onSaved={refresh} />
      <ViewProgrammeModal prog={viewingProg} onClose={() => setViewingProg(null)} />
      <EditProgrammeModal prog={editingProg} onClose={() => setEditingProg(null)} onSaved={refresh} />
    </div>
  );
}
