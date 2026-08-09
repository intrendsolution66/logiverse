// frontend/src/pages/edu/LevelPlayerPage.tsx
//
// 视觉上跟后台管理页面用同一套配色（青蓝主色调、圆角卡片），但保持全屏
// 沉浸式布局，不套 AdminLayout 侧边栏——游戏/视频播放需要专注，侧边栏
// 导航会打断学习节奏。
//
// 顺便修了一个之前发现的bug：KNOWN_MODULES 之前没包含 ppt_lecture /
// video_lecture，导致从 /play/:id 直接打开视频/PPT讲义类型的Activity会
// 显示"还没有对应引擎"。现在补上，复用 Discovery 那边已经写好的
// VideoPlayer / PptReader 组件，不用重新做播放器。

import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { eduApi } from "@/api";
import CountingGame, { type CountingConfig, type CountingResult } from "@/games/CountingGame";
import SpotDiffGame, { type SpotDiffConfig, type SpotDiffResult } from "@/games/SpotDiffGame";
import FocusTapGame, { type FocusTapConfig, type FocusTapResult } from "@/games/FocusTapGame";
import MemoryGame, { type MemoryConfig, type MemoryResult } from "@/games/MemoryGame";
import PatternGame, { type PatternConfig, type PatternResult } from "@/games/PatternGame";
import WordProblemGame, { type WordProblemConfig, type WordProblemResult } from "@/games/WordProblemGame";
import MazeGame, { type MazeConfig, type MazeResult } from "@/games/MazeGame";
import NumberMazeGame, { type NumberMazeConfig, type NumberMazeResult } from "@/games/NumberMazeGame";
import SudokuGame, { type SudokuConfig, type SudokuResult } from "@/games/SudokuGame";
import LineMatchGame, { type LineMatchConfig, type LineMatchResult } from "@/games/LineMatchGame";
import ColoringGame, { type ColoringConfig, type ColoringResult } from "@/games/ColoringGame";
import StickerGame, { type StickerGameConfig, type StickerGameResult } from "@/games/StickerGame";
import CubeStackGame, { type CubeStackConfig, type CubeStackResult } from "@/games/CubeStackGame";
import CubeLayerCountGame, { type CubeLayerCountConfig, type CubeLayerCountResult } from "@/games/CubeLayerCountGame";
import CubeFindHiddenGame, { type CubeFindHiddenConfig, type CubeFindHiddenResult } from "@/games/CubeFindHiddenGame";
import CubeFreeRotateGame, { type CubeFreeRotateConfig, type CubeFreeRotateResult } from "@/games/CubeFreeRotateGame";
import CubeBuildGame, { type CubeBuildConfig, type CubeBuildResult } from "@/games/CubeBuildGame";
import CubeThreeViewGame, { type CubeThreeViewConfig, type CubeThreeViewResult } from "@/games/CubeThreeViewGame";
import ShapeCountGame, { type ShapeCountConfig, type ShapeCountResult } from "@/games/ShapeCountGame";
import ClockGame, { type ClockConfig, type ClockResult } from "@/games/ClockGame";
import LatinSquareGame, { type LatinSquareConfig, type LatinSquareResult } from "@/games/LatinSquareGame";
import NumberFindGame, { type NumberFindConfig, type NumberFindResult } from "@/games/NumberFindGame";
import NumberSequenceGame, { type NumberSequenceConfig, type NumberSequenceResult } from "@/games/NumberSequenceGame";
import NumberBondGame, { type NumberBondConfig, type NumberBondResult } from "@/games/NumberBondGame";
import NumberCompareGame, { type NumberCompareConfig, type NumberCompareResult } from "@/games/NumberCompareGame";
import NumberAdditionGame, { type NumberAdditionConfig, type NumberAdditionResult } from "@/games/NumberAdditionGame";
import ChineseStrokeGame, { type ChineseStrokeConfig, type ChineseStrokeResult } from "@/games/ChineseStrokeGame";
import { useGameLocale, LOCALE_LABELS, ALL_LOCALES, I18N_READY_MODULES, type Dict } from "@/lib/gameLocale";

