// frontend/src/games/ClockGame.tsx
//
// 认钟表 — 1-10级自适应难度，两种模式随机出现：
//   read — 给一个钟面，学生调整"小时/分钟"两个数字来说出几点几分
//   set  — 给一个数字时间(比如"3点15分")，学生调整数字来拨钟面上的指针，
//          直到钟面显示的时间跟题目一致
// 这两种模式其实是同一个"调整数字 → 看钟面实时反应 → 跟目标比对"的操作，
// 用同一套 <ClockFace> 渲染 + 同一套小时/分钟调整器，只是"哪个是题目、
// 哪个是答案"互换了一下，UI代码基本共用。
//
// 时针角度 = (hour%12 + minute/60) * 30度，不是简单的 hour*30度——分针
// 每走一圈，时针也要跟着挪一点点(比如3点30分，时针不会正好指在3上，而
// 是在3和4中间)，这是"认识钟表"这个知识点本身要教的东西，越到高难度
// (分钟粒度更细)这个细节的重要性越明显，故意做成真实物理规则，不是
// 简化版。
//
// 难度曲线：等级决定"分钟只能是几的倍数"——等级1-3只有整点(0)，4-6是
// 半点(0/30)，7-8是刻钟(0/15/30/45)，9-10任意5分钟刻度。小时永远是
// 1-12(12小时制，不是24小时)，这是小孩子认钟表通常学的范围。
//
// i18n: zh/en/ms 已支持 — 见 frontend/src/lib/gameLocale.ts

import { useState, useEffect, useCallback, useRef } from "react";
import { type Locale, type Dict, t, questionProgress } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  read_prompt:    { zh: "钟面现在是几点？", en: "What time does the clock show?", ms: "Pukul berapakah jam sekarang?" },
  set_prompt:     { zh: "请把钟面拨到 {h} 点 {m} 分", en: "Set the clock to {h}:{m2}", ms: "Tetapkan jam kepada pukul {h}:{m2}" },
  submit:         { zh: "✅ 提交", en: "✅ Submit", ms: "✅ Hantar" },
  correct_level_up: { zh: "🎉 答对了！难度提升一级", en: "🎉 Correct! Level up", ms: "🎉 Betul! Naik tahap" },
  wrong_answer_was: { zh: "正确答案是 {h} 点 {m} 分（难度降一级）", en: "The correct time is {h}:{m2} (level down)", ms: "Masa yang betul ialah {h}:{m2} (tahap turun)" },
  next_question:  { zh: "下一题", en: "Next question", ms: "Soalan seterusnya" },
  practice_done:  { zh: "练习完成！答对 {c} / {n} 题", en: "Practice complete! {c} / {n} correct", ms: "Latihan selesai! {c} / {n} betul" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}
// 英文/马来文习惯用 H:MM 补零格式，中文"3点5分"不用补零
function pad2(n: number): string { return String(n).padStart(2, "0"); }

export type ClockMode = "read" | "set";
export interface ClockConfig {
  starting_level: number;   // 1-10，分钟刻度粒度的自适应难度
  total_questions: number;
  mode: ClockMode | "both"; // "both" = 每题随机读钟表或拨钟表
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
}
export interface ClockResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
  ending_level?: number;
}

const LEVEL_MAX = 10;

function randInt(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }

// 等级 → 分钟允许的刻度粒度(分钟只能是这个数的倍数)
function levelMinuteStep(level: number): number {
  const L = Math.min(LEVEL_MAX, Math.max(1, level));
  if (L <= 3) return 60; // 只有整点(等于说分钟固定是0)
  if (L <= 6) return 30; // 整点或半点
  if (L <= 8) return 15; // 整点/一刻/半点/三刻
  return 5;              // 任意5分钟刻度
}

interface Puzzle {
  mode: ClockMode;
  hour: number;   // 1-12
  minute: number; // 0-55，按当前等级的粒度生成
  minuteStep: number;
}

function genPuzzle(level: number, configMode: ClockMode | "both"): Puzzle {
  const minuteStep = levelMinuteStep(level);
  const hour = randInt(1, 12);
  const stepsAvailable = Math.max(1, Math.floor(60 / minuteStep));
  const minute = (minuteStep === 60 ? 0 : randInt(0, stepsAvailable - 1) * minuteStep) % 60;
  const mode: ClockMode = configMode === "both" ? (Math.random() < 0.5 ? "read" : "set") : configMode;
  return { mode, hour, minute, minuteStep };
}

