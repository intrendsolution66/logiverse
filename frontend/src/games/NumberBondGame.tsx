// frontend/src/games/NumberBondGame.tsx
//
// 数的分解与合成 — 经典的"数感树"练习(Singapore Math 里常见的 number
// bond)：一个总数框(摆着N个物件图标)，拆成两个子框(物件已经视觉上摆好
// 分成两堆)，三个方框各自连一个圆圈，学生要数每个方框里有几个图标、
// 填进对应的圆圈。
//
// 看起来像是要解"总数=部分1+部分2"这个方程，但其实不是——图标本身已经
// 摆好了怎么分（比如总数框里2个蜗牛，子框分别是1个+1个），每个圆圈的
// 正确答案就是"数它对应那个方框里有几个图标"，三个圆圈互相独立，缺哪个
// 都能直接数出来，不存在"两个都缺就无解"这种问题——这跟表面上看起来的
// "考加减法"不一样，本质更接近"数数"，只是套了一个三节点的树状呈现方式。
//
// 图标来源：设计师自己上传（不用CountingGame那种内置emoji主题），可以
// 传好几张让每次出题随机换着用，增加一点变化。
//
// 难度：等级控制"这一题同时出几棵树"(树越多，要数的框越多)+"每棵树里
// 挖几个圆圈"(挖得越多，要自己数、不能对照已知数字的圆圈就越多)。
//
// 判定走client端直接比较（图标数量本来就在前端手上，现算的），安全
// 等级跟CubeStack系列一致。
//
// i18n: zh/en/ms 已支持 — 见 frontend/src/lib/gameLocale.ts

import { useState, useEffect, useCallback, useRef } from "react";
import { type Locale, type Dict, t, questionProgress } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  fill_prompt:    { zh: "看图，在空白圆圈里写上合适的数字", en: "Look at the pictures and fill in the blank circles", ms: "Lihat gambar dan isi bulatan kosong" },
  submit:         { zh: "✅ 提交", en: "✅ Submit", ms: "✅ Hantar" },
  correct_level_up:  { zh: "🎉 全部答对了！难度提升一级", en: "🎉 All correct! Level up", ms: "🎉 Semua betul! Naik tahap" },
  wrong_level_down:  { zh: "有几个圆圈不对哦，红色标出来了（难度降一级）", en: "Some circles are wrong — shown in red (level down)", ms: "Ada bulatan yang salah — ditunjukkan merah (tahap turun)" },
  next_question:  { zh: "下一题", en: "Next question", ms: "Soalan seterusnya" },
  practice_done:  { zh: "答对 {c} / {n} 题", en: "{c} / {n} correct", ms: "{c} / {n} betul" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

export interface NumberBondConfig {
  icon_urls: string[];        // 设计师上传的图标(至少1张，多张时每棵树随机挑一张用)
  number_min: number; number_max: number; // 总数(顶端方框)的随机范围，至少要2才能拆成两个非空的部分
  starting_level: number;     // 1-10，"几棵树"+"每棵树挖几个圆圈"的自适应难度
  total_questions: number;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string; ms?: string };
}
export interface NumberBondResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
  ending_level?: number;
}

const LEVEL_MAX = 10;

function randInt(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }

// 等级 → 同时出几棵树：树越多，一题里要数的方框也越多。
function levelTreeCount(level: number): number {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  if (L <= 4) return 1;
  if (L <= 7) return 2;
  return 3;
}
// 等级 → 每棵树挖几个圆圈(总数/部分1/部分2 这3个里挖几个)：挖得越多，
// 能直接对照已知数字的圆圈就越少，基本靠自己一个个数。
function levelBlanksPerTree(level: number): number {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  if (L <= 3) return 1;
  if (L <= 7) return 2;
  return 3;
}

type Slot = "total" | "part1" | "part2";

interface TreeData {
  icon: string;
  total: number; part1: number; part2: number;
  blanks: Set<Slot>; // 这几个圆圈是空的，要填
}
interface Puzzle { trees: TreeData[] }

