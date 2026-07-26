// frontend/src/games/WordProblemGame.tsx
//
// 应用题 v2 — the two categories (鸡兔同笼 / 相遇问题) now get an interactive
// "adjust and check" answer UI instead of plain select/type-a-number, since
// that's closer to how these problems are actually meant to be reasoned
// about at this age (trial-and-adjustment with concrete feedback, before
// algebra) rather than "read text, guess from a list, or type a number you
// worked out on paper elsewhere". The question TEXT/generation logic is
// unchanged from v1 — only the answer-input mechanism changed, so the
// verified-correct math from v1 carries over untouched.

import { useState, useEffect, useCallback, useRef } from "react";
import { eduApi } from "@/api/index";
import { GAME_CANVAS_W, GAME_CANVAS_H } from "@/lib/gameCanvas";

export type WordProblemCategory = "chicken_rabbit" | "meeting_point" | "cow_grass" | "concentration";

export interface WordProblemConfig {
  categories: WordProblemCategory[];
  answer_mode: "select" | "input"; // kept for config compatibility; interactive UI is now the default answer mechanism for both categories regardless of this setting — see note below
  num_choices: number;
  total_questions: number;
  chicken_min: number; chicken_max: number;
  speed_min: number; speed_max: number;
  meet_time_min: number; meet_time_max: number;
  cow_rate_min?: number; cow_rate_max?: number; // 牛吃草: daily grass regrowth rate per "unit"
  cow_days_min?: number; cow_days_max?: number; // 牛吃草: how many days the first known scenario takes
  conc_low_min?: number; conc_low_max?: number; // 浓度问题: target (lower) concentration %
  conc_gap_min?: number; conc_gap_max?: number; // 浓度问题: how much higher the original concentration is
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  // 自定义题目 (authored) — one specific problem the designer wrote, not
  // procedurally generated. bg_image_url/objects/texts are illustrative
  // (same shape SceneEditor's structured mode produces for counting), not
  // something the game counts — the answer is whatever the designer typed
  // in, checked server-side (see eduApi.checkWordProblem — this component
  // never receives the real answer, same "hidden until checked" principle
  // as sudoku).
  mode?: "random" | "custom_scene";
  bg_image_url?: string | null;
  objects?: Array<{ imageUrl: string; x: number; y: number; w: number; h: number; rotation: number }>;
  texts?: Array<{ text: string; x: number; y: number; fontSize: number; color: string; fontFamily: string; rotation: number }>;
  problem_text?: string;
  question_text?: string;
  unit?: string;
}
export interface WordProblemResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function randInt(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }

// ── Question generation (unchanged math from v1) ─────────────────────────────
interface ChickenRabbitQuestion {
  category: "chicken_rabbit";
  text: string; question: string; answer: number; unit: string;
  targetHeads: number; targetLegs: number; askChicken: boolean;
}
interface MeetingPointQuestion {
  category: "meeting_point";
  text: string; question: string; answer: number; unit: string;
  distance: number; v1: number; v2: number; time: number; askTime: boolean;
}
interface CowGrassQuestion {
  category: "cow_grass";
  text: string; question: string; answer: number; unit: string;
  askDays: boolean; targetCows: number; targetDays: number;
}
interface ConcentrationQuestion {
  category: "concentration";
  text: string; question: string; answer: number; unit: string;
  originalMass: number; originalConc: number; targetConc: number;
}
type Question = ChickenRabbitQuestion | MeetingPointQuestion | CowGrassQuestion | ConcentrationQuestion;

function divisorsOf(n: number): number[] {
  const divs: number[] = [];
  for (let i = 1; i <= n; i++) if (n % i === 0) divs.push(i);
  return divs;
}

