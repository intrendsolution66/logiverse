// frontend/src/games/CountingGame.tsx
//
// 改动集中在 CustomSceneCountingGame：
// - CountingConfig.positions 每项加了可选的 `type`（对应 SceneEditor 里
//   物件打的"类型"标签，比如"苹果"）
// - CountingConfig 加了 `target_types`：这一题实际要问的类型集合，由
//   课程设计师在 CourseDesignerPage 里勾选
// - 答案不再是 positions.length（全部物件总数），而是"target_types 里
//   这几种类型加起来有几个"；如果 target_types 没设（旧数据，或设计师
//   压根没给物件打类型），退回原本"数全部"的行为，不影响已有的Activity

import { useState, useEffect, useRef, useCallback } from "react";
import { GAME_CANVAS_W, GAME_CANVAS_H } from "@/lib/gameCanvas";

export interface CountingConfig {
  theme: string;
  custom_icon_url?: string | null;
  min_val: number;
  max_val: number;
  quiz_mode: "select" | "tap";
  num_choices: number;
  total_questions: number;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  mode?: "random" | "custom_scene";
  bg_image_url?: string | null;
  positions?: { x: number; y: number; image_url?: string; w?: number; h?: number; rotation?: number; type?: string; flip_x?: boolean; flip_y?: boolean }[];
  texts?: { text: string; x: number; y: number; fontSize: number; color: string; fontFamily: string; rotation: number; bold?: boolean; italic?: boolean; underline?: boolean }[];
  // 这一题要问哪几种物件类型的和——不设或空数组时，退回"数全部物件"的
  // 旧行为（向后兼容没有打类型标签的旧Activity）。
  target_types?: string[];
  // 课程设计师自己写的题目句子（比如"苹果和西瓜一共有几个？"）——有值时
  // 优先显示这个，没有才退回下面按 target_types 自动生成的句子。
  question_i18n?: { zh?: string; en?: string };
}

export interface CountingResult {
  score: number;
  max_score: number;
  time_spent_seconds: number;
  mistakes: number;
  completed: boolean;
}