function genTree(config: NumberBondConfig, blankCount: number): TreeData {
  const icon = config.icon_urls[randInt(0, config.icon_urls.length - 1)];
  const total = randInt(Math.max(2, config.number_min), config.number_max);
  const part1 = randInt(1, total - 1); // 保证两部分都至少有1个，不会出现"0个"这种空框
  const part2 = total - part1;

  const slots: Slot[] = ["total", "part1", "part2"];
  // 洗牌选出要挖空的几个圆圈
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const blanks = new Set(slots.slice(0, Math.min(blankCount, 3)));

  return { icon, total, part1, part2, blanks };
}

function genPuzzle(level: number, config: NumberBondConfig): Puzzle {
  const treeCount = levelTreeCount(level);
  const blankCount = levelBlanksPerTree(level);
  const trees = Array.from({ length: treeCount }, () => genTree(config, blankCount));
  return { trees };
}

// 单个方框——摆 count 个图标(数量不大时直接排开，数量比较多的话用自动
// 换行的flex布局，不用另外写网格排版逻辑)
function IconBox({ icon, count }: { icon: string; count: number }) {
  return (
    <div className="w-24 h-20 sm:w-28 sm:h-24 rounded-xl border-2 border-slate-400 bg-white flex flex-wrap items-center justify-center gap-0.5 p-1.5">
      {Array.from({ length: count }, (_, i) => (
        <img key={i} src={icon} alt="" className="w-6 h-6 sm:w-7 sm:h-7 object-contain" />
      ))}
    </div>
  );
}

