// frontend/src/pages/edu/CourseLessonPage.tsx
//
// 课程与课时管理 — split out of what used to be CourseDesignerPage.tsx.
// That page used to be "browse courses → manage this course's Activities
// AND its lessons" all in one place; Activity management moved to its own
// flat, searchable/filterable/sortable table (see the rewritten
// CourseDesignerPage.tsx), and this page keeps just the two things that
// still genuinely belong together: creating/browsing Courses (the
// container), and building Lesson plans (video/PPT/Activity steps in
// sequence) within a course. A Lesson doesn't make sense without a course
// to belong to, so these two stay paired — unlike Activity management,
// which conceptually organizes around Programme/Subject/Topic instead of
// which course something happens to live in.

import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { eduApi, lessonsApi } from "@/api/index";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

interface GradeTier { id: string; code: string; name_i18n: Record<string,string>; age_min?: number; age_max?: number }
interface Course { id: string; title_i18n: Record<string,string>; grade_tier_code?: string; grade_tier_name_i18n?: Record<string,string>; created_at?: string }

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

// ── Modal: add course ─────────────────────────────────────────────────────────
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

// Adding a "level" step pulls from ANY course's levels — this is the actual
// 题库 reuse in action: a maze level authored under one course can become a
// step in a completely different course's lesson.
function AddStepModal({ open, onClose, lessonId, onSaved }: { open: boolean; onClose: () => void; lessonId: string | null; onSaved: () => void }) {
  const [stepType, setStepType] = useState<"video" | "ppt" | "level">("video");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaTitle, setMediaTitle] = useState("");
  const [pickCourses, setPickCourses] = useState<Array<{ id: string; title_i18n: Record<string,string> }>>([]);
  const [pickCourseId, setPickCourseId] = useState("");
  const [pickLevels, setPickLevels] = useState<Array<{ id: string; title_i18n?: Record<string,string>; module_type: string; order_index: number }>>([]);
  const [pickLevelId, setPickLevelId] = useState("");

  useEffect(() => { if (open) eduApi.listCourses({ limit: 100 }).then((r) => setPickCourses(r.data)); }, [open]);
  useEffect(() => { if (pickCourseId) eduApi.listLevels(pickCourseId).then(setPickLevels); else setPickLevels([]); }, [pickCourseId]);

  function reset() {
    setStepType("video"); setMediaUrl(""); setMediaTitle("");
    setPickCourseId(""); setPickLevelId("");
  }

  async function handleSave() {
    if (!lessonId) return;
    try {
      if (stepType === "level") {
        if (!pickLevelId) { toast.error("请选一个 Activity"); return; }
        await lessonsApi.createStep(lessonId, { step_type: "level", course_level_id: pickLevelId });
      } else {
        if (!mediaUrl.trim()) { toast.error("请输入链接"); return; }
        await lessonsApi.createStep(lessonId, { step_type: stepType, media_url: mediaUrl.trim(), media_title: mediaTitle || undefined });
      }
      toast.success("步骤加好了");
      reset(); onSaved(); onClose();
    } catch { toast.error("新增失败（可能没有权限）"); }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="加步骤" size="sm">
      <div className="space-y-3">
        <div>
          <Label>步骤类型</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={stepType} onChange={(e) => setStepType(e.target.value as "video" | "ppt" | "level")}>
            {Object.entries(STEP_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>

        {stepType === "level" ? (
          <>
            <p className="text-xs text-muted-foreground">从任何课程的已有 Activity 里选——这就是题库复用，不是重新做一个。</p>
            <div>
              <Label>课程</Label>
              <select className="w-full border rounded-md p-2 text-sm" value={pickCourseId} onChange={(e) => { setPickCourseId(e.target.value); setPickLevelId(""); }}>
                <option value="">选课程...</option>
                {pickCourses.map((c) => <option key={c.id} value={c.id}>{c.title_i18n?.zh ?? c.title_i18n?.en}</option>)}
              </select>
            </div>
            <div>
              <Label>Activity</Label>
              <select className="w-full border rounded-md p-2 text-sm" value={pickLevelId} onChange={(e) => setPickLevelId(e.target.value)} disabled={!pickCourseId}>
                <option value="">选 Activity...</option>
                {pickLevels.map((lv) => <option key={lv.id} value={lv.id}>{MODULE_LABELS[lv.module_type]?.emoji} {lv.title_i18n?.zh ?? lv.title_i18n?.en ?? lv.module_type}</option>)}
              </select>
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

function LessonsCard({ courseId }: { courseId: string }) {
  const [lessons, setLessons] = useState<Array<{ id: string; title_i18n: Record<string,string>; step_count: number }>>([]);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [lessonDetail, setLessonDetail] = useState<Awaited<ReturnType<typeof lessonsApi.getLesson>> | null>(null);
  const [showLessonModal, setShowLessonModal] = useState(false);
  const [showStepModal, setShowStepModal] = useState(false);

  function refreshLessons() { lessonsApi.listLessons(courseId).then(setLessons); }
  useEffect(refreshLessons, [courseId]);

  function refreshDetail(lessonId: string) { lessonsApi.getLesson(lessonId).then(setLessonDetail); }
  function selectLesson(id: string) { setSelectedLessonId(id); refreshDetail(id); }

  async function handleDeleteStep(stepId: string) {
    await lessonsApi.deleteStep(stepId);
    if (selectedLessonId) refreshDetail(selectedLessonId);
    refreshLessons();
  }

  async function handleMoveStep(stepId: string, direction: "up" | "down") {
    await lessonsApi.moveStep(stepId, direction);
    if (selectedLessonId) refreshDetail(selectedLessonId);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>课时 / 教案</CardTitle>
          <Button size="sm" onClick={() => setShowLessonModal(true)}>+ 新建课时</Button>
        </CardHeader>
        <CardContent>
          {lessons.length === 0 ? (
            <EmptyState title="还没有课时" description="课时是视频/PPT/Activity按顺序组成的教案，点右上角新建一个" />
          ) : (
            <div className="space-y-2">
              {lessons.map((l) => (
                <div key={l.id} className={`border border-border rounded-lg p-3 cursor-pointer transition-colors ${selectedLessonId === l.id ? "bg-muted" : "hover:bg-muted/50"}`} onClick={() => selectLesson(l.id)}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{l.title_i18n?.zh ?? l.title_i18n?.en}</span>
                    <Badge variant="outline">{l.step_count} 个步骤</Badge>
                  </div>
                </div>
              ))}
            </div>
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
  function selectCourse(id: string) { setSearchParams({ course: id }); }
  function backToCourseList() { setSearchParams({}); }

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
                      <th className="py-2.5 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {courses.map((c) => (
                      <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => selectCourse(c.id)}>
                        <td className="py-2.5 px-3 font-medium">{c.title_i18n?.zh ?? c.title_i18n?.en}</td>
                        <td className="px-3">{c.grade_tier_code ? <Badge variant="outline">{c.grade_tier_code}</Badge> : <span className="text-muted-foreground text-xs">未分级</span>}</td>
                        <td className="px-3 text-muted-foreground text-xs">{c.created_at ? new Date(c.created_at).toLocaleDateString() : ""}</td>
                        <td className="px-3 text-right text-primary text-xs font-medium whitespace-nowrap">管理课时 →</td>
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
    </div>
  );
}
