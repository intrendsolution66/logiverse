// frontend/src/pages/edu/GradeTiersPage.tsx
//
// 等级管理 — system-wide grade tier taxonomy (L1-L4), referenced by every
// course. Split out from CourseDesignerPage since this is a different kind
// of task from designing a specific course's content.
//
// Table layout matches the Activity Management page's design (row numbers,
// clickable sortable headers where applicable, Number of Records footer)
// plus 查看/编辑/删除 (view/edit/delete) actions per row and a top-right
// Add button — same visual language as every other admin list page.

import { useState, useEffect, useMemo } from "react";
import { eduApi } from "@/api/index";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

interface GradeTier { id: string; code: string; name_i18n: Record<string,string>; age_min?: number; age_max?: number; order_index?: number }
type SortKey = "code" | "name" | "age";

const MINI_INPUT_CLASS = "flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm font-medium shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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

function AddGradeTierModal({ open, onClose, nextOrder, onSaved }: {
  open: boolean; onClose: () => void; nextOrder: number; onSaved: () => void;
}) {
  const [code, setCode] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [ageMin, setAgeMin] = useState<number | "">("");
  const [ageMax, setAgeMax] = useState<number | "">("");

  async function handleSave() {
    if (!code.trim() || !nameZh.trim()) { toast.error("请填代号和名称"); return; }
    try {
      await eduApi.createGradeTier({
        code: code.trim(), name_i18n: { zh: nameZh, en: nameZh },
        age_min: ageMin === "" ? undefined : ageMin, age_max: ageMax === "" ? undefined : ageMax,
        order_index: nextOrder,
      });
      toast.success("等级加好了");
      setCode(""); setNameZh(""); setAgeMin(""); setAgeMax("");
      onSaved(); onClose();
    } catch {
      toast.error("新增失败（代号可能重复，或没有权限）");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="新增等级" size="sm">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>代号</Label>
          <Input placeholder="如 L5" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>名称</Label>
          <Input placeholder="如：进阶级" value={nameZh} onChange={(e) => setNameZh(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>年龄下限</Label>
            <input type="number" value={ageMin} onChange={(e) => setAgeMin(e.target.value === "" ? "" : +e.target.value)} className={MINI_INPUT_CLASS} />
          </div>
          <div className="space-y-1.5">
            <Label>年龄上限</Label>
            <input type="number" value={ageMax} onChange={(e) => setAgeMax(e.target.value === "" ? "" : +e.target.value)} className={MINI_INPUT_CLASS} />
          </div>
        </div>
        <Button className="w-full" onClick={handleSave}>保存</Button>
      </div>
    </Modal>
  );
}

function ViewGradeTierModal({ tier, onClose }: { tier: GradeTier | null; onClose: () => void }) {
  return (
    <Modal open={!!tier} onClose={onClose} title="等级详情" size="sm">
      {tier && (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">代号</span><Badge>{tier.code}</Badge></div>
          <div className="flex justify-between"><span className="text-muted-foreground">名称</span><span className="font-medium">{tier.name_i18n?.zh ?? tier.name_i18n?.en}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">年龄范围</span><span>{tier.age_min ?? "?"} ~ {tier.age_max ?? "?"} 岁</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">排序值</span><span>{tier.order_index ?? "—"}</span></div>
        </div>
      )}
    </Modal>
  );
}

function EditGradeTierModal({ tier, onClose, onSaved }: { tier: GradeTier | null; onClose: () => void; onSaved: () => void }) {
  const [nameZh, setNameZh] = useState("");
  const [ageMin, setAgeMin] = useState<number | "">("");
  const [ageMax, setAgeMax] = useState<number | "">("");

  useEffect(() => {
    if (tier) { setNameZh(tier.name_i18n?.zh ?? tier.name_i18n?.en ?? ""); setAgeMin(tier.age_min ?? ""); setAgeMax(tier.age_max ?? ""); }
  }, [tier]);

  async function handleSave() {
    if (!tier) return;
    if (!nameZh.trim()) { toast.error("名称不能空着"); return; }
    try {
      await eduApi.updateGradeTier(tier.id, {
        name_i18n: { zh: nameZh, en: nameZh },
        age_min: ageMin === "" ? undefined : ageMin, age_max: ageMax === "" ? undefined : ageMax,
      });
      toast.success("已更新");
      onSaved(); onClose();
    } catch { toast.error("更新失败"); }
  }

  return (
    <Modal open={!!tier} onClose={onClose} title="编辑等级" size="sm">
      {tier && (
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>名称</Label><Input value={nameZh} onChange={(e) => setNameZh(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>年龄下限</Label>
              <input type="number" value={ageMin} onChange={(e) => setAgeMin(e.target.value === "" ? "" : +e.target.value)} className={MINI_INPUT_CLASS} />
            </div>
            <div className="space-y-1.5">
              <Label>年龄上限</Label>
              <input type="number" value={ageMax} onChange={(e) => setAgeMax(e.target.value === "" ? "" : +e.target.value)} className={MINI_INPUT_CLASS} />
            </div>
          </div>
          <Button className="w-full" onClick={handleSave}>保存</Button>
        </div>
      )}
    </Modal>
  );
}

export default function GradeTiersPage() {
  const [tiers, setTiers] = useState<GradeTier[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [viewingTier, setViewingTier] = useState<GradeTier | null>(null);
  const [editingTier, setEditingTier] = useState<GradeTier | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  function refresh() { eduApi.listGradeTiers().then(setTiers); }
  useEffect(refresh, []);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortOrder("asc"); }
  }

  async function handleDelete(tier: GradeTier) {
    if (!window.confirm(`确定要删除「${tier.name_i18n?.zh ?? tier.code}」这个等级吗？已经用这个等级的课程不会受影响，但之后新建课程不会再看到它。`)) return;
    try {
      await eduApi.deleteGradeTier(tier.id);
      toast.success("已删除");
      refresh();
    } catch { toast.error("删除失败"); }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? tiers.filter((t) => (t.name_i18n?.zh ?? "").toLowerCase().includes(q) || t.code.toLowerCase().includes(q)) : tiers;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "code") cmp = a.code.localeCompare(b.code);
      else if (sortKey === "name") cmp = (a.name_i18n?.zh ?? "").localeCompare(b.name_i18n?.zh ?? "");
      else cmp = (a.age_min ?? 0) - (b.age_min ?? 0);
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [tiers, search, sortKey, sortOrder]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">等级管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            这里定义的是整个系统的等级体系（系统级，所有课程共用）。课程建立时会从这里选一个等级，不是每门课各自定义。
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>+ Add Grade Tier</Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[240px]" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {visible.length === 0 ? (
            <EmptyState title={search ? "没有符合条件的等级" : "还没有等级"} description={search ? "换个搜索词试试" : "课程建立前，先在这里定义系统要分成几个等级"} />
          ) : (
            <>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                      <th className="py-2.5 px-3 font-medium w-12">no</th>
                      <SortHeader label="代号" active={sortKey === "code"} order={sortOrder} onClick={() => toggleSort("code")} />
                      <SortHeader label="名称" active={sortKey === "name"} order={sortOrder} onClick={() => toggleSort("name")} />
                      <SortHeader label="年龄范围" active={sortKey === "age"} order={sortOrder} onClick={() => toggleSort("age")} />
                      <th className="py-2.5 px-3 font-medium">view</th>
                      <th className="py-2.5 px-3 font-medium">edit</th>
                      <th className="py-2.5 px-3 font-medium">delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((t, i) => (
                      <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 px-3 text-muted-foreground">{i + 1}</td>
                        <td className="px-3"><Badge>{t.code}</Badge></td>
                        <td className="px-3 font-medium">{t.name_i18n?.zh ?? t.name_i18n?.en}</td>
                        <td className="px-3 text-muted-foreground">{t.age_min ?? "?"} ~ {t.age_max ?? "?"} 岁</td>
                        <td className="px-3">
                          <button type="button" onClick={() => setViewingTier(t)} className="text-primary text-xs font-medium hover:underline">查看</button>
                        </td>
                        <td className="px-3">
                          <button type="button" onClick={() => setEditingTier(t)} className="text-muted-foreground text-xs font-medium hover:text-foreground hover:underline">编辑</button>
                        </td>
                        <td className="px-3">
                          <button type="button" onClick={() => handleDelete(t)} className="text-red-500 text-xs font-medium hover:text-red-600 hover:underline">删除</button>
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

      <AddGradeTierModal open={showAdd} onClose={() => setShowAdd(false)} nextOrder={tiers.length + 1} onSaved={refresh} />
      <ViewGradeTierModal tier={viewingTier} onClose={() => setViewingTier(null)} />
      <EditGradeTierModal tier={editingTier} onClose={() => setEditingTier(null)} onSaved={refresh} />
    </div>
  );
}
