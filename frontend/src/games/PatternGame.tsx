// frontend/src/games/PatternGame.tsx
//
// 找规律 (pattern sequence). Shows a sequence following a repeating unit
// (AB, ABC, AAB, ABB, AABB — the unit's letters map to distinct icons from
// the chosen theme), asks what comes next. A shuffle bag rotates through
// the allowed pattern types across questions so the same shape doesn't
// repeat back-to-back.

import { useState, useEffect, useCallback, useRef } from "react";

export interface PatternConfig {
  theme: "shape" | "animal" | "fruit";
  pattern_types: string[];
  seq_length: number;
  num_choices: number;
  total_questions: number;
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
}
export interface PatternResult {
  score: number; max_score: number; time_spent_seconds: number; mistakes: number; completed: boolean;
}

const THEME_ICONS: Record<string, string[]> = {
  shape:  ["🔴","🔵","🟢","🟡","🟣","🟠"],
  animal: ["🐶","🐱","🐰","🐻","🦊","🐼"],
  fruit:  ["🍎","🍌","🍇","🍓","🍑","🍍"],
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function PatternGame({ config, onComplete }: {
  config: PatternConfig; onComplete: (r: PatternResult) => void;
}) {
  const icons = THEME_ICONS[config.theme] ?? THEME_ICONS.shape;

  const [qIndex, setQIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakeCount, setMistakeCount] = useState(0);
  const [seqIcons, setSeqIcons] = useState<string[]>([]);
  const [choiceIcons, setChoiceIcons] = useState<string[]>([]);
  const [answerIcon, setAnswerIcon] = useState("");
  const [answered, setAnswered] = useState(false);
  const [status, setStatus] = useState<{ msg: string; kind: "" | "good" | "bad" }>({ msg: "", kind: "" });
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);

  const startRef = useRef(Date.now());
  const bagRef = useRef<string[]>([]);

  const drawPatternType = useCallback(() => {
    if (bagRef.current.length === 0) bagRef.current = shuffle([...config.pattern_types]);
    return bagRef.current.pop()!;
  }, [config.pattern_types]);

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

    const patternType = drawPatternType();
    const letters = [...new Set(patternType.split(""))]; // e.g. ['A','B'] or ['A','B','C']
    const letterToIcon: Record<string, string> = {};
    shuffle(icons).slice(0, letters.length).forEach((icon, i) => { letterToIcon[letters[i]] = icon; });

    const seq: string[] = [];
    for (let i = 0; i < config.seq_length; i++) seq.push(patternType[i % patternType.length]);
    const nextLetter = patternType[config.seq_length % patternType.length];

    const wantChoices = Math.min(config.num_choices, letters.length);
    const distractorPool = letters.filter((l) => l !== nextLetter);
    const chosenLetters = shuffle([nextLetter, ...shuffle(distractorPool).slice(0, wantChoices - 1)]);

    setSeqIcons(seq.map((l) => letterToIcon[l]));
    setAnswerIcon(letterToIcon[nextLetter]);
    setChoiceIcons(shuffle(chosenLetters.map((l) => letterToIcon[l])));
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

  function submitAnswer(icon: string) {
    if (answered || finished) return;
    setAnswered(true);
    if (icon === answerIcon) {
      setCorrectCount((c) => c + 1);
      setStatus({ msg: "🎉 答对了！", kind: "good" });
    } else {
      setMistakeCount((m) => m + 1);
      setStatus({ msg: "不对哦，再看看规律吧～", kind: "bad" });
    }
    setTimeout(nextQuestion, 1100);
  }

  const timerLabel = config.timer_mode === "countdown" ? "剩余" : "用时";
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">🧩</div>
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

      <div className="flex flex-wrap gap-3 justify-center items-center min-h-[140px] p-6 bg-amber-50 dark:bg-amber-950/20 rounded-2xl mb-5">
        {seqIcons.map((icon, i) => (
          <span key={i} className="text-5xl leading-none">{icon}</span>
        ))}
        <span className="text-5xl leading-none flex items-center justify-center w-16 h-16 rounded-xl border-2 border-dashed border-muted-foreground/40 text-muted-foreground">?</span>
      </div>

      <div className="flex gap-4 justify-center mb-3">
        {choiceIcons.map((icon, i) => (
          <button
            key={i}
            onClick={() => submitAnswer(icon)}
            disabled={answered}
            className="text-4xl px-8 py-5 rounded-2xl border-2 border-border bg-card hover:border-primary/50 disabled:cursor-default disabled:hover:border-border transition-colors"
          >
            {icon}
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
