// frontend/src/pages/edu/CourseLessonPage.tsx
//
// 课程与课时管理 — 这次补上：
//   课程列表：独立的 查看/编辑/删除 列（之前只能新建+点行进课时管理）
//   课时列表：从卡片堆叠改成表格，加搜索/排序/record数量，加 编辑（改名）/
//     删除（之前只能删里面的步骤，删不掉课时本身）
// 课程列表本身的搜索/筛选/排序/分页是服务端的（之前就有，没动），课时列表
// 因为通常一门课下面数量不多，用客户端搜索/排序即可。

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { eduApi, lessonsApi, taxonomyApi, exerciseClassificationApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

interface GradeTier { id: string; code: string; name_i18n: Record<string,string>; age_min?: number; age_max?: number }
interface Course { id: string; title_i18n: Record<string,string>; description_i18n?: Record<string,string>; grade_tier_id?: string; grade_tier_code?: string; grade_tier_name_i18n?: Record<string,string>; created_at?: string }

const SELECT_CLASS = "flex h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
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
const STEP_TYPE_LABELS: Record<string, string> = { video: "🎬 视频", ppt: "📊 PPT", level: "🎮 Activity（题库）" };

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

// ── Modal: add / view / edit course ────────────────────────────────────────────
function AddCourseModal({ open, onClose, tiers, onSaved }: {
  open: boolean; onClose: () => void; tiers: GradeTier[]; onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [gradeTierId, setGradeTierId] = useState("");

  async function handleSave() {
    if (!title.trim()) { toast.error("请输入课程名称"); return; }
    if (!gradeTierId) { toast.error("请选一个等级"); return; }
    try {
      await eduApi.createCourse({ title_i18n: { zh: title, en: title }, grade_tier_id: gradeTierId });
      toast.success("课程建好了");
      setTitle(""); setGradeTierId("");
      onSaved(); onClose();
    } catch {
      toast.error("建立失败（可能没有权限）");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="新建课程" size="sm">
      <div className="space-y-4">
        {tiers.length === 0 && (
          <p className="text-sm text-muted-foreground bg-muted rounded-lg px-3 py-2">
            还没有任何等级，请先去「等级管理」页面加一个。
          </p>
        )}
        <div className="space-y-1.5">
          <Label>课程名称</Label>
          <Input placeholder="如：逻辑思维基础班" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>等级</Label>
          <select className={SELECT_CLASS} value={gradeTierId} onChange={(e) => setGradeTierId(e.target.value)}>
            <option value="">选等级...</option>
            {tiers.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name_i18n?.zh ?? t.name_i18n?.en}</option>)}
          </select>
        </div>
        <Button className="w-full" onClick={handleSave} disabled={tiers.length === 0}>保存</Button>
      </div>
    </Modal>
  );
}

function ViewCourseModal({ course, onClose }: { course: Course | null; onClose: () => void }) {
  return (
    <Modal open={!!course} onClose={onClose} title="课程详情" size="sm">
      {course && (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">名称</span><span className="font-medium">{course.title_i18n?.zh ?? course.title_i18n?.en}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">等级</span>{course.grade_tier_code ? <Badge variant="outline">{course.grade_tier_code}</Badge> : <span className="text-muted-foreground text-xs">未分级</span>}</div>
          <div className="flex justify-between"><span className="text-muted-foreground">建立时间</span><span>{course.created_at ? new Date(course.created_at).toLocaleDateString() : "—"}</span></div>
        </div>
      )}
    </Modal>
  );
}

function EditCourseModal({ course, tiers, onClose, onSaved }: { course: Course | null; tiers: GradeTier[]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [gradeTierId, setGradeTierId] = useState("");

  useEffect(() => {
    if (course) { setTitle(course.title_i18n?.zh ?? course.title_i18n?.en ?? ""); setGradeTierId(course.grade_tier_id ?? ""); }
  }, [course]);

  async function handleSave() {
    if (!course) return;
    if (!title.trim()) { toast.error("名称不能空着"); return; }
    try {
      await eduApi.updateCourse(course.id, { title_i18n: { zh: title, en: title }, grade_tier_id: gradeTierId || undefined });
      toast.success("已更新");
      onSaved(); onClose();
    } catch { toast.error("更新失败"); }
  }

  return (
    <Modal open={!!course} onClose={onClose} title="编辑课程" size="sm">
      {course && (
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>课程名称</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>等级</Label>
            <select className={SELECT_CLASS} value={gradeTierId} onChange={(e) => setGradeTierId(e.target.value)}>
              <option value="">未分级</option>
              {tiers.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name_i18n?.zh ?? t.name_i18n?.en}</option>)}
            </select>
          </div>
          <Button className="w-full" onClick={handleSave}>保存</Button>
        </div>
      )}
    </Modal>
  );
}