const THEME_EMOJI: Record<string, string> = {
  apple: "🍎", star: "⭐", fish: "🐟", balloon: "🎈", candy: "🍬",
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function randInt(a: number, b: number) { return a + Math.floor(Math.random() * (b - a + 1)); }

function CustomSceneCountingGame({ config, onComplete }: {
  config: CountingConfig; onComplete: (result: CountingResult) => void;
}) {
  const positions = config.positions ?? [];
  const targetTypes = (config.target_types ?? []).filter(Boolean);
  const hasTypedTargets = targetTypes.length > 0;

  // 有指定target_types：只数这几种类型的物件；没指定：数全部（旧行为，
  // 也覆盖了"设计师压根没给物件打类型"的情况）。
  const target = hasTypedTargets
    ? positions.filter((p) => p.type && targetTypes.includes(p.type)).length
    : positions.length;

  const questionText = config.question_i18n?.zh || config.question_i18n?.en || (
    hasTypedTargets
      ? targetTypes.length === 1
        ? `一共有多少个${targetTypes[0]}？`
        : `${targetTypes.join("和")}一共有多少个？`
      : "一共有多少个？"
  );

  const [choices] = useState<number[]>(() => {
    const want = Math.min(config.num_choices || 3, 6);
    const cand = new Set<number>([target]);
    let guard = 0;
    while (cand.size < want && guard < 40) {
      guard++;
      const delta = randInt(1, 3);
      const c = Math.random() < 0.5 ? target - delta : target + delta;
      if (c >= 0 && c !== target) cand.add(c);
    }
    const arr = Array.from(cand);
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  });
  const [answered, setAnswered] = useState(false);
  const [status, setStatus] = useState<{ msg: string; kind: "" | "good" | "bad" }>({ msg: "", kind: "" });
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 100);
    return () => clearInterval(id);
  }, [finished]);

  function submitAnswer(val: number) {
    if (answered) return;
    setAnswered(true);
    const correct = val === target;
    setStatus(correct ? { msg: "🎉 答对了！", kind: "good" } : { msg: `答案是 ${target}`, kind: "bad" });
    setTimeout(() => {
      setFinished(true);
      onComplete({
        score: correct ? 1 : 0, max_score: 1,
        time_spent_seconds: (Date.now() - startRef.current) / 1000,
        mistakes: correct ? 0 : 1, completed: true,
      });
    }, 1300);
  }

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">{status.kind === "good" ? "🎉" : "🔢"}</div>
        <div className="text-xl font-semibold mt-3 text-foreground">练习完成！用时 {elapsed.toFixed(1)} 秒</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto w-full">
      <div className="flex justify-end text-base font-medium text-muted-foreground mb-3">
        <span>⏱️ 用时 {elapsed.toFixed(1)}s</span>
      </div>

      <div
        className="relative w-full aspect-[11/7] rounded-2xl mb-5 bg-amber-50 dark:bg-amber-950/20 overflow-hidden shadow-lg ring-1 ring-black/5"
        style={{
          containerType: "size",
          ...(config.bg_image_url ? { backgroundImage: `url(${config.bg_image_url})`, backgroundSize: "100% 100%", backgroundPosition: "center" } : {}),
        }}
      >
        {positions.map((p, i) => {
          const src = p.image_url ?? config.custom_icon_url ?? "";
          const sizePct = p.w ? (p.w / GAME_CANVAS_W) * 100 : 7;
          const flipX = p.flip_x ? -1 : 1, flipY = p.flip_y ? -1 : 1;
          return (
            <img
              key={i} src={src} alt=""
              className="absolute object-contain -translate-x-1/2 -translate-y-1/2 drop-shadow"
              style={{
                left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${sizePct}%`, aspectRatio: "1 / 1",
                // 顺序要跟 SceneEditor.tsx 里 canvas 渲染的合成顺序一致（先翻转、
                // 再旋转，都绕物件自己的中心）——不然设计师编辑时看到的跟学生玩
                // 的时候看到的会对不上。
                transform: `translate(-50%, -50%) rotate(${p.rotation ?? 0}deg) scale(${flipX}, ${flipY})`,
              }}
            />
          );
        })}
        {(config.texts ?? []).map((t, i) => (
          <span
            key={`text-${i}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap"
            style={{
              left: `${t.x * 100}%`, top: `${t.y * 100}%`,
              fontSize: `${(t.fontSize / GAME_CANVAS_H) * 100}cqh`,
              color: t.color, fontFamily: t.fontFamily,
              fontWeight: t.bold ? "bold" : "normal",
              fontStyle: t.italic ? "italic" : "normal",
              textDecoration: t.underline ? "underline" : "none",
              transform: `translate(-50%, -50%) rotate(${t.rotation ?? 0}deg)`,
            }}
          >
            {t.text}
          </span>
        ))}
      </div>

      <p className="text-center text-lg font-semibold text-foreground mb-3">{questionText}</p>
      <div className="flex gap-4 justify-center mb-3">
        {choices.map((val) => (
          <button
            key={val} onClick={() => submitAnswer(val)} disabled={answered}
            className="text-3xl font-semibold px-10 py-6 rounded-2xl border-2 border-border bg-card hover:border-primary/50 disabled:cursor-default transition-colors min-w-[100px]"
          >
            {val}
          </button>
        ))}
      </div>

      {status.msg && (
        <div className={`text-center text-lg font-medium px-4 py-3 rounded-xl ${
          status.kind === "good" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
          : "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
        }`}>
          {status.msg}
        </div>
      )}
    </div>
  );
}

export default function CountingGame({ config, onComplete }: {
  config: CountingConfig;
  onComplete: (result: CountingResult) => void;
}) {
  if (config.mode === "custom_scene" && config.positions?.length) {
    return <CustomSceneCountingGame config={config} onComplete={onComplete} />;
  }
  return <RandomCountingGame config={config} onComplete={onComplete} />;
}

function RandomCountingGame({ config, onComplete }: {
  config: CountingConfig;
  onComplete: (result: CountingResult) => void;
}) {
  const [qIndex, setQIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [target, setTarget] = useState(0);
  const [choices, setChoices] = useState<number[]>([]);
  const [attempts, setAttempts] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [status, setStatus] = useState<{ msg: string; kind: "" | "good" | "bad" }>({ msg: "", kind: "" });
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);

  const startRef = useRef<number>(Date.now());
  const bagRef = useRef<{ min: number; max: number; arr: number[]; last: number | null }>({
    min: -1, max: -1, arr: [], last: null,
  });

  const icon = config.custom_icon_url
    ? <img src={config.custom_icon_url} alt="" className="w-16 h-16 object-contain inline-block" />
    : <span>{THEME_EMOJI[config.theme] ?? "🍎"}</span>;

  const drawTarget = useCallback(() => {
    const bag = bagRef.current;
    if (bag.min !== config.min_val || bag.max !== config.max_val || bag.arr.length === 0) {
      const arr: number[] = [];
      for (let i = config.min_val; i <= config.max_val; i++) arr.push(i);
      shuffle(arr);
      if (arr.length > 1 && arr[arr.length - 1] === bag.last) {
        const j = randInt(0, arr.length - 2);
        [arr[arr.length - 1], arr[j]] = [arr[j], arr[arr.length - 1]];
      }
      bagRef.current = { min: config.min_val, max: config.max_val, arr, last: bag.last };
    }
    const val = bagRef.current.arr.pop()!;
    bagRef.current.last = val;
    return val;
  }, [config.min_val, config.max_val]);

  const nextQuestion = useCallback(() => {
    if (qIndex >= config.total_questions) {
      setFinished(true);
      onComplete({
        score: correctCount,
        max_score: config.total_questions,
        time_spent_seconds: (Date.now() - startRef.current) / 1000,
        mistakes: mistakeCount,
        completed: true,
      });
      return;
    }
    const n = drawTarget();
    const want = Math.min(config.num_choices, config.max_val - config.min_val + 1);
    const candidates = new Set<number>([n]);
    let guard = 0;
    while (candidates.size < want && guard < 40) {
      guard++;
      const delta = randInt(1, Math.max(2, Math.round((config.max_val - config.min_val) / 3) || 2));
      const cand = Math.random() < 0.5 ? n - delta : n + delta;
      if (cand >= config.min_val && cand <= config.max_val + 5 && cand !== n) candidates.add(cand);
    }
    setTarget(n);
    setChoices(shuffle(Array.from(candidates)));
    setAttempts(0);
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
    const id = setInterval(() => {
      setElapsed((Date.now() - startRef.current) / 1000);
    }, 100);
    return () => clearInterval(id);
  }, [finished]);

  useEffect(() => {
    if (config.timer_mode !== "countdown" || !config.time_limit || finished) return;
    if (elapsed >= config.time_limit) {
      setFinished(true);
      onComplete({
        score: correctCount,
        max_score: config.total_questions,
        time_spent_seconds: elapsed,
        mistakes: mistakeCount,
        completed: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed]);

  function submitAnswer(val: number) {
    if (answered || finished) return;
    setAttempts((a) => a + 1);
    if (val === target) {
      setAnswered(true);
      setCorrectCount((c) => c + 1);
      setStreak((s) => s + 1);
      setStatus({ msg: streak + 1 >= 3 ? `🔥 连对 ${streak + 1} 题！` : "🎉 答对了！", kind: "good" });
      setTimeout(nextQuestion, 1100);
    } else {
      setStreak(0);
      setMistakeCount((m) => m + 1);
      if (attempts + 1 >= 2) {
        setStatus({ msg: `答案是 ${target}，再数一次吧～`, kind: "bad" });
        setAnswered(true);
        setTimeout(nextQuestion, 1400);
      } else {
        setStatus({ msg: "不对哦，再数一次看看～", kind: "bad" });
      }
    }
  }

  const timerLabel = config.timer_mode === "countdown" ? "剩余" : "用时";
  const timerValue = config.timer_mode === "countdown"
    ? Math.max(0, (config.time_limit ?? 0) - elapsed)
    : elapsed;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🎉</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          练习完成！答对 {correctCount} / {config.total_questions} 题
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3">
        <span>第 {qIndex} / {config.total_questions} 题</span>
        <span>✅ {correctCount}　⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      <div className="flex flex-wrap gap-5 justify-center items-center min-h-[220px] p-8 bg-amber-50 dark:bg-amber-950/20 rounded-2xl mb-5 shadow-lg ring-1 ring-black/5">
        {Array.from({ length: target }).map((_, i) => (
          <span key={i} className="text-6xl sm:text-7xl leading-none">{icon}</span>
        ))}
      </div>

      <div className="flex gap-4 justify-center mb-3">
        {choices.map((val) => (
          <button
            key={val}
            onClick={() => submitAnswer(val)}
            disabled={answered}
            className="text-3xl font-semibold px-10 py-6 rounded-2xl border-2 border-border bg-card hover:border-primary/50 disabled:cursor-default disabled:hover:border-border transition-colors min-w-[100px]"
          >
            {val}
          </button>
        ))}
      </div>

      {status.msg && (
        <div className={`text-center text-lg font-medium px-4 py-3 rounded-xl ${
          status.kind === "good" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
          : status.kind === "bad" ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
          : "bg-muted text-muted-foreground"
        }`}>
          {status.msg}
        </div>
      )}
    </div>
  );
}

