// frontend/src/pages/edu/MyExamsPage.tsx
//
// 学生端"我的试卷"列表——只显示这个学生被邀请/分配到的、已发布的试卷
// (见后端 listMyExamPapers)。每份试卷显示自己的作答状态：还没开始 /
// 作答中 / 已交卷(附成绩，如果这份试卷设成练习模式或者已经过了截止
// 时间的话)。

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { examApi } from "@/api";

export default function MyExamsPage() {
  const { i18n } = useTranslation();
  const locale = i18n.language; // "zh" | "en" | "ms"，跟着学生当下切换的界面语言走
  const pickText = (i18nObj?: Record<string, string>) => i18nObj?.[locale] || i18nObj?.zh || i18nObj?.en || "";

  const [papers, setPapers] = useState<Array<{
    id: string; title_i18n: Record<string, string>; time_limit_minutes: number;
    opens_at?: string; closes_at?: string; total_marks: number;
    attempt_id?: string; attempt_status?: string; score?: number; submitted_at?: string;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    examApi.listMyPapers().then(setPapers).catch(() => toast.error("加载试卷列表失败")).finally(() => setLoading(false));
  }, []);

  function statusLabel(p: (typeof papers)[number]): { text: string; color: string } {
    if (!p.attempt_status) return { text: "还没开始", color: "text-muted-foreground" };
    if (p.attempt_status === "in_progress") return { text: "作答中——继续", color: "text-amber-600" };
    return { text: `已交卷 · ${p.score}/${p.total_marks}`, color: "text-emerald-600" };
  }

  function canStart(p: (typeof papers)[number]): boolean {
    const now = new Date();
    if (p.opens_at && now < new Date(p.opens_at)) return false;
    if (p.closes_at && now > new Date(p.closes_at)) return false;
    return true;
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-foreground mb-1">我的试卷</h1>
      <p className="text-sm text-muted-foreground mb-6">这些是你被分配到的试卷/比赛</p>

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中...</p>
      ) : papers.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 text-center py-12">目前还没有分配给你的试卷</p>
      ) : (
        <div className="space-y-3">
          {papers.map((p) => {
            const status = statusLabel(p);
            const startable = canStart(p) && p.attempt_status !== "submitted";
            return (
              <div key={p.id} className="rounded-xl border border-border bg-white shadow-sm p-4 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-foreground">{pickText(p.title_i18n)}</h3>
                  <div className="text-xs text-muted-foreground mt-1 flex gap-3">
                    <span>{p.time_limit_minutes}分钟</span>
                    <span>满分{p.total_marks}</span>
                    <span className={status.color}>{status.text}</span>
                  </div>
                  {!startable && p.attempt_status !== "submitted" && (
                    <p className="text-xs text-amber-600 mt-1">
                      {p.opens_at && new Date() < new Date(p.opens_at) ? `要等到 ${new Date(p.opens_at).toLocaleString()} 才能开始` : "已经过了作答时间"}
                    </p>
                  )}
                </div>
                {p.attempt_status === "submitted" ? (
                  <button
                    onClick={() => navigate(`/exam/attempt/${p.attempt_id}/result`)}
                    className="text-sm font-medium px-4 py-2 rounded-xl bg-muted text-foreground hover:bg-muted/70"
                  >
                    查看成绩
                  </button>
                ) : (
                  <button
                    onClick={() => navigate(`/exam/${p.id}/take`)}
                    disabled={!startable}
                    className="text-sm font-medium px-4 py-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
                  >
                    {p.attempt_status === "in_progress" ? "继续作答" : "开始作答"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
