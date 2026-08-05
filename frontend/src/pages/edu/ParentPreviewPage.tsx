// frontend/src/pages/edu/ParentPreviewPage.tsx
//
// 家长订阅前的预览页——结构照 Discovery 模式（Programme→Subject→Topic→
// Activity），但换成用 parent_preview_enabled 门控内容，不是订阅门控，
// 而且顶部多了 Programme / Subject / 等级 三个筛选器（Discovery 模式是
// 先选 Programme 才看得到 Topic；这里家长一进来就看到"全部Topic"，筛选
// 是缩小范围用的，不是必须先选的前置步骤）。
//
// 两层画面，互斥显示（不是叠在一起）：
//   - 没选中 Topic：显示筛选器 + Topic 卡片网格
//   - 选中了 Topic：显示这个 Topic 底下的 Activity 列表，上面有"← 返回"
//
// 点一个 Activity 之后：
//   - video_lecture / ppt_lecture 这两种，直接开 VideoViewerPage /
//     PptViewerPage（?levelId=xxx，跟素材库预览用的是同一套页面，本来就
//     支持 levelId 入口，不用另外做）
//   - 其他游戏类模块，暂时链到 /play/:levelId（学生端现成的关卡页）。
//     ⚠️ 这条路径目前还没做"预览模式跳过 submitProgress"的处理，家长玩完
//     可能会往 progress_records 写一条不该有的记录——等拿到 LevelPlayerPage
//     的代码补上开关后，这里的链接方式不用改，只是行为会变干净。

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { eduApi, taxonomyApi } from "@/api";
import { Button } from "@/components/ui/button";
import { PlayCircle, Video, FileText, Puzzle } from "lucide-react";

interface Programme { id: string; name_zh: string; name_en?: string }
interface Subject { id: string; name_zh: string; programme_id?: string }
interface GradeTier { id: string; code: string; name_i18n?: { zh?: string; en?: string } }
interface Topic {
  id: string; name_zh: string; name_en?: string;
  subject_id: string; subject_name_zh: string;
  programme_id: string; programme_name_zh: string;
  activity_count: number;
}
interface Activity {
  id: string; exercise_number?: string; title_i18n?: { zh?: string; en?: string };
  module_type: string; difficulty?: string; duration_minutes?: number;
}

const MODULE_TYPE_LABEL: Record<string, string> = {
  video_lecture: "视频讲解", ppt_lecture: "PPT讲义",
  counting: "点点数数", spot_diff: "找不同", focus_tap: "专注力", memory: "记忆配对",
  pattern: "找规律", word_problem: "应用题", maze: "迷宫", sudoku: "数独",
  line_match: "连线配对", coloring: "填色游戏",
};

function moduleIcon(moduleType: string) {
  if (moduleType === "video_lecture") return <Video className="w-4 h-4" />;
  if (moduleType === "ppt_lecture") return <FileText className="w-4 h-4" />;
  return <Puzzle className="w-4 h-4" />;
}

