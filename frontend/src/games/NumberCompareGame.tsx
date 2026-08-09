// frontend/src/games/NumberCompareGame.tsx
//
// 数字比大小 — 给两组图标(数量不同/相同)，学生数一数，选 < / = / > 填
// 进中间的方框。1-10级自适应难度，等级控制"一题同时比几组"(低级1组，
// 高级3组以上)，跟"数的分解与合成"是同一个"给几个方框、挖几个空"的
// 结构套路，但认的关系不一样——数感树认的是"两部分加起来等于总数"，
// 这个认的是"两个数量谁大谁小"，两者的判定逻辑、UI布局都不一样，所以
// 另开一个文件而不是往数感树里加模式。
//
// 图标来源：designer自己上传(至少1张，多张时每组比较随机挑一张用)，
// 跟数感树同一套做法，不用另外内置一份emoji主题库。
//
// 判定：client端直接比较两边数量算出正确符号，没有隐藏答案这回事，
// 安全等级跟CubeStack系列一致。
//
// i18n: zh/en/ms 已支持 — 见 frontend/src/lib/gameLocale.ts

import { useState, useEffect, useCallback, useRef } from "react";
import { type Locale, type Dict, t, questionProgress } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  compare_prompt: { zh: "数一数，选出正确的符号", en: "Count and pick the correct symbol", ms: "Kira dan pilih simbol yang betul" },
  submit:         { zh: "✅ 提交", en: "✅ Submit", ms: "✅ Hantar" },
  correct_level_up:  { zh: "🎉 全部答对了！难度提升一级", en: "🎉 All correct! Level up", ms: "🎉 Semua betul! Naik tahap" },
  wrong_level_down:  { zh: "有几组不对哦，红色标出来了（难度降一级）", en: "Some are wrong — shown in red (level down)", ms: "Ada yang salah — ditunjukkan merah (tahap turun)" },
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

export interface NumberCompareConfig {
  icon_urls: string[];        // designer上传的图标(至少1张，多张时每组比较随机挑一张用)
  number_min: number; number_max: number; // 每边数量的随机范围
  starting_level: number;     // 1-10，"同时比几组"的自适应难度
  total_questions: number;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string; ms?: string };
}
export interface NumberCompareResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
  ending_level?: number;
}

const LEVEL_MAX = 10;
type Sym = "<" | "=" | ">";

function randInt(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }

// 等级 → 同时比几组：组越多，一题要数的方框也越多。
function levelPairCount(level: number): number {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  if (L <= 4) return 1;
  if (L <= 7) return 2;
  return 3;
}

interface ComparePair {
  icon: string;
  left: number; right: number;
  correct: Sym;
}
interface Puzzle { pairs: ComparePair[] }

function genPair(config: NumberCompareConfig): ComparePair {
  const icon = config.icon_urls[randInt(0, config.icon_urls.length - 1)];
  const left = randInt(config.number_min, config.number_max);
  // 大约三分之一概率故意让两边相等——不然左右各自独立随机的话，"="这
  // 个符号出现的概率会很低(尤其数字范围大的时候)，小孩子练不到"相等"
  // 这个情况。
  const right = Math.random() < 0.35 ? left : randInt(config.number_min, config.number_max);
  const correct: Sym = left < right ? "<" : left > right ? ">" : "=";
  return { icon, left, right, correct };
}

function genPuzzle(level: number, config: NumberCompareConfig): Puzzle {
  const pairCount = levelPairCount(level);
  const pairs = Array.from({ length: pairCount }, () => genPair(config));
  return { pairs };
}

function IconBox({ icon, count }: { icon: string; count: number }) {
  return (
    <div className="w-24 h-20 sm:w-28 sm:h-24 rounded-xl border-2 border-slate-400 bg-white flex flex-wrap items-center justify-center gap-0.5 p-1.5">
      {Array.from({ length: count }, (_, i) => (
        <img key={i} src={icon} alt="" className="w-6 h-6 sm:w-7 sm:h-7 object-contain" />
      ))}
    </div>
  );
}

function PairView({ pair, value, onChange, disabled, result }: {
  pair: ComparePair; value: Sym | null; onChange: (s: Sym) => void; disabled: boolean; result: boolean | null;
}) {
  const boxCls = result === null
    ? "border-border bg-card"
    : result ? "border-emerald-400 bg-emerald-50" : "border-red-400 bg-red-50";
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        <IconBox icon={pair.icon} count={pair.left} />
        <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-xl border-2 flex items-center justify-center text-2xl font-bold transition-colors ${boxCls}`}>
          {value ?? ""}
        </div>
        <IconBox icon={pair.icon} count={pair.right} />
      </div>
      <div className="flex gap-1.5">
        {(["<", "=", ">"] as Sym[]).map((s) => (
          <button
            key={s} type="button" onClick={() => onChange(s)} disabled={disabled}
            className={`w-10 h-10 rounded-lg border-2 text-lg font-bold transition-colors ${
              value === s ? "border-primary bg-primary/15 text-primary" : "border-border bg-card hover:border-primary/40"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function NumberCompareGame({ config, onComplete, locale = "zh" }: {
  config: NumberCompareConfig; onComplete: (r: NumberCompareResult) => void; locale?: Locale;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [level, setLevel] = useState(() => Math.min(LEVEL_MAX, Math.max(1, config.starting_level || 1)));
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [values, setValues] = useState<(Sym | null)[]>([]);
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
    setValues(p.pairs.map(() => null));
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

  function updateValue(i: number, s: Sym) {
    setValues((prev) => prev.map((v, idx) => (idx === i ? s : v)));
  }

  const allFilled = values.every((v) => v !== null);

  function submitAnswer() {
    if (answered || !puzzle || !allFilled) return;
    setAnswered(true);
    const r = puzzle.pairs.map((pair, i) => values[i] === pair.correct);
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
        <div className="text-6xl">⚖️</div>
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
        {config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en || lt("compare_prompt", locale)}
      </p>

      <div className="flex flex-wrap justify-center gap-8 bg-white dark:bg-card rounded-2xl p-5 mb-5 shadow-lg ring-1 ring-black/5">
        {puzzle.pairs.map((pair, i) => (
          <PairView
            key={i} pair={pair} value={values[i]}
            onChange={(s) => updateValue(i, s)}
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
