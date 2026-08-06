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
import { VideoPlayer } from "@/components/VideoPlayer";
import { PptReader } from "@/components/PptReader";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import toast from "react-hot-toast";

type GameResult = CountingResult | SpotDiffResult | FocusTapResult | MemoryResult | PatternResult | WordProblemResult | MazeResult | NumberMazeResult | SudokuResult | LineMatchResult | ColoringResult | StickerGameResult;

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

  const KNOWN_GAME_MODULES = ["counting", "spot_diff", "focus_tap", "memory", "pattern", "word_problem", "maze", "number_maze", "sudoku", "line_match", "coloring", "sticker_game"];
  const isLecture = level.module_type === "video_lecture" || level.module_type === "ppt_lecture";
  const isKnown = KNOWN_GAME_MODULES.includes(level.module_type) || isLecture;
  // 只有真正的"游戏"套待机/开始/重玩/退出这套流程——讲义(video/ppt)
  // 本身就有自己的播放条(暂停/进度条/翻页)，硬套一层"按开始才能看"的
  // 封面只会多一次没必要的点击，不套用这套状态机。
  const isGameModule = KNOWN_GAME_MODULES.includes(level.module_type);
  const config = level.config as { video_url?: string; slide_image_urls?: string[] };

  return (
    <div className="min-h-screen bg-[#F4F6FA]">
      <div className="max-w-6xl w-full mx-auto px-4 py-6">
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-bold text-[#0B1526]">{level.title_i18n?.zh ?? level.title_i18n?.en ?? "Activity"}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            {isGameModule && (
              <>
                <Button variant="outline" size="sm" onClick={openMyRecords}>📊 自己记录</Button>
                <Button variant="outline" size="sm" onClick={openLeaderboard}>🏆 排行榜</Button>
              </>
            )}
            {isGameModule && playState !== "idle" && (
              <>
                <Button variant="outline" size="sm" onClick={handleReplay}>🔄 重玩</Button>
                <Button variant="outline" size="sm" onClick={goBack}>🚪 退出</Button>
              </>
            )}
            {!(isGameModule && playState !== "idle") && (
              <Button variant="ghost" size="sm" onClick={goBack}>{cameFromDesigner ? "← 返回设计器" : "返回"}</Button>
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
              <p className="text-lg font-medium text-foreground">准备好了吗？</p>
              <p className="text-sm text-muted-foreground">按下面的"开始"就可以进入游戏啦</p>
              <Button size="lg" onClick={handleStart} className="text-lg font-semibold px-8">▶️ 开始</Button>
            </div>
          )}

          {(!isGameModule || playState !== "idle") && (
            <>
              {level.module_type === "counting" && <CountingGame key={playKey} config={level.config as unknown as CountingConfig} onComplete={handleComplete} />}
              {level.module_type === "spot_diff" && <SpotDiffGame key={playKey} config={level.config as unknown as SpotDiffConfig} onComplete={handleComplete} />}
              {level.module_type === "focus_tap" && <FocusTapGame key={playKey} config={level.config as unknown as FocusTapConfig} onComplete={handleComplete} />}
              {level.module_type === "memory" && <MemoryGame key={playKey} config={level.config as unknown as MemoryConfig} onComplete={handleComplete} />}
              {level.module_type === "pattern" && <PatternGame key={playKey} config={level.config as unknown as PatternConfig} onComplete={handleComplete} />}
              {level.module_type === "word_problem" && levelId && <WordProblemGame key={playKey} levelId={levelId} config={level.config as unknown as WordProblemConfig} onComplete={handleComplete} />}
              {level.module_type === "maze" && <MazeGame key={playKey} config={level.config as unknown as MazeConfig} onComplete={handleComplete} />}
              {level.module_type === "number_maze" && <NumberMazeGame key={playKey} config={level.config as unknown as NumberMazeConfig} onComplete={handleComplete} />}
              {level.module_type === "sudoku" && levelId && <SudokuGame key={playKey} levelId={levelId} config={level.config as unknown as SudokuConfig} onComplete={handleComplete} />}
              {level.module_type === "line_match" && levelId && <LineMatchGame key={playKey} levelId={levelId} config={level.config as unknown as LineMatchConfig} onComplete={handleComplete} />}
              {level.module_type === "coloring" && levelId && <ColoringGame key={playKey} levelId={levelId} config={level.config as unknown as ColoringConfig} onComplete={handleComplete} />}
              {level.module_type === "sticker_game" && <StickerGame key={playKey} config={level.config as unknown as StickerGameConfig} onComplete={handleComplete} />}

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
            <Button variant="outline" onClick={() => setShowExplanation(true)}>📖 查看讲解</Button>
          </div>
        )}

        <Modal open={showExplanation} onClose={() => setShowExplanation(false)} title="讲解" size="md">
          <div className="space-y-3">
            {level.explanation_video_url && <video src={level.explanation_video_url} controls loop className="w-full rounded-lg bg-black" />}
            {level.explanation_image_url && <img src={level.explanation_image_url} alt="讲解图" className="w-full rounded-lg border border-border" />}
            {level.explanation_text && <p className="text-sm leading-relaxed whitespace-pre-wrap">{level.explanation_text}</p>}
          </div>
        </Modal>

        <Modal open={showLeaderboard} onClose={() => setShowLeaderboard(false)} title="🏆 全台的排行榜" size="md">
          {leaderboardLoading ? (
            <p className="text-center text-muted-foreground py-6">加载中...</p>
          ) : !leaderboard || leaderboard.entries.length === 0 ? (
            <p className="text-center text-muted-foreground py-6">还没有人玩过这个 Activity，快来当第一名！</p>
          ) : (
            <div className="space-y-2">
              {leaderboard.my_rank && (
                <p className="text-sm text-teal-700 bg-teal-50 rounded-lg px-3 py-2 mb-2">
                  你目前排在第 {leaderboard.my_rank} 名（共 {leaderboard.total_players} 人）
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
                      <span className="text-sm font-medium text-foreground">{e.full_name_zh ?? e.full_name_en ?? e.username}{isMe ? "（我）" : ""}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {e.score}/{e.max_score} 分　⏱️ {e.time_spent_seconds.toFixed(1)}s
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>

        <Modal open={showMyRecords} onClose={() => setShowMyRecords(false)} title="📊 自己的记录" size="md">
          {myRecordsLoading ? (
            <p className="text-center text-muted-foreground py-6">加载中...</p>
          ) : !myRecords || (!myRecords.best && myRecords.history.length === 0) ? (
            <p className="text-center text-muted-foreground py-6">还没有玩过，快去试试看！</p>
          ) : (
            <div className="space-y-4">
              {myRecords.best && (
                <div className="rounded-xl bg-gradient-to-r from-teal-500 to-blue-600 text-white px-4 py-3">
                  <p className="text-xs opacity-80 mb-1">历史最佳</p>
                  <p className="text-lg font-semibold">{myRecords.best.score}/{myRecords.best.max_score} 分　⏱️ {myRecords.best.time_spent_seconds.toFixed(1)}s</p>
                </div>
              )}
              {myRecords.history.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">最近记录（第几次尝试 · 分数 · 用时）</p>
                  {myRecords.history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between text-sm rounded-lg bg-muted/40 px-3 py-1.5">
                      <span className="text-muted-foreground">第 {h.attempt_number} 次</span>
                      <span className="text-foreground">{h.score}/{h.max_score} 分</span>
                      <span className="text-muted-foreground">⏱️ {h.time_spent_seconds.toFixed(1)}s</span>
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
