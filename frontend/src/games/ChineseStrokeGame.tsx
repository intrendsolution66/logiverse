// frontend/src/games/ChineseStrokeGame.tsx
//
// 中文字笔顺练习 — 固定字库(designer自己指定，比如教学大纲要求的那几百
// 个字)，每个字先看一遍笔顺动画演示，再让学生自己描着写，系统判断每一
// 笔写得对不对(顺序、方向、大致形状)。
//
// 笔顺数据和手写笔迹比对这两块——不自己重新发明，用业界现成的开源库
// hanzi-writer(MIT协议，很多中文学习类App背后都是用它)：
//   - hanzi-writer(运行时库)：负责画字、播放笔顺动画、判断学生画的每一
//     笔对不对。这个库本身不含字的笔顺数据，需要另外喂数据给它。
//   - hanzi-writer-data(数据源)：一个npm包，每个汉字一个独立json文件
//     (比如 你.json)，装完整个包大约47MB(9580个常用字)。这个项目只需要
//     designer指定的那几百个字，不需要整个包都塞进部署包里——用一次性
//     脚本(见部署说明)从这个包里挑出需要的字，放到
//     frontend/public/hanzi-data/ 这个自己的静态资源目录，运行时从自己
//     服务器读，不依赖外网CDN。以后designer往字库里加新字，重新跑一次
//     那个提取脚本、把新字的json文件加进去就行。
//
// 跟其它游戏不太一样的地方：这是固定字库的练习工具，不是"随机生成题
// 目、按对错升降难度"那一套——写字本来就没有"蒙对"这回事，学生跟着提示
// 一笔一笔写、写对了才能进入下一笔(hanzi-writer的quiz模式自带这个行
// 为，连续写错几次会自动提示正确笔画)，所以这里没有starting_level这个
// 自适应难度概念，分数就是"练完了几个字"，mistakes是纯统计参考、不影
// 响过关与否。
//
// i18n: zh/en/ms 已支持 — 见 frontend/src/lib/gameLocale.ts

import { useState, useEffect, useRef, useCallback } from "react";
import HanziWriter from "hanzi-writer";
import { eduApi } from "@/api";
import { type Locale, type Dict, t, questionProgress } from "@/lib/gameLocale";

