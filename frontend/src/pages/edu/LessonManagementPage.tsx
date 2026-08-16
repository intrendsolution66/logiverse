// frontend/src/pages/edu/LessonManagementPage.tsx
//
// 课程与课时管理——把已经建好、但从来没有前端页面用过的一整套后端接口
// (lessonsApi + eduApi.listAllActivities) 接起来。三层结构：
//   Course（自主学习课程）→ Lesson（课时，有顺序）→ Step（视频/PPT/
//   引用一个 Activity，也有顺序）
//
// 核心是"选 Activity 那一步"——课程设计者在这里加 level 类型的步骤时，
// 不再局限于某个范围，而是能搜索/按 Subject/Topic 筛选全部 Activity，
// 同一个 Activity 也能被好几个不同 Lesson、好几个不同 Course 引用（后端
// lesson_steps.course_level_id 就是个普通外键，没有唯一约束限制这件事）。

import { useState, useEffect, useCallback } from "react";
import { eduApi, lessonsApi, taxonomyApi, exerciseClassificationApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

interface Course { id: string; title_i18n: Record<string, string>; age_group?: string; grade_tier_id?: string; grade_tier_name_i18n?: Record<string, string> }
interface Lesson { id: string; title_i18n: Record<string, string>; order_index: number; created_at: string; step_count: number }
interface Step {
  id: string; order_index: number; step_type: "video" | "ppt" | "level" | "quiz";
  media_url?: string; media_title?: string; slide_urls?: string[];
  course_level_id?: string; level_title_i18n?: Record<string, string>; module_type?: string;
  bank_question_id?: string; bank_category?: string; bank_question_type?: string; bank_question_preview?: string;
}
interface GradeTier { id: string; code: string; name_i18n: Record<string, string> }

const MODULE_EMOJI: Record<string, string> = {
  counting: "🔢", spot_diff: "🔍", focus_tap: "🎯", memory: "🃏", pattern: "🧩",
  word_problem: "📝", maze: "🧭", sudoku: "🔢", line_match: "🔗", coloring: "🎨",
  ppt_lecture: "📊", video_lecture: "🎬",
};
const STEP_TYPE_LABELS: Record<string, string> = { video: "🎬 视频", ppt: "📊 PPT", level: "🎮 Activity", quiz: "📝 练习题（考试题库）" };

function zh(obj?: Record<string, string>): string { return obj?.zh ?? obj?.en ?? "（未命名）"; }

// ── Activity 选择器——搜索/筛选全部 Activity，不限制范围 ──────────────────────
function ActivityPickerModal({ open, onClose, onPick }: {
  open: boolean; onClose: () => void; onPick: (activity: { id: string; title_i18n?: Record<string, string> }) => void;
}) {
  const [search, setSearch] = useState("");
  const [subjects, setSubjects] = useState<Array<{ id: string; name_zh: string }>>([]);
  const [topics, setTopics] = useState<Array<{ id: string; name_zh: string; subject_id?: string }>>([]);
  const [subjectId, setSubjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [results, setResults] = useState<Array<{
    id: string; module_type: string; title_i18n?: Record<string, string>; exercise_number?: string;
    course_title_i18n?: Record<string, string>;
    topics: Array<{ category_id: string; topic_name_zh?: string; subject_name_zh?: string }>;
  }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (open) taxonomyApi.listSubjects().then((ss) => setSubjects(ss.map((s) => ({ id: s.id, name_zh: s.name_zh })))); }, [open]);
  useEffect(() => {
    setCategoryId("");
    if (subjectId) exerciseClassificationApi.listCategories(subjectId).then((cs) => setTopics(cs.map((c) => ({ id: c.id, name_zh: c.name_zh, subject_id: c.subject_id }))));
    else setTopics([]);
  }, [subjectId]);

  const refresh = useCallback(() => {
    if (!open) return;
    setLoading(true);
    eduApi.listAllActivities({
      search: search || undefined, subject_id: subjectId || undefined, category_id: categoryId || undefined,
      sort: "created_at", order: "desc", page: 1, limit: 30,
    }).then((r) => setResults(r.data)).finally(() => setLoading(false));
  }, [open, search, subjectId, categoryId]);
  useEffect(refresh, [refresh]);

  return (
    <Modal open={open} onClose={onClose} title="选一个 Activity 加进这个课时" size="lg">
      <div className="space-y-3">
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

        <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">搜索中...</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">没有符合条件的 Activity</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {results.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                    <td className="px-3 py-2 text-lg">{MODULE_EMOJI[a.module_type] ?? "❓"}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{zh(a.title_i18n)}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.exercise_number ?? "未编号"}
                        {a.topics.length > 0 && <> · {a.topics.map((t) => t.topic_name_zh).filter(Boolean).join("、")}</>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" onClick={() => { onPick(a); onClose(); }}>+ 加入</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── 加视频/PPT步骤 ─────────────────────────────────────────────────────────────
function AddMediaStepModal({ open, stepType, onClose, onSaved }: {
  open: boolean; stepType: "video" | "ppt" | null; onClose: () => void; onSaved: (b: { step_type: string; media_url: string; media_title?: string }) => void;
}) {
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaTitle, setMediaTitle] = useState("");

  function handleSave() {
    if (!mediaUrl.trim()) { toast.error("请填资源链接"); return; }
    onSaved({ step_type: stepType!, media_url: mediaUrl.trim(), media_title: mediaTitle.trim() || undefined });
    setMediaUrl(""); setMediaTitle("");
    onClose();
  }

  return (
    <Modal open={open && !!stepType} onClose={onClose} title={`加${stepType === "video" ? "视频" : "PPT"}步骤`} size="sm">
      <div className="space-y-3">
        <div><Label>资源链接</Label><Input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="https://..." /></div>
        <div><Label>标题（选填）</Label><Input value={mediaTitle} onChange={(e) => setMediaTitle(e.target.value)} /></div>
        <Button className="w-full" onClick={handleSave}>加入</Button>
      </div>
    </Modal>
  );
}

// ── 加课时 ─────────────────────────────────────────────────────────────────────
function AddLessonModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (title: string) => void }) {
  const [title, setTitle] = useState("");
  function handleSave() {
    if (!title.trim()) { toast.error("课时标题要填"); return; }
    onSaved(title.trim());
    setTitle("");
    onClose();
  }
  return (
    <Modal open={open} onClose={onClose} title="新增课时 (Lesson)" size="sm">
      <div className="space-y-3">
        <div><Label>标题</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：第一课 认识数字" /></div>
        <Button className="w-full" onClick={handleSave}>建立</Button>
      </div>
    </Modal>
  );
}

