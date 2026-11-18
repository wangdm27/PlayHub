"use client";

import { Maximize2 } from "lucide-react";

export default function FullscreenButton() {
  return <button onClick={() => document.getElementById("gameFrame")?.requestFullscreen()}><Maximize2/> Fullscreen</button>;
}
