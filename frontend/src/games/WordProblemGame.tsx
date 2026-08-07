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
//
// i18n: zh/en/ms 已支持 — 见 frontend/src/lib/gameLocale.ts。这个文件是
// 试点里最大的一块，因为7种题型的题目文字都是"数字+中文语法"现场拼出来
// 的句子，不是查表就能翻译——每种题型、每种语言都各自写了一套拼句子的
// 模板(见每个 genXxx 函数)，共用的只有底下的数学生成逻辑(完全没动过，
// 跟v1验证过的数学正确性一致)。custom_scene模式(designer自己写的单一
// 题目)的文字是designer自己填的，不在这次翻译范围内，只翻了周围的UI。

import { useState, useEffect, useCallback, useRef } from "react";
import { eduApi } from "@/api";
import { GAME_CANVAS_W, GAME_CANVAS_H } from "@/lib/gameCanvas";
import { type Locale, type Dict, t, questionProgress } from "@/lib/gameLocale";

// 各题型共用的UI短语 + 量词翻译表(量词本来就是中文特有，英文/马来文大部
// 分不需要，留空即可，参照CubeLayerCountGame"个"这个量词的处理方式)。
const LOCAL: Record<string, Dict> = {
  confirm_answer:  { zh: "确认答案", en: "Confirm answer", ms: "Sahkan jawapan" },
  checking:        { zh: "检查中...", en: "Checking...", ms: "Menyemak..." },
  enter_answer:    { zh: "输入答案", en: "Enter answer", ms: "Masukkan jawapan" },
  answer_is:       { zh: "答案是 {a}", en: "The answer is {a}", ms: "Jawapannya ialah {a}" },
  practice_done:   { zh: "答对 {c} / {n} 题", en: "{c} / {n} correct", ms: "{c} / {n} betul" },
};
function lt(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = LOCAL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}
// 量词翻译——只翻中文原有那几个量词本身，不改变生成逻辑；英文/马来文
// 大部分数字后面不需要跟量词，留空字符串就是"不显示"。
const UNIT_TRANSLATIONS: Record<string, Dict> = {
  "只": { zh: "只", en: "", ms: "" },
  "头": { zh: "头", en: "", ms: "" },
  "小时": { zh: "小时", en: "hours", ms: "jam" },
  "千米": { zh: "千米", en: "km", ms: "km" },
  "天": { zh: "天", en: "days", ms: "hari" },
  "克": { zh: "克", en: "g", ms: "g" },
  "个": { zh: "个", en: "", ms: "" },
  "人": { zh: "人", en: "people", ms: "orang" },
};
function unitFor(zhUnit: string, locale: Locale): string {
  const entry = UNIT_TRANSLATIONS[zhUnit];
  if (!entry) return zhUnit;
  return entry[locale] ?? zhUnit;
}
// 两位数字补零，时间显示"H:0M"这种要用——中文"3点5分"不需要补零，英文/
// 马来文用"HH:MM"格式，5分要显示成05
function pad2(n: number): string { return String(n).padStart(2, "0"); }

export type WordProblemCategory = "chicken_rabbit" | "meeting_point" | "cow_grass" | "concentration" | "queue_position" | "queue_count" | "time_calc";

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
  queue_total_min?: number; queue_total_max?: number; // 排队序数: 队伍总人数范围
  queue_front_min?: number; queue_front_max?: number; // 排队人数: 前面人数范围
  queue_back_min?: number; queue_back_max?: number; // 排队人数: 后面人数范围
  time_dur_h_min?: number; time_dur_h_max?: number; // 时间计算: 经过的小时数范围
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

// ── Question generation (math unchanged from v1) ─────────────────────────────
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
interface QueuePositionQuestion {
  category: "queue_position";
  text: string; question: string; answer: number; unit: string;
  total: number; posFromFront: number; posFromBack: number; askFromBack: boolean;
}
interface QueueCountQuestion {
  category: "queue_count";
  text: string; question: string; answer: number; unit: string;
  front: number; back: number; total: number; askWhich: "total" | "front" | "back";
}
interface TimeCalcQuestion {
  category: "time_calc";
  text: string; question: string; answer: number; // 分钟数(0~1439)，答案语义由askWhich决定(是几点、还是经过多久)
  askWhich: "end" | "start" | "duration";
  startH: number; startM: number; durH: number; durM: number; endH: number; endM: number;
}
type Question = ChickenRabbitQuestion | MeetingPointQuestion | CowGrassQuestion | ConcentrationQuestion | QueuePositionQuestion | QueueCountQuestion | TimeCalcQuestion;

function divisorsOf(n: number): number[] {
  const divs: number[] = [];
  for (let i = 1; i <= n; i++) if (n % i === 0) divs.push(i);
  return divs;
}

// 牛吃草 (Newton's cow problem)
function genCowGrass(cfg: WordProblemConfig, locale: Locale): CowGrassQuestion {
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

  const scenarioText = {
    zh: `一片牧场的草每天匀速生长。<b>${N1}</b> 头牛吃 <b>${D1}</b> 天可以吃完牧场的草，<b>${N2}</b> 头牛吃 <b>${D2}</b> 天可以吃完牧场的草。`,
    en: `The grass in a pasture grows at a steady daily rate. <b>${N1}</b> cows can finish the grass in <b>${D1}</b> days; <b>${N2}</b> cows can finish it in <b>${D2}</b> days.`,
    ms: `Rumput di sebuah padang tumbuh pada kadar yang tetap setiap hari. <b>${N1}</b> ekor lembu boleh menghabiskan rumput dalam <b>${D1}</b> hari; <b>${N2}</b> ekor lembu boleh menghabiskannya dalam <b>${D2}</b> hari.`,
  }[locale];

  if (askDays) {
    return {
      category: "cow_grass", text: scenarioText,
      question: { zh: `如果有 <b>${N3}</b> 头牛，几天能吃完牧场的草？`, en: `If there are <b>${N3}</b> cows, how many days will it take to finish the grass?`, ms: `Jika ada <b>${N3}</b> ekor lembu, berapa hari diperlukan untuk menghabiskan rumput?` }[locale],
      answer: D3, unit: unitFor("天", locale),
      askDays: true, targetCows: N3, targetDays: D3,
    };
  }
  return {
    category: "cow_grass", text: scenarioText,
    question: { zh: `如果要 <b>${D3}</b> 天吃完牧场的草，需要多少头牛？`, en: `If the grass needs to be finished in <b>${D3}</b> days, how many cows are needed?`, ms: `Jika rumput perlu dihabiskan dalam <b>${D3}</b> hari, berapakah bilangan lembu yang diperlukan?` }[locale],
    answer: N3, unit: unitFor("头", locale),
    askDays: false, targetCows: N3, targetDays: D3,
  };
}

