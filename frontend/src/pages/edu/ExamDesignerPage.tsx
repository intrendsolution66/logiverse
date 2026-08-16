// frontend/src/pages/edu/ExamDesignerPage.tsx
//
// 试卷/比赛系统的设计器——跟 CourseDesignerPage(管 Activity)是两套独立
// 界面，这里管的是 exam_papers 这套试卷/比赛体系。分四个标签页：
//   基本信息 —— 标题、时限、开考/截止时间、重考设置、答案查看时机
//   题目     —— 固定题(复用选择题/填充题表单) + 随机槽(从题库某分类抽题)
//   题库     —— 随机槽背后的题目池子，按分类管理
//   学生名单 —— 谁被邀请/分配到这份试卷(白名单)
//
// 权限跟后端一致：courses.manage 管内容，classes.manage 管名单——前端
// 不重复做权限判断，接口本身会拒绝没权限的请求，这里只处理正常业务
// 流程，403会被全局的错误提示逻辑接住。

import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/index";
import { CheckSquare, PencilLine, X, Plus, FileText, Users, Trophy, Download, Trash2 } from "lucide-react";
import { examApi, adminUsersApi, type ExamPaper, type ExamPaperQuestion, type ExamQuestionBankItem } from "@/api";
import ColoringQuestionEditor from "@/components/ColoringQuestionEditor";
import IllustrationEditor from "@/components/IllustrationEditor";
import MultiLangInput from "@/components/MultiLangInput";
import { IllustrationView, type Illustration } from "@/lib/illustrationShapes";
import type { ColoringConfig } from "@/lib/coloringShapes";

const INPUT_CLASS = "w-full px-3 py-2 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

interface MCOption { id: string; zh: string; en: string; ms: string; correct: boolean; image_url?: string }