// ── 钟面渲染 ────────────────────────────────────────────────────────────────
// 纯SVG，viewBox固定100x100，指针角度按传入的hour/minute现算——read模式
// 传题目本身的hour/minute(钟面=题目)，set模式传学生当前调整器选的
// hour/minute(钟面=学生的作答，实时跟着调整器变化，这是"调整看反馈"的
// 具体体现)。
function ClockFace({ hour, minute, size = 220 }: { hour: number; minute: number; size?: number }) {
  const hourAngle = ((hour % 12) + minute / 60) * 30;
  const minuteAngle = minute * 6;

  const marks = [];
  for (let i = 0; i < 60; i++) {
    const angle = i * 6;
    const isHour = i % 5 === 0;
    const r1 = isHour ? 40 : 43, r2 = 46;
    const rad = (angle - 90) * (Math.PI / 180);
    marks.push(
      <line
        key={i}
        x1={50 + r1 * Math.cos(rad)} y1={50 + r1 * Math.sin(rad)}
        x2={50 + r2 * Math.cos(rad)} y2={50 + r2 * Math.sin(rad)}
        stroke="#334155" strokeWidth={isHour ? 1.6 : 0.7} strokeLinecap="round"
      />
    );
  }
  const numbers = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    const angle = n * 30 - 90;
    const rad = angle * (Math.PI / 180);
    const x = 50 + 34 * Math.cos(rad), y = 50 + 34 * Math.sin(rad);
    return (
      <text key={n} x={x} y={y} fontSize={9} fontWeight="600" fill="#1e293b" textAnchor="middle" dominantBaseline="central">
        {n}
      </text>
    );
  });

  return (
    <svg viewBox="0 0 100 100" style={{ width: size, height: size }} className="mx-auto">
      <circle cx={50} cy={50} r={48} fill="#ffffff" stroke="#334155" strokeWidth={2} />
      {marks}
      {numbers}
      {/* 时针 */}
      <line
        x1={50} y1={50}
        x2={50 + 24 * Math.cos((hourAngle - 90) * (Math.PI / 180))}
        y2={50 + 24 * Math.sin((hourAngle - 90) * (Math.PI / 180))}
        stroke="#1e293b" strokeWidth={3.2} strokeLinecap="round"
      />
      {/* 分针 */}
      <line
        x1={50} y1={50}
        x2={50 + 36 * Math.cos((minuteAngle - 90) * (Math.PI / 180))}
        y2={50 + 36 * Math.sin((minuteAngle - 90) * (Math.PI / 180))}
        stroke="#2563eb" strokeWidth={2.2} strokeLinecap="round"
      />
      <circle cx={50} cy={50} r={2.4} fill="#1e293b" />
    </svg>
  );
}

// ── 小时/分钟调整器——read/set两种模式共用同一个组件，只是文案不同 ──────────────
function TimeAdjuster({ hour, minute, minuteStep, onChangeHour, onChangeMinute, disabled, locale }: {
  hour: number; minute: number; minuteStep: number;
  onChangeHour: (h: number) => void; onChangeMinute: (m: number) => void; disabled: boolean; locale: Locale;
}) {
  const hourLabel = locale === "zh" ? `${hour}点` : String(hour);
  const minuteLabel = locale === "zh" ? `${minute}分` : pad2(minute);
  return (
    <div className="flex items-center justify-center gap-6 flex-wrap">
      <div className="flex items-center gap-2">
        <button disabled={disabled} onClick={() => onChangeHour(hour === 1 ? 12 : hour - 1)} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">−</button>
        <span className="w-16 text-center text-2xl font-bold">{hourLabel}</span>
        <button disabled={disabled} onClick={() => onChangeHour(hour === 12 ? 1 : hour + 1)} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">+</button>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={disabled} onClick={() => onChangeMinute((minute - minuteStep + 60) % 60)} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">−</button>
        <span className="w-20 text-center text-2xl font-bold">{minuteLabel}</span>
        <button disabled={disabled} onClick={() => onChangeMinute((minute + minuteStep) % 60)} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">+</button>
      </div>
    </div>
  );
}