// 浓度问题
function genConcentration(cfg: WordProblemConfig, locale: Locale): ConcentrationQuestion {
  const c2 = randInt(cfg.conc_low_min ?? 5, cfg.conc_low_max ?? 20);
  const c1 = c2 + randInt(cfg.conc_gap_min ?? 5, cfg.conc_gap_max ?? 25);
  const k = randInt(2, 10);
  const M = k * c2;
  const waterToAdd = k * (c1 - c2);
  return {
    category: "concentration",
    text: { zh: `有 <b>${M}</b> 克浓度为 <b>${c1}%</b> 的盐水。`, en: `There is <b>${M}</b> grams of salt water at <b>${c1}%</b> concentration.`, ms: `Terdapat <b>${M}</b> gram air garam pada kepekatan <b>${c1}%</b>.` }[locale],
    question: { zh: `要把它稀释成浓度 <b>${c2}%</b> 的盐水，需要加多少克水？`, en: `How many grams of water need to be added to dilute it to <b>${c2}%</b>?`, ms: `Berapa gram air perlu ditambah untuk mencairkannya kepada kepekatan <b>${c2}%</b>?` }[locale],
    answer: waterToAdd, unit: unitFor("克", locale),
    originalMass: M, originalConc: c1, targetConc: c2,
  };
}

// 排队序数
function genQueuePosition(cfg: WordProblemConfig, locale: Locale): QueuePositionQuestion {
  const total = randInt(cfg.queue_total_min ?? 8, cfg.queue_total_max ?? 20);
  const posFromFront = randInt(1, total);
  const posFromBack = total - posFromFront + 1;
  const askFromBack = Math.random() < 0.5;
  if (askFromBack) {
    return {
      category: "queue_position",
      text: { zh: `一排队伍一共有 <b>${total}</b> 人，小明排在从队头数第 <b>${posFromFront}</b> 个。`, en: `A line has <b>${total}</b> people. Counting from the front, Xiaoming is at position <b>${posFromFront}</b>.`, ms: `Satu barisan mempunyai <b>${total}</b> orang. Dikira dari depan, Xiaoming berada di kedudukan <b>${posFromFront}</b>.` }[locale],
      question: { zh: "从队尾数，小明排第几个？", en: "Counting from the back, what position is Xiaoming at?", ms: "Dikira dari belakang, kedudukan ke berapakah Xiaoming?" }[locale],
      answer: posFromBack, unit: unitFor("个", locale),
      total, posFromFront, posFromBack, askFromBack,
    };
  }
  return {
    category: "queue_position",
    text: { zh: `一排队伍一共有 <b>${total}</b> 人，小明排在从队尾数第 <b>${posFromBack}</b> 个。`, en: `A line has <b>${total}</b> people. Counting from the back, Xiaoming is at position <b>${posFromBack}</b>.`, ms: `Satu barisan mempunyai <b>${total}</b> orang. Dikira dari belakang, Xiaoming berada di kedudukan <b>${posFromBack}</b>.` }[locale],
    question: { zh: "从队头数，小明排第几个？", en: "Counting from the front, what position is Xiaoming at?", ms: "Dikira dari depan, kedudukan ke berapakah Xiaoming?" }[locale],
    answer: posFromFront, unit: unitFor("个", locale),
    total, posFromFront, posFromBack, askFromBack,
  };
}

// 排队人数
function genQueueCount(cfg: WordProblemConfig, locale: Locale): QueueCountQuestion {
  const front = randInt(cfg.queue_front_min ?? 1, cfg.queue_front_max ?? 10);
  const back = randInt(cfg.queue_back_min ?? 1, cfg.queue_back_max ?? 10);
  const total = front + back + 1;
  const pick = Math.random();
  const askWhich: "total" | "front" | "back" = pick < 1 / 3 ? "total" : pick < 2 / 3 ? "front" : "back";

  if (askWhich === "total") {
    return {
      category: "queue_count",
      text: { zh: `排队时，小明前面有 <b>${front}</b> 人，后面有 <b>${back}</b> 人。`, en: `In a line, there are <b>${front}</b> people in front of Xiaoming and <b>${back}</b> behind him.`, ms: `Dalam satu barisan, terdapat <b>${front}</b> orang di hadapan Xiaoming dan <b>${back}</b> orang di belakangnya.` }[locale],
      question: { zh: "这一排队伍一共有多少人？", en: "How many people are in the line in total?", ms: "Berapakah jumlah orang dalam barisan itu?" }[locale],
      answer: total, unit: unitFor("人", locale), front, back, total, askWhich,
    };
  }
  if (askWhich === "front") {
    return {
      category: "queue_count",
      text: { zh: `一排队伍一共有 <b>${total}</b> 人，小明后面有 <b>${back}</b> 人。`, en: `A line has <b>${total}</b> people in total, with <b>${back}</b> behind Xiaoming.`, ms: `Satu barisan mempunyai jumlah <b>${total}</b> orang, dengan <b>${back}</b> orang di belakang Xiaoming.` }[locale],
      question: { zh: "小明前面有多少人？", en: "How many people are in front of Xiaoming?", ms: "Berapakah bilangan orang di hadapan Xiaoming?" }[locale],
      answer: front, unit: unitFor("人", locale), front, back, total, askWhich,
    };
  }
  return {
    category: "queue_count",
    text: { zh: `一排队伍一共有 <b>${total}</b> 人，小明前面有 <b>${front}</b> 人。`, en: `A line has <b>${total}</b> people in total, with <b>${front}</b> in front of Xiaoming.`, ms: `Satu barisan mempunyai jumlah <b>${total}</b> orang, dengan <b>${front}</b> orang di hadapan Xiaoming.` }[locale],
    question: { zh: "小明后面有多少人？", en: "How many people are behind Xiaoming?", ms: "Berapakah bilangan orang di belakang Xiaoming?" }[locale],
    answer: back, unit: unitFor("人", locale), front, back, total, askWhich,
  };
}

