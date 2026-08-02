// frontend/src/pages/edu/DiscoveryActivitiesPage.tsx
//
// 同一套设计语言：表格用等宽字体呈现Activity ID/分数，状态用小圆点+文字
// 代替大色块徽章，整体更接近专业系统的数据表格，而不是游戏化的花哨列表。

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { discoveryApi, eduApi } from "@/api";
import { Modal } from "@/components/ui/modal";
import { ArrowLeft } from "lucide-react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { PptReader } from "@/components/PptReader";

interface Activity {
  id: string; exercise_number?: string; title_i18n?: Record<string, string>; module_type: string;
  completed?: boolean; score?: number; max_score?: number; played_at?: string;
}

const LECTURE_TYPES = new Set(["ppt_lecture", "video_lecture"]);

function StatusDot({ a }: { a: Activity }) {
  const color = a.completed ? "#1E9E5A" : a.played_at ? "#F2A93B" : "#171923";
  const opacity = a.completed || a.played_at ? "" : "opacity-25";
  const label = a.completed ? "已完成" : a.played_at ? "进行中" : "未开始";
  return (
    <span className="inline-flex items-center gap-1.5 font-['IBM_Plex_Sans'] text-sm text-[#171923]/80">
      <span className={`w-1.5 h-1.5 rounded-full ${opacity}`} style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function marksLabel(a: Activity): string {
  if (a.score == null || a.max_score == null) return "—";
  return `${a.score}/${a.max_score}`;
}

export default function DiscoveryActivitiesPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const topicName = (location.state as { topicName?: string } | null)?.topicName;

  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [lecture, setLecture] = useState<{ activity: Activity; moduleType: string; videoUrl?: string; slideUrls?: string[] } | null>(null);

  const refresh = useCallback(() => {
    if (!categoryId) return;
    discoveryApi.listActivities(categoryId).then((r) => { setActivities(r); setLoading(false); });
  }, [categoryId]);

  useEffect(refresh, [refresh]);

  async function handleRowClick(a: Activity) {
    if (!LECTURE_TYPES.has(a.module_type)) {
      navigate(`/play/${a.id}`);
      return;
    }
    const level = await eduApi.getLevel(a.id);
    const config = level.config as { video_url?: string; poster_image_url?: string; slide_image_urls?: string[] };
    if (a.module_type === "video_lecture") {
      setLecture({ activity: a, moduleType: a.module_type, videoUrl: config.video_url });
    } else {
      setLecture({ activity: a, moduleType: a.module_type, slideUrls: config.slide_image_urls ?? [] });
    }
  }

  function handleVideoProgress(secondsWatched: number, durationSeconds: number, completed: boolean) {
    if (!lecture) return;
    eduApi.submitProgress(lecture.activity.id, {
      module_type: "video_lecture", score: 0, max_score: 0,
      time_spent_seconds: secondsWatched, mistakes: 0, completed,
    }).then(refresh).catch(() => {});
  }

  function handlePptProgress(_index: number, _total: number, completed: boolean) {
    if (!lecture) return;
    eduApi.submitProgress(lecture.activity.id, {
      module_type: "ppt_lecture", score: 0, max_score: 0,
      time_spent_seconds: 0, mistakes: 0, completed,
    }).then(refresh).catch(() => {});
  }

  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      <div className="max-w-4xl mx-auto px-6 py-16 space-y-6">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm font-['IBM_Plex_Sans'] text-[#171923]/50 hover:text-[#171923] transition-colors"
        >
          <ArrowLeft size={15} /> 返回
        </button>

        <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-[#171923]">{topicName ?? "内容列表"}</h1>

        {!loading && activities.length === 0 && (
          <div className="py-16 text-center">
            <p className="font-['Space_Grotesk'] text-base text-[#171923]/70">这个分类暂时没有内容</p>
            <p className="text-sm text-[#171923]/45 font-['IBM_Plex_Sans'] mt-1">换一个分类看看</p>
          </div>
        )}

        {activities.length > 0 && (
          <div className="rounded-md border border-[#E4E1D8] bg-white overflow-hidden">
            <table className="w-full text-sm font-['IBM_Plex_Sans']">
              <thead>
                <tr className="border-b border-[#E4E1D8]">
                  <th className="text-left px-4 py-3 font-medium text-[#171923]/45 text-xs tracking-wide uppercase w-12">No</th>
                  <th className="text-left px-4 py-3 font-medium text-[#171923]/45 text-xs tracking-wide uppercase">Activity ID</th>
                  <th className="text-left px-4 py-3 font-medium text-[#171923]/45 text-xs tracking-wide uppercase">Description</th>
                  <th className="text-left px-4 py-3 font-medium text-[#171923]/45 text-xs tracking-wide uppercase">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-[#171923]/45 text-xs tracking-wide uppercase">Marks</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a, i) => (
                  <tr
                    key={a.id}
                    onClick={() => handleRowClick(a)}
                    className="border-b border-[#E4E1D8] last:border-0 cursor-pointer hover:bg-[#4A3AFF]/[0.03] transition-colors"
                  >
                    <td className="px-4 py-3 font-['IBM_Plex_Mono'] text-[#171923]/40">{i + 1}</td>
                    <td className="px-4 py-3 font-['IBM_Plex_Mono'] text-[#171923]/70">{a.exercise_number ?? "—"}</td>
                    <td className="px-4 py-3 font-medium text-[#171923]">{a.title_i18n?.zh ?? a.title_i18n?.en ?? "未命名"}</td>
                    <td className="px-4 py-3"><StatusDot a={a} /></td>
                    <td className="px-4 py-3 font-['IBM_Plex_Mono'] text-[#171923]/70">{marksLabel(a)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={!!lecture} onClose={() => setLecture(null)} title={lecture?.activity.title_i18n?.zh ?? ""} size="lg">
        {lecture?.moduleType === "video_lecture" && lecture.videoUrl && (
          <VideoPlayer src={lecture.videoUrl} onProgress={handleVideoProgress} />
        )}
        {lecture?.moduleType === "ppt_lecture" && (
          <PptReader slideUrls={lecture.slideUrls ?? []} onProgress={handlePptProgress} />
        )}
      </Modal>
    </div>
  );
}
