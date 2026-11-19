"use client";

import { useEffect, useRef } from "react";

export default function GameFrame({ src, title }: { src: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // 只信自家 iframe 的消息，防页面其他脚本伪造
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.source !== "playhub-game" || !event.data.sdkVersion) return;
      if (event.data.type === "game_over") console.info("[playhub] game_over", event.data.data); // TODO: 落库（API 暂无端点）
      else if (event.data.type === "game_loading_completed") console.info("[playhub] game_loading_completed", event.data.data);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);
  return <iframe id="gameFrame" ref={frameRef} src={src} title={title} sandbox="allow-scripts allow-pointer-lock"/>;
}
