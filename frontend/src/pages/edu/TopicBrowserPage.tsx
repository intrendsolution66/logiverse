// frontend/src/pages/edu/TopicBrowserPage.tsx
//
// 按 Topic 浏览——这个页面本身是只读的跨课程Activity浏览/审查工具（编辑
// 还是要跳去CourseDesignerPage，这点不变），所以不需要新增/编辑/删除，
// 但下面这张Activity表格补上搜索/排序/分页/record数量，跟其他管理表格
// 保持一致的操作体验。

import { useState, useEffect, useMemo } from "react";
import { taxonomyApi, exerciseClassificationApi, eduApi } from "@/api";
import { Card, CardContent, CardHeader, CardTitle, Input, Badge, EmptyState } from "@/components/ui/index";

const MODULE_LABELS: Record<string, { emoji: string; label: string }> = {
  counting:     { emoji: "🔢", label: "点点数数" },
  spot_diff:    { emoji: "🔍", label: "找不同之处" },
  focus_tap:    { emoji: "🎯", label: "专注力点数字" },
  memory:       { emoji: "🃏", label: "Memory配对" },
  pattern:      { emoji: "🧩", label: "找规律" },
  word_problem: { emoji: "📝", label: "应用题" },
  maze:         { emoji: "🧭", label: "迷宫" },
  sudoku:       { emoji: "🔢", label: "数独" },
  line_match:   { emoji: "🔗", label: "连线配对" },
  coloring:     { emoji: "🎨", label: "填色游戏" },
};
const DIFFICULTY_LABELS: Record<string, string> = { starter: "Starter", easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert" };

type Activity = Awaited<ReturnType<typeof eduApi.listActivitiesByTopic>>[number];
type SortKey = "name" | "difficulty";

const PAGE_SIZE = 20;

function SortHeader({ label, active, order, onClick }: { label: string; active: boolean; order: "asc"|"desc"; onClick: () => void }) {
  return (
    <th className="px-3 font-medium cursor-pointer select-none hover:text-foreground transition-colors" onClick={onClick}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`text-[10px] transition-opacity ${active ? "opacity-100" : "opacity-0"}`}>{order === "asc" ? "▲" : "▼"}</span>
      </span>
    </th>
  );
}

