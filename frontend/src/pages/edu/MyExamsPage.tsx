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
  const { t, i18n } = useTranslation();
  const locale = i18n.language; // "zh" | "en" | "ms"，跟着学生当下切换的界面语言走
  const pickText = (i18nObj?: Record<string, string>) => i18nObj?.[locale] || i18nObj?.zh || i18nObj?.en || "";

  const [papers, setPapers] = useState<Array<{
    id: string; title_i18n: Record<string, string>; time_limit_minutes: number;
    opens_at?: string; closes_at?: string; total_marks: number; allow_retake?: boolean;
    attempt_id?: string; attempt_status?: string; score?: number; submitted_at?: string;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; status: string; score?: number; max_score?: number; started_at: string; submitted_at?: string }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function toggleHistory(paperId: string) {
    if (expandedId === paperId) { setExpandedId(null); return; }
    setExpandedId(paperId); setHistoryLoading(true);
    try {
      const list = await examApi.listMyAttempts(paperId);
      setHistory([...list].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()));
    }
    catch (err) { toast.error(t("exam.myExams.loadHistoryFailed")); }
    setHistoryLoading(false);
  }

  useEffect(() => {
    examApi.listMyPapers().then(setPapers).catch(() => toast.error(t("exam.myExams.loadFailed"))).finally(() => setLoading(false));
  }, []);

  function statusLabel(p: (typeof papers)[number]): { text: string; color: string } {
    if (!p.attempt_status) return { text: t("exam.myExams.notStarted"), color: "text-muted-foreground" };
    if (p.attempt_status === "in_progress") return { text: t("exam.myExams.inProgressContinue"), color: "text-amber-600" };
    return { text: t("exam.myExams.submittedScore", { score: p.score, total: p.total_marks }), color: "text-emerald-600" };
  }

  function canStart(p: (typeof papers)[number]): boolean {
    const now = new Date();
    if (p.opens_at && now < new Date(p.opens_at)) return false;
    if (p.closes_at && now > new Date(p.closes_at)) return false;
    return true;
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-foreground mb-1">{t("exam.myExams.title")}</h1>
      <p className="text-sm text-muted-foreground mb-6">{t("exam.myExams.subtitle")}</p>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("exam.loading")}</p>
      ) : papers.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 text-center py-12">{t("exam.myExams.empty")}</p>
      ) : (
        <div className="space-y-3">
          {papers.map((p) => {
            const status = statusLabel(p);
            const startable = canStart(p) && p.attempt_status !== "submitted";
            return (
              <div key={p.id} className="rounded-xl border border-border bg-white shadow-sm p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-foreground">{pickText(p.title_i18n)}</h3>
                    <div className="text-xs text-muted-foreground mt-1 flex gap-3">
                      <span>{t("exam.myExams.minutes", { n: p.time_limit_minutes })}</span>
                      <span>{t("exam.myExams.fullMarks", { n: p.total_marks })}</span>
                      <span className={status.color}>{status.text}</span>
                    </div>
                    {!startable && p.attempt_status !== "submitted" && (
                      <p className="text-xs text-amber-600 mt-1">
                        {p.opens_at && new Date() < new Date(p.opens_at) ? t("exam.myExams.opensAt", { time: new Date(p.opens_at).toLocaleString() }) : t("exam.myExams.closed")}
                      </p>
                    )}
                  </div>
                  {p.attempt_status === "submitted" ? (
                    <button
                      onClick={() => navigate(`/exam/attempt/${p.attempt_id}/result`)}
                      className="text-sm font-medium px-4 py-2 rounded-xl bg-muted text-foreground hover:bg-muted/70"
                    >
                      {t("exam.myExams.viewScore")}
                    </button>
                  ) : (
                    <button
                      onClick={() => navigate(`/exam/${p.id}/take`)}
                      disabled={!startable}
                      className="text-sm font-medium px-4 py-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
                    >
                      {p.attempt_status === "in_progress" ? t("exam.myExams.continueButton") : t("exam.myExams.startButton")}
                    </button>
                  )}
                </div>

                {p.allow_retake && p.attempt_status && (
                  <div className="mt-2 pt-2 border-t border-border/60">
                    <button onClick={() => toggleHistory(p.id)} className="text-xs text-muted-foreground hover:text-foreground underline">
                      {expandedId === p.id ? t("exam.myExams.hideHistory") : t("exam.myExams.viewHistory")}
                    </button>
                    {expandedId === p.id && (
                      <div className="mt-2 space-y-1">
                        {historyLoading ? (
                          <p className="text-xs text-muted-foreground">{t("exam.loading")}</p>
                        ) : history.length === 0 ? (
                          <p className="text-xs text-muted-foreground/60">{t("exam.myExams.historyEmpty")}</p>
                        ) : (
                          history.map((h, idx) => (
                            <div key={h.id} className="text-xs text-muted-foreground flex items-center gap-2">
                              {h.status === "submitted" ? (
                                <button
                                  onClick={() => navigate(`/exam/attempt/${h.id}/result`)}
                                  className="hover:text-foreground underline text-left"
                                >
                                  {t("exam.myExams.historySubmitted", { n: idx + 1, score: h.score, total: h.max_score, date: h.submitted_at ? new Date(h.submitted_at).toLocaleString(locale) : "" })}
                                </button>
                              ) : (
                                <span>{t("exam.myExams.historyInProgress")}</span>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