// 时间计算
function genTimeCalc(cfg: WordProblemConfig, locale: Locale): TimeCalcQuestion {
  const startH = randInt(0, 23);
  const startM = randInt(0, 11) * 5;
  const durH = randInt(cfg.time_dur_h_min ?? 0, cfg.time_dur_h_max ?? 3);
  let durM = randInt(0, 11) * 5;
  if (durH === 0 && durM === 0) durM = randInt(1, 11) * 5;

  const startTotal = startH * 60 + startM;
  const durTotal = durH * 60 + durM;
  const endTotal = (startTotal + durTotal) % (24 * 60);
  const endH = Math.floor(endTotal / 60), endM = endTotal % 60;

  const pick = Math.random();
  const askWhich: "end" | "start" | "duration" = pick < 1 / 3 ? "end" : pick < 2 / 3 ? "start" : "duration";

  // 中文"3点5分"不用补零，英文/马来文"HH:MM"格式要补零
  const startClock = locale === "zh" ? `${startH}点${startM}分` : `${startH}:${pad2(startM)}`;
  const endClock = locale === "zh" ? `${endH}点${endM}分` : `${endH}:${pad2(endM)}`;
  const durText = { zh: `${durH}小时${durM}分钟`, en: `${durH} hours ${durM} minutes`, ms: `${durH} jam ${durM} minit` }[locale];

  if (askWhich === "end") {
    return {
      category: "time_calc",
      text: { zh: `小明 <b>${startClock}</b> 开始做一件事，做了 <b>${durText}</b>。`, en: `Xiaoming started something at <b>${startClock}</b>, and it took <b>${durText}</b>.`, ms: `Xiaoming mula melakukan sesuatu pada pukul <b>${startClock}</b>, dan mengambil masa <b>${durText}</b>.` }[locale],
      question: { zh: "他几点做完？", en: "What time did he finish?", ms: "Pukul berapakah dia selesai?" }[locale],
      answer: endTotal, askWhich, startH, startM, durH, durM, endH, endM,
    };
  }
  if (askWhich === "start") {
    return {
      category: "time_calc",
      text: { zh: `小明做一件事用了 <b>${durText}</b>，做完的时候是 <b>${endClock}</b>。`, en: `Xiaoming spent <b>${durText}</b> on something, finishing at <b>${endClock}</b>.`, ms: `Xiaoming mengambil masa <b>${durText}</b> untuk melakukan sesuatu, selesai pada pukul <b>${endClock}</b>.` }[locale],
      question: { zh: "他是几点开始做的？", en: "What time did he start?", ms: "Pukul berapakah dia mula?" }[locale],
      answer: startTotal, askWhich, startH, startM, durH, durM, endH, endM,
    };
  }
  return {
    category: "time_calc",
    text: { zh: `小明 <b>${startClock}</b> 开始做一件事，<b>${endClock}</b> 做完。`, en: `Xiaoming started something at <b>${startClock}</b> and finished at <b>${endClock}</b>.`, ms: `Xiaoming mula melakukan sesuatu pada pukul <b>${startClock}</b> dan selesai pada pukul <b>${endClock}</b>.` }[locale],
    question: { zh: "他一共用了多长时间？", en: "How long did it take in total?", ms: "Berapa lamakah masa yang diambil?" }[locale],
    answer: durTotal, askWhich, startH, startM, durH, durM, endH, endM,
  };
}

function genChickenRabbit(cfg: WordProblemConfig, locale: Locale): ChickenRabbitQuestion {
  const c = randInt(cfg.chicken_min, cfg.chicken_max);
  const r = randInt(cfg.chicken_min, cfg.chicken_max);
  const H = c + r, L = 2 * c + 4 * r;
  const askChicken = Math.random() < 0.5;
  return {
    category: "chicken_rabbit",
    text: { zh: `笼子里关着一群鸡和兔子，从上面数一共有 <b>${H}</b> 个头，从下面数一共有 <b>${L}</b> 条腿。`, en: `A cage holds some chickens and rabbits. Counting heads gives <b>${H}</b> in total; counting legs gives <b>${L}</b> in total.`, ms: `Sebuah sangkar mengandungi beberapa ekor ayam dan arnab. Jika dikira kepala, jumlahnya <b>${H}</b>; jika dikira kaki, jumlahnya <b>${L}</b>.` }[locale],
    question: askChicken
      ? { zh: "鸡有多少只？", en: "How many chickens are there?", ms: "Berapakah bilangan ayam?" }[locale]
      : { zh: "兔子有多少只？", en: "How many rabbits are there?", ms: "Berapakah bilangan arnab?" }[locale],
    answer: askChicken ? c : r,
    unit: unitFor("只", locale),
    targetHeads: H, targetLegs: L, askChicken,
  };
}

