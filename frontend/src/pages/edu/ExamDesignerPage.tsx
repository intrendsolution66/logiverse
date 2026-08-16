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
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/index";
import { CheckSquare, PencilLine, X, Plus, FileText, Users, Trophy, Download, Trash2 } from "lucide-react";
import { examApi, adminUsersApi, type ExamPaper, type ExamPaperQuestion, type ExamQuestionBankItem } from "@/api";
import ColoringQuestionEditor from "@/components/ColoringQuestionEditor";
import IllustrationEditor from "@/components/IllustrationEditor";
import { IllustrationView, type Illustration } from "@/lib/illustrationShapes";
import type { ColoringConfig } from "@/lib/coloringShapes";

const INPUT_CLASS = "w-full px-3 py-2 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

interface MCOption { id: string; zh: string; en: string; ms: string; correct: boolean; image_url?: string }

export default function ExamDesignerPage() {
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
    } catch (err) { toast.error("加载试卷列表失败"); }
    setLoading(false);
  }

  async function handleCreate() {
    if (!newTitle.trim()) { toast.error("请填写试卷名称"); return; }
    try {
      const paper = await examApi.createPaper({ title_i18n: { zh: newTitle.trim() } });
      toast.success("试卷已建立，可以开始加题目了");
      setCreating(false); setNewTitle("");
      await loadPapers();
      setEditingPaperId(paper.id);
    } catch (err) { toast.error("建立失败"); }
  }

  if (editingPaperId) {
    return <ExamPaperEditor paperId={editingPaperId} onBack={() => { setEditingPaperId(null); loadPapers(); }} />;
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">试卷 / 比赛管理</h1>
          <p className="text-sm text-muted-foreground mt-1">建立试卷、管理题目和受邀学生名单，比如 SASMO 2026 这类比赛用卷</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus size={16} className="mr-1" /> 新建试卷</Button>
      </div>

      {creating && (
        <div className="rounded-xl border border-border bg-white shadow-sm p-4 mb-6 flex gap-3 items-end">
          <div className="flex-1">
            <Label>试卷名称</Label>
            <Input placeholder="例如：SASMO 2026" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          </div>
          <Button onClick={handleCreate}>建立</Button>
          <Button variant="outline" onClick={() => { setCreating(false); setNewTitle(""); }}>取消</Button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中...</p>
      ) : papers.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 text-center py-12">还没有试卷，点右上角"新建试卷"开始</p>
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
                  {p.status === "published" ? "已发布" : p.status === "closed" ? "已结束" : "草稿"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground flex gap-3">
                <span>满分 {p.total_marks}</span>
                <span>{p.time_limit_minutes}分钟</span>
                <span>{p.student_count ?? 0}名学生</span>
                <span>{p.attempt_count ?? 0}次作答</span>
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
  const [paper, setPaper] = useState<(ExamPaper & { questions: ExamPaperQuestion[] }) | null>(null);
  const [tab, setTab] = useState<"basic" | "questions" | "bank" | "students">("basic");
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [paperId]);

  async function load() {
    setLoading(true);
    try {
      const data = await examApi.getPaperForEdit(paperId);
      setPaper(data);
    } catch (err) { toast.error("加载试卷失败"); }
    setLoading(false);
  }

  async function handlePublish() {
    if (!paper) return;
    const next = paper.status === "draft" ? "published" : "draft";
    try {
      await examApi.setPaperStatus(paperId, next);
      toast.success(next === "published" ? "已发布" : "已收回草稿");
      await load();
    } catch (err: any) { toast.error(err?.response?.data?.message ?? "操作失败"); }
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
    } catch (err) { toast.error("生成PDF失败——请确认试卷至少有1道题目"); }
  }

  if (loading || !paper) return <div className="max-w-4xl mx-auto py-8 px-4"><p className="text-sm text-muted-foreground">加载中...</p></div>;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">← 返回列表</button>
          <h1 className="text-xl font-bold text-foreground">{paper.title_i18n?.zh || paper.title_i18n?.en}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            paper.status === "published" ? "bg-emerald-100 text-emerald-700" : paper.status === "closed" ? "bg-gray-100 text-gray-600" : "bg-amber-100 text-amber-700"
          }`}>
            {paper.status === "published" ? "已发布" : paper.status === "closed" ? "已结束" : "草稿"}
          </span>
        </div>
        <div className="flex gap-2 relative">
          <Button variant="outline" size="sm" onClick={() => window.open(`/exam-preview/${paper.id}`, "_blank")}>🧪 试玩预览</Button>
          <Button variant="outline" size="sm" onClick={() => setShowPdfLangPicker((v) => !v)}><Download size={14} className="mr-1" /> 下载PDF</Button>
          {showPdfLangPicker && (
            <div className="absolute top-full right-0 mt-1 bg-white border border-border rounded-lg shadow-lg py-1 z-20 w-40">
              {([["zh", "中文"], ["en", "English"], ["ms", "Bahasa Melayu"]] as const).map(([code, label]) => (
                <button key={code} onClick={() => handleDownloadPdf(code)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50">{label}</button>
              ))}
            </div>
          )}
          {paper.status !== "closed" && (
            <Button size="sm" onClick={handlePublish}>{paper.status === "draft" ? "发布" : "收回草稿"}</Button>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit mb-6">
        {([
          ["basic", "基本信息"], ["questions", `题目(${paper.questions.length})`], ["bank", "题库"], ["students", "学生名单"],
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
    </div>
  );
}

// ── 基本信息 ──────────────────────────────────────────────────────────────────

function BasicInfoTab({ paper, onSaved }: { paper: ExamPaper; onSaved: () => void }) {
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
    if (!title.trim()) { toast.error("请填写试卷名称（至少中文）"); return; }
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
      toast.success("已保存");
      onSaved();
    } catch (err) { toast.error("保存失败"); }
    setSaving(false);
  }

  return (
    <div className="rounded-xl bg-white border border-border shadow-sm p-5 space-y-4">
      <div>
        <Label>试卷名称（至少中文必填，英文/马来文选填——学生作答时会跟着当下切换的界面语言显示对应文字）</Label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input placeholder="中文" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input placeholder="English" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
          <Input placeholder="Bahasa Melayu" value={titleMs} onChange={(e) => setTitleMs(e.target.value)} />
        </div>
      </div>
      <div>
        <Label>说明（选填，学生看不到，只是给自己留备注用）</Label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={INPUT_CLASS} />
      </div>
      <div>
        <Label>作答时间限制（分钟）</Label>
        <Input type="number" min={1} value={timeLimit} onChange={(e) => setTimeLimit(+e.target.value)} className="w-32" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>开考时间（选填，不填代表随时可以开始）</Label>
          <Input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
        </div>
        <div>
          <Label>截止时间（选填）</Label>
          <Input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
        </div>
      </div>

      <div className="pt-2 border-t border-border/60 space-y-3">
        <div className="flex items-center gap-2">
          <input type="checkbox" id="allow-retake" checked={allowRetake} onChange={(e) => setAllowRetake(e.target.checked)} className="w-4 h-4" />
          <label htmlFor="allow-retake" className="text-sm">允许重考</label>
          {allowRetake && (
            <span className="flex items-center gap-1.5 ml-2">
              <span className="text-xs text-muted-foreground">最多</span>
              <Input type="number" min={1} value={maxAttempts} onChange={(e) => setMaxAttempts(Math.max(1, +e.target.value))} className="w-16 h-8 text-sm" />
              <span className="text-xs text-muted-foreground">次</span>
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground/70 pl-6">
          {allowRetake ? "每次重考会重新随机抽题（如果有随机槽的话），排行榜按每人历史最佳一次成绩排名" : "一次型考试：学生只能交卷1次"}
        </p>
      </div>

      <div className="pt-2 border-t border-border/60">
        <Label>答案查看时机</Label>
        <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit mt-1.5">
          {(["immediate", "after_close"] as const).map((v) => (
            <button
              key={v} type="button" onClick={() => setReviewPolicy(v)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${reviewPolicy === v ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {v === "immediate" ? "🏃 自主练习(交卷即看)" : "🏆 正式比赛(等截止时间)"}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground/70 mt-1.5">
          {reviewPolicy === "after_close"
            ? (closesAt ? "学生交卷后先看到总分，逐题详情/正确答案要等截止时间过了才能看，防止先交卷的人泄题" : "⚠️ 还没填截止时间——正式比赛模式下不填截止时间，逐题详情会一直看不到，建议补上或改成自主练习")
            : "学生交卷后立刻能看逐题详情/正确答案，适合平时练习"}
        </p>
      </div>

      <div className="pt-2">
        <Button onClick={handleSave} disabled={saving}>{saving ? "保存中..." : "保存"}</Button>
      </div>
    </div>
  );
}

// ── 题目 ──────────────────────────────────────────────────────────────────────

function QuestionsTab({ paper, onChanged }: { paper: ExamPaper & { questions: ExamPaperQuestion[] }; onChanged: () => void }) {
  const [showAddForm, setShowAddForm] = useState<"fixed" | "random" | null>(null);
  const locked = paper.status !== "draft";

  async function handleDelete(questionId: string) {
    if (!confirm("确定删掉这道题？")) return;
    try { await examApi.deleteQuestion(paper.id, questionId); toast.success("已删除"); onChanged(); }
    catch (err) { toast.error("删除失败"); }
  }

  return (
    <div className="space-y-4">
      {locked && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          这份试卷已经{paper.status === "published" ? "发布" : "结束"}，不能再改题目——如果要改，先在"基本信息"外的发布按钮把状态收回草稿
        </p>
      )}

      <div className="space-y-2">
        {paper.questions.length === 0 ? (
          <p className="text-sm text-muted-foreground/60 text-center py-8">还没有题目</p>
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
                        ? ((q.config?.question_i18n as Record<string, string>)?.zh ?? "选择题")
                        : q.question_type === "fill_blank"
                        ? ((q.config?.sentence_i18n as Record<string, string>)?.zh ?? "填充题")
                        : "填色题"}
                    </div>
                  </>
                ) : (
                  <div className="text-sm font-medium text-foreground">
                    🎲 随机抽题 —— 从"{q.random_category}"分类抽 {q.random_count} 题
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-0.5">{q.marks} 分{q.slot_type === "random_category" ? `/题（共${(q.marks) * (q.random_count ?? 0)}分）` : ""}</div>
              </div>
              {!locked && (
                <button onClick={() => handleDelete(q.id)} className="text-muted-foreground hover:text-red-600 p-1.5">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {!locked && !showAddForm && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowAddForm("fixed")}><Plus size={14} className="mr-1" /> 加固定题</Button>
          <Button variant="outline" onClick={() => setShowAddForm("random")}><Plus size={14} className="mr-1" /> 加随机抽题槽</Button>
        </div>
      )}

      {showAddForm === "fixed" && (
        <AddFixedQuestionForm paperId={paper.id} onDone={() => { setShowAddForm(null); onChanged(); }} onCancel={() => setShowAddForm(null)} />
      )}
      {showAddForm === "random" && (
        <AddRandomSlotForm paperId={paper.id} onDone={() => { setShowAddForm(null); onChanged(); }} onCancel={() => setShowAddForm(null)} />
      )}
    </div>
  );
}

// ── 加固定题——选择题/填充题二选一，表单逻辑照抄 CourseDesignerPage 里
//    multiple_choice/fill_blank 那两块，只是保存目标换成试卷题目槽位 ───────

function AddFixedQuestionForm({ paperId, onDone, onCancel }: { paperId: string; onDone: () => void; onCancel: () => void }) {
  const [qType, setQType] = useState<"multiple_choice" | "fill_blank" | "coloring">("multiple_choice");
  const [marks, setMarks] = useState(1);

  // 选择题字段
  const [mcAnswerMode, setMcAnswerMode] = useState<"single" | "multi">("single");
  const [mcOptions, setMcOptions] = useState<MCOption[]>([
    { id: "opt1", zh: "", en: "", ms: "", correct: false },
    { id: "opt2", zh: "", en: "", ms: "", correct: false },
  ]);
  const [mcQuestionZh, setMcQuestionZh] = useState("");
  const [mcQuestionEn, setMcQuestionEn] = useState("");
  const [mcQuestionMs, setMcQuestionMs] = useState("");

  // 填充题字段
  const [fbSentenceZh, setFbSentenceZh] = useState("");
  const [fbSentenceEn, setFbSentenceEn] = useState("");
  const [fbSentenceMs, setFbSentenceMs] = useState("");
  const [fbBlankAnswers, setFbBlankAnswers] = useState<string[]>([""]);

  // 填色题字段
  const [coloringConfig, setColoringConfig] = useState<ColoringConfig | null>(null);

  // 题目配图字段(选择题/填充题都能用，纯装饰性插图，不影响判分)
  const [showIllustration, setShowIllustration] = useState(false);
  const [illustration, setIllustration] = useState<Illustration | null>(null);

  async function handleSubmit() {
    try {
      if (qType === "multiple_choice") {
        const filled = mcOptions.filter((o) => o.zh.trim() || o.image_url);
        if (filled.length < 2) { toast.error("至少要有2个选项(至少填中文)"); return; }
        const correct = filled.filter((o) => o.correct);
        if (correct.length === 0) { toast.error("请至少勾选1个正确答案"); return; }
        if (!mcQuestionZh.trim()) { toast.error("请填写题目文字"); return; }
        await examApi.addQuestion(paperId, {
          slot_type: "fixed", question_type: "multiple_choice", marks,
          config: {
            answer_mode: mcAnswerMode,
            options: filled.map((o) => ({ id: o.id, text_i18n: { zh: o.zh || undefined, en: o.en || undefined, ms: o.ms || undefined }, image_url: o.image_url || undefined })),
            correct_option_ids: correct.map((o) => o.id),
            question_i18n: { zh: mcQuestionZh.trim(), en: mcQuestionEn.trim() || undefined, ms: mcQuestionMs.trim() || undefined },
            illustration: illustration ?? undefined,
          },
        });
      } else if (qType === "fill_blank") {
        const blankCount = (fbSentenceZh.match(/___/g) ?? []).length;
        if (!fbSentenceZh.trim() || blankCount === 0) { toast.error('请填写题目句子，用"___"标记至少1个空'); return; }
        if (fbSentenceEn.trim() && (fbSentenceEn.match(/___/g) ?? []).length !== blankCount) { toast.error(`英文版句子里的"___"数量要跟中文版一致(${blankCount}个)`); return; }
        if (fbSentenceMs.trim() && (fbSentenceMs.match(/___/g) ?? []).length !== blankCount) { toast.error(`马来文版句子里的"___"数量要跟中文版一致(${blankCount}个)`); return; }
        const blanks = fbBlankAnswers.slice(0, blankCount).map((s) => s.split(",").map((x) => x.trim()).filter(Boolean));
        if (blanks.length < blankCount || blanks.some((b) => b.length === 0)) { toast.error("每个空都要至少填1个正确答案"); return; }
        await examApi.addQuestion(paperId, {
          slot_type: "fixed", question_type: "fill_blank", marks,
          config: {
            sentence_i18n: { zh: fbSentenceZh.trim(), en: fbSentenceEn.trim() || undefined, ms: fbSentenceMs.trim() || undefined },
            blanks: blanks.map((accepted) => ({ accepted_answers: accepted })), illustration: illustration ?? undefined,
          },
        });
      } else {
        if (!coloringConfig) { toast.error("请至少放1个形状"); return; }
        const colorable = coloringConfig.regions.filter((r) => r.colorable);
        if (colorable.length === 0) { toast.error('至少要有1个区域勾选"需要学生上色"'); return; }
        if (colorable.some((r) => !r.correct_color)) { toast.error("每个可上色的区域都要设正确颜色"); return; }
        await examApi.addQuestion(paperId, { slot_type: "fixed", question_type: "coloring", marks, config: coloringConfig as unknown as Record<string, unknown> });
      }
      toast.success("已加入");
      onDone();
    } catch (err: any) { toast.error(err?.response?.data?.message ?? "加入失败"); }
  }

  return (
    <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4">
      <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
        {(["multiple_choice", "fill_blank", "coloring"] as const).map((t) => (
          <button
            key={t} onClick={() => setQType(t)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${qType === t ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {t === "multiple_choice" ? "☑️ 选择题" : t === "fill_blank" ? "📝 填充题" : "🎨 填色题"}
          </button>
        ))}
        <div className="flex items-center gap-1.5 pl-3">
          <span className="text-xs text-muted-foreground">分值</span>
          <Input type="number" min={1} value={marks} onChange={(e) => setMarks(Math.max(1, +e.target.value))} className="w-16 h-7 text-xs" />
        </div>
      </div>

      {qType === "coloring" && <ColoringQuestionEditor initial={coloringConfig ?? undefined} onChange={setColoringConfig} />}

      {(qType === "multiple_choice" || qType === "fill_blank") && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <button type="button" onClick={() => setShowIllustration((v) => !v)} className="text-xs font-medium text-foreground flex items-center gap-1.5">
            🖼️ 题目配图（选填，纯装饰性插图，不影响判分）{showIllustration ? "▲" : "▼"}
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
          <div>
            <Label>题目文字（至少中文必填）</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input placeholder="中文" value={mcQuestionZh} onChange={(e) => setMcQuestionZh(e.target.value)} />
              <Input placeholder="English" value={mcQuestionEn} onChange={(e) => setMcQuestionEn(e.target.value)} />
              <Input placeholder="Bahasa Melayu" value={mcQuestionMs} onChange={(e) => setMcQuestionMs(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">答题方式：</span>
            <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
              {(["single", "multi"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMcAnswerMode(m)} className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 ${mcAnswerMode === m ? "bg-white shadow-sm text-foreground" : "text-muted-foreground"}`}>
                  <span className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${mcAnswerMode === m ? "border-primary bg-primary" : "border-muted-foreground/40"}`} />
                  {m === "single" ? "单选" : "多选"}
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
                  <span className="text-xs text-muted-foreground flex-1">选项（至少中文或图片其一）</span>
                  <button
                    type="button" onClick={() => setMcOptions((arr) => (arr.length > 2 ? arr.filter((o) => o.id !== opt.id) : arr))}
                    disabled={mcOptions.length <= 2} className="w-7 h-7 flex-shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30"
                  ><X size={14} /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pl-9">
                  <Input placeholder="中文" value={opt.zh} onChange={(e) => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, zh: e.target.value } : o)))} />
                  <Input placeholder="English" value={opt.en} onChange={(e) => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, en: e.target.value } : o)))} />
                  <Input placeholder="Bahasa Melayu" value={opt.ms} onChange={(e) => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, ms: e.target.value } : o)))} />
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setMcOptions((arr) => [...arr, { id: `opt${Date.now()}`, zh: "", en: "", ms: "", correct: false }])}>+ 加一个选项</Button>
          </div>
        </>
      ) : (
        <>
          <div>
            <Label>题目句子（用 ___ 三个下划线标记空的位置，至少中文必填；英文/马来文如果填了，空格数量要跟中文一致）</Label>
            <div className="space-y-1.5">
              <Input placeholder="中文，例如：1 + 1 = ___" value={fbSentenceZh} onChange={(e) => setFbSentenceZh(e.target.value)} />
              <Input placeholder="English（选填）" value={fbSentenceEn} onChange={(e) => setFbSentenceEn(e.target.value)} />
              <Input placeholder="Bahasa Melayu（选填）" value={fbSentenceMs} onChange={(e) => setFbSentenceMs(e.target.value)} />
            </div>
          </div>
          {(() => {
            const blankCount = (fbSentenceZh.match(/___/g) ?? []).length;
            if (blankCount === 0) return <p className="text-xs text-muted-foreground/60">先在上面句子里加至少一个 ___</p>;
            return (
              <div className="space-y-1.5">
                {Array.from({ length: blankCount }, (_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-14 flex-shrink-0">第{i + 1}个空</span>
                    <Input
                      placeholder="正确答案，多个写法用逗号隔开" value={fbBlankAnswers[i] ?? ""}
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
        <Button onClick={handleSubmit}>加入试卷</Button>
        <Button variant="outline" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}

// ── 加随机抽题槽 ──────────────────────────────────────────────────────────────

function AddRandomSlotForm({ paperId, onDone, onCancel }: { paperId: string; onDone: () => void; onCancel: () => void }) {
  const [categories, setCategories] = useState<Array<{ category: string; question_count: number }>>([]);
  const [category, setCategory] = useState("");
  const [count, setCount] = useState(1);
  const [marks, setMarks] = useState(1);

  useEffect(() => { examApi.listQuestionBankCategories().then(setCategories).catch(() => {}); }, []);

  async function handleSubmit() {
    if (!category.trim()) { toast.error("请选一个分类"); return; }
    try {
      await examApi.addQuestion(paperId, { slot_type: "random_category", marks, random_category: category.trim(), random_count: count });
      toast.success("已加入");
      onDone();
    } catch (err: any) { toast.error(err?.response?.data?.message ?? "加入失败"); }
  }

  return (
    <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4">
      <p className="text-xs text-muted-foreground">学生开始作答那一刻，才会从这个分类的题库里现场随机抽题——不同学生可能抽到不同具体题目。分类要先去"题库"标签页加好题目才能选。</p>
      <div>
        <Label>从哪个分类抽</Label>
        {categories.length === 0 ? (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-1">题库还没有任何分类——先去"题库"标签页加几道题</p>
        ) : (
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT_CLASS}>
            <option value="">请选择</option>
            {categories.map((c) => <option key={c.category} value={c.category}>{c.category}（题库里有{c.question_count}题）</option>)}
          </select>
        )}
      </div>
      <div className="flex gap-4">
        <div>
          <Label>抽几题</Label>
          <Input type="number" min={1} value={count} onChange={(e) => setCount(Math.max(1, +e.target.value))} className="w-24" />
        </div>
        <div>
          <Label>每题分值</Label>
          <Input type="number" min={1} value={marks} onChange={(e) => setMarks(Math.max(1, +e.target.value))} className="w-24" />
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <Button onClick={handleSubmit} disabled={categories.length === 0}>加入试卷</Button>
        <Button variant="outline" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}

// ── 题库 ──────────────────────────────────────────────────────────────────────

function QuestionBankTab() {
  const [items, setItems] = useState<ExamQuestionBankItem[]>([]);
  const [filterCategory, setFilterCategory] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [filterCategory]);

  async function load() {
    setLoading(true);
    try {
      const { data } = await examApi.listQuestionBank({ category: filterCategory || undefined, limit: 100 });
      setItems(data);
    } catch (err) { toast.error("加载题库失败"); }
    setLoading(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("确定删掉这道题库题目？(已经被抽进过的作答记录不受影响)")) return;
    try { await examApi.deleteBankQuestion(id); toast.success("已删除"); load(); }
    catch (err) { toast.error("删除失败"); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Input placeholder="按分类筛选（留空看全部）" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="w-64" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowImport(true)}>📥 从Activity库导入</Button>
          <Button onClick={() => setShowAdd(true)}><Plus size={14} className="mr-1" /> 加题库题目</Button>
        </div>
      </div>

      {showAdd && <AddBankQuestionForm onDone={() => { setShowAdd(false); load(); }} onCancel={() => setShowAdd(false)} />}
      {showImport && <ImportFromActivityForm onDone={() => { setShowImport(false); load(); }} onCancel={() => setShowImport(false)} />}

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 text-center py-8">题库是空的</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="rounded-xl border border-border bg-white shadow-sm p-3 flex items-center gap-3">
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0">{it.category}</span>
              <div className="flex-1 min-w-0 text-sm text-foreground truncate">
                {it.question_type === "multiple_choice"
                  ? ((it.config?.question_i18n as Record<string, string>)?.zh ?? "选择题")
                  : it.question_type === "fill_blank"
                  ? ((it.config?.sentence_i18n as Record<string, string>)?.zh ?? "填充题")
                  : it.question_type === "coloring"
                  ? "🎨 填色题"
                  : it.question_type === "sudoku"
                  ? "🔢 数独（从Activity库导入）"
                  : "🏷️ 贴纸游戏（从Activity库导入）"}
              </div>
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

const IMPORTABLE_TYPES = [
  { value: "multiple_choice", label: "☑️ 选择题" },
  { value: "fill_blank", label: "📝 填充题" },
  { value: "sudoku", label: "🔢 数独" },
  { value: "sticker_game", label: "🏷️ 贴纸游戏" },
] as const;

function ImportFromActivityForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
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
      .catch(() => toast.error("加载Activity列表失败"))
      .finally(() => setLoading(false));
  }, [moduleType]);

  async function handleImport() {
    if (!selectedId) { toast.error("请选一道要导入的Activity"); return; }
    if (!category.trim()) { toast.error("请填写分类名称"); return; }
    setImporting(true);
    try {
      await examApi.importFromActivity(selectedId, category.trim());
      toast.success("已导入");
      onDone();
    } catch (err: any) { toast.error(err?.response?.data?.message ?? "导入失败"); }
    setImporting(false);
  }

  return (
    <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4">
      {(moduleType === "sudoku" || moduleType === "sticker_game") && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          导入后判分会改成服务器端进行（比在Activity里玩安全，防止考试作弊）。
          {moduleType === "sticker_game" && "贴纸游戏的判定方式也会简化成\"贴纸是否放对槽位\"，跟原本按像素位置判定的手感不完全一样。"}
        </p>
      )}

      <div>
        <Label>从哪种类型导入</Label>
        <div className="flex gap-1.5 flex-wrap">
          {IMPORTABLE_TYPES.map((t) => (
            <button
              key={t.value} type="button" onClick={() => setModuleType(t.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${moduleType === t.value ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label>选一道Activity</Label>
        {loading ? (
          <p className="text-xs text-muted-foreground">加载中...</p>
        ) : activities.length === 0 ? (
          <p className="text-xs text-muted-foreground/60">Activity库里还没有这种类型的题目</p>
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
        <Label>导入进题库的哪个分类（可以从已有分类里选，也可以打新分类名）</Label>
        <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="比如：数独练习" list="import-category-options" />
        <datalist id="import-category-options">
          {existingCategories.map((c) => <option key={c} value={c} />)}
        </datalist>
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={handleImport} disabled={importing}>{importing ? "导入中..." : "导入"}</Button>
        <Button variant="outline" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}

function AddBankQuestionForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [category, setCategory] = useState("");
  const [qType, setQType] = useState<"multiple_choice" | "fill_blank" | "coloring">("multiple_choice");
  const [mcAnswerMode, setMcAnswerMode] = useState<"single" | "multi">("single");
  const [mcOptions, setMcOptions] = useState<MCOption[]>([
    { id: "opt1", zh: "", en: "", ms: "", correct: false },
    { id: "opt2", zh: "", en: "", ms: "", correct: false },
  ]);
  const [mcQuestionZh, setMcQuestionZh] = useState("");
  const [mcQuestionEn, setMcQuestionEn] = useState("");
  const [mcQuestionMs, setMcQuestionMs] = useState("");
  const [fbSentenceZh, setFbSentenceZh] = useState("");
  const [fbSentenceEn, setFbSentenceEn] = useState("");
  const [fbSentenceMs, setFbSentenceMs] = useState("");
  const [fbBlankAnswers, setFbBlankAnswers] = useState<string[]>([""]);
  const [coloringConfig, setColoringConfig] = useState<ColoringConfig | null>(null);
  const [showIllustration, setShowIllustration] = useState(false);
  const [illustration, setIllustration] = useState<Illustration | null>(null);

  async function handleSubmit() {
    if (!category.trim()) { toast.error("请填写分类名称"); return; }
    try {
      if (qType === "multiple_choice") {
        const filled = mcOptions.filter((o) => o.zh.trim() || o.image_url);
        if (filled.length < 2) { toast.error("至少要有2个选项"); return; }
        const correct = filled.filter((o) => o.correct);
        if (correct.length === 0) { toast.error("请至少勾选1个正确答案"); return; }
        if (!mcQuestionZh.trim()) { toast.error("请填写题目文字"); return; }
        await examApi.createBankQuestion({
          category: category.trim(), question_type: "multiple_choice",
          config: {
            answer_mode: mcAnswerMode,
            options: filled.map((o) => ({ id: o.id, text_i18n: { zh: o.zh || undefined, en: o.en || undefined, ms: o.ms || undefined }, image_url: o.image_url || undefined })),
            correct_option_ids: correct.map((o) => o.id),
            question_i18n: { zh: mcQuestionZh.trim(), en: mcQuestionEn.trim() || undefined, ms: mcQuestionMs.trim() || undefined },
            illustration: illustration ?? undefined,
          },
        });
      } else if (qType === "fill_blank") {
        const blankCount = (fbSentenceZh.match(/___/g) ?? []).length;
        if (!fbSentenceZh.trim() || blankCount === 0) { toast.error('请用"___"标记至少1个空'); return; }
        if (fbSentenceEn.trim() && (fbSentenceEn.match(/___/g) ?? []).length !== blankCount) { toast.error(`英文版句子里的"___"数量要跟中文版一致(${blankCount}个)`); return; }
        if (fbSentenceMs.trim() && (fbSentenceMs.match(/___/g) ?? []).length !== blankCount) { toast.error(`马来文版句子里的"___"数量要跟中文版一致(${blankCount}个)`); return; }
        const blanks = fbBlankAnswers.slice(0, blankCount).map((s) => s.split(",").map((x) => x.trim()).filter(Boolean));
        if (blanks.some((b) => b.length === 0)) { toast.error("每个空都要至少填1个正确答案"); return; }
        await examApi.createBankQuestion({
          category: category.trim(), question_type: "fill_blank",
          config: {
            sentence_i18n: { zh: fbSentenceZh.trim(), en: fbSentenceEn.trim() || undefined, ms: fbSentenceMs.trim() || undefined },
            blanks: blanks.map((accepted) => ({ accepted_answers: accepted })), illustration: illustration ?? undefined,
          },
        });
      } else {
        if (!coloringConfig) { toast.error("请至少放1个形状"); return; }
        const colorable = coloringConfig.regions.filter((r) => r.colorable);
        if (colorable.length === 0) { toast.error('至少要有1个区域勾选"需要学生上色"'); return; }
        if (colorable.some((r) => !r.correct_color)) { toast.error("每个可上色的区域都要设正确颜色"); return; }
        await examApi.createBankQuestion({ category: category.trim(), question_type: "coloring", config: coloringConfig as unknown as Record<string, unknown> });
      }
      toast.success("已加入题库");
      onDone();
    } catch (err: any) { toast.error(err?.response?.data?.message ?? "加入失败"); }
  }

  return (
    <div className="rounded-xl bg-white border border-border shadow-sm p-4 space-y-4">
      <div>
        <Label>分类（比如"比大比小"，随机槽靠这个名字来抽题，务必跟其他同类题目用同一个名字，注意统一大小写/别打错字）</Label>
        <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="比大比小" />
      </div>
      <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
        {(["multiple_choice", "fill_blank", "coloring"] as const).map((t) => (
          <button key={t} onClick={() => setQType(t)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${qType === t ? "bg-white shadow-sm" : "text-muted-foreground"}`}>
            {t === "multiple_choice" ? "☑️ 选择题" : t === "fill_blank" ? "📝 填充题" : "🎨 填色题"}
          </button>
        ))}
      </div>
      {qType === "coloring" && <ColoringQuestionEditor initial={coloringConfig ?? undefined} onChange={setColoringConfig} />}
      {(qType === "multiple_choice" || qType === "fill_blank") && (
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <button type="button" onClick={() => setShowIllustration((v) => !v)} className="text-xs font-medium text-foreground flex items-center gap-1.5">
            🖼️ 题目配图（选填，纯装饰性插图，不影响判分）{showIllustration ? "▲" : "▼"}
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
          <div>
            <Label>题目文字（至少中文必填）</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input placeholder="中文" value={mcQuestionZh} onChange={(e) => setMcQuestionZh(e.target.value)} />
              <Input placeholder="English" value={mcQuestionEn} onChange={(e) => setMcQuestionEn(e.target.value)} />
              <Input placeholder="Bahasa Melayu" value={mcQuestionMs} onChange={(e) => setMcQuestionMs(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5 bg-muted/50 p-1 rounded-lg w-fit">
              {(["single", "multi"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMcAnswerMode(m)} className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 ${mcAnswerMode === m ? "bg-white shadow-sm text-foreground" : "text-muted-foreground"}`}>
                  <span className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${mcAnswerMode === m ? "border-primary bg-primary" : "border-muted-foreground/40"}`} />
                  {m === "single" ? "单选" : "多选"}
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
                  <span className="text-xs text-muted-foreground flex-1">选项（至少中文或图片其一）</span>
                  <button onClick={() => setMcOptions((arr) => (arr.length > 2 ? arr.filter((o) => o.id !== opt.id) : arr))} disabled={mcOptions.length <= 2} className="w-7 h-7 flex-shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30"><X size={14} /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pl-9">
                  <Input placeholder="中文" value={opt.zh} onChange={(e) => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, zh: e.target.value } : o)))} />
                  <Input placeholder="English" value={opt.en} onChange={(e) => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, en: e.target.value } : o)))} />
                  <Input placeholder="Bahasa Melayu" value={opt.ms} onChange={(e) => setMcOptions((arr) => arr.map((o) => (o.id === opt.id ? { ...o, ms: e.target.value } : o)))} />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setMcOptions((arr) => [...arr, { id: `opt${Date.now()}`, zh: "", en: "", ms: "", correct: false }])}>+ 加一个选项</Button>
          </div>
        </>
      ) : (
        <>
          <div>
            <Label>题目句子（用 ___ 标记空，至少中文必填）</Label>
            <div className="space-y-1.5">
              <Input placeholder="中文" value={fbSentenceZh} onChange={(e) => setFbSentenceZh(e.target.value)} />
              <Input placeholder="English（选填）" value={fbSentenceEn} onChange={(e) => setFbSentenceEn(e.target.value)} />
              <Input placeholder="Bahasa Melayu（选填）" value={fbSentenceMs} onChange={(e) => setFbSentenceMs(e.target.value)} />
            </div>
          </div>
          {(() => {
            const blankCount = (fbSentenceZh.match(/___/g) ?? []).length;
            if (blankCount === 0) return null;
            return (
              <div className="space-y-1.5">
                {Array.from({ length: blankCount }, (_, i) => (
                  <Input key={i} placeholder={`第${i + 1}个空的正确答案`} value={fbBlankAnswers[i] ?? ""}
                    onChange={(e) => setFbBlankAnswers((arr) => { const next = [...arr]; while (next.length <= i) next.push(""); next[i] = e.target.value; return next; })} />
                ))}
              </div>
            );
          })()}
        </>
      ))}
      <div className="flex gap-2 pt-2">
        <Button onClick={handleSubmit}>加入题库</Button>
        <Button variant="outline" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}