export default function TopicBrowserPage() {
  const [programmes, setProgrammes] = useState<Array<{ id: string; code: string; name_zh: string; name_en?: string }>>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; programme_id?: string; code: string; name_zh: string; name_en?: string }>>([]);
  const [topics, setTopics] = useState<Array<{ id: string; code: string; name_zh: string; name_en?: string; prefix: string; subject_id?: string }>>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  useEffect(() => { taxonomyApi.listProgrammes().then(setProgrammes); }, []);
  useEffect(() => {
    setSubjectId(""); setTopicId(""); setActivities([]);
    if (programmeId) taxonomyApi.listSubjects(programmeId).then(setSubjects);
    else setSubjects([]);
  }, [programmeId]);
  useEffect(() => {
    setTopicId(""); setActivities([]);
    if (subjectId) exerciseClassificationApi.listCategories(subjectId).then(setTopics);
    else setTopics([]);
  }, [subjectId]);
  useEffect(() => {
    if (!topicId) { setActivities([]); return; }
    setLoading(true);
    eduApi.listActivitiesByTopic(topicId).then(setActivities).finally(() => setLoading(false));
  }, [topicId]);
  useEffect(() => { setPage(1); setSearch(""); }, [topicId]);
  useEffect(() => { setPage(1); }, [search, sortKey, sortOrder]);

  const selectedTopic = topics.find((t) => t.id === topicId);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortOrder("asc"); }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const f = q ? activities.filter((a) => {
      const name = (a.title_i18n?.zh ?? a.title_i18n?.en ?? a.module_type ?? "").toLowerCase();
      const num = (a.exercise_number ?? "").toLowerCase();
      return name.includes(q) || num.includes(q);
    }) : activities;
    return [...f].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        const an = a.title_i18n?.zh ?? a.title_i18n?.en ?? a.module_type ?? "";
        const bn = b.title_i18n?.zh ?? b.title_i18n?.en ?? b.module_type ?? "";
        cmp = an.localeCompare(bn);
      } else {
        cmp = (a.difficulty ?? "").localeCompare(b.difficulty ?? "");
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [activities, search, sortKey, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">按 Topic 浏览</h1>
        <p className="text-sm text-muted-foreground mt-1">
          按 Programme → Subject → Topic 逐层选下去，看某个 Topic 底下所有 Activity——不分它们分别放在哪门课程里，跨课程一次看全。
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-2">
            <select className="border rounded-md p-2 text-sm min-w-[160px]" value={programmeId} onChange={(e) => setProgrammeId(e.target.value)}>
              <option value="">选 Programme...</option>
              {programmes.map((p) => <option key={p.id} value={p.id}>{p.name_zh}</option>)}
            </select>
            <select className="border rounded-md p-2 text-sm min-w-[160px]" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={!programmeId}>
              <option value="">选 Subject...</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name_zh}</option>)}
            </select>
            <select className="border rounded-md p-2 text-sm min-w-[160px]" value={topicId} onChange={(e) => setTopicId(e.target.value)} disabled={!subjectId}>
              <option value="">选 Topic...</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name_zh}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      {topicId && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{selectedTopic?.name_zh} 底下的 Activity</CardTitle>
            <Input placeholder="搜索名称/编号..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[200px]" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">加载中...</p>
            ) : visible.length === 0 ? (
              <EmptyState title={search ? "没有符合条件的Activity" : "这个 Topic 底下还没有 Activity"} description={search ? "换个搜索词试试" : "去「Activity 设计管理」里建一个，记得选这个 Topic 分类"} />
            ) : (
              <>
                <div className="rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                        <th className="py-2.5 px-3 font-medium w-12">no</th>
                        <SortHeader label="Activity 名称" active={sortKey === "name"} order={sortOrder} onClick={() => toggleSort("name")} />
                        <th className="px-3 font-medium">所属课程</th>
                        <th className="px-3 font-medium">模块类型</th>
                        <SortHeader label="难度" active={sortKey === "difficulty"} order={sortOrder} onClick={() => toggleSort("difficulty")} />
                        <th className="px-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((a, i) => (
                        <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                          <td className="py-2.5 px-3 text-muted-foreground">{(page - 1) * PAGE_SIZE + i + 1}</td>
                          <td className="px-3 font-medium">
                            {a.title_i18n?.zh ?? a.title_i18n?.en ?? a.module_type}
                            {a.exercise_number && <span className="text-xs text-muted-foreground font-mono ml-2">{a.exercise_number}</span>}
                          </td>
                          <td className="px-3 text-muted-foreground">{a.course_title_i18n?.zh ?? a.course_title_i18n?.en ?? "—"}</td>
                          <td className="px-3">
                            <Badge variant="outline">{MODULE_LABELS[a.module_type]?.emoji} {MODULE_LABELS[a.module_type]?.label ?? a.module_type}</Badge>
                          </td>
                          <td className="px-3 text-muted-foreground">{a.difficulty ? DIFFICULTY_LABELS[a.difficulty] ?? a.difficulty : "—"}</td>
                          <td className="px-3 text-right">
                            <a href={`/play/${a.id}`} target="_blank" rel="noreferrer" className="text-primary text-xs font-medium hover:underline mr-3">试玩 →</a>
                            <a href={`/course-designer?course=${a.course_id}`} className="text-muted-foreground text-xs font-medium hover:text-foreground hover:underline">去编辑 →</a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                  <span>Number of Records: {filtered.length}</span>
                  <div className="flex items-center gap-2">
                    <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-2 py-1 border rounded disabled:opacity-40">上一页</button>
                    <span>第 {page} / {totalPages} 页</span>
                    <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="px-2 py-1 border rounded disabled:opacity-40">下一页</button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
