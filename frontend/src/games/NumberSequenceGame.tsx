// frontend/src/games/NumberSequenceGame.tsx
//
// 数列填空 — 给一串按固定算术规律排列的数字(每次+1/-1/+2/+5/+10)，挖掉
// 其中几格，学生要根据前后数字推算出规律、填上缺的数字。
//
// 跟"找规律"(PatternGame)看起来有点像，但认的规律完全不是一回事：
// PatternGame 认的是"图案重复单位"(比如 AB AB AB 这种循环)，这个游戏
// 认的是"数字本身的算术步长"(每次固定加/减多少)，生成逻辑、判定方式
// 都不一样，硬合并成一个引擎会让两边的生成逻辑互相打架，所以另开一个
// 文件。
//
// 纯生成参数——没有素材图，序列本身就是题目内容，答案是现算出来的，
// 判定走client端直接比较，安全等级跟CubeStack系列一致。
//
// i18n: zh/en/ms 已支持 — 见 frontend/src/lib/gameLocale.ts

import { useState, useEffect, useCallback, useRef } from "react";
import { type Locale, type Dict, t, questionProgress } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  fill_prompt:    { zh: "找出规律，填上缺少的数字", en: "Find the pattern and fill in the missing numbers", ms: "Cari corak dan isi nombor yang hilang" },
  submit:         { zh: "✅ 提交", en: "✅ Submit", ms: "✅ Hantar" },
  correct_level_up:  { zh: "🎉 全部答对了！难度提升一级", en: "🎉 All correct! Level up", ms: "🎉 Semua betul! Naik tahap" },
  wrong_level_down:  { zh: "有几格不对哦，红色标出来了（难度降一级）", en: "Some are wrong — shown in red (level down)", ms: "Ada yang salah — ditunjukkan merah (tahap turun)" },
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

export interface NumberSequenceConfig {
  starting_level: number; // 1-10，步长复杂度+挖空密度的自适应难度
  total_questions: number;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string; ms?: string };
}
export interface NumberSequenceResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
  ending_level?: number;
}

const LEVEL_MAX = 10;
const SEQ_LENGTH = 10; // 每题固定10格，跟常见的练习册排版一致

function randInt(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 等级 → 允许的步长池：等级越高，允许的步长越"跳"，光看相邻两个数字
// 推规律的难度也跟着上升(+1只要看差1，+10要一眼看出跳了10)。
function levelStepPool(level: number): number[] {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  if (L <= 3) return [1];
  if (L <= 6) return [1, 2];
  if (L <= 8) return [1, 2, 5];
  return [1, 2, 5, 10];
}
// 等级 → 挖空格数：等级越高，挖得越多，剩下能参考的"已知格"越少。
function levelBlankCount(level: number): number {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  if (L <= 2) return 2;
  if (L <= 4) return 3;
  if (L <= 6) return 4;
  if (L <= 8) return 5;
  return 6;
}

interface Puzzle {
  sequence: number[];   // 完整正确序列
  blanks: Set<number>;  // 被挖空的下标
}

function genPuzzle(level: number): Puzzle {
  const stepPool = levelStepPool(level);
  const stepMag = stepPool[randInt(0, stepPool.length - 1)];
  const descending = Math.random() < 0.5;
  const step = descending ? -stepMag : stepMag;

  // 起始值随便挑一个，保证整串数字都落在 0~500 之间(不出现负数，小孩子
  // 认负数还没到这个阶段)
  const maxVal = 500;
  const span = Math.abs(step) * (SEQ_LENGTH - 1);
  const start = step > 0 ? randInt(0, maxVal - span) : randInt(span, maxVal);
  const sequence = Array.from({ length: SEQ_LENGTH }, (_, i) => start + step * i);

  // 挖空——固定保留第一格(下标0)不挖，图片里的例子每一行也都是这样，
  // 学生至少有一个"起点"可以参照；其余从下标1开始随机挑几个挖掉。
  const blankCount = Math.min(levelBlankCount(level), SEQ_LENGTH - 1);
  const candidates = shuffle(Array.from({ length: SEQ_LENGTH - 1 }, (_, i) => i + 1));
  const blanks = new Set(candidates.slice(0, blankCount));

  return { sequence, blanks };
}

export default function NumberSequenceGame({ config, onComplete, locale = "zh" }: {
  config: NumberSequenceConfig; onComplete: (r: NumberSequenceResult) => void; locale?: Locale;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [level, setLevel] = useState(() => Math.min(LEVEL_MAX, Math.max(1, config.starting_level || 1)));
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [answered, setAnswered] = useState(false);
  const [cellResults, setCellResults] = useState<Record<number, boolean> | null>(null);
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
    setPuzzle(genPuzzle(levelRef.current));
    setInputs({});
    setAnswered(false);
    setCellResults(null);
    setStatus({ msg: "", kind: "" });
    setQIndex((i) => i + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex]);

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

  const allFilled = puzzle ? [...puzzle.blanks].every((i) => inputs[i] !== undefined && inputs[i] !== "") : false;

  function submitAnswer() {
    if (answered || !puzzle || !allFilled) return;
    setAnswered(true);
    const results: Record<number, boolean> = {};
    let allCorrect = true;
    puzzle.blanks.forEach((i) => {
      const ok = parseInt(inputs[i], 10) === puzzle.sequence[i];
      results[i] = ok;
      if (!ok) allCorrect = false;
    });
    setCellResults(results);
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
        <div className="text-6xl">🔢</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {t("practice_complete", locale)}{lt("practice_done", locale, { c: correctCount, n: config.total_questions })}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{t("best_streak", locale)} {bestStreak}　{t("ending_level", locale)} Lv.{level}</div>
      </div>
    );
  }

  if (!puzzle) return null;

  return (
    <div className="max-w-3xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3 flex-wrap gap-1">
        <span>{questionProgress(qIndex, config.total_questions, locale)}　Lv.{level}</span>
        <span>✅ {t("accuracy", locale)} {accuracy}%　🔥 {t("streak", locale)} {streak}　⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      <p className="text-center text-lg font-semibold text-foreground mb-4">
        {config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en || lt("fill_prompt", locale)}
      </p>

      <div className="flex flex-wrap justify-center gap-2 bg-white dark:bg-card rounded-2xl p-4 mb-5 shadow-lg ring-1 ring-black/5">
        {puzzle.sequence.map((val, i) => {
          const isBlank = puzzle.blanks.has(i);
          const result = cellResults?.[i];
          const showColor = cellResults !== null && isBlank;
          if (!isBlank) {
            return (
              <div key={i} className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl border-2 border-slate-300 bg-slate-50 flex items-center justify-center text-xl sm:text-2xl font-bold text-slate-700">
                {val}
              </div>
            );
          }
          return (
            <input
              key={i}
              type="tel" inputMode="numeric"
              value={inputs[i] ?? ""}
              disabled={answered}
              onChange={(e) => setInputs((prev) => ({ ...prev, [i]: e.target.value.replace(/[^0-9]/g, "") }))}
              className={`w-14 h-14 sm:w-16 sm:h-16 rounded-xl border-2 text-center text-xl sm:text-2xl font-bold outline-none transition-colors ${
                showColor
                  ? result ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-red-500 bg-red-50 text-red-600"
                  : "border-primary/50 bg-white focus:border-primary"
              }`}
              placeholder="?"
            />
          );
        })}
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