function genMeetingPoint(cfg: WordProblemConfig, locale: Locale): MeetingPointQuestion {
  const tm = randInt(cfg.meet_time_min, cfg.meet_time_max);
  const v1 = randInt(cfg.speed_min, cfg.speed_max);
  const v2 = randInt(cfg.speed_min, cfg.speed_max);
  const D = tm * (v1 + v2);
  const askTime = Math.random() < 0.5;
  if (askTime) {
    return {
      category: "meeting_point",
      text: { zh: `甲、乙两地相距 <b>${D}</b> 千米，A车每小时行 <b>${v1}</b> 千米，B车每小时行 <b>${v2}</b> 千米，两车同时从两地相向而行。`, en: `Places A and B are <b>${D}</b> km apart. Car A travels <b>${v1}</b> km/h and Car B travels <b>${v2}</b> km/h, starting at the same time from each end and heading toward each other.`, ms: `Tempat A dan B berjarak <b>${D}</b> km. Kereta A bergerak <b>${v1}</b> km/j dan kereta B bergerak <b>${v2}</b> km/j, kedua-duanya bermula serentak dari hujung masing-masing dan bergerak ke arah satu sama lain.` }[locale],
      question: { zh: "几小时后两车相遇？", en: "How many hours until they meet?", ms: "Berapa jam sebelum kedua-duanya bertemu?" }[locale],
      answer: tm, unit: unitFor("小时", locale),
      distance: D, v1, v2, time: tm, askTime,
    };
  }
  return {
    category: "meeting_point",
    text: { zh: `A车每小时行 <b>${v1}</b> 千米，B车每小时行 <b>${v2}</b> 千米，两车同时从两地相向而行，<b>${tm}</b> 小时后相遇。`, en: `Car A travels <b>${v1}</b> km/h and Car B travels <b>${v2}</b> km/h, starting at the same time from each end and heading toward each other. They meet after <b>${tm}</b> hours.`, ms: `Kereta A bergerak <b>${v1}</b> km/j dan kereta B bergerak <b>${v2}</b> km/j, bermula serentak dari hujung masing-masing bergerak ke arah satu sama lain. Mereka bertemu selepas <b>${tm}</b> jam.` }[locale],
    question: { zh: "两地相距多少千米？", en: "How far apart are the two places?", ms: "Berapakah jarak antara kedua-dua tempat?" }[locale],
    answer: D, unit: unitFor("千米", locale),
    distance: D, v1, v2, time: tm, askTime,
  };
}

const GENERATORS: Record<WordProblemCategory, (cfg: WordProblemConfig, locale: Locale) => Question> = {
  chicken_rabbit: genChickenRabbit,
  meeting_point: genMeetingPoint,
  cow_grass: genCowGrass,
  concentration: genConcentration,
  queue_position: genQueuePosition,
  queue_count: genQueueCount,
  time_calc: genTimeCalc,
};

