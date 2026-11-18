"use client";

import Link from "next/link";

export default function WebError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="catalog"><h1>暂时无法加载游戏</h1><p>平台 API 暂不可用，请稍后重试。</p><button className="primary" onClick={reset}>重试</button> <Link href="/">返回首页</Link></main>;
}