// 这一圈"外层壳"的文字(待机封面+顶部控制按钮)——只有玩i18n已经接入的
// 游戏(isI18nReady)时才会真的切换语言，其他游戏保持原来的中文不受影响
// (见下面 shellLocale 的算法：不是ready的游戏，shellLocale永远固定是zh)。
// 排行榜/自己的记录两个弹窗内部的详细文字这次没有涵盖，还是中文——那
// 部分内容更多，之后要做再单独排期。
const SHELL: Record<string, Dict> = {
  ready_title:   { zh: "准备好了吗？", en: "Ready?", ms: "Sudah sedia?" },
  ready_hint:    { zh: "按下面的\"开始\"就可以进入游戏啦", en: "Press \"Start\" below to begin", ms: "Tekan \"Mula\" di bawah untuk bermula" },
  start_button:  { zh: "▶️ 开始", en: "▶️ Start", ms: "▶️ Mula" },
  my_records:    { zh: "📊 自己记录", en: "📊 My records", ms: "📊 Rekod saya" },
  leaderboard:   { zh: "🏆 排行榜", en: "🏆 Leaderboard", ms: "🏆 Papan pendahulu" },
  replay:        { zh: "🔄 重玩", en: "🔄 Replay", ms: "🔄 Main semula" },
  exit:          { zh: "🚪 退出", en: "🚪 Exit", ms: "🚪 Keluar" },
  back_designer: { zh: "← 返回设计器", en: "← Back to designer", ms: "← Kembali ke pereka" },
  back:          { zh: "返回", en: "Back", ms: "Kembali" },
  view_explain:  { zh: "📖 查看讲解", en: "📖 View explanation", ms: "📖 Lihat penjelasan" },
  home:          { zh: "回首页", en: "Home", ms: "Laman utama" },
  loading:       { zh: "加载中...", en: "Loading...", ms: "Memuatkan..." },
  no_one_yet:    { zh: "还没有人玩过这个 Activity，快来当第一名！", en: "No one has played this Activity yet — be the first!", ms: "Belum ada yang bermain Aktiviti ini — jadilah yang pertama!" },
  your_rank:     { zh: "你目前排在第 {rank} 名（共 {total} 人）", en: "You're currently ranked #{rank} (out of {total})", ms: "Anda kini berada di kedudukan #{rank} (daripada {total})" },
  me_suffix:     { zh: "（我）", en: " (me)", ms: " (saya)" },
  score_unit:    { zh: "分", en: "pts", ms: "mata" },
  not_played:    { zh: "还没有玩过，快去试试看！", en: "You haven't played yet — give it a try!", ms: "Anda belum bermain lagi — cubalah!" },
  best_record:   { zh: "历史最佳", en: "Best record", ms: "Rekod terbaik" },
  recent_records:{ zh: "最近记录（第几次尝试 · 分数 · 用时）", en: "Recent attempts (attempt # · score · time)", ms: "Percubaan terkini (percubaan # · markah · masa)" },
  attempt_no:    { zh: "第 {n} 次", en: "Attempt {n}", ms: "Percubaan {n}" },
};
function shellT(key: string, locale: "zh" | "en" | "ms", vars?: Record<string, string | number>): string {
  const entry = SHELL[key];
  if (!entry) return key;
  let s = entry[locale] ?? entry.zh;
  if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, String(v)); });
  return s;
}
// 完成日期时间——played_at是后端存的ISO时间字符串，本来就有，只是弹窗
// UI一直没显示出来。用 toLocaleString 让它自动按浏览器/系统的语言环境
// 排版(中文日期习惯 vs 英文/马来文日期习惯不一样)，不用自己手写格式化。
const DATE_LOCALE_MAP: Record<"zh" | "en" | "ms", string> = { zh: "zh-CN", en: "en-US", ms: "ms-MY" };
function formatPlayedAt(iso: string, locale: "zh" | "en" | "ms"): string {
  try {
    return new Date(iso).toLocaleString(DATE_LOCALE_MAP[locale], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
import { VideoPlayer } from "@/components/VideoPlayer";
import { PptReader } from "@/components/PptReader";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

type GameResult = CountingResult | SpotDiffResult | FocusTapResult | MemoryResult | PatternResult | WordProblemResult | MazeResult | NumberMazeResult | SudokuResult | LineMatchResult | ColoringResult | StickerGameResult | CubeStackResult | CubeLayerCountResult | CubeFindHiddenResult | CubeFreeRotateResult | CubeBuildResult | CubeThreeViewResult | ShapeCountResult | ClockResult | LatinSquareResult | NumberFindResult | NumberSequenceResult | NumberBondResult | NumberCompareResult | NumberAdditionResult | ChineseStrokeResult;

export default function LevelPlayerPage() {
  const { levelId } = useParams<{ levelId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // "试玩"现在是同一个分页内跳转过来的（课程设计器那边已经拿掉了
  // target="_blank"），所以真的有"上一页"能退——直接用浏览器历史返回，
  // 会自然带回点"试玩"之前的那个网址（比如 /course-designer?type=maze，
  // 设计器那边把第二层状态记在网址上了，退回去状态也跟着还原，不用
  // 这里额外传参数）。history.length<=1 这种情况（比如有人直接把这个
  // 播放链接分享出去、没有从站内导航过来）没有上一页可退，才退回首页
  // 兜底——跟 PptViewerPage/VideoViewerPage 那几个播放页是同一个逻辑。
  function goBack() {
    if (window.history.length > 1) { navigate(-1); return; }
    navigate("/home");
  }
  const cameFromDesigner = searchParams.get("from") === "designer";
  const [level, setLevel] = useState<{
    module_type: string; title_i18n?: Record<string,string>; config: Record<string, unknown>;
    explanation_text?: string; explanation_image_url?: string; explanation_video_url?: string;
    hint_text?: string; audio_url?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<GameResult | null>(null);
  const [lectureDone, setLectureDone] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 游戏类模块（不含讲义）的三段式生命周期——待机(没按开始，游戏组件根本
  // 没挂载，不会跑任何计时器/交互) → 进行中(按了开始，游戏组件才真正
  // mount) → 已结束(游戏内部自己的onComplete触发，但不自动退出，
  // 停在这里等用户按"重玩"或"退出")。
  // playKey 只在"重玩"时才 +1——靠改变 key 让 React 把游戏组件整个卸载
  // 重新挂载，组件内部所有 useState 初始值重新跑一遍，等同全新开局，
  // 不需要动任何一个游戏组件内部的代码。
  const [playState, setPlayState] = useState<"idle" | "playing" | "finished">("idle");
  const [playKey, setPlayKey] = useState(0);
  // 游戏侧多语言——目前只有部分游戏(见I18N_READY_MODULES清单)真正接入了
  // 翻译，这个hook本身对所有游戏都可用，但语言切换按钮只在当前这个
  // module_type在清单里时才显示(见下面isI18nReady)，没接入的游戏不会
  // 出现"按钮在但点了没反应"的半吊子体验。
  const [locale, setLocale] = useGameLocale();

  // 切换到不同的 Activity（比如设计器里连续试玩了好几个）要整个重置，
  // 不然会带着上一个 Activity 的"已结束"状态进到新的这个。
  useEffect(() => {
    setPlayState("idle");
    setPlayKey(0);
    setResult(null);
    setLectureDone(false);
  }, [levelId]);

  function toggleAudio() {
    const el = audioRef.current;
    if (!el) return;
    if (audioPlaying) { el.pause(); } else { el.currentTime = 0; el.play(); }
  }

  useEffect(() => {
    if (!levelId) return;
    eduApi.getLevel(levelId)
      .then(setLevel)
      .catch(() => toast.error("Activity 加载失败"))
      .finally(() => setLoading(false));
  }, [levelId]);

  async function handleComplete(r: GameResult) {
    setResult(r);
    setPlayState("finished"); // 游戏内部自己判定完成，这里只是同步外层状态，不做任何跳转
    if (!levelId || !level) return;
    try {
      await eduApi.submitProgress(levelId, {
        module_type: level.module_type, score: r.score, max_score: r.max_score,
        time_spent_seconds: r.time_spent_seconds, mistakes: r.mistakes, completed: r.completed,
        // cube_stack 的自适应难度会跑到哪个等级结束，存进 extra_data——
        // 留给以后"下一次直接从上次结束的等级开始"这个功能用，其他游戏
        // 的 result 都没有这个字段，这里就是 undefined，不会多存东西。
        extra_data: "ending_level" in r ? { ending_level: r.ending_level } : undefined,
      });
      toast.success("成绩已记录！");
    } catch { toast.error("成绩记录失败（网络问题），可以再试一次"); }
  }

  function handleStart() {
    setPlayState("playing");
  }

  function handleReplay() {
    setResult(null);
    setPlayState("playing"); // 重玩直接重新开始，不用再经过待机封面
    setPlayKey((k) => k + 1); // 换 key → 游戏组件整个重新挂载 → 全新开局
  }

  // ── 排行榜 / 自己的记录——都是打开弹窗那一刻才拉数据(懒加载)，不是一
  // 进页面就查，游戏还没玩之前这两份数据用户大概率不会点开看，没必要
  // 抢在最需要马上出结果的游戏加载之前占带宽。每次点开都重新拉一次，
  // 所以"重玩"完再点开，看到的就是包含刚刚这一次在内的最新数据，不用
  // 额外写"完成后主动刷新"这一段逻辑。
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showMyRecords, setShowMyRecords] = useState(false);
  const [leaderboard, setLeaderboard] = useState<Awaited<ReturnType<typeof eduApi.getLevelLeaderboard>> | null>(null);
  const [myRecords, setMyRecords] = useState<Awaited<ReturnType<typeof eduApi.getMyLevelRecords>> | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [myRecordsLoading, setMyRecordsLoading] = useState(false);

  async function openLeaderboard() {
    setShowLeaderboard(true);
    if (!levelId) return;
    setLeaderboardLoading(true);
    try { setLeaderboard(await eduApi.getLevelLeaderboard(levelId)); }
    catch { toast.error("排行榜加载失败"); }
    finally { setLeaderboardLoading(false); }
  }

  async function openMyRecords() {
    setShowMyRecords(true);
    if (!levelId) return;
    setMyRecordsLoading(true);
    try { setMyRecords(await eduApi.getMyLevelRecords(levelId)); }
    catch { toast.error("记录加载失败"); }
    finally { setMyRecordsLoading(false); }
  }

  async function handleLectureProgress(secondsWatchedOrIndex: number, durationOrTotal: number, completed: boolean) {
    if (!levelId || !level) return;
    if (completed && !lectureDone) {
      setLectureDone(true);
      try {
        await eduApi.submitProgress(levelId, {
          module_type: level.module_type, score: 0, max_score: 0,
          time_spent_seconds: level.module_type === "video_lecture" ? secondsWatchedOrIndex : 0,
          mistakes: 0, completed: true,
        });
      } catch { /* 讲义类进度记录失败不打断观看体验，静默忽略 */ }
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">加载中...</div>;
  if (!level) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">找不到这个 Activity</div>;

  const KNOWN_GAME_MODULES = ["counting", "spot_diff", "focus_tap", "memory", "pattern", "word_problem", "maze", "number_maze", "sudoku", "line_match", "coloring", "sticker_game", "cube_stack", "cube_layer_count", "cube_find_hidden", "cube_free_rotate", "cube_build", "cube_three_view", "shape_count", "clock", "latin_square", "number_find", "number_sequence", "number_bond", "number_compare", "number_addition", "chinese_stroke"];
  const isLecture = level.module_type === "video_lecture" || level.module_type === "ppt_lecture";
  const isKnown = KNOWN_GAME_MODULES.includes(level.module_type) || isLecture;
  // 只有真正的"游戏"套待机/开始/重玩/退出这套流程——讲义(video/ppt)
  // 本身就有自己的播放条(暂停/进度条/翻页)，硬套一层"按开始才能看"的
  // 封面只会多一次没必要的点击，不套用这套状态机。
  const isGameModule = KNOWN_GAME_MODULES.includes(level.module_type);
  const isI18nReady = I18N_READY_MODULES.includes(level.module_type);
  // 外层壳(待机封面+控制按钮)只在玩已接入的游戏时才真的切换语言，其他
  // 游戏这个值固定是zh，shellT()永远回退中文，行为跟改动前一样。
  const shellLocale = isI18nReady ? locale : "zh";
  const config = level.config as { video_url?: string; slide_image_urls?: string[] };

  return (
    <div className="min-h-screen bg-[#F4F6FA]">
      <div className="max-w-6xl w-full mx-auto px-4 py-6">
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-bold text-[#0B1526]">{level.title_i18n?.zh ?? level.title_i18n?.en ?? "Activity"}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            {isI18nReady && (
              <div className="flex items-center gap-0.5 bg-muted/50 p-0.5 rounded-lg">
                {ALL_LOCALES.map((l) => (
                  <button
                    key={l} type="button" onClick={() => setLocale(l)}
                    title={LOCALE_LABELS[l]}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      locale === l ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {{ zh: "中文", en: "EN", ms: "BM" }[l]}
                  </button>
                ))}
              </div>
            )}
            {isGameModule && (
              <>
                <Button type="button" variant="outline" size="sm" onClick={openMyRecords}>{shellT("my_records", shellLocale)}</Button>
                <Button type="button" variant="outline" size="sm" onClick={openLeaderboard}>{shellT("leaderboard", shellLocale)}</Button>
              </>
            )}
            {isGameModule && playState !== "idle" && (
              <>
                <Button type="button" variant="outline" size="sm" onClick={handleReplay}>{shellT("replay", shellLocale)}</Button>
                <Button type="button" variant="outline" size="sm" onClick={goBack}>{shellT("exit", shellLocale)}</Button>
              </>
            )}
            {!(isGameModule && playState !== "idle") && (
              <Button variant="ghost" size="sm" onClick={goBack}>{cameFromDesigner ? shellT("back_designer", shellLocale) : shellT("back", shellLocale)}</Button>
            )}
          </div>
        </div>

        {/* 提示栏 */}
        {(level.hint_text || level.audio_url) && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-teal-100 bg-teal-50 px-4 py-2.5">
            {level.audio_url && (
              <>
                <button
                  type="button" onClick={toggleAudio}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-teal-500 to-blue-600 text-white text-sm font-medium transition-opacity hover:opacity-90"
                >
                  {audioPlaying ? "⏸️ 暂停" : "🔊 听题目"}
                </button>
                <audio ref={audioRef} src={level.audio_url} onPlay={() => setAudioPlaying(true)} onPause={() => setAudioPlaying(false)} onEnded={() => setAudioPlaying(false)} className="hidden" />
              </>
            )}
            {level.hint_text && <p className="text-sm text-teal-900">💡 {level.hint_text}</p>}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-border p-6">
          {/* 待机封面——游戏组件在这个状态下压根没挂载，不会跑任何计时器
              或交互，按"开始"之后才真正 mount 下面对应的游戏组件 */}
          {isGameModule && playState === "idle" && (
            <div className="text-center py-16 space-y-4">
              <div className="text-5xl">🎮</div>
              <p className="text-lg font-medium text-foreground">{shellT("ready_title", shellLocale)}</p>
              <p className="text-sm text-muted-foreground">{shellT("ready_hint", shellLocale)}</p>
              <Button type="button" size="lg" onClick={handleStart} className="text-lg font-semibold px-8">{shellT("start_button", shellLocale)}</Button>
            </div>
          )}

          {(!isGameModule || playState !== "idle") && (
            <>
              {level.module_type === "counting" && <CountingGame key={playKey} config={level.config as unknown as CountingConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "spot_diff" && <SpotDiffGame key={playKey} config={level.config as unknown as SpotDiffConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "focus_tap" && <FocusTapGame key={playKey} config={level.config as unknown as FocusTapConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "memory" && <MemoryGame key={playKey} config={level.config as unknown as MemoryConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "pattern" && <PatternGame key={playKey} config={level.config as unknown as PatternConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "word_problem" && levelId && <WordProblemGame key={playKey} levelId={levelId} config={level.config as unknown as WordProblemConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "maze" && <MazeGame key={playKey} config={level.config as unknown as MazeConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "number_maze" && <NumberMazeGame key={playKey} config={level.config as unknown as NumberMazeConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "sudoku" && levelId && <SudokuGame key={playKey} levelId={levelId} config={level.config as unknown as SudokuConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "line_match" && levelId && <LineMatchGame key={playKey} levelId={levelId} config={level.config as unknown as LineMatchConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "coloring" && levelId && <ColoringGame key={playKey} levelId={levelId} config={level.config as unknown as ColoringConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "sticker_game" && <StickerGame key={playKey} config={level.config as unknown as StickerGameConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "cube_stack" && <CubeStackGame key={playKey} config={level.config as unknown as CubeStackConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "cube_layer_count" && <CubeLayerCountGame key={playKey} config={level.config as unknown as CubeLayerCountConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "cube_find_hidden" && <CubeFindHiddenGame key={playKey} config={level.config as unknown as CubeFindHiddenConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "cube_free_rotate" && <CubeFreeRotateGame key={playKey} config={level.config as unknown as CubeFreeRotateConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "cube_build" && <CubeBuildGame key={playKey} config={level.config as unknown as CubeBuildConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "cube_three_view" && <CubeThreeViewGame key={playKey} config={level.config as unknown as CubeThreeViewConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "shape_count" && <ShapeCountGame key={playKey} config={level.config as unknown as ShapeCountConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "clock" && <ClockGame key={playKey} config={level.config as unknown as ClockConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "latin_square" && <LatinSquareGame key={playKey} config={level.config as unknown as LatinSquareConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "number_find" && <NumberFindGame key={playKey} config={level.config as unknown as NumberFindConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "number_sequence" && <NumberSequenceGame key={playKey} config={level.config as unknown as NumberSequenceConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "number_bond" && <NumberBondGame key={playKey} config={level.config as unknown as NumberBondConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "number_compare" && <NumberCompareGame key={playKey} config={level.config as unknown as NumberCompareConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "number_addition" && <NumberAdditionGame key={playKey} config={level.config as unknown as NumberAdditionConfig} onComplete={handleComplete} locale={locale} />}
              {level.module_type === "chinese_stroke" && <ChineseStrokeGame key={playKey} config={level.config as unknown as ChineseStrokeConfig} onComplete={handleComplete} locale={locale} />}

              {level.module_type === "video_lecture" && (
                <VideoPlayer src={config.video_url ?? ""} onProgress={(sec, dur, completed) => handleLectureProgress(sec, dur, completed)} />
              )}
              {level.module_type === "ppt_lecture" && (
                <PptReader slideUrls={config.slide_image_urls ?? []} onProgress={(idx, total, completed) => handleLectureProgress(idx, total, completed)} />
              )}

              {!isKnown && (
                <div className="text-center text-muted-foreground p-6">
                  这个模块类型（{level.module_type}）还没有对应的引擎组件——Phase 2 会陆续补上。
                </div>
              )}
            </>
          )}
        </div>

        {/* 讲义类：完成后照旧提供"查看讲解/回首页"。
            游戏类：退出/重玩已经在上面标题栏常驻，这里完成后只多补一个
            "查看讲解"（如果有的话），不重复放退出按钮，避免同一屏幕上
            两个功能一样的按钮。 */}
        {isLecture && lectureDone && (
          <div className="mt-4 text-center space-x-3">
            {(level.explanation_text || level.explanation_image_url || level.explanation_video_url) && (
              <Button variant="outline" onClick={() => setShowExplanation(true)}>📖 查看讲解</Button>
            )}
            <Button onClick={goBack}>{cameFromDesigner ? "← 返回设计器" : "回首页"}</Button>
          </div>
        )}
        {isGameModule && playState === "finished" && (level.explanation_text || level.explanation_image_url || level.explanation_video_url) && (
          <div className="mt-4 text-center">
            <Button variant="outline" onClick={() => setShowExplanation(true)}>{shellT("view_explain", shellLocale)}</Button>
          </div>
        )}

        <Modal open={showExplanation} onClose={() => setShowExplanation(false)} title="讲解" size="md">
          <div className="space-y-3">
            {level.explanation_video_url && <video src={level.explanation_video_url} controls loop className="w-full rounded-lg bg-black" />}
            {level.explanation_image_url && <img src={level.explanation_image_url} alt="讲解图" className="w-full rounded-lg border border-border" />}
            {level.explanation_text && <p className="text-sm leading-relaxed whitespace-pre-wrap">{level.explanation_text}</p>}
          </div>
        </Modal>

        <Modal open={showLeaderboard} onClose={() => setShowLeaderboard(false)} title={shellT("leaderboard", shellLocale)} size="md">
          {leaderboardLoading ? (
            <p className="text-center text-muted-foreground py-6">{shellT("loading", shellLocale)}</p>
          ) : !leaderboard?.entries?.length ? (
            <p className="text-center text-muted-foreground py-6">{shellT("no_one_yet", shellLocale)}</p>
          ) : (
            <div className="space-y-2">
              {leaderboard.my_rank && (
                <p className="text-sm text-teal-700 bg-teal-50 rounded-lg px-3 py-2 mb-2">
                  {shellT("your_rank", shellLocale, { rank: leaderboard.my_rank, total: leaderboard.total_players ?? leaderboard.entries.length })}
                </p>
              )}
              {leaderboard.entries.map((e) => {
                // 用 rank（不是 student_id）判断"是不是我"——分数用时都
                // 完全一样才会撞车，理论上有但概率极低，先不特别处理
                const isMe = leaderboard.my_rank !== null && e.rank === leaderboard.my_rank;
                const medal = e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : `${e.rank}`;
                return (
                  <div key={e.student_id} className={`flex items-center justify-between rounded-xl px-3 py-2 ${isMe ? "bg-teal-50 ring-1 ring-teal-200" : "bg-muted/40"}`}>
                    <div className="flex items-center gap-3">
                      <span className="w-7 text-center font-semibold text-foreground">{medal}</span>
                      <div>
                        <span className="text-sm font-medium text-foreground">{e.full_name_zh ?? e.full_name_en ?? e.username}{isMe ? shellT("me_suffix", shellLocale) : ""}</span>
                        <p className="text-xs text-muted-foreground/70">{formatPlayedAt(e.played_at, shellLocale)}</p>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {e.score}/{e.max_score} {shellT("score_unit", shellLocale)}　⏱️ {Number(e.time_spent_seconds ?? 0).toFixed(1)}s
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>

        <Modal open={showMyRecords} onClose={() => setShowMyRecords(false)} title={shellT("my_records", shellLocale)} size="md">
          {myRecordsLoading ? (
            <p className="text-center text-muted-foreground py-6">{shellT("loading", shellLocale)}</p>
          ) : !myRecords?.best && !myRecords?.history?.length ? (
            <p className="text-center text-muted-foreground py-6">{shellT("not_played", shellLocale)}</p>
          ) : (
            <div className="space-y-4">
              {myRecords.best && (
                <div className="rounded-xl bg-gradient-to-r from-teal-500 to-blue-600 text-white px-4 py-3">
                  <p className="text-xs opacity-80 mb-1">{shellT("best_record", shellLocale)}</p>
                  <p className="text-lg font-semibold">{myRecords.best.score}/{myRecords.best.max_score} {shellT("score_unit", shellLocale)}　⏱️ {Number(myRecords.best.time_spent_seconds ?? 0).toFixed(1)}s</p>
                  <p className="text-xs opacity-80 mt-1">{formatPlayedAt(myRecords.best.played_at, shellLocale)}</p>
                </div>
              )}
              {!!myRecords?.history?.length && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">{shellT("recent_records", shellLocale)}</p>
                  {myRecords.history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between text-sm rounded-lg bg-muted/40 px-3 py-1.5">
                      <div>
                        <span className="text-muted-foreground">{shellT("attempt_no", shellLocale, { n: h.attempt_number })}</span>
                        <p className="text-xs text-muted-foreground/70">{formatPlayedAt(h.played_at, shellLocale)}</p>
                      </div>
                      <span className="text-foreground">{h.score}/{h.max_score} {shellT("score_unit", shellLocale)}</span>
                      <span className="text-muted-foreground">⏱️ {Number(h.time_spent_seconds ?? 0).toFixed(1)}s</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
}