// ── 新建课程（极简——只用来让这个页面在没有任何课程时也能起步） ──────────────────
function AddCourseModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [gradeTierId, setGradeTierId] = useState("");
  const [gradeTiers, setGradeTiers] = useState<GradeTier[]>([]);
  useEffect(() => { if (open) eduApi.listGradeTiers().then(setGradeTiers); }, [open]);

  async function handleSave() {
    if (!title.trim()) { toast.error("课程标题要填"); return; }
    if (!gradeTierId) { toast.error("请选年级"); return; }
    try {
      await eduApi.createCourse({ title_i18n: { zh: title.trim(), en: title.trim() }, grade_tier_id: gradeTierId });
      toast.success("课程建好了");
      setTitle(""); setGradeTierId("");
      onSaved(); onClose();
    } catch { toast.error("建立失败"); }
  }

  return (
    <Modal open={open} onClose={onClose} title="新增课程 (Course)" size="sm">
      <div className="space-y-3">
        <div><Label>标题</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：一年级数学" /></div>
        <div>
          <Label>年级</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={gradeTierId} onChange={(e) => setGradeTierId(e.target.value)}>
            <option value="">选年级...</option>
            {gradeTiers.map((g) => <option key={g.id} value={g.id}>{zh(g.name_i18n)}</option>)}
          </select>
        </div>
        <Button className="w-full" onClick={handleSave}>建立</Button>
      </div>
    </Modal>
  );
}