export default function ParentPreviewPage() {
  const navigate = useNavigate();

  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [gradeTiers, setGradeTiers] = useState<GradeTier[]>([]);

  const [programmeId, setProgrammeId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [gradeTierId, setGradeTierId] = useState("");

  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);

  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);

  // 筛选器的下拉资料只抓一次
  useEffect(() => {
    taxonomyApi.listProgrammes().then(setProgrammes).catch(() => {});
    taxonomyApi.listSubjects().then(setSubjects).catch(() => {});
    eduApi.listGradeTiers().then(setGradeTiers).catch(() => {});
  }, []);

  const visibleSubjects = programmeId ? subjects.filter((s) => s.programme_id === programmeId) : subjects;

  const loadTopics = useCallback(() => {
    setTopicsLoading(true);
    eduApi.listParentPreviewTopics({
      programme_id: programmeId || undefined,
      subject_id: subjectId || undefined,
      grade_tier_id: gradeTierId || undefined,
    })
      .then(setTopics)
      .catch(() => setTopics([]))
      .finally(() => setTopicsLoading(false));
  }, [programmeId, subjectId, gradeTierId]);

  useEffect(() => { loadTopics(); }, [loadTopics]);

  function openTopic(topic: Topic) {
    setSelectedTopic(topic);
    setActivitiesLoading(true);
    eduApi.listParentPreviewActivities(topic.id, { grade_tier_id: gradeTierId || undefined })
      .then(setActivities)
      .catch(() => setActivities([]))
      .finally(() => setActivitiesLoading(false));
  }

  function openActivity(activity: Activity) {
    if (activity.module_type === "video_lecture") { navigate(`/view/video?levelId=${activity.id}`); return; }
    if (activity.module_type === "ppt_lecture") { navigate(`/view/ppt?levelId=${activity.id}`); return; }
    navigate(`/play/${activity.id}`);
  }

  // Subject 换了但选的 Programme 底下已经不包含这个 Subject 时，清空
  function handleProgrammeChange(id: string) {
    setProgrammeId(id);
    if (id && subjectId) {
      const stillValid = subjects.some((s) => s.id === subjectId && s.programme_id === id);
      if (!stillValid) setSubjectId("");
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F6FA]">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">课程内容预览</h1>
          <p className="text-sm text-muted-foreground mt-1">看看孩子订阅后能学到什么，再决定要不要订阅</p>
        </div>

        {!selectedTopic ? (
          <>
            {/* 筛选器 */}
            <div className="flex flex-wrap items-center gap-2 mb-5 bg-white rounded-xl border border-border px-4 py-3">
              <select
                value={programmeId}
                onChange={(e) => handleProgrammeChange(e.target.value)}
                className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-background"
              >
                <option value="">全部 Programme</option>
                {programmes.map((p) => <option key={p.id} value={p.id}>{p.name_zh}</option>)}
              </select>

              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-background"
              >
                <option value="">全部 Subject</option>
                {visibleSubjects.map((s) => <option key={s.id} value={s.id}>{s.name_zh}</option>)}
              </select>

              <select
                value={gradeTierId}
                onChange={(e) => setGradeTierId(e.target.value)}
                className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-background"
              >
                <option value="">全部等级</option>
                {gradeTiers.map((g) => <option key={g.id} value={g.id}>{g.name_i18n?.zh ?? g.name_i18n?.en ?? g.code}</option>)}
              </select>

              <select
                value=""
                onChange={(e) => {
                  const t = topics.find((x) => x.id === e.target.value);
                  if (t) openTopic(t);
                }}
                disabled={topics.length === 0}
                className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-background disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">选择 Topic 直接查看</option>
                {topics.map((t) => <option key={t.id} value={t.id}>{t.name_zh}</option>)}
              </select>

              {(programmeId || subjectId || gradeTierId) && (
                <button
                  onClick={() => { setProgrammeId(""); setSubjectId(""); setGradeTierId(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground ml-1"
                >
                  清除筛选
                </button>
              )}
            </div>

            {/* Topic 网格 */}
            {topicsLoading ? (
              <p className="text-center text-muted-foreground py-16">加载中...</p>
            ) : topics.length === 0 ? (
              <p className="text-center text-muted-foreground py-16">这个筛选条件下还没有开放预览的内容</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {topics.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => openTopic(t)}
                    className="text-left bg-white rounded-xl border border-border p-4 hover:border-primary hover:shadow-sm transition-all"
                  >
                    <p className="text-xs text-muted-foreground mb-1">{t.programme_name_zh} · {t.subject_name_zh}</p>
                    <p className="font-medium">{t.name_zh}</p>
                    <p className="text-xs text-muted-foreground mt-2">{t.activity_count} 个可预览内容</p>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <button onClick={() => setSelectedTopic(null)} className="text-sm text-muted-foreground hover:text-foreground mb-4">
              ← 返回 Topic 列表
            </button>
            <div className="mb-4">
              <p className="text-xs text-muted-foreground">{selectedTopic.programme_name_zh} · {selectedTopic.subject_name_zh}</p>
              <h2 className="text-lg font-semibold">{selectedTopic.name_zh}</h2>
            </div>

            {activitiesLoading ? (
              <p className="text-center text-muted-foreground py-16">加载中...</p>
            ) : activities.length === 0 ? (
              <p className="text-center text-muted-foreground py-16">这个 Topic 下暂时没有开放预览的内容</p>
            ) : (
              <div className="space-y-2">
                {activities.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => openActivity(a)}
                    className="w-full flex items-center justify-between gap-3 bg-white rounded-lg border border-border px-4 py-3 hover:border-primary hover:shadow-sm transition-all text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                        {moduleIcon(a.module_type)}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{a.title_i18n?.zh ?? a.title_i18n?.en ?? "未命名"}</p>
                        <p className="text-xs text-muted-foreground">
                          {MODULE_TYPE_LABEL[a.module_type] ?? a.module_type}
                          {a.duration_minutes ? ` · 约${a.duration_minutes}分钟` : ""}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0 gap-1.5">
                      <PlayCircle className="w-3.5 h-3.5" />
                      {a.module_type === "video_lecture" || a.module_type === "ppt_lecture" ? "预览" : "试玩"}
                    </Button>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


 