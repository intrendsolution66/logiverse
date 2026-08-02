// frontend/src/pages/edu/DiscoveryPage.tsx
//
// 同一套设计语言：underline tab代替糖果色圆角pill，Topic卡片去掉大emoji，
// 改用小型编号+等宽字体呈现"内容数量"，更像一个专业的学习系统而不是
// 儿童玩具App的糖果风格。

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { taxonomyApi, discoveryApi } from "@/api";
import { FolderOpen } from "lucide-react";

interface Programme { id: string; code: string; name_zh: string; name_en?: string }
interface Topic { id: string; name_zh: string; name_en?: string; subject_name_zh?: string; activity_count: number }

export default function DiscoveryPage() {
  const navigate = useNavigate();
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [activeProgrammeId, setActiveProgrammeId] = useState<string>("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(false);

  useEffect(() => {
    taxonomyApi.listProgrammes().then((r) => {
      setProgrammes(r);
      if (r.length) setActiveProgrammeId(r[0].id);
    });
  }, []);

  useEffect(() => {
    if (!activeProgrammeId) return;
    setLoadingTopics(true);
    discoveryApi.listTopics(activeProgrammeId).then((r) => { setTopics(r); setLoadingTopics(false); });
  }, [activeProgrammeId]);

  return (
    <div className="min-h-screen bg-[#F7F5F0]">
      <div className="max-w-5xl mx-auto px-6 py-16 space-y-8">
        <div className="space-y-2">
          <p className="font-['IBM_Plex_Mono'] text-xs tracking-[0.15em] uppercase text-[#4A3AFF]">Discovery</p>
          <h1 className="font-['Space_Grotesk'] text-2xl font-bold text-[#171923]">自由探索</h1>
          <p className="text-sm text-[#171923]/60 font-['IBM_Plex_Sans']">选一个科目，看看里面有什么</p>
        </div>

        <div className="flex gap-6 border-b border-[#E4E1D8]">
          {programmes.map((p) => {
            const active = activeProgrammeId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setActiveProgrammeId(p.id)}
                className={`relative pb-3 text-sm font-['IBM_Plex_Sans'] font-medium transition-colors ${
                  active ? "text-[#171923]" : "text-[#171923]/45 hover:text-[#171923]/70"
                }`}
              >
                {p.name_zh}
                {active && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-[#4A3AFF]" />}
              </button>
            );
          })}
        </div>

        {!loadingTopics && topics.length === 0 && (
          <div className="py-16 text-center">
            <p className="font-['Space_Grotesk'] text-base text-[#171923]/70">这个科目暂时没有适合你的内容</p>
            <p className="text-sm text-[#171923]/45 font-['IBM_Plex_Sans'] mt-1">换一个科目试试</p>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {topics.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(`/discovery/topics/${t.id}`, { state: { topicName: t.name_zh } })}
              className="group flex flex-col gap-3 p-4 rounded-md border border-[#E4E1D8] bg-white text-left hover:border-[#4A3AFF] hover:shadow-[0_4px_20px_rgba(74,58,255,0.08)] transition-all"
            >
              <FolderOpen size={18} className="text-[#4A3AFF]/70 group-hover:text-[#4A3AFF]" />
              <div>
                <p className="font-['Space_Grotesk'] text-sm font-semibold text-[#171923]">{t.name_zh}</p>
                <p className="font-['IBM_Plex_Mono'] text-[11px] text-[#171923]/40 mt-0.5">{t.activity_count} 项内容</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
