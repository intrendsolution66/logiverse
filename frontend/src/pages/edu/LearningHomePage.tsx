// frontend/src/pages/edu/LearningHomePage.tsx
//
// 学生"我的 Activity"点进来的入口页——不直接跳去某一种玩法，先让学生
// 自己选：Discovery（自己按 Topic 随便探索）还是 Self Guided Learning
// （跟着老师排好的 Course/Lesson 顺序学）。取代原本失效的 /courses 链接
// （那个页面和路由早就被删掉了，HomePage.tsx 的卡片却一直没跟着更新，
// 导致学生点进去等于走进死路，这也是"看不到任何Activity"的真正原因）。

import { Link } from "react-router-dom";

export default function LearningHomePage() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">我的 Activity</h1>
      <p className="text-muted-foreground mb-6">想怎么学？挑一个吧</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          to="/discovery"
          className="rounded-2xl border-2 border-border p-6 hover:border-primary hover:bg-primary/5 transition-colors flex flex-col items-start"
        >
          <div className="text-4xl mb-2">🧭</div>
          <div className="font-semibold text-lg">自由探索</div>
          <p className="text-sm text-muted-foreground mt-1">按自己喜欢的主题，想玩哪个玩哪个，没有固定顺序</p>
        </Link>

        <Link
          to="/self-guided"
          className="rounded-2xl border-2 border-border p-6 hover:border-primary hover:bg-primary/5 transition-colors flex flex-col items-start"
        >
          <div className="text-4xl mb-2">📖</div>
          <div className="font-semibold text-lg">跟着课程学</div>
          <p className="text-sm text-muted-foreground mt-1">选一门课，一步步跟着排好的顺序学：看视频/PPT讲义，再做练习</p>
        </Link>
      </div>
    </div>
  );
}