// ── Interactive UI: 鸡兔同笼 ───────────────────────────────────────────────────
function ChickenRabbitInteractive({ q, onSubmit, disabled, locale }: {
  q: ChickenRabbitQuestion; onSubmit: (val: number) => void; disabled: boolean; locale: Locale;
}) {
  const [chickens, setChickens] = useState(0);
  const [rabbits, setRabbits] = useState(0);
  const heads = chickens + rabbits;
  const legs = chickens * 2 + rabbits * 4;
  const headsMatch = heads === q.targetHeads;
  const legsMatch = legs === q.targetLegs;

  const L: Record<string, Dict> = {
    prompt:    { zh: "往笼子里加几只试试看", en: "Try adding some to the cage", ms: "Cuba tambah beberapa ke dalam sangkar" },
    chicken:   { zh: "🐔 鸡", en: "🐔 Chicken", ms: "🐔 Ayam" },
    rabbit:    { zh: "🐰 兔", en: "🐰 Rabbit", ms: "🐰 Arnab" },
    heads:     { zh: "头数 {a} / {b}", en: "Heads {a} / {b}", ms: "Kepala {a} / {b}" },
    legs:      { zh: "腿数 {a} / {b}", en: "Legs {a} / {b}", ms: "Kaki {a} / {b}" },
    confirm:   { zh: "确认答案：{who} {n} 只", en: "Confirm: {n} {who}", ms: "Sahkan: {n} {who}" },
  };
  const tt = (k: string, vars?: Record<string, string | number>) => {
    let s = L[k][locale];
    if (vars) Object.entries(vars).forEach(([kk, vv]) => { s = s.replaceAll(`{${kk}}`, String(vv)); });
    return s;
  };
  const whoLabel = q.askChicken ? { zh: "鸡", en: "chickens", ms: "ayam" }[locale] : { zh: "兔", en: "rabbits", ms: "arnab" }[locale];

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
        {heads === 0 && <span className="text-muted-foreground text-sm">{tt("prompt")}</span>}
      </div>

      <div className="flex gap-6 justify-center">
        <div className="flex items-center gap-2">
          <span className="text-lg">{tt("chicken")}</span>
          <button disabled={disabled} onClick={() => setChickens((c) => Math.max(0, c - 1))} className="w-9 h-9 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">−</button>
          <span className="w-8 text-center text-lg font-semibold">{chickens}</span>
          <button disabled={disabled} onClick={() => setChickens((c) => c + 1)} className="w-9 h-9 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">+</button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg">{tt("rabbit")}</span>
          <button disabled={disabled} onClick={() => setRabbits((r) => Math.max(0, r - 1))} className="w-9 h-9 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">−</button>
          <span className="w-8 text-center text-lg font-semibold">{rabbits}</span>
          <button disabled={disabled} onClick={() => setRabbits((r) => r + 1)} className="w-9 h-9 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">+</button>
        </div>
      </div>

      <div className="flex gap-4 justify-center text-sm font-medium">
        <span className={headsMatch ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
          {tt("heads", { a: heads, b: q.targetHeads })} {headsMatch && "✓"}
        </span>
        <span className={legsMatch ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
          {tt("legs", { a: legs, b: q.targetLegs })} {legsMatch && "✓"}
        </span>
      </div>

      <button
        onClick={() => onSubmit(q.askChicken ? chickens : rabbits)}
        disabled={disabled || heads === 0}
        className="block mx-auto text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
      >
        {tt("confirm", { who: whoLabel, n: q.askChicken ? chickens : rabbits })}
      </button>
    </div>
  );
}

// ── Interactive UI: 相遇问题 ───────────────────────────────────────────────────
function MeetingPointInteractive({ q, onSubmit, disabled, locale }: {
  q: MeetingPointQuestion; onSubmit: (val: number) => void; disabled: boolean; locale: Locale;
}) {
  const maxGuess = q.askTime ? q.time * 2 : q.distance * 2;
  const [guess, setGuess] = useState(0);

  const roadLength = q.askTime ? q.distance : Math.max(guess, q.distance, 1);
  const posA = q.askTime ? guess * q.v1 : q.time * q.v1;
  const posB = q.askTime ? guess * q.v2 : q.time * q.v2;
  const gap = roadLength - posA - posB;
  const met = Math.abs(gap) < 0.01;

  const pctA = Math.min(100, (posA / roadLength) * 100);
  const pctB = Math.min(100, (posB / roadLength) * 100);

  const L: Record<string, Dict> = {
    start_a:  { zh: "起点A", en: "Start A", ms: "Mula A" },
    start_b:  { zh: "起点B", en: "Start B", ms: "Mula B" },
    drag_time: { zh: "拖动时间：{n} 小时", en: "Drag time: {n} hours", ms: "Seret masa: {n} jam" },
    drag_dist: { zh: "拖动距离：{n} 千米", en: "Drag distance: {n} km", ms: "Seret jarak: {n} km" },
    met:       { zh: "两车正好相遇！✓", en: "The cars just met! ✓", ms: "Kereta baru sahaja bertemu! ✓" },
    still_gap: { zh: "还差 {n} 千米", en: "{n} km left to go", ms: "{n} km lagi" },
    overshot:  { zh: "已经相遇过了", en: "They've already met", ms: "Sudah bertemu" },
    confirm_time: { zh: "确认答案：{n} 小时", en: "Confirm: {n} hours", ms: "Sahkan: {n} jam" },
    confirm_dist: { zh: "确认答案：{n} 千米", en: "Confirm: {n} km", ms: "Sahkan: {n} km" },
  };
  const tt = (k: string, vars?: Record<string, string | number>) => {
    let s = L[k][locale];
    if (vars) Object.entries(vars).forEach(([kk, vv]) => { s = s.replaceAll(`{${kk}}`, String(vv)); });
    return s;
  };

  return (
    <div className="space-y-4">
      <div className="relative h-16 bg-card rounded-xl border-2 border-border mx-2">
        <div className="absolute left-2 -top-6 text-xs text-muted-foreground">{tt("start_a")}</div>
        <div className="absolute right-2 -top-6 text-xs text-muted-foreground">{tt("start_b")}</div>
        <div className="absolute top-1/2 -translate-y-1/2 text-2xl transition-all duration-150" style={{ left: `calc(${pctA}% - 12px)` }}>🚗</div>
        <div className="absolute top-1/2 -translate-y-1/2 text-2xl -scale-x-100 transition-all duration-150" style={{ right: `calc(${pctB}% - 12px)` }}>🚗</div>
      </div>

      <input
        type="range" min={0} max={Math.max(1, maxGuess)} step={q.askTime ? 0.1 : 1}
        value={guess} disabled={disabled}
        onChange={(e) => setGuess(Number(e.target.value))}
        className="w-full"
      />

      <p className="text-center text-sm font-medium">
        {q.askTime ? tt("drag_time", { n: guess.toFixed(1) }) : tt("drag_dist", { n: guess })}
        {"　"}
        <span className={met ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
          {met ? tt("met") : gap > 0 ? tt("still_gap", { n: gap.toFixed(1) }) : tt("overshot")}
        </span>
      </p>

      <button
        onClick={() => onSubmit(q.askTime ? Number(guess.toFixed(1)) : guess)}
        disabled={disabled}
        className="block mx-auto text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
      >
        {q.askTime ? tt("confirm_time", { n: guess.toFixed(1) }) : tt("confirm_dist", { n: guess })}
      </button>
    </div>
  );
}

// ── Interactive UI: 牛吃草 ─────────────────────────────────────────────────────
function CowGrassInteractive({ q, onSubmit, disabled, locale }: {
  q: CowGrassQuestion; onSubmit: (val: number) => void; disabled: boolean; locale: Locale;
}) {
  const [guess, setGuess] = useState(1);
  const L: Record<string, Dict> = {
    days_label:  { zh: "🐄🐄🐄 吃完的天数", en: "🐄🐄🐄 Days to finish", ms: "🐄🐄🐄 Hari untuk habis" },
    cows_label:  { zh: "🌾 需要的牛数", en: "🌾 Cows needed", ms: "🌾 Lembu diperlukan" },
    unit_days:   { zh: "天", en: "days", ms: "hari" },
    unit_cows:   { zh: "头牛", en: "cows", ms: "ekor lembu" },
    confirm:     { zh: "确认答案：{n} {unit}", en: "Confirm: {n} {unit}", ms: "Sahkan: {n} {unit}" },
  };
  const tt = (k: string, vars?: Record<string, string | number>) => {
    let s = L[k][locale];
    if (vars) Object.entries(vars).forEach(([kk, vv]) => { s = s.replaceAll(`{${kk}}`, String(vv)); });
    return s;
  };
  const unit = q.askDays ? tt("unit_days") : tt("unit_cows");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-3">
        <span className="text-lg">{q.askDays ? tt("days_label") : tt("cows_label")}</span>
        <button disabled={disabled} onClick={() => setGuess((v) => Math.max(1, v - 1))} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">−</button>
        <span className="w-14 text-center text-2xl font-bold">{guess}</span>
        <button disabled={disabled} onClick={() => setGuess((v) => v + 1)} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">+</button>
        <span className="text-lg text-muted-foreground">{unit}</span>
      </div>
      <button
        onClick={() => onSubmit(guess)}
        disabled={disabled}
        className="block mx-auto text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
      >
        {tt("confirm", { n: guess, unit })}
      </button>
    </div>
  );
}

// ── Interactive UI: 浓度问题 ───────────────────────────────────────────────────
function ConcentrationInteractive({ q, onSubmit, disabled, locale }: {
  q: ConcentrationQuestion; onSubmit: (val: number) => void; disabled: boolean; locale: Locale;
}) {
  const maxWater = q.originalMass * 3;
  const [water, setWater] = useState(0);
  const saltGrams = (q.originalMass * q.originalConc) / 100;
  const resultConc = (saltGrams / (q.originalMass + water)) * 100;
  const matched = Math.abs(resultConc - q.targetConc) < 0.05;

  const L: Record<string, Dict> = {
    salt_fixed:  { zh: "盐的重量固定不变（{g}克），加水只会让它变淡", en: "The salt stays fixed ({g}g) — adding water only dilutes it", ms: "Berat garam kekal tetap ({g}g) — menambah air hanya mencairkannya" },
    add_water:   { zh: "加水：{n} 克", en: "Water added: {n} g", ms: "Air ditambah: {n} g" },
    now_conc:    { zh: "现在浓度 {a}%（目标 {b}%）", en: "Now {a}% (target {b}%)", ms: "Sekarang {a}% (sasaran {b}%)" },
    confirm:     { zh: "确认答案：加水 {n} 克", en: "Confirm: add {n} g water", ms: "Sahkan: tambah {n} g air" },
  };
  const tt = (k: string, vars?: Record<string, string | number>) => {
    let s = L[k][locale];
    if (vars) Object.entries(vars).forEach(([kk, vv]) => { s = s.replaceAll(`{${kk}}`, String(vv)); });
    return s;
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <span className="text-3xl">🧂💧</span>
        <p className="text-sm text-muted-foreground mt-1">{tt("salt_fixed", { g: saltGrams.toFixed(1) })}</p>
      </div>
      <input
        type="range" min={0} max={Math.max(1, maxWater)} step={1}
        value={water} disabled={disabled}
        onChange={(e) => setWater(Number(e.target.value))}
        className="w-full"
      />
      <p className="text-center text-sm font-medium">
        {tt("add_water", { n: water })}　
        <span className={matched ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
          {tt("now_conc", { a: resultConc.toFixed(1), b: q.targetConc })}{matched && " ✓"}
        </span>
      </p>
      <button
        onClick={() => onSubmit(water)}
        disabled={disabled}
        className="block mx-auto text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
      >
        {tt("confirm", { n: water })}
      </button>
    </div>
  );
}

// ── Interactive UI: 排队序数 ───────────────────────────────────────────────────
function QueuePositionInteractive({ q, onSubmit, disabled, locale }: {
  q: QueuePositionQuestion; onSubmit: (val: number) => void; disabled: boolean; locale: Locale;
}) {
  const [guess, setGuess] = useState(1);
  const targetFromFront = q.posFromFront;
  const guessedFromFront = q.askFromBack ? q.total - guess + 1 : guess;
  const matched = guessedFromFront === targetFromFront;

  const L: Record<string, Dict> = {
    front:      { zh: "队头", en: "Front", ms: "Depan" },
    back:       { zh: "队尾", en: "Back", ms: "Belakang" },
    ask_back:   { zh: "从队尾数第几个", en: "Position from the back", ms: "Kedudukan dari belakang" },
    ask_front:  { zh: "从队头数第几个", en: "Position from the front", ms: "Kedudukan dari depan" },
    matched:    { zh: "对上小明的位置了！✓", en: "That matches Xiaoming's spot! ✓", ms: "Sepadan dengan kedudukan Xiaoming! ✓" },
    not_yet:    { zh: "调整一下，看看是不是对上小明的位置", en: "Adjust and see if it matches Xiaoming's spot", ms: "Laraskan dan lihat jika ia sepadan dengan kedudukan Xiaoming" },
    confirm:    { zh: "确认答案：第 {n} 个", en: "Confirm: position {n}", ms: "Sahkan: kedudukan {n}" },
  };
  const tt = (k: string, vars?: Record<string, string | number>) => {
    let s = L[k][locale];
    if (vars) Object.entries(vars).forEach(([kk, vv]) => { s = s.replaceAll(`{${kk}}`, String(vv)); });
    return s;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 overflow-x-auto px-2 py-3 justify-start sm:justify-center">
        <span className="text-xs text-muted-foreground mr-1 shrink-0">{tt("front")}</span>
        {Array.from({ length: q.total }, (_, i) => i + 1).map((pos) => {
          const isTarget = pos === targetFromFront;
          const isGuess = pos === guessedFromFront && !isTarget;
          return (
            <span
              key={pos}
              className={`text-2xl shrink-0 rounded-full ${isTarget ? "ring-2 ring-amber-400 bg-amber-50" : isGuess ? "ring-2 ring-sky-400 bg-sky-50" : ""}`}
            >
              {isTarget ? "🧑‍🦱" : "🧍"}
            </span>
          );
        })}
        <span className="text-xs text-muted-foreground ml-1 shrink-0">{tt("back")}</span>
      </div>

      <div className="flex items-center justify-center gap-3">
        <span className="text-lg">{q.askFromBack ? tt("ask_back") : tt("ask_front")}</span>
        <button disabled={disabled} onClick={() => setGuess((v) => Math.max(1, v - 1))} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">−</button>
        <span className="w-10 text-center text-2xl font-bold">{guess}</span>
        <button disabled={disabled} onClick={() => setGuess((v) => Math.min(q.total, v + 1))} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">+</button>
      </div>

      <p className="text-center text-sm font-medium">
        <span className={matched ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
          {matched ? tt("matched") : tt("not_yet")}
        </span>
      </p>

      <button
        onClick={() => onSubmit(guess)}
        disabled={disabled}
        className="block mx-auto text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
      >
        {tt("confirm", { n: guess })}
      </button>
    </div>
  );
}

// ── Interactive UI: 排队人数 ───────────────────────────────────────────────────
function QueueCountInteractive({ q, onSubmit, disabled, locale }: {
  q: QueueCountQuestion; onSubmit: (val: number) => void; disabled: boolean; locale: Locale;
}) {
  const [guess, setGuess] = useState(0);
  const targetValue = q.askWhich === "total" ? q.total : q.askWhich === "front" ? q.front : q.back;
  const matched = guess === targetValue;
  const meIndex = q.front + 1;

  const L: Record<string, Dict> = {
    front:       { zh: "队头", en: "Front", ms: "Depan" },
    back:        { zh: "队尾", en: "Back", ms: "Belakang" },
    label_total: { zh: "队伍总人数", en: "Total people", ms: "Jumlah orang" },
    label_front: { zh: "小明前面的人数", en: "People in front of Xiaoming", ms: "Orang di hadapan Xiaoming" },
    label_back:  { zh: "小明后面的人数", en: "People behind Xiaoming", ms: "Orang di belakang Xiaoming" },
    matched:     { zh: "数对了！✓", en: "Correct count! ✓", ms: "Kiraan betul! ✓" },
    try_count:   { zh: "数一数队伍里的小人试试看", en: "Try counting the people in line", ms: "Cuba kira orang dalam barisan" },
    confirm:     { zh: "确认答案：{n} 人", en: "Confirm: {n} people", ms: "Sahkan: {n} orang" },
  };
  const tt = (k: string, vars?: Record<string, string | number>) => {
    let s = L[k][locale];
    if (vars) Object.entries(vars).forEach(([kk, vv]) => { s = s.replaceAll(`{${kk}}`, String(vv)); });
    return s;
  };
  const label = q.askWhich === "total" ? tt("label_total") : q.askWhich === "front" ? tt("label_front") : tt("label_back");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 overflow-x-auto px-2 py-3 justify-start sm:justify-center">
        <span className="text-xs text-muted-foreground mr-1 shrink-0">{tt("front")}</span>
        {Array.from({ length: q.total }, (_, i) => i + 1).map((pos) => (
          <span key={pos} className="text-2xl shrink-0">{pos === meIndex ? "🧑‍🦱" : "🧍"}</span>
        ))}
        <span className="text-xs text-muted-foreground ml-1 shrink-0">{tt("back")}</span>
      </div>

      <div className="flex items-center justify-center gap-3">
        <span className="text-lg">{label}</span>
        <button disabled={disabled} onClick={() => setGuess((v) => Math.max(0, v - 1))} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">−</button>
        <span className="w-10 text-center text-2xl font-bold">{guess}</span>
        <button disabled={disabled} onClick={() => setGuess((v) => v + 1)} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">+</button>
        <span className="text-lg text-muted-foreground">{{ zh: "人", en: "", ms: "" }[locale]}</span>
      </div>

      <p className="text-center text-sm font-medium">
        <span className={matched ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
          {matched ? tt("matched") : tt("try_count")}
        </span>
      </p>

      <button
        onClick={() => onSubmit(guess)}
        disabled={disabled}
        className="block mx-auto text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
      >
        {tt("confirm", { n: guess })}
      </button>
    </div>
  );
}

// ── Interactive UI: 时间计算 ───────────────────────────────────────────────────
function TimeCalcInteractive({ q, onSubmit, disabled, locale }: {
  q: TimeCalcQuestion; onSubmit: (val: number) => void; disabled: boolean; locale: Locale;
}) {
  const [h, setH] = useState(0);
  const [m, setM] = useState(0);
  const isDuration = q.askWhich === "duration";
  const maxHour = 23;
  const guessTotal = h * 60 + m;
  const matched = guessTotal === q.answer;

  const L: Record<string, Dict> = {
    hour_unit_clock: { zh: "点", en: "", ms: "" }, // 英文/马来文用 h:mm 格式显示，不需要"点"这个字
    hour_unit_dur:   { zh: "小时", en: "h", ms: "j" },
    min_unit_clock:  { zh: "分", en: "min", ms: "min" },
    min_unit_dur:    { zh: "分钟", en: "min", ms: "min" },
    your_pick:       { zh: "你选的是 {t}", en: "You picked {t}", ms: "Anda pilih {t}" },
    confirm:         { zh: "确认答案", en: "Confirm answer", ms: "Sahkan jawapan" },
  };
  const tt = (k: string, vars?: Record<string, string | number>) => {
    let s = L[k][locale];
    if (vars) Object.entries(vars).forEach(([kk, vv]) => { s = s.replaceAll(`{${kk}}`, String(vv)); });
    return s;
  };

  const hourUnit = isDuration ? tt("hour_unit_dur") : tt("hour_unit_clock");
  const minUnit = isDuration ? tt("min_unit_dur") : tt("min_unit_clock");
  // 英文/马来文用 H:MM 格式(补零)更符合习惯，中文用"H点M分"
  const displayTime = locale === "zh"
    ? `${h}${hourUnit}${m}${minUnit}`
    : isDuration ? `${h}${hourUnit} ${m}${minUnit}` : `${h}:${pad2(m)}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-6 flex-wrap">
        <div className="flex items-center gap-2">
          <button disabled={disabled} onClick={() => setH((v) => Math.max(0, v - 1))} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">−</button>
          <span className="w-16 text-center text-2xl font-bold">{h}{hourUnit}</span>
          <button disabled={disabled} onClick={() => setH((v) => Math.min(maxHour, v + 1))} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">+</button>
        </div>
        <div className="flex items-center gap-2">
          <button disabled={disabled} onClick={() => setM((v) => Math.max(0, v - 5))} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">−</button>
          <span className="w-20 text-center text-2xl font-bold">{m}{minUnit}</span>
          <button disabled={disabled} onClick={() => setM((v) => Math.min(55, v + 5))} className="w-10 h-10 rounded-lg border-2 border-border bg-card text-lg font-semibold disabled:opacity-50">+</button>
        </div>
      </div>

      <p className="text-center text-sm font-medium">
        <span className={matched ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
          {tt("your_pick", { t: displayTime })}{matched ? "　✓" : ""}
        </span>
      </p>

      <button
        onClick={() => onSubmit(guessTotal)}
        disabled={disabled}
        className="block mx-auto text-lg font-semibold px-8 py-3 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
      >
        {tt("confirm")}
      </button>
    </div>
  );
}

// ── 自定义题目 (authored) ────────────────────────────────────────────────────────
// designer自己写的题目文字(problem_text/question_text)不在这次翻译范围内
// (跟CubeFreeRotateGame的question_i18n是同一类情况——authored内容，另外
// 一套机制)，这里只翻了周围的UI控件文字。
function CustomWordProblemGame({ levelId, config, onComplete, locale }: {
  levelId: string; config: WordProblemConfig; onComplete: (r: WordProblemResult) => void; locale: Locale;
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
        <span>⏱️ {t("time_used", locale)} {elapsed.toFixed(1)}s</span>
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
          {(config.texts ?? []).map((tx, i) => (
            <span
              key={`text-${i}`} className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap"
              style={{ left: `${tx.x * 100}%`, top: `${tx.y * 100}%`, fontSize: `${(tx.fontSize / GAME_CANVAS_H) * 100}cqh`, color: tx.color, fontFamily: tx.fontFamily, transform: `translate(-50%, -50%) rotate(${tx.rotation ?? 0}deg)` }}
            >
              {tx.text}
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
            placeholder={lt("enter_answer", locale)} className="w-32 text-center text-2xl font-bold px-3 py-2 rounded-xl border-2 border-border bg-card"
          />
          {config.unit && <span className="text-lg text-muted-foreground">{config.unit}</span>}
          <button
            onClick={handleSubmit} disabled={checking || !answer}
            className="text-lg font-semibold px-6 py-2.5 rounded-2xl bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
          >
            {checking ? lt("checking", locale) : `✅ ${t("submit", locale)}`}
          </button>
        </div>
      ) : (
        <div className={`text-center text-lg font-medium px-4 py-3 rounded-xl ${
          result?.correct ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
          : "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
        }`}>
          {result?.correct ? t("correct_exclaim", locale) : lt("answer_is", locale, { a: `${result?.answer} ${config.unit ?? ""}` })}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function WordProblemGame({ levelId, config, onComplete, locale = "zh" }: {
  levelId: string; config: WordProblemConfig; onComplete: (r: WordProblemResult) => void; locale?: Locale;
}) {
  if (config.mode === "custom_scene") {
    return <CustomWordProblemGame levelId={levelId} config={config} onComplete={onComplete} locale={locale} />;
  }
  return <RandomWordProblemGame config={config} onComplete={onComplete} locale={locale} />;
}

function RandomWordProblemGame({ config, onComplete, locale }: {
  config: WordProblemConfig; onComplete: (r: WordProblemResult) => void; locale: Locale;
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
    setQuestion(GENERATORS[category](config, locale));
    setAnswered(false);
    setStatus({ msg: "", kind: "" });
    setQIndex((i) => i + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, locale]);

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

  // time_calc的answer是"从0点起算的分钟数"，答错时提示语要转回人看得懂
  // 的格式，不能直接照其他题型那样拼"数字+单位"。
  function formatTimeAnswer(q: TimeCalcQuestion): string {
    const h = Math.floor(q.answer / 60), m = q.answer % 60;
    if (locale === "zh") return q.askWhich === "duration" ? `${h}小时${m}分钟` : `${h}点${m}分`;
    if (q.askWhich === "duration") return locale === "en" ? `${h}h ${m}min` : `${h}j ${m}min`;
    return `${h}:${pad2(m)}`;
  }

  function submitAnswer(val: number) {
    if (answered || finished || !question) return;
    setAnswered(true);
    if (val === question.answer) {
      setCorrectCount((c) => c + 1);
      setStatus({ msg: t("correct_exclaim", locale), kind: "good" });
    } else {
      setMistakeCount((m) => m + 1);
      const answerText = question.category === "time_calc" ? formatTimeAnswer(question) : `${question.answer} ${question.unit}`;
      setStatus({ msg: lt("answer_is", locale, { a: answerText }), kind: "bad" });
    }
    setTimeout(nextQuestion, 1600);
  }

  const timerLabel = config.timer_mode === "countdown" ? t("time_left", locale) : t("time_used", locale);
  const timerValue = config.timer_mode === "countdown" ? Math.max(0, (config.time_limit ?? 0) - elapsed) : elapsed;

  if (finished) {
    return (
      <div className="text-center py-10">
        <div className="text-6xl">📝</div>
        <div className="text-xl font-semibold mt-3 text-foreground">
          {t("practice_complete", locale)}{lt("practice_done", locale, { c: correctCount, n: config.total_questions })}
        </div>
      </div>
    );
  }

  if (!question) return null;

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="flex justify-between text-base font-medium text-muted-foreground mb-3">
        <span>{questionProgress(qIndex, config.total_questions, locale)}</span>
        <span>✅ {correctCount}　⏱️ {timerLabel} {timerValue.toFixed(1)}s</span>
      </div>

      <div className="p-6 bg-amber-50 dark:bg-amber-950/20 rounded-2xl mb-5 space-y-3">
        <p className="text-lg leading-relaxed" dangerouslySetInnerHTML={{ __html: question.text }} />
        <p className="text-lg font-semibold text-foreground">{question.question}</p>
      </div>

      {question.category === "chicken_rabbit" ? (
        <ChickenRabbitInteractive q={question} onSubmit={submitAnswer} disabled={answered} locale={locale} />
      ) : question.category === "meeting_point" ? (
        <MeetingPointInteractive q={question} onSubmit={submitAnswer} disabled={answered} locale={locale} />
      ) : question.category === "cow_grass" ? (
        <CowGrassInteractive q={question} onSubmit={submitAnswer} disabled={answered} locale={locale} />
      ) : question.category === "concentration" ? (
        <ConcentrationInteractive q={question} onSubmit={submitAnswer} disabled={answered} locale={locale} />
      ) : question.category === "queue_position" ? (
        <QueuePositionInteractive q={question} onSubmit={submitAnswer} disabled={answered} locale={locale} />
      ) : question.category === "queue_count" ? (
        <QueueCountInteractive q={question} onSubmit={submitAnswer} disabled={answered} locale={locale} />
      ) : (
        <TimeCalcInteractive q={question} onSubmit={submitAnswer} disabled={answered} locale={locale} />
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