function TreeView({ tree, values, onChangeValue, disabled, results, locale }: {
  tree: TreeData; values: Record<Slot, string>; onChangeValue: (slot: Slot, v: string) => void;
  disabled: boolean; results: Record<Slot, boolean> | null; locale: Locale;
}) {
  function circle(slot: Slot, trueValue: number) {
    const isBlank = tree.blanks.has(slot);
    const result = results?.[slot];
    const showColor = results !== null && isBlank;
    if (!isBlank) {
      return (
        <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full border-2 border-amber-400 bg-amber-300 flex items-center justify-center text-lg sm:text-xl font-bold text-amber-950">
          {trueValue}
        </div>
      );
    }
    return (
      <input
        type="tel" inputMode="numeric"
        value={values[slot] ?? ""}
        disabled={disabled}
        onChange={(e) => onChangeValue(slot, e.target.value.replace(/[^0-9]/g, ""))}
        className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full border-2 text-center text-lg sm:text-xl font-bold outline-none transition-colors ${
          showColor
            ? result ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-red-500 bg-red-50 text-red-600"
            : "border-primary/60 bg-white focus:border-primary"
        }`}
      />
    );
  }
  void locale;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <IconBox icon={tree.icon} count={tree.total} />
      {circle("total", tree.total)}
      <svg width="140" height="28" className="-mb-1">
        <line x1={70} y1={2} x2={20} y2={26} stroke="#94a3b8" strokeWidth={2} />
        <line x1={70} y1={2} x2={120} y2={26} stroke="#94a3b8" strokeWidth={2} />
      </svg>
      <div className="flex gap-4">
        <div className="flex flex-col items-center gap-1.5">
          <IconBox icon={tree.icon} count={tree.part1} />
          {circle("part1", tree.part1)}
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <IconBox icon={tree.icon} count={tree.part2} />
          {circle("part2", tree.part2)}
        </div>
      </div>
    </div>
  );
}

export default function NumberBondGame({ config, onComplete, locale = "zh" }: {
  config: NumberBondConfig; onComplete: (r: NumberBondResult) => void; locale?: Locale;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [level, setLevel] = useState(() => Math.min(LEVEL_MAX, Math.max(1, config.starting_level || 1)));
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [values, setValues] = useState<Record<Slot, string>[]>([]); // 每棵树各自一份 {total,part1,part2} 输入值
  const [answered, setAnswered] = useState(false);
  const [treeResults, setTreeResults] = useState<Record<Slot, boolean>[] | null>(null);
  const [status, setStatus] = useState<{ msg: string; kind: "" | "good" | "bad" }>({ msg: "", kind: "" });
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);

  const startRef = useRef(Date.now());
  const levelRef = useRef(level);
  levelRef.current = level;

  const finish = useCallback((completed: boolean) => {
    setFinished(true);
    onComplete({
      score: correctCount, max_score: config.total_questions,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes: mistakeCount, completed, ending_level: levelRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correctCount, mistakeCount, config.total_questions]);

  const nextQuestion = useCallback(() => {
    if (qIndex >= config.total_questions) { finish(true); return; }
    const p = genPuzzle(levelRef.current, config);
    setPuzzle(p);
    setValues(p.trees.map(() => ({ total: "", part1: "", part2: "" })));
    setAnswered(false);
    setTreeResults(null);
    setStatus({ msg: "", kind: "" });
    setQIndex((i) => i + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, config.icon_urls, config.number_min, config.number_max]);

  useEffect(() => {
    startRef.current = Date.now();
    nextQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  useEffect(() => {
    if (config.timer_mode !== "countdown" || !config.time_limit || finished) return;
    if (elapsed >= config.time_limit) finish(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  function updateValue(treeIdx: number, slot: Slot, v: string) {
    setValues((prev) => prev.map((tv, i) => (i === treeIdx ? { ...tv, [slot]: v } : tv)));
  }

  const allFilled = puzzle
    ? puzzle.trees.every((tree, i) => [...tree.blanks].every((slot) => values[i]?.[slot] !== undefined && values[i][slot] !== ""))
    : false;

  function submitAnswer() {
    if (answered || !puzzle || !allFilled) return;
    setAnswered(true);
    let allCorrect = true;
    const results = puzzle.trees.map((tree, i) => {
      const r: Record<Slot, boolean> = { total: true, part1: true, part2: true };
      (["total", "part1", "part2"] as Slot[]).forEach((slot) => {
        if (!tree.blanks.has(slot)) return;
        const trueValue = tree[slot];
        const ok = parseInt(values[i][slot], 10) === trueValue;
        r[slot] = ok;
        if (!ok) allCorrect = false;
      });
      return r;
    });
    setTreeResults(results);
    if (allCorrect) {
      setCorrectCount((c) => c + 1);
      setStreak((s) => { const next = s + 1; setBestStreak((b) => Math.max(b, next)); return next; });
      setLevel((lv) => Math.min(LEVEL_MAX, lv + 1));
      setStatus({ msg: lt("correct_level_up", locale), kind: "good" });
    } else {
      setMistakeCount((m) => m + 1);
      setStreak(0);
      setLevel((lv) => Math.max(1, lv - 1));
      setStatus({ msg: lt("wrong_level_down", locale), kind: "bad" });
    }
  }

  const timerLabel = config.timer_mode === "countdown" ? t("time_left", locale) : t("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const accuracy = correctCount + mistakeCount > 0 ? Math.round((correctCount / (correctCount + mistakeCount)) * 100) : 0;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🌳</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {t("practice_complete", locale)}{lt("practice_done", locale, { c: correctCount, n: config.total_questions })}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{t("best_streak", locale)} {bestStreak}　{t("ending_level", locale)} Lv.{level}</div>
      </div>
    );
  }

  if (!puzzle) return null;

  return (
    <div className="max-w-4xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3 flex-wrap gap-1">
        <span>{questionProgress(qIndex, config.total_questions, locale)}　Lv.{level}</span>
        <span>✅ {t("accuracy", locale)} {accuracy}%　🔥 {t("streak", locale)} {streak}　⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      <p className="text-center text-lg font-semibold text-foreground mb-5">
        {config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en || lt("fill_prompt", locale)}
      </p>

      <div className="flex flex-wrap justify-center gap-8 bg-white dark:bg-card rounded-2xl p-5 mb-5 shadow-lg ring-1 ring-black/5">
        {puzzle.trees.map((tree, i) => (
          <TreeView
            key={i} tree={tree} values={values[i] ?? { total: "", part1: "", part2: "" }}
            onChangeValue={(slot, v) => updateValue(i, slot, v)}
            disabled={answered} results={treeResults?.[i] ?? null} locale={locale}
          />
        ))}
      </div>

      <div className="flex justify-center">
        {!answered ? (
          <button
            onClick={submitAnswer}
            disabled={!allFilled}
            className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
          >
            {lt("submit", locale)}
          </button>
        ) : (
          <button
            onClick={nextQuestion}
            className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors"
          >
            {lt("next_question", locale)}
          </button>
        )}
      </div>

      {status.msg && (
        <div className={`text-center text-lg font-medium px-4 py-3 rounded-xl mt-4 ${
          status.kind === "good" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
          : "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
        }`}>
          {status.msg}
        </div>
      )}
    </div>
  );
}
