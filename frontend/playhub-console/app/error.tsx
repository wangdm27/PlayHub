"use client";

export default function ConsoleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="loginPage"><div className="loginCard"><h1>控制台加载失败</h1><p>无法完成页面渲染，请稍后重试。</p><button className="loginButton" onClick={reset}>重新加载</button></div></main>;
}