// ── 学生名单 ──────────────────────────────────────────────────────────────────

function StudentsTab({ paperId }: { paperId: string }) {
  const [students, setStudents] = useState<Array<{ student_id: string; full_name_zh?: string; full_name_en?: string; username: string; attempt_status?: string; score?: number; max_score?: number }>>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [allStudents, setAllStudents] = useState<Array<{ id: string; full_name_zh?: string; full_name_en?: string; username: string }>>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [paperId]);

  async function load() {
    setLoading(true);
    try { setStudents(await examApi.listPaperStudents(paperId)); }
    catch (err) { toast.error("加载学生名单失败"); }
    setLoading(false);
  }

  async function openAddPicker() {
    setShowAdd(true);
    try {
      const { data } = await adminUsersApi.listStudents({ limit: 200 });
      setAllStudents(data);
    } catch (err) { toast.error("加载学生列表失败"); }
  }

  async function handleAddSelected() {
    if (selectedIds.size === 0) { toast.error("请至少选1个学生"); return; }
    try {
      const res = await examApi.addPaperStudents(paperId, [...selectedIds]);
      toast.success(`已加入${res.added}人`);
      setShowAdd(false); setSelectedIds(new Set());
      load();
    } catch (err) { toast.error("加入失败"); }
  }

  async function handleRemove(studentId: string) {
    if (!confirm("确定移除这个学生？")) return;
    try { await examApi.removePaperStudent(paperId, studentId); toast.success("已移除"); load(); }
    catch (err) { toast.error("移除失败"); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">只有名单里的学生才能作答这份试卷</p>
        <Button onClick={openAddPicker}><Users size={14} className="mr-1" /> 添加学生</Button>
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
            <Button onClick={handleAddSelected}>加入名单（已选{selectedIds.size}人）</Button>
            <Button variant="outline" onClick={() => { setShowAdd(false); setSelectedIds(new Set()); }}>取消</Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中...</p>
      ) : students.length === 0 ? (
        <p className="text-sm text-muted-foreground/60 text-center py-8">还没有学生在名单里</p>
      ) : (
        <div className="space-y-1.5">
          {students.map((s) => (
            <div key={s.student_id} className="flex items-center justify-between rounded-lg border border-border bg-white p-2.5">
              <span className="text-sm">{s.full_name_zh || s.full_name_en || s.username}</span>
              <div className="flex items-center gap-3">
                {s.attempt_status && (
                  <span className="text-xs text-muted-foreground">
                    {s.attempt_status === "submitted" ? `已交卷 ${s.score}/${s.max_score}` : s.attempt_status === "in_progress" ? "作答中" : "还没开始"}
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