// 牛吃草 (Newton's cow problem) — built from two "known" scenarios (a
// pasture with G units of grass growing at r units/day; N cows each eat 1
// unit/day) to derive G and r, then asks a THIRD scenario. Every quantity
// is constructed FROM divisors of G rather than randomly generated then
// checked — guarantees clean integers by construction instead of
// rejection-sampling until something happens to divide evenly (verified
// with a standalone script before wiring this in: every trial produced
// integer results, no floating-point answers slipping through).
function genCowGrass(cfg: WordProblemConfig): CowGrassQuestion {
  const r = randInt(cfg.cow_rate_min ?? 1, cfg.cow_rate_max ?? 4);
  const D1 = randInt(cfg.cow_days_min ?? 3, cfg.cow_days_max ?? 8);
  const N1 = randInt(r + 2, r + 15);
  const G = D1 * (N1 - r);
  const divs = divisorsOf(G);
  const d2 = divs[randInt(0, divs.length - 1)];
  const N2 = d2 + r, D2 = G / d2;

  const askDays = Math.random() < 0.5;
  const d3 = divs[randInt(0, divs.length - 1)];
  const N3 = d3 + r, D3 = G / d3;

  const scenarioText = `一片牧场的草每天匀速生长。<b>${N1}</b> 头牛吃 <b>${D1}</b> 天可以吃完牧场的草，<b>${N2}</b> 头牛吃 <b>${D2}</b> 天可以吃完牧场的草。`;
  if (askDays) {
    return {
      category: "cow_grass",
      text: scenarioText,
      question: `如果有 <b>${N3}</b> 头牛，几天能吃完牧场的草？`,
      answer: D3, unit: "天",
      askDays: true, targetCows: N3, targetDays: D3,
    };
  }
  return {
    category: "cow_grass",
    text: scenarioText,
    question: `如果要 <b>${D3}</b> 天吃完牧场的草，需要多少头牛？`,
    answer: N3, unit: "头",
    askDays: false, targetCows: N3, targetDays: D3,
  };
}

// 浓度问题 — dilute M grams of c1% saltwater down to c2% by adding water.
// M is deliberately constructed as k×c2 so the answer (k×(c1−c2)) is
// guaranteed an integer — same "build from the answer backward" approach
// as cow_grass, not generate-then-hope.
function genConcentration(cfg: WordProblemConfig): ConcentrationQuestion {
  const c2 = randInt(cfg.conc_low_min ?? 5, cfg.conc_low_max ?? 20);
  const c1 = c2 + randInt(cfg.conc_gap_min ?? 5, cfg.conc_gap_max ?? 25);
  const k = randInt(2, 10);
  const M = k * c2;
  const waterToAdd = k * (c1 - c2);
  return {
    category: "concentration",
    text: `有 <b>${M}</b> 克浓度为 <b>${c1}%</b> 的盐水。`,
    question: `要把它稀释成浓度 <b>${c2}%</b> 的盐水，需要加多少克水？`,
    answer: waterToAdd, unit: "克",
    originalMass: M, originalConc: c1, targetConc: c2,
  };
}

function genChickenRabbit(cfg: WordProblemConfig): ChickenRabbitQuestion {
  const c = randInt(cfg.chicken_min, cfg.chicken_max);
  const r = randInt(cfg.chicken_min, cfg.chicken_max);
  const H = c + r, L = 2 * c + 4 * r;
  const askChicken = Math.random() < 0.5;
  return {
    category: "chicken_rabbit",
    text: `笼子里关着一群鸡和兔子，从上面数一共有 <b>${H}</b> 个头，从下面数一共有 <b>${L}</b> 条腿。`,
    question: askChicken ? "鸡有多少只？" : "兔子有多少只？",
    answer: askChicken ? c : r,
    unit: "只",
    targetHeads: H, targetLegs: L, askChicken,
  };
}

function genMeetingPoint(cfg: WordProblemConfig): MeetingPointQuestion {
  const t = randInt(cfg.meet_time_min, cfg.meet_time_max);
  const v1 = randInt(cfg.speed_min, cfg.speed_max);
  const v2 = randInt(cfg.speed_min, cfg.speed_max);
  const D = t * (v1 + v2);
  const askTime = Math.random() < 0.5;
  if (askTime) {
    return {
      category: "meeting_point",
      text: `甲、乙两地相距 <b>${D}</b> 千米，A车每小时行 <b>${v1}</b> 千米，B车每小时行 <b>${v2}</b> 千米，两车同时从两地相向而行。`,
      question: "几小时后两车相遇？",
      answer: t, unit: "小时",
      distance: D, v1, v2, time: t, askTime,
    };
  }
  return {
    category: "meeting_point",
    text: `A车每小时行 <b>${v1}</b> 千米，B车每小时行 <b>${v2}</b> 千米，两车同时从两地相向而行，<b>${t}</b> 小时后相遇。`,
    question: "两地相距多少千米？",
    answer: D, unit: "千米",
    distance: D, v1, v2, time: t, askTime,
  };
}

