// frontend/src/pages/edu/ProgrammeManagementPage.tsx
//
// 课程体系管理 (Programme) — the top level of LogiVerse Education Taxonomy
// v1.0. Deliberately its own page, separate from Subject/Topic management
// AND separate from Activity design (CourseDesignerPage) — managing the
// taxonomy (what Programmes/Subjects/Topics exist) and authoring Activities
// (which Programme/Subject/Topic a specific piece of content belongs to)
// are different jobs done at different times by people who may not even be
// the same person; mixing "create a new Topic" into the middle of "build
// this Activity" makes both harder to reason about, so CourseDesignerPage's
// classification step is pure SELECTION only — creating new Programmes/
// Subjects/Topics happens here and on the two sibling pages instead.
//
// Table layout matches the Activity Management page's design: separate
// view/edit/delete columns (not one combined "operations" column), search
// box, sortable headers, row numbers, Number of Records footer. Search/sort
// here are client-side (not server round-trips) — a Programme list is
// inherently small.
//
// Delete is blocked server-side (409-style friendly message) if any Subject
// still references this Programme — see deleteProgramme's FK-violation
// handling in exerciseClassification.controller.ts. This page surfaces
// whatever message the backend sends rather than trying to pre-validate
// client-side, since "is it actually still referenced" is a server-side
// fact this page doesn't otherwise track.

import { useState, useEffect, useMemo } from "react";
import { taxonomyApi } from "@/api/index";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

interface Programme { id: string; code: string; name_zh: string; name_en?: string; description?: string }
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
        <p className="text-xs text-muted-foreground">最顶层的分类，比如"幼儿数学启蒙"、"奥数"、"编程"——一般不常新增，除非要开一整套全新的课程体系。</p>
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
          <div className="flex justify-between"><span className="text-muted-foreground">代号</span><Badge variant="outline">{prog.code}</Badge></div>
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
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  function refresh() { taxonomyApi.listProgrammes().then(setProgrammes); }
  useEffect(refresh, []);

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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? programmes.filter((p) => p.name_zh.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)) : programmes;
    const sorted = [...filtered].sort((a, b) => {
      const cmp = (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "");
      return sortOrder === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [programmes, search, sortKey, sortOrder]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">课程体系管理 (Programme)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            LogiVerse Education Taxonomy 最顶层——每个 Programme 底下挂着若干 Subject（学习领域管理→独立页面），Subject 底下挂着 Topic。
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>+ Add Programme</Button>
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
                      <SortHeader label="代号" active={sortKey === "code"} order={sortOrder} onClick={() => toggleSort("code")} />
                      <SortHeader label="名称" active={sortKey === "name_zh"} order={sortOrder} onClick={() => toggleSort("name_zh")} />
                      <th className="py-2.5 px-3 font-medium">描述</th>
                      <th className="py-2.5 px-3 font-medium">view</th>
                      <th className="py-2.5 px-3 font-medium">edit</th>
                      <th className="py-2.5 px-3 font-medium">delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p, i) => (
                      <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 px-3 text-muted-foreground">{i + 1}</td>
                        <td className="px-3"><Badge variant="outline">{p.code}</Badge></td>
                        <td className="px-3 font-medium">{p.name_zh}</td>
                        <td className="px-3 text-muted-foreground text-xs">{p.description ?? "—"}</td>
                        <td className="px-3">
                          <button type="button" onClick={() => setViewingProg(p)} className="text-primary text-xs font-medium hover:underline">查看</button>
                        </td>
                        <td className="px-3">
                          <button type="button" onClick={() => setEditingProg(p)} className="text-muted-foreground text-xs font-medium hover:text-foreground hover:underline">编辑</button>
                        </td>
                        <td className="px-3">
                          <button type="button" onClick={() => handleDelete(p)} className="text-red-500 text-xs font-medium hover:text-red-600 hover:underline">删除</button>
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

      <AddProgrammeModal open={showAdd} onClose={() => setShowAdd(false)} onSaved={refresh} />
      <ViewProgrammeModal prog={viewingProg} onClose={() => setViewingProg(null)} />
      <EditProgrammeModal prog={editingProg} onClose={() => setEditingProg(null)} onSaved={refresh} />
    </div>
  );
}
