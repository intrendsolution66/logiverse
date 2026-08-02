// frontend/src/pages/edu/ModeSelectPage.tsx
//
// 视觉重做——去掉大emoji+糖果色圆角卡片的模板感，换成一套专属的设计
// 语言：深墨色+电紫蓝主色，Space Grotesk标题字体，line icon代替emoji，
// 卡片之间用一条细"星链"虚线连起来（呼应LogiVerse=逻辑宇宙的产品名）。
//
// 需要在 index.html 或全局CSS里加这行字体引入（如果还没有）：
//   @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap');

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { studentModeApi } from "@/api";
import { School, BookOpen, Compass, Lock } from "lucide-react";

interface ModeCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  disabled: boolean;
  disabledReason?: string;
  onClick: () => void;
}

function ModeCard({ icon, title, description, disabled, disabledReason, onClick }: ModeCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative flex flex-col items-start gap-4 p-6 rounded-lg border text-left transition-all ${
        disabled
          ? "border-[#E4E1D8] bg-[#F7F5F0]/50 opacity-60 cursor-not-allowed"
          : "border-[#E4E1D8] bg-white hover:border-[#4A3AFF] hover:shadow-[0_4px_24px_rgba(74,58,255,0.08)] cursor-pointer"
      }`}
    >
      <div className={`w-11 h-11 rounded-md flex items-center justify-center ${disabled ? "bg-[#E4E1D8]" : "bg-[#4A3AFF]/10"}`}>
        {disabled ? <Lock size={20} className="text-[#171923]/40" /> : <span className="text-[#4A3AFF]">{icon}</span>}
      </div>
      <div className="space-y-1">
        <h3 className="font-['Space_Grotesk'] text-lg font-semibold text-[#171923]">{title}</h3>
        <p className="text-sm text-[#171923]/60 font-['IBM_Plex_Sans'] leading-snug">{description}</p>
      </div>
      {disabledReason && (
        <span className="font-['IBM_Plex_Mono'] text-[11px] tracking-wide uppercase text-[#171923]/40 mt-auto pt-2">
          {disabledReason}
        </span>
      )}
    </button>
  );
}

export default function ModeSelectPage() {
  const navigate = useNavigate();
  const [hasActiveSubscription, setHasActiveSubscription] = useState<boolean | null>(null);

  useEffect(() => {
    studentModeApi.getModes().then((r) => setHasActiveSubscription(r.hasActiveSubscription));
  }, []);

  const loading = hasActiveSubscription === null;
  const subscribed = hasActiveSubscription === true;

  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      <div className="max-w-4xl mx-auto px-6 py-16 space-y-10">
        <div className="space-y-2">
          <p className="font-['IBM_Plex_Mono'] text-xs tracking-[0.15em] uppercase text-[#4A3AFF]">LogiVerse</p>
          <h1 className="font-['Space_Grotesk'] text-3xl font-bold text-[#171923]">选择学习模式</h1>
          <p className="text-sm text-[#171923]/60 font-['IBM_Plex_Sans']">挑一个适合现在的学习方式</p>
        </div>

        {!loading && !subscribed && (
          <div className="text-sm font-['IBM_Plex_Sans'] text-[#171923] bg-[#F2A93B]/15 border border-[#F2A93B]/30 rounded-md py-3 px-4 max-w-lg">
            订阅已过期或还没开始 — 联系家长开通订阅才能使用 Self Guided Learning 和 Discovery
          </div>
        )}

        {/* 卡片间的"星链"连接线——签名元素，克制地只用这一处 */}
        <div className="relative">
          <svg className="absolute top-[38px] left-0 w-full h-px hidden sm:block" preserveAspectRatio="none">
            <line x1="16.5%" y1="0" x2="50%" y2="0" stroke="#E4E1D8" strokeWidth="1" strokeDasharray="3 4" />
            <line x1="50%" y1="0" x2="83.5%" y2="0" stroke="#E4E1D8" strokeWidth="1" strokeDasharray="3 4" />
          </svg>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 relative">
            <ModeCard
              icon={<School size={22} />}
              title="实体课"
              description="和老师实时上课"
              disabled
              disabledReason="即将推出"
              onClick={() => {}}
            />
            <ModeCard
              icon={<BookOpen size={22} />}
              title="Self Guided Learning"
              description="按顺序学习一整套课程"
              disabled={loading || !subscribed}
              disabledReason={!loading && !subscribed ? "需要订阅" : undefined}
              onClick={() => navigate("/self-guided")}
            />
            <ModeCard
              icon={<Compass size={22} />}
              title="Discovery"
              description="自由探索游戏、视频、讲义"
              disabled={loading || !subscribed}
              disabledReason={!loading && !subscribed ? "需要订阅" : undefined}
              onClick={() => navigate("/discovery")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

