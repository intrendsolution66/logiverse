// frontend/src/components/CollaboraViewer.tsx
//
// "PPT真实动画版"的查看器——跟 PptReader(转成静态图片、一页页翻)是两
// 条完全不同的路子。这个组件靠 Collabora Online(自建的、内核是真的
// LibreOffice的在线查看服务)在服务器端真实打开这份pptx，通过iframe把
// 渲染结果嵌进页面，页内点击动画/过渡这些效果都能保留，代价是要连一
// 个独立服务、加载会比看静态图片慢一些(要走真的WOPI协议握手)。
//
// 用法：<CollaboraViewer assetId={xxx} />——组件自己负责调用后端换WOPI
// 会话令牌、拼iframe网址，调用方不需要关心WOPI协议细节。

import { useState, useEffect } from "react";
import { wopiApi } from "@/api";

export function CollaboraViewer({ assetId, title }: { assetId: string; title?: string }) {
  const [iframeSrc, setIframeSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true); setError(null); setIframeSrc(null);
    wopiApi.createSession(assetId)
      .then(({ wopiSrc, accessToken, officeUrl }) => {
        const url = `${officeUrl}?WOPISrc=${encodeURIComponent(wopiSrc)}&access_token=${encodeURIComponent(accessToken)}`;
        setIframeSrc(url);
      })
      .catch((err) => setError(err?.response?.data?.message ?? "打不开这份PPT，可能素材已经被删除了"))
      .finally(() => setLoading(false));
  }, [assetId]);

  if (loading) {
    return <div className="w-full h-[80vh] rounded-xl bg-muted/30 flex items-center justify-center text-sm text-muted-foreground">加载中...</div>;
  }
  if (error) {
    return <div className="w-full h-[80vh] rounded-xl bg-muted/30 flex items-center justify-center text-sm text-red-600">🔒 {error}</div>;
  }

  return (
    <div className="w-full space-y-1">
      {title && <p className="text-sm font-medium text-foreground/90">{title}</p>}
      <div className="w-full h-[75vh] rounded-xl overflow-hidden border border-border shadow-lg bg-black">
        <iframe
          src={iframeSrc ?? undefined}
          className="w-full h-full border-0"
          allow="fullscreen"
          title={title ?? "PPT查看器"}
        />
      </div>
    </div>
  );
}