const GENERATORS: Record<WordProblemCategory, (cfg: WordProblemConfig) => Question> = {
  chicken_rabbit: genChickenRabbit,
  meeting_point: genMeetingPoint,
  cow_grass: genCowGrass,
  concentration: genConcentration,
};

// ── Interactive UI: 鸡兔同笼 ───────────────────────────────────────────────────
// Student adjusts chicken/rabbit counts with steppers, sees the head/leg
// totals update live against the target, and submits whichever count the
// question actually asked for once the totals line up. This is the natural
// "guess and adjust" approach to this problem, concrete before algebraic.
function ChickenRabbitInteractive({ q, onSubmit, disabled }: {
  q: ChickenRabbitQuestion; onSubmit: (val: number) => void; disabled: boolean;
}) {
  const [chickens, setChickens] = useState(0);
  const [rabbits, setRabbits] = useState(0);
  const heads = chickens + rabbits;
  const legs = chickens * 2 + rabbits * 4;
  const headsMatch = heads === q.targetHeads;
  const legsMatch = legs === q.targetLegs;

  function renderIcons(count: number, icon: string) {
    if (count === 0) return null;
    if (count > 16) return <span className="text-2xl">{icon} ×{count}</span>;
    return <span className="text-2xl leading-none">{icon.repeat(count)}</span>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-2 flex-wrap min-h-[48px] px-3">
        {renderIcons(chickens, "🐔")}
        {renderIcons(rabbits, "🐰")}
        {heads === 0 && <span className="text-muted-foreground text-sm">往笼子里加几只试试看</span>}
      </div>

      <div className="flex gap-6 justify-center">
        <div className="flex items-center gap-2">
          <span className="text-lg">🐔 鸡</span>
          <button disabled={disabled} onClick={() => setChickens((c) => Math.max(0, c - 1))} className="w-9 h-9 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">−</button>
          <span className="w-8 text-center text-lg font-semibold">{chickens}</span>
          <button disabled={disabled} onClick={() => setChickens((c) => c + 1)} className="w-9 h-9 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">+</button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg">🐰 兔</span>
          <button disabled={disabled} onClick={() => setRabbits((r) => Math.max(0, r - 1))} className="w-9 h-9 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">−</button>
          <span className="w-8 text-center text-lg font-semibold">{rabbits}</span>
          <button disabled={disabled} onClick={() => setRabbits((r) => r + 1)} className="w-9 h-9 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">+</button>
        </div>
      </div>

      <div className="flex gap-4 justify-center text-sm font-medium">
        <span className={headsMatch ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
          头数 {heads} / {q.targetHeads} {headsMatch && "✓"}
        </span>
        <span className={legsMatch ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
          腿数 {legs} / {q.targetLegs} {legsMatch && "✓"}
        </span>
      </div>

      <button
        onClick={() => onSubmit(q.askChicken ? chickens : rabbits)}
        disabled={disabled || heads === 0}
        className="block mx-auto text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
      >
        确认答案：{q.askChicken ? "鸡" : "兔"} {q.askChicken ? chickens : rabbits} 只
      </button>
    </div>
  );
}

// ── Interactive UI: 相遇问题 ───────────────────────────────────────────────────
// One slider, one mechanic for both question variants: drag until the gap
// between the two cars hits exactly zero, then submit whichever quantity
// was being searched for (time, if distance is the known/fixed quantity on
// the line; or distance, if time is fixed and the road length is what's
// being searched for).
function MeetingPointInteractive({ q, onSubmit, disabled }: {
  q: MeetingPointQuestion; onSubmit: (val: number) => void; disabled: boolean;
}) {
  const maxGuess = q.askTime ? q.time * 2 : q.distance * 2;
  const [guess, setGuess] = useState(0);

  // askTime: distance is fixed (the road), guess = elapsed time, positions move inward
  // askDistance: time is fixed, guess = candidate road length, positions are fixed offsets from each end
  const roadLength = q.askTime ? q.distance : Math.max(guess, q.distance, 1);
  const posA = q.askTime ? guess * q.v1 : q.time * q.v1;       // from left
  const posB = q.askTime ? guess * q.v2 : q.time * q.v2;       // from right
  const gap = roadLength - posA - posB;
  const met = Math.abs(gap) < 0.01;

  const pctA = Math.min(100, (posA / roadLength) * 100);
  const pctB = Math.min(100, (posB / roadLength) * 100);

  return (
    <div className="space-y-4">
      <div className="relative h-16 bg-card rounded-xl border-2 border-border mx-2">
        <div className="absolute left-2 -top-6 text-xs text-muted-foreground">起点A</div>
        <div className="absolute right-2 -top-6 text-xs text-muted-foreground">起点B</div>
        <div
          className="absolute top-1/2 -translate-y-1/2 text-2xl transition-all duration-150"
          style={{ left: `calc(${pctA}% - 12px)` }}
        >🚗</div>
        <div
          className="absolute top-1/2 -translate-y-1/2 text-2xl -scale-x-100 transition-all duration-150"
          style={{ right: `calc(${pctB}% - 12px)` }}
        >🚗</div>
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(1, maxGuess)}
        step={q.askTime ? 0.1 : 1}
        value={guess}
        disabled={disabled}
        onChange={(e) => setGuess(Number(e.target.value))}
        className="w-full"
      />

      <p className="text-center text-sm font-medium">
        {q.askTime ? `拖动时间：${guess.toFixed(1)} 小时` : `拖动距离：${guess} 千米`}
        {"　"}
        <span className={met ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
          {met ? "两车正好相遇！✓" : gap > 0 ? `还差 ${gap.toFixed(1)} 千米` : `已经相遇过了`}
        </span>
      </p>

      <button
        onClick={() => onSubmit(q.askTime ? Number(guess.toFixed(1)) : guess)}
        disabled={disabled}
        className="block mx-auto text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
      >
        确认答案：{q.askTime ? `${guess.toFixed(1)} 小时` : `${guess} 千米`}
      </button>
    </div>
  );
}

// ── Interactive UI: 牛吃草 ─────────────────────────────────────────────────────
// A single stepper for whichever quantity is being asked (cows, or days) —
// simpler than the two-variable balancing act of chicken_rabbit/meeting_point
// since this problem only has one unknown once the two "known" scenarios
// are given, not two simultaneously-adjusted quantities.
function CowGrassInteractive({ q, onSubmit, disabled }: {
  q: CowGrassQuestion; onSubmit: (val: number) => void; disabled: boolean;
}) {
  const [guess, setGuess] = useState(1);
  const label = q.askDays ? "天" : "头牛";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-3">
        <span className="text-lg">{q.askDays ? "🐄🐄🐄 吃完的天数" : "🌾 需要的牛数"}</span>
        <button disabled={disabled} onClick={() => setGuess((v) => Math.max(1, v - 1))} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">−</button>
        <span className="w-14 text-center text-2xl font-bold">{guess}</span>
        <button disabled={disabled} onClick={() => setGuess((v) => v + 1)} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">+</button>
        <span className="text-lg text-muted-foreground">{label}</span>
      </div>
      <button
        onClick={() => onSubmit(guess)}
        disabled={disabled}
        className="block mx-auto text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
      >
        确认答案：{guess} {label}
      </button>
    </div>
  );
}

// ── Interactive UI: 浓度问题 ───────────────────────────────────────────────────
// Slider for "how much water to add", with the resulting concentration
// recomputed and shown live as the student drags — same "see the
// consequence of your guess before committing" principle as the meeting
// point gap indicator.
function ConcentrationInteractive({ q, onSubmit, disabled }: {
  q: ConcentrationQuestion; onSubmit: (val: number) => void; disabled: boolean;
}) {
  const maxWater = q.originalMass * 3;
  const [water, setWater] = useState(0);
  const saltGrams = (q.originalMass * q.originalConc) / 100;
  const resultConc = (saltGrams / (q.originalMass + water)) * 100;
  const matched = Math.abs(resultConc - q.targetConc) < 0.05;

  return (
    <div className="space-y-4">
      <div className="text-center">
        <span className="text-3xl">🧂💧</span>
        <p className="text-sm text-muted-foreground mt-1">盐的重量固定不变（{saltGrams.toFixed(1)}克），加水只会让它变淡</p>
      </div>
      <input
        type="range" min={0} max={Math.max(1, maxWater)} step={1}
        value={water} disabled={disabled}
        onChange={(e) => setWater(Number(e.target.value))}
        className="w-full"
      />
      <p className="text-center text-sm font-medium">
        加水：{water} 克　
        <span className={matched ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
          现在浓度 {resultConc.toFixed(1)}%（目标 {q.targetConc}%）{matched && "✓"}
        </span>
      </p>
      <button
        onClick={() => onSubmit(water)}
        disabled={disabled}
        className="block mx-auto text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
      >
        确认答案：加水 {water} 克
      </button>
    </div>
  );
}

// ── 自定义题目 (authored) ────────────────────────────────────────────────────────
// A single fixed problem the designer wrote — background/objects/text are
// illustrative (same data shape SceneEditor's structured mode produces for
// counting), not counted. Answer input is a plain number field since a
// custom problem isn't a fixed formula with a natural "adjust and see
// feedback" mechanic the way chicken_rabbit/meeting_point/cow_grass/
// concentration are — those get their interactive sliders/steppers BECAUSE
// their math has an obvious physical analogy to manipulate; an arbitrary
// authored problem doesn't have one in general, so "type the number you
// worked out" is the honest, general-purpose answer mechanism here.
function CustomWordProblemGame({ levelId, config, onComplete }: {
  levelId: string; config: WordProblemConfig; onComplete: (r: WordProblemResult) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ correct: boolean; answer: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  async function handleSubmit() {
    if (checking || !answer) return;
    setChecking(true);
    try {
      const numericValue = parseFloat(answer);
      const r = await eduApi.checkWordProblem(levelId, numericValue);
      setResult(r);
      setFinished(true);
      onComplete({
        score: r.correct ? 1 : 0, max_score: 1,
        time_spent_seconds: (Date.now() - startRef.current) / 1000,
        mistakes: r.correct ? 0 : 1, completed: true,
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto w-full">
      <div className="flex justify-end text-base font-medium text-muted-foreground mb-3">
        <span>⏱️ 用时 {elapsed.toFixed(1)}s</span>
      </div>

      {config.bg_image_url && (
        <div
          className="relative w-full aspect-[11/7] rounded-2xl mb-4 bg-amber-50 dark:bg-amber-950/20 overflow-hidden shadow-lg ring-1 ring-black/5"
          style={{ containerType: "size", backgroundImage: `url(${config.bg_image_url})`, backgroundSize: "100% 100%", backgroundPosition: "center" }}
        >
          {(config.objects ?? []).map((o, i) => (
            <img
              key={i} src={o.imageUrl} alt=""
              className="absolute object-contain -translate-x-1/2 -translate-y-1/2 drop-shadow"
              style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${(o.w / GAME_CANVAS_W) * 100}%`, aspectRatio: "1 / 1", transform: `translate(-50%, -50%) rotate(${o.rotation ?? 0}deg)` }}
            />
          ))}
          {(config.texts ?? []).map((t, i) => (
            <span
              key={`text-${i}`} className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap"
              style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%`, fontSize: `${(t.fontSize / GAME_CANVAS_H) * 100}cqh`, color: t.color, fontFamily: t.fontFamily, transform: `translate(-50%, -50%) rotate(${t.rotation ?? 0}deg)` }}
            >
              {t.text}
            </span>
          ))}
        </div>
      )}

      <div className="p-6 bg-amber-50 dark:bg-amber-950/20 rounded-2xl mb-5 space-y-3">
        <p className="text-lg leading-relaxed">{config.problem_text}</p>
        <p className="text-lg font-semibold text-foreground">{config.question_text}</p>
      </div>

      {!finished ? (
        <div className="flex items-center justify-center gap-3">
          <input
            type="number" value={answer} onChange={(e) => setAnswer(e.target.value)}
            placeholder="输入答案" className="w-32 text-center text-2xl font-bold px-3 py-2 rounded-xl border-2 border-border bg-card"
          />
          {config.unit && <span className="text-lg text-muted-foreground">{config.unit}</span>}
          <button
            onClick={handleSubmit} disabled={checking || !answer}
            className="text-lg font-semibold px-6 py-2.5 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
          >
            {checking ? "检查中..." : "✅ 提交"}
          </button>
        </div>
      ) : (
        <div className={`text-center text-lg font-medium px-4 py-3 rounded-xl ${
          result?.correct ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
          : "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
        }`}>
          {result?.correct ? "🎉 答对了！" : `答案是 ${result?.answer} ${config.unit ?? ""}`}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function WordProblemGame({ levelId, config, onComplete }: {
  levelId: string; config: WordProblemConfig; onComplete: (r: WordProblemResult) => void;
}) {
  if (config.mode === "custom_scene") {
    return <CustomWordProblemGame levelId={levelId} config={config} onComplete={onComplete} />;
  }
  return <RandomWordProblemGame config={config} onComplete={onComplete} />;
}

function RandomWordProblemGame({ config, onComplete }: {
  config: WordProblemConfig; onComplete: (r: WordProblemResult) => void;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [question, setQuestion] = useState<Question | null>(null);
  const [answered, setAnswered] = useState(false);
  const [status, setStatus] = useState<{ msg: string; kind: "" | "good" | "bad" }>({ msg: "", kind: "" });
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);

  const startRef = useRef(Date.now());
  const bagRef = useRef<WordProblemCategory[]>([]);

  const finish = useCallback(() => {
    setFinished(true);
    onComplete({
      score: correctCount, max_score: config.total_questions,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes: mistakeCount, completed: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correctCount, mistakeCount, config.total_questions]);

  const nextQuestion = useCallback(() => {
    if (qIndex >= config.total_questions) { finish(); return; }
    if (bagRef.current.length === 0) bagRef.current = shuffle([...config.categories]);
    const category = bagRef.current.pop()!;
    setQuestion(GENERATORS[category](config));
    setAnswered(false);
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
    if (elapsed >= config.time_limit) {
      setFinished(true);
      onComplete({
        score: correctCount, max_score: config.total_questions,
        time_spent_seconds: elapsed, mistakes: mistakeCount, completed: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  function submitAnswer(val: number) {
    if (answered || finished || !question) return;
    setAnswered(true);
    if (val === question.answer) {
      setCorrectCount((c) => c + 1);
      setStatus({ msg: "🎉 答对了！", kind: "good" });
    } else {
      setMistakeCount((m) => m + 1);
      setStatus({ msg: `答案是 ${question.answer} ${question.unit}`, kind: "bad" });
    }
    setTimeout(nextQuestion, 1600);
  }

  const timerLabel = config.timer_mode === "countdown" ? "剩余" : "用时";
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">📝</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          练习完成！答对 {correctCount} / {config.total_questions} 题
        </div>
      </div>
    );
  }

  if (!question) return null;

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3">
        <span>第 {qIndex} / {config.total_questions} 题</span>
        <span>✅ {correctCount}　⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      <div className="p-6 bg-amber-50 dark:bg-amber-950/20 rounded-2xl mb-5 space-y-3">
        <p className="text-lg leading-relaxed" dangerouslySetInnerHTML={{ __html: question.text }} />
        <p className="text-lg font-semibold text-foreground">{question.question}</p>
      </div>

      {question.category === "chicken_rabbit" ? (
        <ChickenRabbitInteractive q={question} onSubmit={submitAnswer} disabled={answered} />
      ) : question.category === "meeting_point" ? (
        <MeetingPointInteractive q={question} onSubmit={submitAnswer} disabled={answered} />
      ) : question.category === "cow_grass" ? (
        <CowGrassInteractive q={question} onSubmit={submitAnswer} disabled={answered} />
      ) : (
        <ConcentrationInteractive q={question} onSubmit={submitAnswer} disabled={answered} />
      )}

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