// ── 一个课时展开后的步骤列表 ─────────────────────────────────────────────────────
function LessonPanel({ lesson, onRefreshLessons }: { lesson: Lesson; onRefreshLessons: () => void }) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [mediaStepType, setMediaStepType] = useState<"video" | "ppt" | null>(null);

  function refresh() { lessonsApi.getLesson(lesson.id).then((l) => setSteps(l.steps)); }
  useEffect(refresh, [lesson.id]);

  async function addLevelStep(activity: { id: string }) {
    try {
      await lessonsApi.createStep(lesson.id, { step_type: "level", course_level_id: activity.id });
      toast.success("已加入");
      refresh(); onRefreshLessons();
    } catch { toast.error("加入失败"); }
  }

  async function addMediaStep(b: { step_type: string; media_url: string; media_title?: string }) {
    try {
      await lessonsApi.createStep(lesson.id, b);
      toast.success("已加入");
      refresh(); onRefreshLessons();
    } catch { toast.error("加入失败"); }
  }

  async function move(stepId: string, direction: "up" | "down") {
    await lessonsApi.moveStep(stepId, direction);
    refresh();
  }

  async function removeStep(stepId: string) {
    if (!window.confirm("确定要删除这个步骤吗？")) return;
    await lessonsApi.deleteStep(stepId);
    toast.success("已删除");
    refresh(); onRefreshLessons();
  }

  return (
    <div className="pl-4 space-y-2 border-l-2 border-border ml-4 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => setShowPicker(true)}>🎮 加 Activity 步骤</Button>
        <Button size="sm" variant="outline" onClick={() => setMediaStepType("video")}>🎬 加视频步骤</Button>
        <Button size="sm" variant="outline" onClick={() => setMediaStepType("ppt")}>📊 加 PPT 步骤</Button>
      </div>

      {steps === null ? (
        <p className="text-xs text-muted-foreground">加载中...</p>
      ) : steps.length === 0 ? (
        <p className="text-xs text-muted-foreground">这个课时还没有步骤——上面加一个。</p>
      ) : (
        <div className="space-y-1.5">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2 bg-card rounded-lg border border-border px-3 py-1.5 text-sm">
              <Badge variant="outline">{STEP_TYPE_LABELS[s.step_type]}</Badge>
              <span className="flex-1 truncate">
                {s.step_type === "level"
                  ? `${MODULE_EMOJI[s.module_type ?? ""] ?? ""} ${zh(s.level_title_i18n)}`
                  : (s.media_title || s.media_url || "（未命名）")}
              </span>
              <button type="button" disabled={i === 0} onClick={() => move(s.id, "up")} className="text-muted-foreground hover:text-foreground disabled:opacity-30">▲</button>
              <button type="button" disabled={i === steps.length - 1} onClick={() => move(s.id, "down")} className="text-muted-foreground hover:text-foreground disabled:opacity-30">▼</button>
              <button type="button" onClick={() => removeStep(s.id)} className="text-red-500 hover:text-red-600 text-xs">删除</button>
            </div>
          ))}
        </div>
      )}

      <ActivityPickerModal open={showPicker} onClose={() => setShowPicker(false)} onPick={addLevelStep} />
      <AddMediaStepModal open={!!mediaStepType} stepType={mediaStepType} onClose={() => setMediaStepType(null)} onSaved={addMediaStep} />
    </div>
  );
}

