// frontend/src/games/NumberAdditionGame.tsx
//
// 加法算式 — 经典"图1 + 图2 = ?"横向算式练习。两个加数永远用图片给好
// (数一数就知道)，只留"答案"这一个空，学生填。
//
// 跟"数的分解与合成"背后的数学关系其实是同一件事(总数=两部分之和)，
// 但呈现方式不一样——数感树是树状结构(总数在上面往下拆两支，圆圈可以
// 随便挖1-3个)，这个是横向算式("A + B = ?"，两个加数固定给好，只留
// 答案这一个空)。既是不同的视觉呈现，又是不同的挖空规则，所以另开一
// 个引擎，不是数感树的一个模式。
//
// 图标来源：designer自己上传，跟数感树/数字比大小同一套做法。
//
// 判定：client端直接算 addend1+addend2 跟学生填的比，没有隐藏答案这
// 回事，安全等级跟CubeStack系列一致。
//
// i18n: zh/en/ms 已支持 — 见 frontend/src/lib/gameLocale.ts

import { useState, useEffect, useCallback, useRef } from "react";
import { type Locale, type Dict, t, questionProgress } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  add_prompt:     { zh: "数一数，算出答案", en: "Count and work out the answer", ms: "Kira dan cari jawapannya" },
  submit:         { zh: "✅ 提交", en: "✅ Submit", ms: "✅ Hantar" },
  correct_level_up:  { zh: "🎉 全部答对了！难度提升一级", en: "🎉 All correct! Level up", ms: "🎉 Semua betul! Naik tahap" },
  wrong_level_down:  { zh: "有几题不对哦，红色标出来了（难度降一级）", en: "Some are wrong — shown in red (level down)", ms: "Ada yang salah — ditunjukkan merah (tahap turun)" },
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

export interface NumberAdditionConfig {
  icon_urls: string[];        // designer上传的图标(至少1张，多张时每道算式随机挑一张用)
  number_min: number; number_max: number; // 每个加数的随机范围
  starting_level: number;     // 1-10，"同时出几道算式"的自适应难度
  total_questions: number;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string; ms?: string };
}
export interface NumberAdditionResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
  ending_level?: number;
}

const LEVEL_MAX = 10;

function randInt(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }

// 等级 → 同时出几道算式：算式越多，一题要数、要算的就越多。
function levelEquationCount(level: number): number {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  if (L <= 4) return 1;
  if (L <= 7) return 2;
  return 3;
}

interface Equation {
  icon: string;
  addend1: number; addend2: number;
  sum: number;
}
interface Puzzle { equations: Equation[] }

function genEquation(config: NumberAdditionConfig): Equation {
  const icon = config.icon_urls[randInt(0, config.icon_urls.length - 1)];
  const addend1 = randInt(config.number_min, config.number_max);
  const addend2 = randInt(config.number_min, config.number_max);
  return { icon, addend1, addend2, sum: addend1 + addend2 };
}

function genPuzzle(level: number, config: NumberAdditionConfig): Puzzle {
  const count = levelEquationCount(level);
  const equations = Array.from({ length: count }, () => genEquation(config));
  return { equations };
}

function IconGroup({ icon, count }: { icon: string; count: number }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1 min-w-[88px]">
      {Array.from({ length: count }, (_, i) => (
        <img key={i} src={icon} alt="" className="w-9 h-9 sm:w-10 sm:h-10 object-contain" />
      ))}
    </div>
  );
}

function EquationRow({ eq, value, onChange, disabled, result }: {
  eq: Equation; value: string; onChange: (v: string) => void; disabled: boolean; result: boolean | null;
}) {
  const boxCls = result === null
    ? "border-primary/50 bg-white focus:border-primary"
    : result ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-red-500 bg-red-50 text-red-600";
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2">
        <IconGroup icon={eq.icon} count={eq.addend1} />
        <span className="text-2xl font-bold text-slate-500">+</span>
        <IconGroup icon={eq.icon} count={eq.addend2} />
      </div>
      <div className="flex items-center gap-2 text-2xl font-bold text-slate-700">
        <span>{eq.addend1}</span>
        <span>+</span>
        <span>{eq.addend2}</span>
        <span>=</span>
        <input
          type="tel" inputMode="numeric"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
          className={`w-16 h-14 rounded-xl border-2 text-center outline-none transition-colors ${boxCls}`}
        />
      </div>
    </div>
  );
}

export default function NumberAdditionGame({ config, onComplete, locale = "zh" }: {
  config: NumberAdditionConfig; onComplete: (r: NumberAdditionResult) => void; locale?: Locale;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [level, setLevel] = useState(() => Math.min(LEVEL_MAX, Math.max(1, config.starting_level || 1)));
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const [answered, setAnswered] = useState(false);
  const [results, setResults] = useState<boolean[] | null>(null);
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
    setValues(p.equations.map(() => ""));
    setAnswered(false);
    setResults(null);
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

  function updateValue(i: number, v: string) {
    setValues((prev) => prev.map((val, idx) => (idx === i ? v : val)));
  }

  const allFilled = values.every((v) => v !== "");

  function submitAnswer() {
    if (answered || !puzzle || !allFilled) return;
    setAnswered(true);
    const r = puzzle.equations.map((eq, i) => parseInt(values[i], 10) === eq.sum);
    setResults(r);
    const allCorrect = r.every(Boolean);
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
        <div className="text-6xl">➕</div>
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
        {config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en || lt("add_prompt", locale)}
      </p>

      <div className="flex flex-wrap justify-center gap-6 bg-white dark:bg-card rounded-2xl p-5 mb-5 shadow-lg ring-1 ring-black/5">
        {puzzle.equations.map((eq, i) => (
          <EquationRow
            key={i} eq={eq} value={values[i]}
            onChange={(v) => updateValue(i, v)}
            disabled={answered} result={results?.[i] ?? null}
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
