// frontend/src/pages/edu/TopicBrowserPage.tsx
//
// 按 Topic 浏览 — the content-classification view, complementary to
// CourseDesignerPage's course-first workflow. That page answers "what's
// in this course"; this one answers "what's under this Topic, regardless
// of which course each Activity happens to live in" — cascading
// Programme → Subject → Topic, then listing every Activity classified
// under the selected Topic across the whole platform. Read-only here:
// editing an Activity still happens on its own course's designer page
// (linked from each row), this page is for finding/auditing coverage of
// a Topic, not authoring.

import { useState, useEffect } from "react";
import { taxonomyApi, exerciseClassificationApi, eduApi } from "@/api/index";
import { Card, CardContent, CardHeader, CardTitle, Badge, EmptyState } from "@/components/ui/index";

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

export default function TopicBrowserPage() {
  const [programmes, setProgrammes] = useState<Array<{ id: string; code: string; name_zh: string; name_en?: string }>>([]);
  const [subjects, setSubjects] = useState<Array<{ id: string; programme_id: string; code: string; name_zh: string; name_en?: string }>>([]);
  const [topics, setTopics] = useState<Array<{ id: string; code: string; name_zh: string; name_en?: string; prefix: string; subject_id?: string }>>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [activities, setActivities] = useState<Awaited<ReturnType<typeof eduApi.listActivitiesByTopic>>>([]);
  const [loading, setLoading] = useState(false);

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

  const selectedTopic = topics.find((t) => t.id === topicId);

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
            <CardTitle>{selectedTopic?.name_zh} 底下的 Activity（共 {activities.length} 个）</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">加载中...</p>
            ) : activities.length === 0 ? (
              <EmptyState title="这个 Topic 底下还没有 Activity" description="去「Activity 设计管理」里建一个，记得选这个 Topic 分类" />
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground bg-muted/50 border-b border-border">
                      <th className="py-2.5 px-3 font-medium">Activity 名称</th>
                      <th className="px-3 font-medium">所属课程</th>
                      <th className="px-3 font-medium">模块类型</th>
                      <th className="px-3 font-medium">难度</th>
                      <th className="px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activities.map((a) => (
                      <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-2.5 px-3 font-medium">
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
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