export default function LessonManagementPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [showAddLesson, setShowAddLesson] = useState(false);

  function refreshCourses() { eduApi.listCourses({ limit: 100 }).then((r) => setCourses(r.data)); }
  useEffect(refreshCourses, []);

  function refreshLessons() { if (courseId) lessonsApi.listLessons(courseId).then(setLessons); else setLessons([]); }
  useEffect(refreshLessons, [courseId]);

  async function handleAddLesson(title: string) {
    try {
      await lessonsApi.createLesson(courseId, { title_i18n: { zh: title, en: title }, order_index: lessons.length });
      toast.success("课时建好了");
      refreshLessons();
    } catch { toast.error("建立失败"); }
  }

  async function handleDeleteLesson(lesson: Lesson) {
    if (!window.confirm(`确定要删除「${zh(lesson.title_i18n)}」这个课时吗？底下的步骤会一起删掉，这个操作没办法撤销。`)) return;
    try {
      await lessonsApi.deleteLesson(lesson.id);
      toast.success("已删除");
      refreshLessons();
    } catch { toast.error("删除失败"); }
  }

  async function handleDeleteCourse() {
    if (!courseId || !selectedCourse) return;
    if (!window.confirm(`确定要删除「${zh(selectedCourse.title_i18n)}」这门课程吗？`)) return;
    try {
      await eduApi.deleteCourse(courseId);
      toast.success("已删除");
      setCourseId(""); refreshCourses();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "";
      // 后端拦住了（底下还有Activity/课时）——问要不要强制删除，讲清楚
      // 强制删除具体会发生什么，不是无脑重试。
      if (msg.includes("请先清空或转移")) {
        const confirmForce = window.confirm(
          `${msg}\n\n也可以选择"强制删除"：\n· 底下的 Activity 会保留，只是解除跟这门课的关联，之后还能被别的课时单独引用\n· 底下的课时(Lesson)会连同步骤一起被删掉，没办法恢复\n\n要强制删除吗？`
        );
        if (!confirmForce) return;
        try {
          await eduApi.deleteCourse(courseId, true);
          toast.success("已删除（Activity 已保留、解除关联；课时已一起清空）");
          setCourseId(""); refreshCourses();
        } catch { toast.error("删除失败"); }
      } else {
        toast.error(msg || "删除失败");
      }
    }
  }

  const selectedCourse = courses.find((c) => c.id === courseId);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">课程与课时管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Course → Lesson → 步骤（视频/PPT/引用一个Activity）。加 Activity 步骤时能搜索、按 Subject/Topic 筛选全部 Activity——不限于某个范围，同一个 Activity 也能被好几个不同课时引用。
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAddCourse(true)}>+ 新增课程</Button>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <Label>选课程</Label>
          {courses.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有课程——先点右上角"+ 新增课程"建一个。</p>
          ) : (
            <div className="flex gap-2 items-center">
              <select className="w-full border rounded-md p-2 text-sm" value={courseId} onChange={(e) => { setCourseId(e.target.value); setExpandedLessonId(null); }}>
                <option value="">选一门课程...</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{zh(c.title_i18n)}{c.grade_tier_name_i18n ? `（${zh(c.grade_tier_name_i18n)}）` : ""}</option>)}
              </select>
              {courseId && (
                <Button size="sm" variant="outline" onClick={handleDeleteCourse} className="shrink-0 text-red-500 hover:text-red-600">删除课程</Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {courseId && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{zh(selectedCourse?.title_i18n)} 的课时</h2>
              <Button size="sm" variant="outline" onClick={() => setShowAddLesson(true)}>+ 新增课时</Button>
            </div>

            {lessons.length === 0 ? (
              <EmptyState title="这门课还没有课时" description="点上面「+ 新增课时」建第一个" />
            ) : (
              <div className="space-y-2">
                {lessons.map((l) => (
                  <div key={l.id} className="rounded-lg border border-border">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <button
                        type="button" onClick={() => setExpandedLessonId((id) => (id === l.id ? null : l.id))}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {expandedLessonId === l.id ? "▾" : "▸"}
                      </button>
                      <span className="font-medium flex-1">{zh(l.title_i18n)}</span>
                      <span className="text-xs text-muted-foreground">{l.step_count} 个步骤</span>
                      <button type="button" onClick={() => handleDeleteLesson(l)} className="text-red-500 hover:text-red-600 text-xs font-medium">删除</button>
                    </div>
                    {expandedLessonId === l.id && <LessonPanel lesson={l} onRefreshLessons={refreshLessons} />}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <AddCourseModal open={showAddCourse} onClose={() => setShowAddCourse(false)} onSaved={refreshCourses} />
      <AddLessonModal open={showAddLesson} onClose={() => setShowAddLesson(false)} onSaved={handleAddLesson} />
    </div>
  );
}