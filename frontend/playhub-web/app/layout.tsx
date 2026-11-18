import type { Metadata } from "next";
import "../src/styles.css";
import SiteHeader from "./site-header";

export const metadata: Metadata = {
  title: "PlayHub — HTML5 Games",
  description: "Discover and play HTML5 games on PlayHub.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><SiteHeader/>{children}</body></html>;
}