// ── Lessons (课程编排流程) ──────────────────────────────────────────────────────
function AddLessonModal({ open, onClose, courseId, onSaved }: { open: boolean; onClose: () => void; courseId: string | null; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  async function handleSave() {
    if (!courseId) return;
    if (!title.trim()) { toast.error("请输入课时名称"); return; }
    try {
      await lessonsApi.createLesson(courseId, { title_i18n: { zh: title, en: title } });
      toast.success("课时建好了");
      setTitle(""); onSaved(); onClose();
    } catch { toast.error("建立失败（可能没有权限）"); }
  }
  return (
    <Modal open={open} onClose={onClose} title="新建课时" size="sm">
      <div className="space-y-3">
        <div><Label>课时名称</Label><Input placeholder="如：第1课时：认识数字" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <Button className="w-full" onClick={handleSave}>建立</Button>
      </div>
    </Modal>
  );
}

function EditLessonModal({ lesson, onClose, onSaved }: { lesson: { id: string; title_i18n: Record<string,string> } | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  useEffect(() => { if (lesson) setTitle(lesson.title_i18n?.zh ?? lesson.title_i18n?.en ?? ""); }, [lesson]);

  async function handleSave() {
    if (!lesson) return;
    if (!title.trim()) { toast.error("名称不能空着"); return; }
    try {
      await lessonsApi.updateLesson(lesson.id, { title_i18n: { zh: title, en: title } });
      toast.success("已更新");
      onSaved(); onClose();
    } catch { toast.error("更新失败"); }
  }

  return (
    <Modal open={!!lesson} onClose={onClose} title="编辑课时名称" size="sm">
      {lesson && (
        <div className="space-y-3">
          <div><Label>课时名称</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <Button className="w-full" onClick={handleSave}>保存</Button>
        </div>
      )}
    </Modal>
  );
}

// 加 level 步骤现在能从"全部" Activity 里搜索/筛选，不再局限于某一门
// 课底下——这就是题库真正意义上的复用：一个迷宫 Activity 不管当初是在
// 哪门课下面建的，都能被任何课时引用。
function AddStepModal({ open, onClose, lessonId, onSaved }: { open: boolean; onClose: () => void; lessonId: string | null; onSaved: () => void }) {
  const [stepType, setStepType] = useState<"video" | "ppt" | "level">("video");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaTitle, setMediaTitle] = useState("");

  const [search, setSearch] = useState("");
  const [subjects, setSubjects] = useState<Array<{ id: string; name_zh: string }>>([]);
  const [topics, setTopics] = useState<Array<{ id: string; name_zh: string; subject_id?: string }>>([]);
  const [subjectId, setSubjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [results, setResults] = useState<Array<{
    id: string; module_type: string; title_i18n?: Record<string, string>; exercise_number?: string;
    topics: Array<{ category_id: string; topic_name_zh?: string; subject_name_zh?: string }>;
  }>>([]);
  const [loading, setLoading] = useState(false);
  const [pickedLevel, setPickedLevel] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => { if (open) taxonomyApi.listSubjects().then((ss) => setSubjects(ss.map((s) => ({ id: s.id, name_zh: s.name_zh })))); }, [open]);
  useEffect(() => {
    setCategoryId("");
    if (subjectId) exerciseClassificationApi.listCategories(subjectId).then((cs) => setTopics(cs.map((c) => ({ id: c.id, name_zh: c.name_zh, subject_id: c.subject_id }))));
    else setTopics([]);
  }, [subjectId]);

  useEffect(() => {
    if (!open || stepType !== "level") return;
    setLoading(true);
    eduApi.listAllActivities({
      search: search || undefined, subject_id: subjectId || undefined, category_id: categoryId || undefined,
      sort: "created_at", order: "desc", page: 1, limit: 30,
    }).then((r) => setResults(r.data)).finally(() => setLoading(false));
  }, [open, stepType, search, subjectId, categoryId]);

  function reset() {
    setStepType("video"); setMediaUrl(""); setMediaTitle("");
    setSearch(""); setSubjectId(""); setCategoryId(""); setPickedLevel(null);
  }

  async function handleSave() {
    if (!lessonId) return;
    try {
      if (stepType === "level") {
        if (!pickedLevel) { toast.error("请选一个 Activity"); return; }
        await lessonsApi.createStep(lessonId, { step_type: "level", course_level_id: pickedLevel.id });
      } else {
        if (!mediaUrl.trim()) { toast.error("请输入链接"); return; }
        await lessonsApi.createStep(lessonId, { step_type: stepType, media_url: mediaUrl.trim(), media_title: mediaTitle || undefined });
      }
      toast.success("步骤加好了");
      reset(); onSaved(); onClose();
    } catch { toast.error("新增失败（可能没有权限）"); }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="加步骤" size={stepType === "level" ? "lg" : "sm"}>
      <div className="space-y-3">
        <div>
          <Label>步骤类型</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={stepType} onChange={(e) => { setStepType(e.target.value as "video" | "ppt" | "level"); setPickedLevel(null); }}>
            {Object.entries(STEP_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>

        {stepType === "level" ? (
          <>
            <p className="text-xs text-muted-foreground">从全部 Activity 里搜索/筛选——不限于某一门课，这就是题库复用，不是重新做一个。同一个 Activity 也能被好几个不同课时引用。</p>
            <div className="flex flex-wrap gap-2">
              <Input placeholder="搜索标题/编号..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[220px]" />
              <select className="border rounded-md p-2 text-sm" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                <option value="">全部 Subject</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name_zh}</option>)}
              </select>
              <select className="border rounded-md p-2 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!subjectId}>
                <option value="">全部 Topic</option>
                {topics.map((t) => <option key={t.id} value={t.id}>{t.name_zh}</option>)}
              </select>
            </div>

            {pickedLevel && (
              <div className="flex items-center gap-2 bg-primary/5 border border-primary/30 rounded-lg px-3 py-2 text-sm">
                <span className="flex-1">已选：{pickedLevel.label}</span>
                <button type="button" onClick={() => setPickedLevel(null)} className="text-muted-foreground hover:text-destructive text-xs">✕ 换一个</button>
              </div>
            )}

            <div className="max-h-[320px] overflow-y-auto rounded-lg border border-border">
              {loading ? (
                <p className="text-sm text-muted-foreground text-center py-8">搜索中...</p>
              ) : results.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">没有符合条件的 Activity</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {results.map((a) => {
                      const label = `${MODULE_LABELS[a.module_type]?.emoji ?? "❓"} ${a.title_i18n?.zh ?? a.title_i18n?.en ?? a.module_type}`;
                      return (
                        <tr key={a.id} className={`border-b border-border last:border-0 hover:bg-muted/50 ${pickedLevel?.id === a.id ? "bg-primary/10" : ""}`}>
                          <td className="px-3 py-2">
                            <div className="font-medium">{label}</div>
                            <div className="text-xs text-muted-foreground">
                              {a.exercise_number ?? "未编号"}
                              {a.topics.length > 0 && <> · {a.topics.map((t) => t.topic_name_zh).filter(Boolean).join("、")}</>}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button size="sm" variant={pickedLevel?.id === a.id ? "outline" : "default"} onClick={() => setPickedLevel({ id: a.id, label })}>
                              {pickedLevel?.id === a.id ? "已选" : "选它"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <>
            <div><Label>{stepType === "video" ? "视频链接" : "PPT链接"}</Label><Input placeholder="https://..." value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} /></div>
            <div><Label>标题（选填）</Label><Input placeholder="如：数字介绍视频" value={mediaTitle} onChange={(e) => setMediaTitle(e.target.value)} /></div>
          </>
        )}
        <Button className="w-full" onClick={handleSave}>加入步骤</Button>
      </div>
    </Modal>
  );
}

type LessonSortKey = "title" | "step_count";

function LessonsCard({ courseId }: { courseId: string }) {
  const [lessons, setLessons] = useState<Array<{ id: string; title_i18n: Record<string,string>; step_count: number }>>([]);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [lessonDetail, setLessonDetail] = useState<Awaited<ReturnType<typeof lessonsApi.getLesson>> | null>(null);
  const [showLessonModal, setShowLessonModal] = useState(false);
  const [showStepModal, setShowStepModal] = useState(false);
  const [editingLesson, setEditingLesson] = useState<{ id: string; title_i18n: Record<string,string> } | null>(null);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<LessonSortKey>("title");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  function refreshLessons() { lessonsApi.listLessons(courseId).then(setLessons); }
  useEffect(refreshLessons, [courseId]);

  function refreshDetail(lessonId: string) { lessonsApi.getLesson(lessonId).then(setLessonDetail); }
  function selectLesson(id: string) { setSelectedLessonId(id); refreshDetail(id); }

  function toggleSort(key: LessonSortKey) {
    if (sortKey === key) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortOrder("asc"); }
  }

  async function handleDeleteStep(stepId: string) {
    await lessonsApi.deleteStep(stepId);
    if (selectedLessonId) refreshDetail(selectedLessonId);
    refreshLessons();
  }

  async function handleMoveStep(stepId: string, direction: "up" | "down") {
    await lessonsApi.moveStep(stepId, direction);
    if (selectedLessonId) refreshDetail(selectedLessonId);
  }

  async function handleDeleteLesson(lesson: { id: string; title_i18n: Record<string,string> }) {
    if (!window.confirm(`确定要删除课时「${lesson.title_i18n?.zh ?? lesson.title_i18n?.en}」吗？里面的步骤会一并删除，没办法撤销。`)) return;
    try {
      await lessonsApi.deleteLesson(lesson.id);
      toast.success("已删除");
      if (selectedLessonId === lesson.id) { setSelectedLessonId(null); setLessonDetail(null); }
      refreshLessons();
    } catch { toast.error("删除失败"); }
  }

  const visibleLessons = useMemo(() => {
    const q = search.trim().toLowerCase();
    const f = q ? lessons.filter((l) => (l.title_i18n?.zh ?? l.title_i18n?.en ?? "").toLowerCase().includes(q)) : lessons;
    return [...f].sort((a, b) => {
      const cmp = sortKey === "title"
        ? (a.title_i18n?.zh ?? "").localeCompare(b.title_i18n?.zh ?? "")
        : a.step_count - b.step_count;
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [lessons, search, sortKey, sortOrder]);

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>课时 / 教案</CardTitle>
          <Button size="sm" onClick={() => setShowLessonModal(true)}>+ 新建课时</Button>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <Input placeholder="搜索课时名称..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[220px]" />
          </div>

          {visibleLessons.length === 0 ? (
            <EmptyState title={search ? "没有符合条件的课时" : "还没有课时"} description={search ? "换个搜索词试试" : "课时是视频/PPT/Activity按顺序组成的教案，点右上角新建一个"} />
          ) : (
            <>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                      <SortHeader label="课时名称" active={sortKey === "title"} order={sortOrder} onClick={() => toggleSort("title")} />
                      <SortHeader label="步骤数" active={sortKey === "step_count"} order={sortOrder} onClick={() => toggleSort("step_count")} />
                      <th className="py-2.5 px-3 font-medium">view</th>
                      <th className="py-2.5 px-3 font-medium">edit</th>
                      <th className="py-2.5 px-3 font-medium">delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLessons.map((l) => (
                      <tr key={l.id} className={`border-b border-border last:border-0 transition-colors ${selectedLessonId === l.id ? "bg-muted" : "hover:bg-muted/50"}`}>
                        <td className="py-2.5 px-3 font-medium">{l.title_i18n?.zh ?? l.title_i18n?.en}</td>
                        <td className="px-3"><Badge variant="outline">{l.step_count} 个步骤</Badge></td>
                        <td className="px-3">
                          <button type="button" onClick={() => selectLesson(l.id)} className="text-primary text-xs font-medium hover:underline">查看步骤</button>
                        </td>
                        <td className="px-3">
                          <button type="button" onClick={() => setEditingLesson(l)} className="text-muted-foreground text-xs font-medium hover:text-foreground hover:underline">编辑</button>
                        </td>
                        <td className="px-3">
                          <button type="button" onClick={() => handleDeleteLesson(l)} className="text-red-500 text-xs font-medium hover:text-red-600 hover:underline">删除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">Number of Records: {visibleLessons.length}</div>
            </>
          )}
        </CardContent>
      </Card>

      {selectedLessonId && lessonDetail && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{lessonDetail.title_i18n?.zh ?? lessonDetail.title_i18n?.en} — 步骤顺序</CardTitle>
            <div className="flex gap-2">
              <a href={`/lesson/${selectedLessonId}`} target="_blank" rel="noreferrer" className="text-primary text-xs font-medium hover:underline self-center">试玩课时 →</a>
              <Button size="sm" onClick={() => setShowStepModal(true)}>+ 加步骤</Button>
            </div>
          </CardHeader>
          <CardContent>
            {lessonDetail.steps.length === 0 ? (
              <EmptyState title="这个课时还没有步骤" description="点右上角加一个——视频、PPT、或是从题库选一个 Activity" />
            ) : (
              <ol className="space-y-2">
                {lessonDetail.steps.map((s, i) => (
                  <li key={s.id} className="flex items-center justify-between border border-border rounded-lg p-3 text-sm">
                    <span>
                      <span className="text-muted-foreground mr-2">{i + 1}.</span>
                      <Badge variant="outline" className="mr-2">{STEP_TYPE_LABELS[s.step_type]}</Badge>
                      {s.step_type === "level"
                        ? `${MODULE_LABELS[s.module_type ?? ""]?.emoji ?? ""} ${s.level_title_i18n?.zh ?? s.level_title_i18n?.en ?? s.module_type}`
                        : (s.media_title || s.media_url)}
                    </span>
                    <span className="flex items-center gap-2">
                      <button onClick={() => handleMoveStep(s.id, "up")} disabled={i === 0} className="text-muted-foreground hover:text-primary disabled:opacity-30 disabled:hover:text-muted-foreground text-sm px-1">▲</button>
                      <button onClick={() => handleMoveStep(s.id, "down")} disabled={i === lessonDetail.steps.length - 1} className="text-muted-foreground hover:text-primary disabled:opacity-30 disabled:hover:text-muted-foreground text-sm px-1">▼</button>
                      <button onClick={() => handleDeleteStep(s.id)} className="text-muted-foreground hover:text-red-500 text-xs ml-1">删除</button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      )}

      <AddLessonModal open={showLessonModal} onClose={() => setShowLessonModal(false)} courseId={courseId} onSaved={refreshLessons} />
      <EditLessonModal lesson={editingLesson} onClose={() => setEditingLesson(null)} onSaved={() => { refreshLessons(); if (selectedLessonId) refreshDetail(selectedLessonId); }} />
      <AddStepModal
        open={showStepModal} onClose={() => setShowStepModal(false)} lessonId={selectedLessonId}
        onSaved={() => selectedLessonId && refreshDetail(selectedLessonId)}
      />
    </>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
type SortKey = "title" | "created_at" | "grade_tier";

export default function CourseLessonPage() {
  const [tiers, setTiers] = useState<GradeTier[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedCourseId = searchParams.get("course");
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [viewingCourse, setViewingCourse] = useState<Course | null>(null);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);

  const [search, setSearch] = useState("");
  const [filterTierId, setFilterTierId] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const PAGE_SIZE = 10;

  function refreshTiers() { eduApi.listGradeTiers().then(setTiers); }
  function refreshCourses() {
    eduApi.listCourses({
      search: search || undefined, grade_tier_id: filterTierId || undefined,
      sort: sortKey, order: sortOrder, page, limit: PAGE_SIZE,
    }).then((r) => { setCourses(r.data); setMeta(r.meta); });
  }
  useEffect(() => { refreshTiers(); }, []);
  useEffect(refreshCourses, [search, filterTierId, sortKey, sortOrder, page]);
  useEffect(() => { setPage(1); }, [search, filterTierId, sortKey, sortOrder]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortOrder("desc"); }
  }
  function goManageLessons(id: string) { setSearchParams({ course: id }); }
  function backToCourseList() { setSearchParams({}); }

  async function handleDeleteCourse(course: Course) {
    if (!window.confirm(`确定要删除课程「${course.title_i18n?.zh ?? course.title_i18n?.en}」吗？这个操作没办法撤销。`)) return;
    try {
      await eduApi.deleteCourse(course.id);
      toast.success("已删除");
      refreshCourses();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "删除失败";
      // 底下还有 Activity/课时，后端拦住了——问要不要强制删除，讲清楚
      // 强制删除具体会发生什么，不是无脑重试。
      if (msg.includes("请先清空或转移")) {
        const confirmForce = window.confirm(
          `${msg}\n\n也可以选择"强制删除"：\n· 底下的 Activity 会保留，只是解除跟这门课的关联，之后还能被别的课时单独引用\n· 底下的课时(Lesson)会连同步骤一起被删掉，没办法恢复\n\n要强制删除吗？`
        );
        if (!confirmForce) return;
        try {
          await eduApi.deleteCourse(course.id, true);
          toast.success("已删除（Activity 已保留、解除关联；课时已一起清空）");
          refreshCourses();
        } catch { toast.error("删除失败"); }
      } else {
        toast.error(msg);
      }
    }
  }

  const selectedCourse = courses.find((c) => c.id === selectedCourseId);

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-16">
      {!selectedCourseId && (
      <>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">课程与课时管理</h1>
        <p className="text-sm text-muted-foreground mt-0.5">建立课程、编排课时（视频/PPT/Activity 按顺序组成的教案）——Activity 本身的建立/编辑去「Activity 设计管理」</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>课程列表</CardTitle>
          <Button size="sm" onClick={() => setShowCourseModal(true)}>+ 新建课程</Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            <Input placeholder="搜索课程名称..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[220px]" />
            <select className={`${SELECT_CLASS} w-auto`} value={filterTierId} onChange={(e) => setFilterTierId(e.target.value)}>
              <option value="">全部等级</option>
              {tiers.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name_i18n?.zh ?? t.name_i18n?.en}</option>)}
            </select>
          </div>

          {courses.length === 0 ? (
            <EmptyState title={search || filterTierId ? "没有符合条件的课程" : "还没有课程"} description={search || filterTierId ? "换个搜索词或筛选条件试试" : "点右上角新建一个"} />
          ) : (
            <>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                      <SortHeader label="课程名称" active={sortKey === "title"} order={sortOrder} onClick={() => toggleSort("title")} />
                      <SortHeader label="等级" active={sortKey === "grade_tier"} order={sortOrder} onClick={() => toggleSort("grade_tier")} />
                      <SortHeader label="建立时间" active={sortKey === "created_at"} order={sortOrder} onClick={() => toggleSort("created_at")} />
                      <th className="py-2.5 px-3 font-medium">view</th>
                      <th className="py-2.5 px-3 font-medium">edit</th>
                      <th className="py-2.5 px-3 font-medium">delete</th>
                      <th className="py-2.5 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.map((c) => (
                      <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 px-3 font-medium">{c.title_i18n?.zh ?? c.title_i18n?.en}</td>
                        <td className="px-3">{c.grade_tier_code ? <Badge variant="outline">{c.grade_tier_code}</Badge> : <span className="text-muted-foreground text-xs">未分级</span>}</td>
                        <td className="px-3 text-muted-foreground text-xs">{c.created_at ? new Date(c.created_at).toLocaleDateString() : ""}</td>
                        <td className="px-3">
                          <button type="button" onClick={() => setViewingCourse(c)} className="text-primary text-xs font-medium hover:underline">查看</button>
                        </td>
                        <td className="px-3">
                          <button type="button" onClick={() => setEditingCourse(c)} className="text-muted-foreground text-xs font-medium hover:text-foreground hover:underline">编辑</button>
                        </td>
                        <td className="px-3">
                          <button type="button" onClick={() => handleDeleteCourse(c)} className="text-red-500 text-xs font-medium hover:text-red-600 hover:underline">删除</button>
                        </td>
                        <td className="px-3 text-right text-primary text-xs font-medium whitespace-nowrap">
                          <button type="button" onClick={() => goManageLessons(c.id)} className="hover:underline">管理课时 →</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                <span>共 {meta.total} 门课，第 {meta.page} / {meta.totalPages} 页</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</Button>
                  <Button size="sm" variant="outline" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      </>
      )}

      {selectedCourseId && (
        <>
        <div>
          <button onClick={backToCourseList} className="text-sm font-medium text-primary hover:underline">← 返回课程列表</button>
        </div>
        <div>
          <h1 className="text-xl font-bold">{selectedCourse?.title_i18n?.zh ?? selectedCourse?.title_i18n?.en} — 课时管理</h1>
        </div>
        <LessonsCard courseId={selectedCourseId} />
        </>
      )}

      <AddCourseModal open={showCourseModal} onClose={() => setShowCourseModal(false)} tiers={tiers} onSaved={refreshCourses} />
      <ViewCourseModal course={viewingCourse} onClose={() => setViewingCourse(null)} />
      <EditCourseModal course={editingCourse} tiers={tiers} onClose={() => setEditingCourse(null)} onSaved={refreshCourses} />
    </div>
  );
}
