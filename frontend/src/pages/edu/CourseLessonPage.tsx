// frontend/src/pages/edu/CourseLessonPage.tsx
//
// 课程与课时管理 — 这次补上：
//   课程列表：独立的 查看/编辑/删除 列（之前只能新建+点行进课时管理）
//   课时列表：从卡片堆叠改成表格，加搜索/排序/record数量，加 编辑（改名）/
//     删除（之前只能删里面的步骤，删不掉课时本身）
// 课程列表本身的搜索/筛选/排序/分页是服务端的（之前就有，没动），课时列表
// 因为通常一门课下面数量不多，用客户端搜索/排序即可。

import { useState, useEffect, useMemo, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { eduApi, lessonsApi, taxonomyApi, exerciseClassificationApi, examApi } from "@/api";
import { Button } from "@/components/ui/button";
import { Input, Label, Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui/index";
import { Modal } from "@/components/ui/modal";
import { Eye, PencilLine, Trash2, ChevronRight, BookOpen, GraduationCap } from "lucide-react";
import AssetPicker from "@/components/AssetPicker";
import { shareLinksApi, type ShareLink } from "@/api";
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
const STEP_TYPE_LABELS: Record<string, string> = { video: "🎬 视频", ppt: "📊 PPT", level: "🎮 Activity（题库）", quiz: "📝 练习题（考试题库）" };
const BANK_TYPE_LABELS: Record<string, string> = { multiple_choice: "☑️ 选择题", fill_blank: "📝 填充题", coloring: "🎨 填色题", sudoku: "🔢 数独", sticker_game: "🏷️ 贴纸游戏" };

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

// 统一的图标操作按钮——view/edit/delete 三种颜色区分开，鼠标悬停有底色
// 反馈，比纯文字链接更接近专业后台的观感（截图里那种操作列样式）。
function IconAction({ icon: Icon, onClick, variant = "default", title }: {
  icon: typeof Eye; onClick: () => void; variant?: "default" | "danger"; title: string;
}) {
  return (
    <button
      type="button" onClick={onClick} title={title}
      className={`inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors ${
        variant === "danger" ? "text-muted-foreground hover:text-red-600 hover:bg-red-50" : "text-muted-foreground hover:text-primary hover:bg-primary/10"
      }`}
    >
      <Icon size={15} />
    </button>
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
function bankQuestionLabel(item: { question_type: string; config: Record<string, unknown> }): string {
  const emoji = BANK_TYPE_LABELS[item.question_type]?.split(" ")[0] ?? "❓";
  if (item.question_type === "multiple_choice") {
    const q = item.config.question_i18n as Record<string, string> | undefined;
    return `${emoji} ${q?.zh ?? q?.en ?? "（选择题）"}`;
  }
  if (item.question_type === "fill_blank") {
    const s = item.config.sentence_i18n as Record<string, string> | undefined;
    return `${emoji} ${s?.zh ?? s?.en ?? "（填充题）"}`;
  }
  return `${emoji} ${BANK_TYPE_LABELS[item.question_type] ?? item.question_type}`;
}

function AddStepModal({ open, onClose, lessonId, onSaved }: { open: boolean; onClose: () => void; lessonId: string | null; onSaved: () => void }) {
  const [stepType, setStepType] = useState<"video" | "ppt" | "level" | "quiz">("video");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaTitle, setMediaTitle] = useState("");
  const [mediaSlideUrls, setMediaSlideUrls] = useState<string[]>([]); // ppt多页——完整幻灯片图片URL数组，只有通过AssetPicker选/传PPT才会有值

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

  // quiz(题库)分支专用——跟 level 分支的"全部Activity"是两套完全独立
  // 的数据源，quiz 这边查的是 examApi.listQuestionBank，不是 eduApi.
  // listAllActivities，两者字段结构不一样，不能共用同一份 results。
  const [bankCategory, setBankCategory] = useState("");
  const [bankCategories, setBankCategories] = useState<Array<{ category: string; question_count: number }>>([]);
  const [bankResults, setBankResults] = useState<Array<{ id: string; category: string; question_type: string; config: Record<string, unknown> }>>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [pickedBankQuestion, setPickedBankQuestion] = useState<{ id: string; label: string } | null>(null);

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

  useEffect(() => { if (open && stepType === "quiz") examApi.listQuestionBankCategories().then(setBankCategories).catch(() => {}); }, [open, stepType]);
  useEffect(() => {
    if (!open || stepType !== "quiz") return;
    setBankLoading(true);
    examApi.listQuestionBank({ category: bankCategory || undefined, limit: 50 })
      .then((r) => setBankResults(r.data))
      .finally(() => setBankLoading(false));
  }, [open, stepType, bankCategory]);

  function reset() {
    setStepType("video"); setMediaUrl(""); setMediaTitle(""); setMediaSlideUrls([]);
    setSearch(""); setSubjectId(""); setCategoryId(""); setPickedLevel(null);
    setBankCategory(""); setPickedBankQuestion(null);
  }

  async function handleSave() {
    if (!lessonId) return;
    try {
      if (stepType === "level") {
        if (!pickedLevel) { toast.error("请选一个 Activity"); return; }
        await lessonsApi.createStep(lessonId, { step_type: "level", course_level_id: pickedLevel.id });
      } else if (stepType === "quiz") {
        if (!pickedBankQuestion) { toast.error("请选一道题库题目"); return; }
        await lessonsApi.createStep(lessonId, { step_type: "quiz", bank_question_id: pickedBankQuestion.id });
      } else {
        if (!mediaUrl.trim()) { toast.error("请输入链接"); return; }
        await lessonsApi.createStep(lessonId, {
          step_type: stepType, media_url: mediaUrl.trim(), media_title: mediaTitle || undefined,
          slide_urls: stepType === "ppt" && mediaSlideUrls.length > 0 ? mediaSlideUrls : undefined,
        });
      }
      toast.success("步骤加好了");
      reset(); onSaved(); onClose();
    } catch { toast.error("新增失败（可能没有权限）"); }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="加步骤" size={stepType === "level" || stepType === "quiz" ? "lg" : "sm"}>
      <div className="space-y-3">
        <div>
          <Label>步骤类型</Label>
          <select className="w-full border rounded-md p-2 text-sm" value={stepType} onChange={(e) => { setStepType(e.target.value as "video" | "ppt" | "level" | "quiz"); setPickedLevel(null); setPickedBankQuestion(null); setMediaSlideUrls([]); }}>
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
        ) : stepType === "quiz" ? (
          <>
            <p className="text-xs text-muted-foreground">从考试系统的题库里选——跟「试卷/比赛」用的是同一批题，判分逻辑也共用，不是另外重做一套。</p>
            <div className="flex flex-wrap gap-2">
              <select className="border rounded-md p-2 text-sm" value={bankCategory} onChange={(e) => setBankCategory(e.target.value)}>
                <option value="">全部分类</option>
                {bankCategories.map((c) => <option key={c.category} value={c.category}>{c.category}（{c.question_count}题）</option>)}
              </select>
            </div>

            {pickedBankQuestion && (
              <div className="flex items-center gap-2 bg-primary/5 border border-primary/30 rounded-lg px-3 py-2 text-sm">
                <span className="flex-1">已选：{pickedBankQuestion.label}</span>
                <button type="button" onClick={() => setPickedBankQuestion(null)} className="text-muted-foreground hover:text-destructive text-xs">✕ 换一个</button>
              </div>
            )}

            <div className="max-h-[320px] overflow-y-auto rounded-lg border border-border">
              {bankLoading ? (
                <p className="text-sm text-muted-foreground text-center py-8">搜索中...</p>
              ) : bankResults.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">题库里没有符合条件的题目——先去「试卷/比赛」的题库标签页加几题</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {bankResults.map((item) => {
                      const label = bankQuestionLabel(item);
                      return (
                        <tr key={item.id} className={`border-b border-border last:border-0 hover:bg-muted/50 ${pickedBankQuestion?.id === item.id ? "bg-primary/10" : ""}`}>
                          <td className="px-3 py-2">
                            <div className="font-medium">{label}</div>
                            <div className="text-xs text-muted-foreground">{item.category}</div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button size="sm" variant={pickedBankQuestion?.id === item.id ? "outline" : "default"} onClick={() => setPickedBankQuestion({ id: item.id, label })}>
                              {pickedBankQuestion?.id === item.id ? "已选" : "选它"}
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
            <div>
              <Label>{stepType === "video" ? "视频" : "PPT讲义"}</Label>
              <div className="flex items-center gap-2 mt-1">
                {stepType === "video" ? (
                  <AssetPicker
                    category="video" label={mediaUrl ? "换一个视频" : "🗂️ 选 / 上传视频"}
                    onSelect={(url) => { setMediaUrl(url); setMediaSlideUrls([]); }}
                  />
                ) : (
                  <AssetPicker
                    category="ppt" label={mediaUrl ? "换一份PPT" : "🗂️ 选 / 上传PPT"}
                    onSelect={(url) => { setMediaUrl(url); setMediaSlideUrls([]); }}
                    onSelectAsset={(asset) => { setMediaUrl(asset.url); setMediaSlideUrls(asset.slideUrls ?? []); }}
                  />
                )}
                {mediaUrl && (
                  <span className="text-xs text-emerald-600">
                    ✓ 已选好{stepType === "ppt" && mediaSlideUrls.length > 0 ? `（共${mediaSlideUrls.length}页）` : ""}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground/70 mt-1.5">
                或者直接贴外部链接（比如YouTube视频网址）——
                {stepType === "ppt" && "PPT贴外部链接的话只会当成单页显示，没有翻页效果，"}
                两种方式二选一即可
              </p>
              <Input
                className="mt-1.5" placeholder="https://..." value={mediaUrl}
                onChange={(e) => { setMediaUrl(e.target.value); setMediaSlideUrls([]); }}
              />
            </div>
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
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null); // 树展开的那一行——null=全部收起
  const [lessonDetail, setLessonDetail] = useState<Awaited<ReturnType<typeof lessonsApi.getLesson>> | null>(null);
  const [showLessonModal, setShowLessonModal] = useState(false);
  const [showStepModal, setShowStepModal] = useState(false);
  const [sharingLessonId, setSharingLessonId] = useState<string | null>(null);
  const [editingLesson, setEditingLesson] = useState<{ id: string; title_i18n: Record<string,string> } | null>(null);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<LessonSortKey>("title");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  function refreshLessons() { lessonsApi.listLessons(courseId).then(setLessons); }
  useEffect(refreshLessons, [courseId]);

  function refreshDetail(lessonId: string) { lessonsApi.getLesson(lessonId).then(setLessonDetail); }

  // 树形展开——点已经展开的那一行收起，点别的行换成展开那一行（手风琴式，
  // 同一时间只展开一个课时，步骤列表直接嵌在这一行底下，不用另外滚到
  // 页面下方看）。
  function toggleLesson(id: string) {
    if (selectedLessonId === id) { setSelectedLessonId(null); setLessonDetail(null); return; }
    setSelectedLessonId(id); refreshDetail(id);
  }

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
                      <th className="py-2.5 px-3 font-medium text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLessons.map((l) => {
                      const isOpen = selectedLessonId === l.id;
                      return (
                        <Fragment key={l.id}>
                          <tr className={`border-b border-border last:border-0 transition-colors cursor-pointer ${isOpen ? "bg-muted" : "hover:bg-muted/50"}`} onClick={() => toggleLesson(l.id)}>
                            <td className="py-2.5 px-3 font-medium">
                              <span className="inline-flex items-center gap-1.5">
                                <ChevronRight size={14} className={`text-muted-foreground transition-transform flex-shrink-0 ${isOpen ? "rotate-90" : ""}`} />
                                {l.title_i18n?.zh ?? l.title_i18n?.en}
                              </span>
                            </td>
                            <td className="px-3"><Badge variant="outline">{l.step_count} 个步骤</Badge></td>
                            <td className="px-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center gap-1">
                                <IconAction icon={PencilLine} title="编辑" onClick={() => setEditingLesson(l)} />
                                <IconAction icon={Trash2} title="删除" variant="danger" onClick={() => handleDeleteLesson(l)} />
                              </div>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="border-b border-border last:border-0">
                              <td colSpan={3} className="bg-muted/20 p-0">
                                <div className="pl-8 pr-3 py-3 border-l-2 border-primary/30 ml-5">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-medium text-muted-foreground">步骤顺序</span>
                                    <div className="flex items-center gap-3">
                                      <a href={`/lesson/${l.id}?preview=true`} target="_blank" rel="noreferrer" className="text-primary text-xs font-medium hover:underline">🧪 试玩课时 →</a>
                                      <button onClick={() => setSharingLessonId(l.id)} className="text-primary text-xs font-medium hover:underline">🔗 分享</button>
                                      <Button size="sm" onClick={() => setShowStepModal(true)}>+ 加步骤</Button>
                                    </div>
                                  </div>

                                  {!lessonDetail || lessonDetail.id !== l.id ? (
                                    <p className="text-xs text-muted-foreground py-4 text-center">加载中...</p>
                                  ) : lessonDetail.steps.length === 0 ? (
                                    <EmptyState title="这个课时还没有步骤" description="点右上角加一个——视频、PPT、题库练习题、或是从Activity题库选一个" />
                                  ) : (
                                    <ol className="space-y-1.5">
                                      {lessonDetail.steps.map((s, i) => (
                                        <li key={s.id} className="flex items-center justify-between border border-border bg-white rounded-lg p-2.5 text-sm">
                                          <span className="min-w-0 truncate">
                                            <span className="text-muted-foreground mr-2">{i + 1}.</span>
                                            <Badge variant="outline" className="mr-2">{STEP_TYPE_LABELS[s.step_type]}</Badge>
                                            {s.step_type === "level"
                                              ? `${MODULE_LABELS[s.module_type ?? ""]?.emoji ?? ""} ${s.level_title_i18n?.zh ?? s.level_title_i18n?.en ?? s.module_type}`
                                              : s.step_type === "quiz"
                                              ? (s.bank_question_preview ? `${s.bank_category ? `[${s.bank_category}] ` : ""}${s.bank_question_preview}` : "（这道题已经从题库删除，请重新选一道）")
                                              : `${s.media_title || s.media_url}${s.step_type === "ppt" && s.slide_urls && s.slide_urls.length > 1 ? `（共${s.slide_urls.length}页）` : ""}`}
                                          </span>
                                          <span className="flex items-center gap-2 flex-shrink-0">
                                            <button onClick={() => handleMoveStep(s.id, "up")} disabled={i === 0} className="text-muted-foreground hover:text-primary disabled:opacity-30 disabled:hover:text-muted-foreground text-sm px-1">▲</button>
                                            <button onClick={() => handleMoveStep(s.id, "down")} disabled={i === lessonDetail.steps.length - 1} className="text-muted-foreground hover:text-primary disabled:opacity-30 disabled:hover:text-muted-foreground text-sm px-1">▼</button>
                                            <button onClick={() => handleDeleteStep(s.id)} className="text-muted-foreground hover:text-red-500 text-xs ml-1">删除</button>
                                          </span>
                                        </li>
                                      ))}
                                    </ol>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">Number of Records: {visibleLessons.length}</div>
            </>
          )}
        </CardContent>
      </Card>

      <AddLessonModal open={showLessonModal} onClose={() => setShowLessonModal(false)} courseId={courseId} onSaved={refreshLessons} />
      <EditLessonModal lesson={editingLesson} onClose={() => setEditingLesson(null)} onSaved={() => { refreshLessons(); if (selectedLessonId) refreshDetail(selectedLessonId); }} />
      <AddStepModal
        open={showStepModal} onClose={() => setShowStepModal(false)} lessonId={selectedLessonId}
        onSaved={() => selectedLessonId && refreshDetail(selectedLessonId)}
      />
      <ShareLinkModal lessonId={sharingLessonId} onClose={() => setSharingLessonId(null)} />
    </>
  );
}

// 分享链接管理——生成新链接(带过期天数选项)、列出这堂课已经有的分享
// 链接、可以撤销。公开访问地址是当前站点的 /share/:token，不需要账号
// 即可打开(见 LessonPlayerPage.tsx 的 share 模式)。
function ShareLinkModal({ lessonId, onClose }: { lessonId: string | null; onClose: () => void }) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<string>("7");

  useEffect(() => {
    if (!lessonId) return;
    setLoading(true);
    shareLinksApi.list({ resource_type: "lesson", resource_id: lessonId }).then(setLinks).finally(() => setLoading(false));
  }, [lessonId]);

  async function handleCreate() {
    if (!lessonId) return;
    try {
      const days = expiresInDays === "never" ? undefined : Number(expiresInDays);
      await shareLinksApi.create({ resource_type: "lesson", resource_id: lessonId, expires_in_days: days });
      toast.success("分享链接已生成");
      const fresh = await shareLinksApi.list({ resource_type: "lesson", resource_id: lessonId });
      setLinks(fresh);
    } catch { toast.error("生成失败"); }
  }

  async function handleRevoke(id: string) {
    if (!lessonId) return;
    try {
      await shareLinksApi.revoke(id);
      toast.success("已撤销");
      const fresh = await shareLinksApi.list({ resource_type: "lesson", resource_id: lessonId });
      setLinks(fresh);
    } catch { toast.error("撤销失败"); }
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/share/${token}`;
    navigator.clipboard.writeText(url).then(() => toast.success("链接已复制")).catch(() => toast.error("复制失败，请手动选取链接"));
  }

  function linkStatus(link: ShareLink): { label: string; className: string } {
    if (link.revoked_at) return { label: "已撤销", className: "bg-muted text-muted-foreground" };
    if (link.expires_at && new Date(link.expires_at) < new Date()) return { label: "已过期", className: "bg-muted text-muted-foreground" };
    return { label: "有效", className: "bg-emerald-100 text-emerald-700" };
  }

  return (
    <Modal open={!!lessonId} onClose={onClose} title="分享这堂课" size="lg">
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">生成一个公开链接——不需要账号，任何拿到链接的人都能直接看视频/PPT、做quiz题（不计入学习进度）。游戏类步骤暂时还不支持分享播放。</p>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label>有效期</Label>
            <select className="w-full border rounded-md p-2 text-sm" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)}>
              <option value="1">1天</option>
              <option value="7">7天</option>
              <option value="30">30天</option>
              <option value="never">永久（可随时手动撤销）</option>
            </select>
          </div>
          <Button onClick={handleCreate}>+ 生成新链接</Button>
        </div>

        <div className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-4">加载中...</p>
          ) : links.length === 0 ? (
            <p className="text-sm text-muted-foreground/60 text-center py-4">还没有生成过分享链接</p>
          ) : (
            links.map((link) => {
              const status = linkStatus(link);
              return (
                <div key={link.id} className="rounded-lg border border-border bg-white p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${status.className}`}>{status.label}</span>
                      <span className="text-xs text-muted-foreground">已查看 {link.view_count} 次</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate font-mono">{window.location.origin}/share/{link.token}</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                      {link.expires_at ? `${new Date(link.expires_at).toLocaleDateString()} 过期` : "永久有效"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!link.revoked_at && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => copyLink(link.token)}>复制</Button>
                        <Button size="sm" variant="outline" onClick={() => handleRevoke(link.id)}>撤销</Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
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

      <div className="grid grid-cols-2 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-white shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0"><BookOpen size={18} /></div>
          <div>
            <div className="text-xs text-muted-foreground">总课程数</div>
            <div className="text-xl font-bold text-foreground">{meta.total}</div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-white shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0"><GraduationCap size={18} /></div>
          <div>
            <div className="text-xs text-muted-foreground">等级数</div>
            <div className="text-xl font-bold text-foreground">{tiers.length}</div>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>课程列表</CardTitle>
          <Button size="sm" onClick={() => setShowCourseModal(true)}>+ 新建课程</Button>
        </CardHeader>
        <CardContent>
          {/* 等级分类标签页——替代原本的下拉筛选，点一个等级直接切进去，
              视觉上跟"总览/分类tab"这种专业后台样式对齐 */}
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            <button
              type="button" onClick={() => setFilterTierId("")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterTierId === "" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              全部
            </button>
            {tiers.map((t) => (
              <button
                key={t.id} type="button" onClick={() => setFilterTierId(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterTierId === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
              >
                {t.code}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            <Input placeholder="搜索课程名称..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[220px]" />
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
                      <th className="py-2.5 px-3 font-medium text-center">操作</th>
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
                          <div className="flex items-center justify-center gap-1">
                            <IconAction icon={Eye} title="查看" onClick={() => setViewingCourse(c)} />
                            <IconAction icon={PencilLine} title="编辑" onClick={() => setEditingCourse(c)} />
                            <IconAction icon={Trash2} title="删除" variant="danger" onClick={() => handleDeleteCourse(c)} />
                          </div>
                        </td>
                        <td className="px-3 text-right text-primary text-xs font-medium whitespace-nowrap">
                          <button type="button" onClick={() => goManageLessons(c.id)} className="inline-flex items-center gap-0.5 hover:underline">
                            管理课时 <ChevronRight size={13} />
                          </button>
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