const LOCAL: Record<string, Dict> = {
  watch_prompt:   { zh: "先看一遍笔顺是怎么写的", en: "Watch how to write this character first", ms: "Tonton dahulu cara menulis aksara ini" },
  watch_again:    { zh: "🔁 再看一次", en: "🔁 Watch again", ms: "🔁 Tonton semula" },
  start_practice: { zh: "✏️ 开始练习", en: "✏️ Start practicing", ms: "✏️ Mula berlatih" },
  practice_hint:  { zh: "跟着虚线描一笔，顺序、方向都要对哦", en: "Trace along the dashed guide — order and direction both matter", ms: "Ikut garis putus-putus — urutan dan arah kedua-duanya penting" },
  char_done:      { zh: "🎉 写对了！", en: "🎉 Well written!", ms: "🎉 Ditulis dengan baik!" },
  next_character: { zh: "下一个字", en: "Next character", ms: "Aksara seterusnya" },
  mistakes_count: { zh: "这个字写错了 {n} 次", en: "{n} mistakes on this character", ms: "{n} kesilapan pada aksara ini" },
  practice_done:  { zh: "练习完成！一共练了 {n} 个字", en: "Practice complete! {n} characters practiced", ms: "Latihan selesai! {n} aksara dilatih" },
  loading_char:   { zh: "加载中...", en: "Loading...", ms: "Memuatkan..." },
  load_failed:    { zh: "这个字的笔顺数据加载失败，跳到下一个", en: "Failed to load this character's data — skipping to the next", ms: "Gagal memuatkan data aksara ini — langkau ke seterusnya" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}

export interface ChineseStrokeConfig {
  characters: string[];       // designer指定的固定字库(至少1个字)
  total_questions: number;    // 每次玩练几个字(从characters里随机抽，字库不够total_questions时允许重复抽)
  timer_mode: "stopwatch" | "countdown";
  time_limit?: number | null;
  question_i18n?: { zh?: string; en?: string; ms?: string }; // 可选的额外说明文字(比如这个字的意思/用法)
}
export interface ChineseStrokeResult {
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

// 从字库里抽 total_questions 个字——字库数量够的话直接洗牌截取，字库比
// 需要的题数少的话循环重复填满(允许同一个字在一次练习里出现好几次，
// 总比"题数不够就提前结束"更符合"练够N个字"这个设计意图)。
function pickCharacters(pool: string[], count: number): string[] {
  if (pool.length === 0) return [];
  const result: string[] = [];
  let bag: string[] = [];
  while (result.length < count) {
    if (bag.length === 0) bag = shuffle(pool);
    result.push(bag.pop()!);
  }
  return result;
}

// 笔顺数据从后端接口拿——数据本身躺在后端服务器的node_modules里
// (hanzi-writer-data这个包，装成了后端依赖)，这个接口按需读某个字的
// json发回来。用这个方式而不是前端静态文件，是为了让designer在
// CourseDesignerPage随便加什么常用字都能立刻用，不需要额外跑脚本、
// 重新部署那一步——见 backend/src/modules/edu/hanzi.controller.ts。
const charDataLoader = (
  char: string,
  onLoad: (data: unknown) => void,
  onError: (err?: unknown) => void
) => {
  eduApi.getHanziStrokeData(char).then(onLoad).catch(onError);
};

type Phase = "loading" | "demo" | "quiz" | "char_done";

export default function ChineseStrokeGame({ config, onComplete, locale = "zh" }: {
  config: ChineseStrokeConfig; onComplete: (r: ChineseStrokeResult) => void; locale?: Locale;
}) {
  const total = Math.max(1, config.total_questions || 1);
  const [chars] = useState<string[]>(() => pickCharacters(config.characters ?? [], total));

  const [qIndex, setQIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("loading");
  const [charMistakes, setCharMistakes] = useState(0);   // 当前这个字写错了几次
  const [totalMistakes, setTotalMistakes] = useState(0); // 累计所有字的错误次数(纯统计，不影响分数)
  const [completedCount, setCompletedCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const writerRef = useRef<HanziWriter | null>(null);
  const startRef = useRef(Date.now());

  const currentChar = chars[qIndex];

  const finish = useCallback((completed: boolean) => {
    setFinished(true);
    onComplete({
      score: completedCount, max_score: total,
      time_spent_seconds: (Date.now() - startRef.current) / 1000,
      mistakes: totalMistakes, completed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedCount, totalMistakes, total]);

  useEffect(() => { startRef.current = Date.now(); }, []);

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

  // 每换一个字，重新创建一个全新的 HanziWriter 实例——比调用 setCharacter()
  // 切换字更省心，不用担心quiz模式的内部状态(当前第几笔、已经错了几次
  // 这些)有没有被正确重置，全新实例保证一定是干净的。
  useEffect(() => {
    if (!currentChar || !containerRef.current || finished) return;
    setPhase("loading");
    setCharMistakes(0);
    setLoadError(false);
    containerRef.current.innerHTML = ""; // 清掉上一个字残留的svg

    const writer = HanziWriter.create(containerRef.current, currentChar, {
      width: 280, height: 280, padding: 16,
      showOutline: true,
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 300,
      strokeColor: "#1e293b",
      outlineColor: "#e2e8f0",
      drawingColor: "#2563eb",
      highlightColor: "#93c5fd",
      charDataLoader,
    });
    writerRef.current = writer;

    // 字数据是异步加载的(从自己服务器fetch)，加载完才能真正开始播放
    // 演示动画——用 getCharacterData() 等它就绪，顺便捕捉"这个字没有
    // 数据文件"这种情况(比如designer往字库里加了新字，但忘了跑数据
    // 提取脚本)，给出明确的错误提示而不是卡住不动。
    writer.getCharacterData()
      .then(() => {
        setPhase("demo");
        writer.animateCharacter();
      })
      .catch(() => setLoadError(true));

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, currentChar, finished]);

  function replayDemo() {
    if (!writerRef.current) return;
    writerRef.current.animateCharacter();
  }

  function startQuiz() {
    const writer = writerRef.current;
    if (!writer) return;
    setPhase("quiz");
    writer.quiz({
      onMistake: () => {
        setCharMistakes((n) => n + 1);
        setTotalMistakes((n) => n + 1);
      },
      onComplete: () => {
        setPhase("char_done");
        setCompletedCount((n) => n + 1);
      },
    });
  }

  function nextCharacter() {
    if (qIndex + 1 >= total) { finish(true); return; }
    setQIndex((i) => i + 1);
  }

  const timerLabel = config.timer_mode === "countdown" ? t("time_left", locale) : t("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">✍️</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {lt("practice_done", locale, { n: completedCount })}
        </div>
      </div>
    );
  }

  if (!currentChar) return null;

  return (
    <div className="max-w-lg mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3">
        <span>{questionProgress(qIndex, total, locale)}</span>
        <span>⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      {(config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en) && (
        <p className="text-center text-lg font-semibold text-foreground mb-3">
          {config.question_i18n?.[locale] || config.question_i18n?.zh || config.question_i18n?.en}
        </p>
      )}

      <div className="bg-white dark:bg-card rounded-2xl p-5 mb-4 shadow-lg ring-1 ring-black/5 flex flex-col items-center">
        <div ref={containerRef} className="w-[280px] h-[280px] border-2 border-dashed border-slate-200 rounded-xl" />
        {loadError && (
          <p className="text-sm text-red-500 mt-3">{lt("load_failed", locale)}</p>
        )}
        {phase === "loading" && !loadError && (
          <p className="text-sm text-muted-foreground mt-3">{lt("loading_char", locale)}</p>
        )}
      </div>

      {loadError ? (
        <div className="flex justify-center">
          <button onClick={nextCharacter} className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors">
            {lt("next_character", locale)}
          </button>
        </div>
      ) : phase === "demo" ? (
        <div className="space-y-3">
          <p className="text-center text-sm text-muted-foreground">{lt("watch_prompt", locale)}</p>
          <div className="flex justify-center gap-3">
            <button onClick={replayDemo} className="text-sm font-medium px-4 py-2.5 rounded-xl border-2 border-border bg-card hover:border-primary/50 transition-colors">
              {lt("watch_again", locale)}
            </button>
            <button onClick={startQuiz} className="text-sm font-semibold px-4 py-2.5 rounded-xl bg-primary text-primary-foreground transition-colors">
              {lt("start_practice", locale)}
            </button>
          </div>
        </div>
      ) : phase === "quiz" ? (
        <div className="space-y-2">
          <p className="text-center text-sm text-muted-foreground">{lt("practice_hint", locale)}</p>
          {charMistakes > 0 && (
            <p className="text-center text-xs text-amber-600">{lt("mistakes_count", locale, { n: charMistakes })}</p>
          )}
        </div>
      ) : phase === "char_done" ? (
        <div className="space-y-4">
          <div className="text-center text-lg font-medium px-4 py-3 rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
            {lt("char_done", locale)}
            {charMistakes > 0 && <span className="block text-sm mt-1 opacity-80">{lt("mistakes_count", locale, { n: charMistakes })}</span>}
          </div>
          <div className="flex justify-center">
            <button onClick={nextCharacter} className="text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground transition-colors">
              {lt("next_character", locale)}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
