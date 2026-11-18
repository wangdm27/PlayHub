import type { Metadata } from "next";
import "../src/styles.css";

export const metadata: Metadata = {
  title: "PlayHub Console",
  description: "PlayHub developer and operations console.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