export default function ExamDesignerPage() {
  const { t } = useTranslation();
  const [papers, setPapers] = useState<ExamPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPaperId, setEditingPaperId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  useEffect(() => { loadPapers(); }, []);

  async function loadPapers() {
    setLoading(true);
    try {
      const { data } = await examApi.listPapers({ limit: 50 });
      setPapers(data);
    } catch (err) { toast.error(t("examDesigner.loadListFailed")); }
    setLoading(false);
  }

  async function handleCreate() {
    if (!newTitle.trim()) { toast.error(t("examDesigner.titleRequired")); return; }
    try {
      const paper = await examApi.createPaper({ title_i18n: { zh: newTitle.trim() } });
      toast.success(t("examDesigner.createSuccess"));
      setCreating(false); setNewTitle("");
      await loadPapers();
      setEditingPaperId(paper.id);
    } catch (err) { toast.error(t("examDesigner.createFailed")); }
  }

  if (editingPaperId) {
    return <ExamPaperEditor paperId={editingPaperId} onBack={() => { setEditingPaperId(null); loadPapers(); }} />;
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("examDesigner.listTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("examDesigner.listSubtitle")}</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus size={16} className="mr-1" /> {t("examDesigner.newPaper")}</Button>
      </div>

      {creating && (
        <div className="rounded-xl border border-border bg-white shadow-sm p-4 mb-6 flex gap-3 items-end">
          <div className="flex-1">
            <Label>{t("examDesigner.paperNameLabel")}</Label>
            <Input placeholder={t("examDesigner.paperNamePlaceholder")} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          </div>
          <Button onClick={handleCreate}>{t("examDesigner.create")}</Button>
          <Button variant="outline" onClick={() => { setCreating(false); setNewTitle(""); }}>{t("common.cancel")}</Button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("exam.loading")}</p>
      ) : papers.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 text-center py-12">{t("examDesigner.emptyList")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {papers.map((p) => (
            <button
              key={p.id} onClick={() => setEditingPaperId(p.id)}
              className="text-left rounded-xl border border-border bg-white shadow-sm hover:shadow-md transition-shadow p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-foreground">{p.title_i18n?.zh || p.title_i18n?.en}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  p.status === "published" ? "bg-emerald-100 text-emerald-700" : p.status === "closed" ? "bg-gray-100 text-gray-600" : "bg-amber-100 text-amber-700"
                }`}>
                  {p.status === "published" ? t("examDesigner.status.published") : p.status === "closed" ? t("examDesigner.status.closed") : t("examDesigner.status.draft")}
                </span>
              </div>
              <div className="text-xs text-muted-foreground flex gap-3">
                <span>{t("examDesigner.fullMarks", { n: p.total_marks })}</span>
                <span>{t("examDesigner.minutes", { n: p.time_limit_minutes })}</span>
                <span>{t("examDesigner.studentCount", { n: p.student_count ?? 0 })}</span>
                <span>{t("examDesigner.attemptCount", { n: p.attempt_count ?? 0 })}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 试卷编辑器 ────────────────────────────────────────────────────────────────

function ExamPaperEditor({ paperId, onBack }: { paperId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [paper, setPaper] = useState<(ExamPaper & { questions: ExamPaperQuestion[] }) | null>(null);
  const [tab, setTab] = useState<"basic" | "questions" | "bank" | "students" | "leaderboard">("basic");
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [paperId]);

  async function load() {
    setLoading(true);
    try {
      const data = await examApi.getPaperForEdit(paperId);
      setPaper(data);
    } catch (err) { toast.error(t("examDesigner.loadPaperFailed")); }
    setLoading(false);
  }

  async function handlePublish() {
    if (!paper) return;
    const next = paper.status === "draft" ? "published" : "draft";
    try {
      await examApi.setPaperStatus(paperId, next);
      toast.success(next === "published" ? t("examDesigner.publishSuccess") : t("examDesigner.unpublishSuccess"));
      await load();
    } catch (err: any) { toast.error(err?.response?.data?.message ?? t("examDesigner.actionFailed")); }
  }

  const [showPdfLangPicker, setShowPdfLangPicker] = useState(false);

  async function handleDownloadPdf(lang: "zh" | "en" | "ms") {
    setShowPdfLangPicker(false);
    try {
      const blob = await examApi.downloadPaperPdf(paperId, lang);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const title = paper?.title_i18n?.[lang] || paper?.title_i18n?.zh || "exam";
      a.href = url; a.download = `${title}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      // downloadPaperPdf 用 responseType:"blob"——出错时后端返回的错误JSON
      // 也会被axios当成Blob对待，不会自动解析，所以 err.response.data.message
      // 这种常规写法在这里读不到东西，要手动把Blob内容读出来再parse一次，
      // 不然不管后端实际报什么错，前端永远只能显示写死的兜底文案，排查
      // 起来很难受(之前这里就是这样，见"生成PDF失败——请确认试卷至少
      // 有1道题目"这句话不管什么原因失败都会显示的问题)。
      let message = t("examDesigner.pdfFailed");
      const data = err?.response?.data;
      if (data instanceof Blob) {
        try {
          const text = await data.text();
          const parsed = JSON.parse(text);
          if (parsed?.message) message = parsed.message;
        } catch { /* Blob内容不是JSON文字(比如网络层错误没有响应体)，用兜底文案 */ }
      } else if (data?.message) {
        message = data.message;
      }
      toast.error(message);
    }
  }

  if (loading || !paper) return <div className="max-w-4xl mx-auto py-8 px-4"><p className="text-sm text-muted-foreground">{t("exam.loading")}</p></div>;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">{t("examDesigner.backToList")}</button>
          <h1 className="text-xl font-bold text-foreground">{paper.title_i18n?.zh || paper.title_i18n?.en}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            paper.status === "published" ? "bg-emerald-100 text-emerald-700" : paper.status === "closed" ? "bg-gray-100 text-gray-600" : "bg-amber-100 text-amber-700"
          }`}>
            {paper.status === "published" ? t("examDesigner.status.published") : paper.status === "closed" ? t("examDesigner.status.closed") : t("examDesigner.status.draft")}
          </span>
        </div>
        <div className="flex gap-2 relative">
          <Button variant="outline" size="sm" onClick={() => window.open(`/exam-preview/${paper.id}`, "_blank")}>{t("examDesigner.tryPreview")}</Button>
          <Button variant="outline" size="sm" onClick={() => setShowPdfLangPicker((v) => !v)}><Download size={14} className="mr-1" /> {t("examDesigner.downloadPdf")}</Button>
          {showPdfLangPicker && (
            <div className="absolute top-full right-0 mt-1 bg-white border border-border rounded-lg shadow-lg py-1 z-20 w-40">
              {([["zh", "中文"], ["en", "English"], ["ms", "Bahasa Melayu"]] as const).map(([code, label]) => (
                <button key={code} onClick={() => handleDownloadPdf(code)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50">{label}</button>
              ))}
            </div>
          )}
          {paper.status !== "closed" && (
            <Button size="sm" onClick={handlePublish}>{paper.status === "draft" ? t("examDesigner.publish") : t("examDesigner.unpublish")}</Button>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit mb-6">
        {([
          ["basic", t("examDesigner.tabs.basic")], ["questions", t("examDesigner.tabs.questions", { n: paper.questions.length })], ["bank", t("examDesigner.tabs.bank")], ["students", t("examDesigner.tabs.students")], ["leaderboard", t("examDesigner.leaderboard.tabLabel")],
        ] as const).map(([key, label]) => (
          <button
            key={key} onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${tab === key ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "basic" && <BasicInfoTab paper={paper} onSaved={load} />}
      {tab === "questions" && <QuestionsTab paper={paper} onChanged={load} />}
      {tab === "bank" && <QuestionBankTab />}
      {tab === "students" && <StudentsTab paperId={paperId} />}
      {tab === "leaderboard" && <LeaderboardTab paperId={paperId} />}
    </div>
  );
}

// ── 排行榜 ──────────────────────────────────────────────────────────────────

function LeaderboardTab({ paperId }: { paperId: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [data, setData] = useState<{
    total_marks: number;
    rankings: Array<{ student_id: string; full_name_zh?: string; full_name_en?: string; username: string; best_score: number; best_submitted_at: string }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    examApi.getLeaderboard(paperId)
      .then(setData)
      .catch(() => toast.error(t("examDesigner.leaderboard.loadFailed")))
      .finally(() => setLoading(false));
  }, [paperId]);

  if (loading) return <p className="text-sm text-muted-foreground">{t("exam.loading")}</p>;
  if (!data || data.rankings.length === 0) return <p className="text-sm text-muted-foreground/60 text-center py-8">{t("examDesigner.leaderboard.empty")}</p>;

  return (
    <div className="rounded-xl bg-white border border-border shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 text-xs text-muted-foreground">
            <th className="text-left px-4 py-2 font-medium">{t("examDesigner.leaderboard.rankHeader")}</th>
            <th className="text-left px-4 py-2 font-medium">{t("examDesigner.leaderboard.nameHeader")}</th>
            <th className="text-left px-4 py-2 font-medium">{t("examDesigner.leaderboard.scoreHeader")}</th>
            <th className="text-left px-4 py-2 font-medium">{t("examDesigner.leaderboard.timeHeader")}</th>
          </tr>
        </thead>
        <tbody>
          {data.rankings.map((r, i) => (
            <tr key={r.student_id} className="border-t border-border/60">
              <td className="px-4 py-2.5 font-semibold text-foreground">
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
              </td>
              <td className="px-4 py-2.5">{r.full_name_zh || r.full_name_en || r.username}</td>
              <td className="px-4 py-2.5 font-medium">{r.best_score} / {data.total_marks}</td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">{new Date(r.best_submitted_at).toLocaleString(locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 基本信息 ──────────────────────────────────────────────────────────────────

function BasicInfoTab({ paper, onSaved }: { paper: ExamPaper; onSaved: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(paper.title_i18n?.zh ?? "");
  const [titleEn, setTitleEn] = useState(paper.title_i18n?.en ?? "");
  const [titleMs, setTitleMs] = useState(paper.title_i18n?.ms ?? "");
  const [description, setDescription] = useState(paper.description ?? "");
  const [timeLimit, setTimeLimit] = useState(paper.time_limit_minutes);
  const [opensAt, setOpensAt] = useState(paper.opens_at?.slice(0, 16) ?? "");
  const [closesAt, setClosesAt] = useState(paper.closes_at?.slice(0, 16) ?? "");
  const [allowRetake, setAllowRetake] = useState(paper.allow_retake);
  const [maxAttempts, setMaxAttempts] = useState(paper.max_attempts);
  const [reviewPolicy, setReviewPolicy] = useState(paper.review_policy);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title.trim()) { toast.error(t("examDesigner.basic.titleRequired")); return; }
    setSaving(true);
    try {
      await examApi.updatePaper(paper.id, {
        title_i18n: { zh: title.trim(), en: titleEn.trim() || undefined, ms: titleMs.trim() || undefined },
        description: description || undefined,
        time_limit_minutes: timeLimit,
        opens_at: opensAt || undefined, closes_at: closesAt || undefined,
        allow_retake: allowRetake, max_attempts: allowRetake ? maxAttempts : 1,
        review_policy: reviewPolicy,
      });
      toast.success(t("examDesigner.basic.saveSuccess"));
      onSaved();
    } catch (err) { toast.error(t("examDesigner.basic.saveFailed")); }
    setSaving(false);
  }

  return (
    <div className="rounded-xl bg-white border border-border shadow-sm p-5 space-y-4">
      <MultiLangInput
        label={t("examDesigner.basic.titleLabel")}
        values={{ zh: title, en: titleEn, ms: titleMs }}
        onChange={(lang, v) => (lang === "zh" ? setTitle(v) : lang === "en" ? setTitleEn(v) : setTitleMs(v))}
      />
      <div>
        <Label>{t("examDesigner.basic.descLabel")}</Label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={INPUT_CLASS} />
      </div>
      <div>
        <Label>{t("examDesigner.basic.timeLimitLabel")}</Label>
        <Input type="number" min={1} value={timeLimit} onChange={(e) => setTimeLimit(+e.target.value)} className="w-32" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>{t("examDesigner.basic.opensAtLabel")}</Label>
          <Input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
        </div>
        <div>
          <Label>{t("examDesigner.basic.closesAtLabel")}</Label>
          <Input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
        </div>
      </div>

      <div className="pt-2 border-t border-border/60 space-y-3">
        <div className="flex items-center gap-2">
          <input type="checkbox" id="allow-retake" checked={allowRetake} onChange={(e) => setAllowRetake(e.target.checked)} className="w-4 h-4" />
          <label htmlFor="allow-retake" className="text-sm">{t("examDesigner.basic.allowRetake")}</label>
          {allowRetake && (
            <span className="flex items-center gap-1.5 ml-2">
              <span className="text-xs text-muted-foreground">{t("examDesigner.basic.maxLabel")}</span>
              <Input type="number" min={1} value={maxAttempts} onChange={(e) => setMaxAttempts(Math.max(1, +e.target.value))} className="w-16 h-8 text-sm" />
              <span className="text-xs text-muted-foreground">{t("examDesigner.basic.timesLabel")}</span>
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground/70 pl-6">
          {allowRetake ? t("examDesigner.basic.retakeHintOn") : t("examDesigner.basic.retakeHintOff")}
        </p>
      </div>

      <div className="pt-2 border-t border-border/60">
        <Label>{t("examDesigner.basic.reviewPolicyLabel")}</Label>
        <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit mt-1.5">
          {(["immediate", "after_close"] as const).map((v) => (
            <button
              key={v} type="button" onClick={() => setReviewPolicy(v)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${reviewPolicy === v ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {v === "immediate" ? t("examDesigner.basic.reviewImmediate") : t("examDesigner.basic.reviewAfterClose")}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground/70 mt-1.5">
          {reviewPolicy === "after_close"
            ? (closesAt ? t("examDesigner.basic.reviewHintAfterCloseSet") : t("examDesigner.basic.reviewHintAfterCloseUnset"))
            : t("examDesigner.basic.reviewHintImmediate")}
        </p>
      </div>

      <div className="pt-2">
        <Button onClick={handleSave} disabled={saving}>{saving ? t("examDesigner.basic.saving") : t("examDesigner.basic.save")}</Button>
      </div>
    </div>
  );
}

// ── 题目 ──────────────────────────────────────────────────────────────────────

function QuestionsTab({ paper, onChanged }: { paper: ExamPaper & { questions: ExamPaperQuestion[] }; onChanged: () => void }) {
  const { t } = useTranslation();
  const [showAddForm, setShowAddForm] = useState<"fixed" | "random" | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<ExamPaperQuestion | null>(null);
  const locked = paper.status !== "draft";

  async function handleDelete(questionId: string) {
    if (!confirm(t("examDesigner.questions.confirmDelete"))) return;
    try { await examApi.deleteQuestion(paper.id, questionId); toast.success(t("examDesigner.questions.deleteSuccess")); onChanged(); }
    catch (err) { toast.error(t("examDesigner.questions.deleteFailed")); }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= paper.questions.length) return;
    const ids = paper.questions.map((q) => q.id);
    [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
    try { await examApi.reorderQuestions(paper.id, ids); onChanged(); }
    catch (err) { toast.error(t("examDesigner.reorder.reorderFailed")); }
  }

  return (
    <div className="space-y-4">
      {locked && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          {t("examDesigner.questions.lockedNotice", { status: paper.status === "published" ? t("examDesigner.questions.statusPublishedVerb") : t("examDesigner.questions.statusClosedVerb") })}
        </p>
      )}

      <div className="space-y-2">
        {paper.questions.length === 0 ? (
          <p className="text-sm text-muted-foreground/60 text-center py-8">{t("examDesigner.questions.empty")}</p>
        ) : (
          paper.questions.map((q, i) => (
            <div key={q.id} className="rounded-xl border border-border bg-white shadow-sm p-3 flex items-center gap-3">
              <span className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold flex-shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                {q.slot_type === "fixed" ? (
                  <>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      {q.question_type === "multiple_choice" ? <CheckSquare size={14} /> : q.question_type === "fill_blank" ? <PencilLine size={14} /> : <span>🎨</span>}
                      {q.question_type === "multiple_choice"
                        ? ((q.config?.question_i18n as Record<string, string>)?.zh ?? t("examDesigner.questions.mcDefaultLabel"))
                        : q.question_type === "fill_blank"
                        ? ((q.config?.sentence_i18n as Record<string, string>)?.zh ?? t("examDesigner.questions.fbDefaultLabel"))
                        : t("examDesigner.questions.coloringLabel")}
                    </div>
                  </>
                ) : (
                  <div className="text-sm font-medium text-foreground">
                    {t("examDesigner.questions.randomSlotLabel", { category: q.random_category, count: q.random_count })}
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-0.5">{t("examDesigner.questions.marksLabel", { n: q.marks })}{q.slot_type === "random_category" ? t("examDesigner.questions.marksPerQuestion", { total: (q.marks) * (q.random_count ?? 0) }) : ""}</div>
              </div>
              {!locked && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => handleMove(i, -1)} disabled={i === 0} title={t("examDesigner.reorder.moveUp")} className="text-muted-foreground hover:text-foreground p-1.5 disabled:opacity-30 disabled:hover:text-muted-foreground">
                    ▲
                  </button>
                  <button onClick={() => handleMove(i, 1)} disabled={i === paper.questions.length - 1} title={t("examDesigner.reorder.moveDown")} className="text-muted-foreground hover:text-foreground p-1.5 disabled:opacity-30 disabled:hover:text-muted-foreground">
                    ▼
                  </button>
                  <button onClick={() => { setEditingQuestion(q); setShowAddForm(q.slot_type === "fixed" ? "fixed" : "random"); }} className="text-muted-foreground hover:text-foreground p-1.5">
                    <PencilLine size={15} />
                  </button>
                  <button onClick={() => handleDelete(q.id)} className="text-muted-foreground hover:text-red-600 p-1.5">
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {!locked && !showAddForm && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setEditingQuestion(null); setShowAddForm("fixed"); }}><Plus size={14} className="mr-1" /> {t("examDesigner.questions.addFixed")}</Button>
          <Button variant="outline" onClick={() => { setEditingQuestion(null); setShowAddForm("random"); }}><Plus size={14} className="mr-1" /> {t("examDesigner.questions.addRandom")}</Button>
        </div>
      )}

      {showAddForm === "fixed" && (
        <AddFixedQuestionForm
          paperId={paper.id} editing={editingQuestion}
          onDone={() => { setShowAddForm(null); setEditingQuestion(null); onChanged(); }}
          onCancel={() => { setShowAddForm(null); setEditingQuestion(null); }}
        />
      )}
      {showAddForm === "random" && (
        <AddRandomSlotForm
          paperId={paper.id} editing={editingQuestion}
          onDone={() => { setShowAddForm(null); setEditingQuestion(null); onChanged(); }}
          onCancel={() => { setShowAddForm(null); setEditingQuestion(null); }}
        />
      )}
    </div>
  );
}

// ── 加固定题——选择题/填充题二选一，表单逻辑照抄 CourseDesignerPage 里
//    multiple_choice/fill_blank 那两块，只是保存目标换成试卷题目槽位 ───────

function AddFixedQuestionForm({ paperId, editing, onDone, onCancel }: { paperId: string; editing?: ExamPaperQuestion | null; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const isEditing = !!editing;
  const editConfig = (editing?.config ?? {}) as Record<string, unknown>;

  const [qType, setQType] = useState<"multiple_choice" | "fill_blank" | "coloring">((editing?.question_type as any) ?? "multiple_choice");
  const [marks, setMarks] = useState(editing?.marks ?? 1);

  // 选择题字段
  const [mcAnswerMode, setMcAnswerMode] = useState<"single" | "multi">((editConfig.answer_mode as "single" | "multi") ?? "single");
  const [mcOptions, setMcOptions] = useState<MCOption[]>(() => {
    if (editing?.question_type === "multiple_choice") {
      const opts = (editConfig.options as Array<{ id: string; text_i18n?: Record<string, string>; image_url?: string }>) ?? [];
      const correctIds = new Set((editConfig.correct_option_ids as string[]) ?? []);
      if (opts.length > 0) {
        return opts.map((o) => ({
          id: o.id, zh: o.text_i18n?.zh ?? "", en: o.text_i18n?.en ?? "", ms: o.text_i18n?.ms ?? "",
          correct: correctIds.has(o.id), image_url: o.image_url,
        }));
      }
    }
    return [
      { id: "opt1", zh: "", en: "", ms: "", correct: false },
      { id: "opt2", zh: "", en: "", ms: "", correct: false },
    ];
  });
  const mcQi18n = (editConfig.question_i18n ?? {}) as Record<string, string>;
  const [mcQuestionZh, setMcQuestionZh] = useState(mcQi18n.zh ?? "");
  const [mcQuestionEn, setMcQuestionEn] = useState(mcQi18n.en ?? "");
  const [mcQuestionMs, setMcQuestionMs] = useState(mcQi18n.ms ?? "");

  // 填充题字段
  const fbSi18n = (editConfig.sentence_i18n ?? {}) as Record<string, string>;
  const [fbSentenceZh, setFbSentenceZh] = useState(fbSi18n.zh ?? "");
  const [fbSentenceEn, setFbSentenceEn] = useState(fbSi18n.en ?? "");
  const [fbSentenceMs, setFbSentenceMs] = useState(fbSi18n.ms ?? "");
  const [fbBlankAnswers, setFbBlankAnswers] = useState<string[]>(() => {
    if (editing?.question_type === "fill_blank") {
      const blanks = (editConfig.blanks as Array<{ accepted_answers: string[] }>) ?? [];
      if (blanks.length > 0) return blanks.map((b) => (b.accepted_answers ?? []).join(", "));
    }
    return [""];
  });

  // 填色题字段
  const [coloringConfig, setColoringConfig] = useState<ColoringConfig | null>(
    editing?.question_type === "coloring" ? (editConfig as unknown as ColoringConfig) : null
  );

  // 题目配图字段(选择题/填充题都能用，纯装饰性插图，不影响判分)
  const editIllustration = (editConfig.illustration as Illustration | undefined) ?? undefined;
  const [showIllustration, setShowIllustration] = useState(!!editIllustration);
  const [illustration, setIllustration] = useState<Illustration | null>(editIllustration ?? null);

  async function handleSubmit() {
    try {
      let config: Record<string, unknown>;
      let questionType: string = qType;
      if (qType === "multiple_choice") {
        const filled = mcOptions.filter((o) => o.zh.trim() || o.image_url);
        if (filled.length < 2) { toast.error(t("examDesigner.form.needTwoOptions")); return; }
        const correct = filled.filter((o) => o.correct);
        if (correct.length === 0) { toast.error(t("examDesigner.form.needCorrectOption")); return; }
        if (!mcQuestionZh.trim()) { toast.error(t("examDesigner.form.needQuestionText")); return; }
        config = {
          answer_mode: mcAnswerMode,
          options: filled.map((o) => ({ id: o.id, text_i18n: { zh: o.zh || undefined, en: o.en || undefined, ms: o.ms || undefined }, image_url: o.image_url || undefined })),
          correct_option_ids: correct.map((o) => o.id),
          question_i18n: { zh: mcQuestionZh.trim(), en: mcQuestionEn.trim() || undefined, ms: mcQuestionMs.trim() || undefined },
          illustration: illustration ?? undefined,
        };
      } else if (qType === "fill_blank") {
        const blankCount = (fbSentenceZh.match(/___/g) ?? []).length;
        if (!fbSentenceZh.trim() || blankCount === 0) { toast.error(t("examDesigner.form.needSentenceBlank")); return; }
        if (fbSentenceEn.trim() && (fbSentenceEn.match(/___/g) ?? []).length !== blankCount) { toast.error(t("examDesigner.form.blankCountMismatchEn", { n: blankCount })); return; }
        if (fbSentenceMs.trim() && (fbSentenceMs.match(/___/g) ?? []).length !== blankCount) { toast.error(t("examDesigner.form.blankCountMismatchMs", { n: blankCount })); return; }
        const blanks = fbBlankAnswers.slice(0, blankCount).map((s) => s.split(",").map((x) => x.trim()).filter(Boolean));
        if (blanks.length < blankCount || blanks.some((b) => b.length === 0)) { toast.error(t("examDesigner.form.needBlankAnswer")); return; }
        config = {
          sentence_i18n: { zh: fbSentenceZh.trim(), en: fbSentenceEn.trim() || undefined, ms: fbSentenceMs.trim() || undefined },
          blanks: blanks.map((accepted) => ({ accepted_answers: accepted })), illustration: illustration ?? undefined,
        };
      } else {
        if (!coloringConfig) { toast.error(t("examDesigner.form.needShape")); return; }
        const colorable = coloringConfig.regions.filter((r) => r.colorable);
        if (colorable.length === 0) { toast.error(t("examDesigner.form.needColorableRegion")); return; }
        if (colorable.some((r) => !r.correct_color)) { toast.error(t("examDesigner.form.needCorrectColor")); return; }
        config = coloringConfig as unknown as Record<string, unknown>;
      }

      if (isEditing && editing) {
        await examApi.updateQuestion(paperId, editing.id, { slot_type: "fixed", question_type: questionType, marks, config });
        toast.success(t("examDesigner.form.saveSuccess"));
      } else {
        await examApi.addQuestion(paperId, { slot_type: "fixed", question_type: questionType, marks, config });
        toast.success(t("examDesigner.form.addSuccess"));
      }
      onDone();
    } catch (err: any) { toast.error(err?.response?.data?.message ?? (isEditing ? t("examDesigner.form.saveFailed") : t("examDesigner.form.addFailed"))); }
  }

  return (
    <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4">
      <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
        {(["multiple_choice", "fill_blank", "coloring"] as const).map((qt) => (
          <button
            key={qt} onClick={() => setQType(qt)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${qType === qt ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {qt === "multiple_choice" ? t("examDesigner.form.typeMC") : qt === "fill_blank" ? t("examDesigner.form.typeFB") : t("examDesigner.form.typeColoring")}
          </button>
        ))}
        <div className="flex items-center gap-1.5 pl-3">
          <span className="text-xs text-muted-foreground">{t("examDesigner.form.marksLabel")}</span>
          <Input type="number" min={1} value={marks} onChange={(e) => setMarks(Math.max(1, +e.target.value))} className="w-16 h-7 text-xs" />
        </div>
      </div>

      {qType === "coloring" && <ColoringQuestionEditor initial={coloringConfig ?? undefined} onChange={setColoringConfig} />}

      {(qType === "multiple_choice" || qType === "fill_blank") && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <button type="button" onClick={() => setShowIllustration((v) => !v)} className="text-xs font-medium text-foreground flex items-center gap-1.5">
            {t("examDesigner.form.illustrationToggle")}{showIllustration ? "▲" : "▼"}
          </button>
          {showIllustration && (
            <div className="mt-3">
              <IllustrationEditor initial={illustration ?? undefined} onChange={setIllustration} />
            </div>
          )}
        </div>
      )}

      {qType !== "coloring" && (qType === "multiple_choice" ? (
        <>
          <MultiLangInput
            label={t("examDesigner.form.questionTextLabel")} multiline
            values={{ zh: mcQuestionZh, en: mcQuestionEn, ms: mcQuestionMs }}
            onChange={(lang, v) => (lang === "zh" ? setMcQuestionZh(v) : lang === "en" ? setMcQuestionEn(v) : setMcQuestionMs(v))}
          />
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{t("examDesigner.form.answerModeLabel")}</span>
            <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
              {(["single", "multi"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMcAnswerMode(m)} className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 ${mcAnswerMode === m ? "bg-white shadow-sm text-foreground" : "text-muted-foreground"}`}>
                  <span className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${mcAnswerMode === m ? "border-primary bg-primary" : "border-muted-foreground/40"}`} />
                  {m === "single" ? t("examDesigner.form.single") : t("examDesigner.form.multi")}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {mcOptions.map((opt) => (
              <div key={opt.id} className="rounded-lg border border-border bg-muted/20 p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button" onClick={() => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, correct: !o.correct } : o)))}
                    className={`w-7 h-7 flex-shrink-0 rounded-md border-2 flex items-center justify-center text-xs font-bold ${opt.correct ? "border-emerald-500 bg-emerald-500 text-white" : "border-border bg-white text-transparent"}`}
                  >✓</button>
                  <OptionImagePicker option={opt} onChange={(img) => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, image_url: img } : o)))} />
                  <span className="text-xs text-muted-foreground flex-1">{t("examDesigner.form.optionHint")}</span>
                  <button
                    type="button" onClick={() => setMcOptions((arr) => (arr.length > 2 ? arr.filter((o) => o.id !== opt.id) : arr))}
                    disabled={mcOptions.length <= 2} className="w-7 h-7 flex-shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30"
                  ><X size={14} /></button>
                </div>
                <MultiLangInput
                  label={t("examDesigner.form.optionTextLabel")}
                  values={{ zh: opt.zh, en: opt.en, ms: opt.ms }}
                  onChange={(lang, v) => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, [lang]: v } : o)))}
                  required={null}
                />
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setMcOptions((arr) => [...arr, { id: `opt${Date.now()}`, zh: "", en: "", ms: "", correct: false }])}>{t("examDesigner.form.addOption")}</Button>
          </div>
        </>
      ) : (
        <>
          <MultiLangInput
            label={t("examDesigner.form.sentenceLabel")}
            values={{ zh: fbSentenceZh, en: fbSentenceEn, ms: fbSentenceMs }}
            onChange={(lang, v) => (lang === "zh" ? setFbSentenceZh(v) : lang === "en" ? setFbSentenceEn(v) : setFbSentenceMs(v))}
          />
          {(() => {
            const blankCount = (fbSentenceZh.match(/___/g) ?? []).length;
            if (blankCount === 0) return <p className="text-xs text-muted-foreground/60">{t("examDesigner.form.addBlankHint")}</p>;
            return (
              <div className="space-y-1.5">
                {Array.from({ length: blankCount }, (_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-14 flex-shrink-0">{t("examDesigner.form.blankLabel", { n: i + 1 })}</span>
                    <Input
                      placeholder={t("examDesigner.form.blankPlaceholder")} value={fbBlankAnswers[i] ?? ""}
                      onChange={(e) => setFbBlankAnswers((arr) => { const next = [...arr]; while (next.length <= i) next.push(""); next[i] = e.target.value; return next; })}
                    />
                  </div>
                ))}
              </div>
            );
          })()}
        </>
      ))}

      <div className="flex gap-2 pt-2">
        <Button onClick={handleSubmit}>{isEditing ? t("examDesigner.form.submitSave") : t("examDesigner.form.submitAdd")}</Button>
        <Button variant="outline" onClick={onCancel}>{t("examDesigner.form.cancel")}</Button>
      </div>
    </div>
  );
}

// ── 加随机抽题槽 ──────────────────────────────────────────────────────────────

function AddRandomSlotForm({ paperId, editing, onDone, onCancel }: { paperId: string; editing?: ExamPaperQuestion | null; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const isEditing = !!editing;
  const [categories, setCategories] = useState<Array<{ category: string; question_count: number }>>([]);
  const [category, setCategory] = useState(editing?.random_category ?? "");
  const [count, setCount] = useState(editing?.random_count ?? 1);
  const [marks, setMarks] = useState(editing?.marks ?? 1);

  useEffect(() => { examApi.listQuestionBankCategories().then(setCategories).catch(() => {}); }, []);

  async function handleSubmit() {
    if (!category.trim()) { toast.error(t("examDesigner.randomForm.needCategory")); return; }
    try {
      if (isEditing && editing) {
        await examApi.updateQuestion(paperId, editing.id, { slot_type: "random_category", marks, random_category: category.trim(), random_count: count });
        toast.success(t("examDesigner.form.saveSuccess"));
      } else {
        await examApi.addQuestion(paperId, { slot_type: "random_category", marks, random_category: category.trim(), random_count: count });
        toast.success(t("examDesigner.form.addSuccess"));
      }
      onDone();
    } catch (err: any) { toast.error(err?.response?.data?.message ?? (isEditing ? t("examDesigner.form.saveFailed") : t("examDesigner.form.addFailed"))); }
  }

  return (
    <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4">
      <p className="text-xs text-muted-foreground">{t("examDesigner.randomForm.hint")}</p>
      <div>
        <Label>{t("examDesigner.randomForm.categoryLabel")}</Label>
        {categories.length === 0 ? (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-1">{t("examDesigner.randomForm.noCategoriesHint")}</p>
        ) : (
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT_CLASS}>
            <option value="">{t("examDesigner.randomForm.selectPlaceholder")}</option>
            {categories.map((c) => <option key={c.category} value={c.category}>{t("examDesigner.randomForm.categoryOption", { category: c.category, count: c.question_count })}</option>)}
          </select>
        )}
      </div>
      <div className="flex gap-4">
        <div>
          <Label>{t("examDesigner.randomForm.countLabel")}</Label>
          <Input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, +e.target.value))} className="w-24" />
        </div>
        <div>
          <Label>{t("examDesigner.randomForm.marksPerLabel")}</Label>
          <Input type="number" min={1} value={marks} onChange={(e) => setMarks(Math.max(1, +e.target.value))} className="w-24" />
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <Button onClick={handleSubmit} disabled={categories.length === 0}>{isEditing ? t("examDesigner.form.submitSave") : t("examDesigner.form.submitAdd")}</Button>
        <Button variant="outline" onClick={onCancel}>{t("examDesigner.form.cancel")}</Button>
      </div>
    </div>
  );
}

// ── 题库 ──────────────────────────────────────────────────────────────────────

function QuestionBankTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ExamQuestionBankItem[]>([]);
  const [filterCategory, setFilterCategory] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingItem, setEditingItem] = useState<ExamQuestionBankItem | null>(null);
  const [loading, setLoading] = useState(true);

  const EDITABLE_TYPES = new Set(["multiple_choice", "fill_blank", "coloring"]);

  useEffect(() => { load(); }, [filterCategory]);

  async function load() {
    setLoading(true);
    try {
      const { data } = await examApi.listQuestionBank({ category: filterCategory || undefined, limit: 100 });
      setItems(data);
    } catch (err) { toast.error(t("examDesigner.bank.loadFailed")); }
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm(t("examDesigner.bank.confirmDelete"))) return;
    try { await examApi.deleteBankQuestion(id); toast.success(t("examDesigner.bank.deleteSuccess")); load(); }
    catch (err) { toast.error(t("examDesigner.bank.deleteFailed")); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Input placeholder={t("examDesigner.bank.filterPlaceholder")} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="w-64" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowImport(true)}>{t("examDesigner.bank.importFromActivity")}</Button>
          <Button onClick={() => { setEditingItem(null); setShowAdd(true); }}><Plus size={14} className="mr-1" /> {t("examDesigner.bank.addQuestion")}</Button>
        </div>
      </div>

      {showAdd && (
        <AddBankQuestionForm
          editing={editingItem}
          onDone={() => { setShowAdd(false); setEditingItem(null); load(); }}
          onCancel={() => { setShowAdd(false); setEditingItem(null); }}
        />
      )}
      {showImport && <ImportFromActivityForm onDone={() => { setShowImport(false); load(); }} onCancel={() => setShowImport(false)} />}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("exam.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 text-center py-8">{t("examDesigner.bank.empty")}</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="rounded-xl border border-border bg-white shadow-sm p-3 flex items-center gap-3">
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0">{it.category}</span>
              <div className="flex-1 min-w-0 text-sm text-foreground truncate">
                {it.question_type === "multiple_choice"
                  ? ((it.config?.question_i18n as Record<string, string>)?.zh ?? t("examDesigner.questions.mcDefaultLabel"))
                  : it.question_type === "fill_blank"
                  ? ((it.config?.sentence_i18n as Record<string, string>)?.zh ?? t("examDesigner.questions.fbDefaultLabel"))
                  : it.question_type === "coloring"
                  ? t("examDesigner.form.typeColoring")
                  : it.question_type === "sudoku"
                  ? t("examDesigner.bank.typeSudoku")
                  : t("examDesigner.bank.typeSticker")}
              </div>
              {EDITABLE_TYPES.has(it.question_type) && (
                <button onClick={() => { setEditingItem(it); setShowAdd(true); }} className="text-muted-foreground hover:text-foreground p-1.5 flex-shrink-0">
                  <PencilLine size={15} />
                </button>
              )}
              <button onClick={() => handleDelete(it.id)} className="text-muted-foreground hover:text-red-600 p-1.5 flex-shrink-0"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 从 Activity 库导入 ────────────────────────────────────────────────────────
// 只支持 multiple_choice/fill_blank/sudoku/sticker_game 这几种(对应后端
// 已经实现服务器端判分的题型)。选中的Activity内容会被**复制**一份进
// 考试题库，不是引用——之后Activity原题怎么改都不影响这份副本。
// 数独/贴纸游戏这两种要特别提醒：判分安全等级会被提升到跟考试系统一致
// (后端判分)，但贴纸游戏的判定方式从"像素坐标容差"简化成了"离散槽位
// 匹配"，跟原本Activity里玩起来的手感不完全一样，这点也提醒一下老师。

function getImportableTypes(t: (key: string) => string) {
  return [
    { value: "multiple_choice", label: t("examDesigner.importForm.typeMC") },
    { value: "fill_blank", label: t("examDesigner.importForm.typeFB") },
    { value: "sudoku", label: t("examDesigner.importForm.typeSudoku") },
    { value: "sticker_game", label: t("examDesigner.importForm.typeSticker") },
  ] as const;
}

function ImportFromActivityForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const IMPORTABLE_TYPES = getImportableTypes(t);
  const [moduleType, setModuleType] = useState<string>("multiple_choice");
  const [activities, setActivities] = useState<Array<{ id: string; title_i18n: Record<string, string> }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    examApi.listQuestionBankCategories().then((cats) => setExistingCategories(cats.map((c) => c.category))).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true); setSelectedId(null);
    examApi.listImportableActivities(moduleType, { limit: 100 })
      .then(({ data }) => setActivities(data))
      .catch(() => toast.error(t("examDesigner.importForm.loadActivityFailed")))
      .finally(() => setLoading(false));
  }, [moduleType]);

  async function handleImport() {
    if (!selectedId) { toast.error(t("examDesigner.importForm.needSelectActivity")); return; }
    if (!category.trim()) { toast.error(t("examDesigner.importForm.needCategoryName")); return; }
    setImporting(true);
    try {
      await examApi.importFromActivity(selectedId, category.trim());
      toast.success(t("examDesigner.importForm.importSuccess"));
      onDone();
    } catch (err: any) { toast.error(err?.response?.data?.message ?? t("examDesigner.importForm.importFailed")); }
    setImporting(false);
  }

  return (
    <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4">
      {(moduleType === "sudoku" || moduleType === "sticker_game") && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          {t("examDesigner.importForm.safetyNoticeBase")}
          {moduleType === "sticker_game" && t("examDesigner.importForm.stickerNotice")}
        </p>
      )}

      <div>
        <Label>{t("examDesigner.importForm.typeLabel")}</Label>
        <div className="flex gap-1.5 flex-wrap">
          {IMPORTABLE_TYPES.map((tp) => (
            <button
              key={tp.value} type="button" onClick={() => setModuleType(tp.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${moduleType === tp.value ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground"}`}
            >
              {tp.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>{t("examDesigner.importForm.selectActivityLabel")}</Label>
        {loading ? (
          <p className="text-xs text-muted-foreground">{t("exam.loading")}</p>
        ) : activities.length === 0 ? (
          <p className="text-xs text-muted-foreground/60">{t("examDesigner.importForm.emptyActivities")}</p>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-1 border border-border rounded-lg p-1.5">
            {activities.map((a) => (
              <button
                key={a.id} type="button" onClick={() => setSelectedId(a.id)}
                className={`w-full text-left px-2.5 py-1.5 rounded-md text-sm ${selectedId === a.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/40"}`}
              >
                {a.title_i18n?.zh || a.title_i18n?.en}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <Label>{t("examDesigner.importForm.categoryTargetLabel")}</Label>
        <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t("examDesigner.importForm.categoryPlaceholder")} list="import-category-options" />
        <datalist id="import-category-options">
          {existingCategories.map((c) => <option key={c} value={c} />)}
        </datalist>
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={handleImport} disabled={importing}>{importing ? t("examDesigner.importForm.importing") : t("examDesigner.importForm.import")}</Button>
        <Button variant="outline" onClick={onCancel}>{t("examDesigner.form.cancel")}</Button>
      </div>
    </div>
  );
}

function AddBankQuestionForm({ editing, onDone, onCancel }: { editing?: ExamQuestionBankItem | null; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const isEditing = !!editing;
  const editConfig = (editing?.config ?? {}) as Record<string, unknown>;

  const [category, setCategory] = useState(editing?.category ?? "");
  const [qType, setQType] = useState<"multiple_choice" | "fill_blank" | "coloring">((editing?.question_type as any) ?? "multiple_choice");
  const [mcAnswerMode, setMcAnswerMode] = useState<"single" | "multi">((editConfig.answer_mode as "single" | "multi") ?? "single");
  const [mcOptions, setMcOptions] = useState<MCOption[]>(() => {
    if (editing?.question_type === "multiple_choice") {
      const opts = (editConfig.options as Array<{ id: string; text_i18n?: Record<string, string>; image_url?: string }>) ?? [];
      const correctIds = new Set((editConfig.correct_option_ids as string[]) ?? []);
      if (opts.length > 0) {
        return opts.map((o) => ({
          id: o.id, zh: o.text_i18n?.zh ?? "", en: o.text_i18n?.en ?? "", ms: o.text_i18n?.ms ?? "",
          correct: correctIds.has(o.id), image_url: o.image_url,
        }));
      }
    }
    return [
      { id: "opt1", zh: "", en: "", ms: "", correct: false },
      { id: "opt2", zh: "", en: "", ms: "", correct: false },
    ];
  });
  const mcQi18n = (editConfig.question_i18n ?? {}) as Record<string, string>;
  const [mcQuestionZh, setMcQuestionZh] = useState(mcQi18n.zh ?? "");
  const [mcQuestionEn, setMcQuestionEn] = useState(mcQi18n.en ?? "");
  const [mcQuestionMs, setMcQuestionMs] = useState(mcQi18n.ms ?? "");
  const fbSi18n = (editConfig.sentence_i18n ?? {}) as Record<string, string>;
  const [fbSentenceZh, setFbSentenceZh] = useState(fbSi18n.zh ?? "");
  const [fbSentenceEn, setFbSentenceEn] = useState(fbSi18n.en ?? "");
  const [fbSentenceMs, setFbSentenceMs] = useState(fbSi18n.ms ?? "");
  const [fbBlankAnswers, setFbBlankAnswers] = useState<string[]>(() => {
    if (editing?.question_type === "fill_blank") {
      const blanks = (editConfig.blanks as Array<{ accepted_answers: string[] }>) ?? [];
      if (blanks.length > 0) return blanks.map((b) => (b.accepted_answers ?? []).join(", "));
    }
    return [""];
  });
  const [coloringConfig, setColoringConfig] = useState<ColoringConfig | null>(
    editing?.question_type === "coloring" ? (editConfig as unknown as ColoringConfig) : null
  );
  const editIllustration = (editConfig.illustration as Illustration | undefined) ?? undefined;
  const [showIllustration, setShowIllustration] = useState(!!editIllustration);
  const [illustration, setIllustration] = useState<Illustration | null>(editIllustration ?? null);

  async function handleSubmit() {
    if (!category.trim()) { toast.error(t("examDesigner.bank.needCategory")); return; }
    try {
      let config: Record<string, unknown>;
      if (qType === "multiple_choice") {
        const filled = mcOptions.filter((o) => o.zh.trim() || o.image_url);
        if (filled.length < 2) { toast.error(t("examDesigner.form.needTwoOptions")); return; }
        const correct = filled.filter((o) => o.correct);
        if (correct.length === 0) { toast.error(t("examDesigner.form.needCorrectOption")); return; }
        if (!mcQuestionZh.trim()) { toast.error(t("examDesigner.form.needQuestionText")); return; }
        config = {
          answer_mode: mcAnswerMode,
          options: filled.map((o) => ({ id: o.id, text_i18n: { zh: o.zh || undefined, en: o.en || undefined, ms: o.ms || undefined }, image_url: o.image_url || undefined })),
          correct_option_ids: correct.map((o) => o.id),
          question_i18n: { zh: mcQuestionZh.trim(), en: mcQuestionEn.trim() || undefined, ms: mcQuestionMs.trim() || undefined },
          illustration: illustration ?? undefined,
        };
      } else if (qType === "fill_blank") {
        const blankCount = (fbSentenceZh.match(/___/g) ?? []).length;
        if (!fbSentenceZh.trim() || blankCount === 0) { toast.error(t("examDesigner.form.needSentenceBlank")); return; }
        if (fbSentenceEn.trim() && (fbSentenceEn.match(/___/g) ?? []).length !== blankCount) { toast.error(t("examDesigner.form.blankCountMismatchEn", { n: blankCount })); return; }
        if (fbSentenceMs.trim() && (fbSentenceMs.match(/___/g) ?? []).length !== blankCount) { toast.error(t("examDesigner.form.blankCountMismatchMs", { n: blankCount })); return; }
        const blanks = fbBlankAnswers.slice(0, blankCount).map((s) => s.split(",").map((x) => x.trim()).filter(Boolean));
        if (blanks.some((b) => b.length === 0)) { toast.error(t("examDesigner.form.needBlankAnswer")); return; }
        config = {
          sentence_i18n: { zh: fbSentenceZh.trim(), en: fbSentenceEn.trim() || undefined, ms: fbSentenceMs.trim() || undefined },
          blanks: blanks.map((accepted) => ({ accepted_answers: accepted })), illustration: illustration ?? undefined,
        };
      } else {
        if (!coloringConfig) { toast.error(t("examDesigner.form.needShape")); return; }
        const colorable = coloringConfig.regions.filter((r) => r.colorable);
        if (colorable.length === 0) { toast.error(t("examDesigner.form.needColorableRegion")); return; }
        if (colorable.some((r) => !r.correct_color)) { toast.error(t("examDesigner.form.needCorrectColor")); return; }
        config = coloringConfig as unknown as Record<string, unknown>;
      }

      if (isEditing && editing) {
        await examApi.updateBankQuestion(editing.id, { category: category.trim(), question_type: qType, config });
        toast.success(t("examDesigner.form.saveSuccess"));
      } else {
        await examApi.createBankQuestion({ category: category.trim(), question_type: qType, config });
        toast.success(t("examDesigner.bank.addToBankSuccess"));
      }
      onDone();
    } catch (err: any) { toast.error(err?.response?.data?.message ?? (isEditing ? t("examDesigner.form.saveFailed") : t("examDesigner.form.addFailed"))); }
  }

  return (
    <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4">
      <div>
        <Label>{t("examDesigner.bank.categoryLabelBank")}</Label>
        <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t("examDesigner.bank.categoryPlaceholder")} />
      </div>
      <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
        {(["multiple_choice", "fill_blank", "coloring"] as const).map((qt) => (
          <button key={qt} onClick={() => setQType(qt)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${qType === qt ? "bg-white shadow-sm" : "text-muted-foreground"}`}>
            {qt === "multiple_choice" ? t("examDesigner.form.typeMC") : qt === "fill_blank" ? t("examDesigner.form.typeFB") : t("examDesigner.form.typeColoring")}
          </button>
        ))}
      </div>
      {qType === "coloring" && <ColoringQuestionEditor initial={coloringConfig ?? undefined} onChange={setColoringConfig} />}
      {(qType === "multiple_choice" || qType === "fill_blank") && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <button type="button" onClick={() => setShowIllustration((v) => !v)} className="text-xs font-medium text-foreground flex items-center gap-1.5">
            {t("examDesigner.form.illustrationToggle")}{showIllustration ? "▲" : "▼"}
          </button>
          {showIllustration && (
            <div className="mt-3">
              <IllustrationEditor initial={illustration ?? undefined} onChange={setIllustration} />
            </div>
          )}
        </div>
      )}
      {qType !== "coloring" && (qType === "multiple_choice" ? (
        <>
          <MultiLangInput
            label={t("examDesigner.form.questionTextLabel")} multiline
            values={{ zh: mcQuestionZh, en: mcQuestionEn, ms: mcQuestionMs }}
            onChange={(lang, v) => (lang === "zh" ? setMcQuestionZh(v) : lang === "en" ? setMcQuestionEn(v) : setMcQuestionMs(v))}
          />
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
              {(["single", "multi"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMcAnswerMode(m)} className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 ${mcAnswerMode === m ? "bg-white shadow-sm text-foreground" : "text-muted-foreground"}`}>
                  <span className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${mcAnswerMode === m ? "border-primary bg-primary" : "border-muted-foreground/40"}`} />
                  {m === "single" ? t("examDesigner.form.single") : t("examDesigner.form.multi")}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {mcOptions.map((opt) => (
              <div key={opt.id} className="rounded-lg border border-border bg-muted/20 p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <button onClick={() => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, correct: !o.correct } : o)))} className={`w-7 h-7 flex-shrink-0 rounded-md border-2 flex items-center justify-center text-xs font-bold ${opt.correct ? "border-emerald-500 bg-emerald-500 text-white" : "border-border bg-white text-transparent"}`}>✓</button>
                  <OptionImagePicker option={opt} onChange={(img) => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, image_url: img } : o)))} />
                  <span className="text-xs text-muted-foreground flex-1">{t("examDesigner.form.optionHint")}</span>
                  <button onClick={() => setMcOptions((arr) => (arr.length > 2 ? arr.filter((o) => o.id !== opt.id) : arr))} disabled={mcOptions.length <= 2} className="w-7 h-7 flex-shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30"><X size={14} /></button>
                </div>
                <MultiLangInput
                  label={t("examDesigner.form.optionTextLabel")}
                  values={{ zh: opt.zh, en: opt.en, ms: opt.ms }}
                  onChange={(lang, v) => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, [lang]: v } : o)))}
                  required={null}
                />
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setMcOptions((arr) => [...arr, { id: `opt${Date.now()}`, zh: "", en: "", ms: "", correct: false }])}>{t("examDesigner.form.addOption")}</Button>
          </div>
        </>
      ) : (
        <>
          <MultiLangInput
            label={t("examDesigner.form.sentenceLabelBank")}
            values={{ zh: fbSentenceZh, en: fbSentenceEn, ms: fbSentenceMs }}
            onChange={(lang, v) => (lang === "zh" ? setFbSentenceZh(v) : lang === "en" ? setFbSentenceEn(v) : setFbSentenceMs(v))}
          />
          {(() => {
            const blankCount = (fbSentenceZh.match(/___/g) ?? []).length;
            if (blankCount === 0) return null;
            return (
              <div className="space-y-1.5">
                {Array.from({ length: blankCount }, (_, i) => (
                  <Input key={i} placeholder={t("examDesigner.form.blankPlaceholderNumbered", { n: i + 1 })} value={fbBlankAnswers[i] ?? ""}
                    onChange={(e) => setFbBlankAnswers((arr) => { const next = [...arr]; while (next.length <= i) next.push(""); next[i] = e.target.value; return next; })} />
                ))}
              </div>
            );
          })()}
        </>
      ))}
      <div className="flex gap-2 pt-2">
        <Button onClick={handleSubmit}>{isEditing ? t("examDesigner.form.submitSave") : t("examDesigner.bank.addToBank")}</Button>
        <Button variant="outline" onClick={onCancel}>{t("examDesigner.form.cancel")}</Button>
      </div>
    </div>
  );
}

// ── 学生名单 ──────────────────────────────────────────────────────────────────

function StudentsTab({ paperId }: { paperId: string }) {
  const { t } = useTranslation();
  const [students, setStudents] = useState<Array<{ student_id: string; full_name_zh?: string; full_name_en?: string; username: string; attempt_status?: string; score?: number; max_score?: number }>>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [allStudents, setAllStudents] = useState<Array<{ id: string; full_name_zh?: string; full_name_en?: string; username: string }>>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [paperId]);

  async function load() {
    setLoading(true);
    try { setStudents(await examApi.listPaperStudents(paperId)); }
    catch (err) { toast.error(t("examDesigner.studentsTab.loadFailed")); }
    setLoading(false);
  }

  async function openAddPicker() {
    setShowAdd(true);
    try {
      const { data } = await adminUsersApi.listStudents({ limit: 200 });
      setAllStudents(data);
    } catch (err) { toast.error(t("examDesigner.studentsTab.loadStudentsFailed")); }
  }

  async function handleAddSelected() {
    if (selectedIds.size === 0) { toast.error(t("examDesigner.studentsTab.needSelectAtLeastOne")); return; }
    try {
      const res = await examApi.addPaperStudents(paperId, [...selectedIds]);
      toast.success(t("examDesigner.studentsTab.addedCount", { n: res.added }));
      setShowAdd(false); setSelectedIds(new Set());
      load();
    } catch (err) { toast.error(t("examDesigner.studentsTab.addFailed")); }
  }

  async function handleRemove(studentId: string) {
    if (!confirm(t("examDesigner.studentsTab.confirmRemove"))) return;
    try { await examApi.removePaperStudent(paperId, studentId); toast.success(t("examDesigner.studentsTab.removeSuccess")); load(); }
    catch (err) { toast.error(t("examDesigner.studentsTab.removeFailed")); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{t("examDesigner.studentsTab.hint")}</p>
        <Button onClick={openAddPicker}><Users size={14} className="mr-1" /> {t("examDesigner.studentsTab.addStudent")}</Button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-3">
          <div className="max-h-64 overflow-y-auto space-y-1.5">
            {allStudents.map((s) => (
              <label key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 cursor-pointer">
                <input
                  type="checkbox" checked={selectedIds.has(s.id)}
                  onChange={(e) => setSelectedIds((set) => { const next = new Set(set); if (e.target.checked) next.add(s.id); else next.delete(s.id); return next; })}
                />
                <span className="text-sm">{s.full_name_zh || s.full_name_en || s.username}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={handleAddSelected}>{t("examDesigner.studentsTab.addToListButton", { n: selectedIds.size })}</Button>
            <Button variant="outline" onClick={() => { setShowAdd(false); setSelectedIds(new Set()); }}>{t("examDesigner.form.cancel")}</Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t("exam.loading")}</p>
      ) : students.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 text-center py-8">{t("examDesigner.studentsTab.empty")}</p>
      ) : (
        <div className="space-y-1.5">
          {students.map((s) => (
            <div key={s.student_id} className="flex items-center justify-between rounded-lg border border-border bg-white p-2.5">
              <span className="text-sm">{s.full_name_zh || s.full_name_en || s.username}</span>
              <div className="flex items-center gap-3">
                {s.attempt_status && (
                  <span className="text-xs text-muted-foreground">
                    {s.attempt_status === "submitted" ? t("examDesigner.studentsTab.submitted", { score: s.score, max: s.max_score }) : s.attempt_status === "in_progress" ? t("examDesigner.studentsTab.inProgress") : t("examDesigner.studentsTab.notStarted")}
                  </span>
                )}
                <button onClick={() => handleRemove(s.student_id)} className="text-muted-foreground hover:text-red-600 p-1"><X size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// 选项图片选择器——点缩略图上传/替换，有图的话右上角小×删除。简单
// 转成data URL存，跟填色题编辑器背景图上传用的是同一套轻量做法，不走
// 现有素材库接口(如果之后想接现有素材库上传流程，这里是唯一要改的地方)。
function OptionImagePicker({ option, onChange }: { option: MCOption; onChange: (imageUrl: string | undefined) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result as string);
    reader.readAsDataURL(file);
  }

  return (
    <div className="relative flex-shrink-0">
      <button
        type="button" onClick={() => inputRef.current?.click()}
        className="w-10 h-10 rounded-lg border border-dashed border-border bg-white overflow-hidden flex items-center justify-center text-muted-foreground hover:border-primary/50"
      >
        {option.image_url ? <img src={option.image_url} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px]">配图</span>}
      </button>
      {option.image_url && (
        <button
          type="button" onClick={() => onChange(undefined)}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white border border-border flex items-center justify-center"
        ><X size={9} /></button>
      )}
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
    </div>
  );
}