export default function ClockGame({ config, onComplete, locale = "zh" }: {
  config: ClockConfig; onComplete: (r: ClockResult) => void; locale?: Locale;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [level, setLevel] = useState(() => Math.min(LEVEL_MAX, Math.max(1, config.starting_level || 1)));
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [guessHour, setGuessHour] = useState(12);
  const [guessMinute, setGuessMinute] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [correct, setCorrect] = useState<boolean | null>(null);
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
    const p = genPuzzle(levelRef.current, config.mode ?? "both");
    setPuzzle(p);
    // 调整器起始值故意不等于正确答案(不然一进题就"碰巧对了")，固定从
    // 12点0分开始，学生自己调到对的地方去。
    setGuessHour(12);
    setGuessMinute(0);
    setAnswered(false);
    setCorrect(null);
    setQIndex((i) => i + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, config.mode]);

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

  function submitAnswer() {
    if (answered || !puzzle) return;
    setAnswered(true);
    const isCorrect = guessHour === puzzle.hour && guessMinute === puzzle.minute;
    setCorrect(isCorrect);
    if (isCorrect) {
      setCorrectCount((c) => c + 1);
      setStreak((s) => { const next = s + 1; setBestStreak((b) => Math.max(b, next)); return next; });
      setLevel((lv) => Math.min(LEVEL_MAX, lv + 1));
    } else {
      setMistakeCount((m) => m + 1);
      setStreak(0);
      setLevel((lv) => Math.max(1, lv - 1));
    }
  }

  const timerLabel = config.timer_mode === "countdown" ? t("time_left", locale) : t("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;
  const accuracy = correctCount + mistakeCount > 0 ? Math.round((correctCount / (correctCount + mistakeCount)) * 100) : 0;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🕐</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {lt("practice_done", locale, { c: correctCount, n: config.total_questions })}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{t("best_streak", locale)} {bestStreak}　{t("ending_level", locale)} Lv.{level}</div>
      </div>
    );
  }

  if (!puzzle) return null;

  // read模式：钟面显示题目(puzzle)，学生调整器选出"我看到的是几点"
  // set模式：钟面显示学生当前调整器选的时间(实时跟着变)，题目文字给
  //          出目标数字时间，学生要把钟面调成跟文字一致
  const displayHour = puzzle.mode === "read" ? puzzle.hour : guessHour;
  const displayMinute = puzzle.mode === "read" ? puzzle.minute : guessMinute;

  return (
    <div className="max-w-xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3 flex-wrap gap-1">
        <span>{questionProgress(qIndex, config.total_questions, locale)}　Lv.{level}</span>
        <span>✅ {t("accuracy", locale)} {accuracy}%　🔥 {t("streak", locale)} {streak}　⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      <p className="text-center text-lg font-semibold text-foreground mb-3">
        {puzzle.mode === "read" ? lt("read_prompt", locale) : lt("set_prompt", locale, { h: puzzle.hour, m: locale === "zh" ? puzzle.minute : pad2(puzzle.minute) })}
      </p>

      <div className="bg-white dark:bg-card rounded-2xl p-5 mb-4 shadow-lg ring-1 ring-black/5">
        <ClockFace hour={displayHour} minute={displayMinute} />
      </div>

      {!answered ? (
        <>
          <TimeAdjuster
            hour={guessHour} minute={guessMinute} minuteStep={puzzle.minuteStep}
            onChangeHour={setGuessHour} onChangeMinute={setGuessMinute}
            disabled={answered} locale={locale}
          />
          <div className="flex justify-center mt-4">
            <button
              onClick={submitAnswer}
              className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors"
            >
              {lt("submit", locale)}
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-4 mt-3">
          <div className={`text-center text-lg font-medium px-4 py-3 rounded-xl ${
            correct ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
            : "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
          }`}>
            {correct ? lt("correct_level_up", locale) : lt("wrong_answer_was", locale, { h: puzzle.hour, m: locale === "zh" ? puzzle.minute : pad2(puzzle.minute) })}
          </div>
          <div className="flex justify-center">
            <button
              onClick={nextQuestion}
              className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors"
            >
              {lt("next_question", locale)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
