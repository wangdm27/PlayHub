import { Gamepad2, Star } from "lucide-react";
import Link from "next/link";
import type { Game } from "../lib/games";

const accentByCategory: Record<string, string> = { Sports: "#19c7a5", Racing: "#f54e78", Puzzle: "#9c7cff" };

export default function GameCard({ game }: { game: Game }) {
  const accent = accentByCategory[game.category] ?? "#2c8a77";
  return <Link className="gameCard" href={`/games/${game.slug}`}><div className="cover" style={{ background: `linear-gradient(145deg, ${accent}, #111827)` }}><div className="ball">{game.category === "Sports" ? "8" : <Gamepad2/>}</div><span className="playBadge">▶</span></div>
    <div className="cardInfo"><div><h3>{game.name}</h3><p>{game.category}</p></div><span className="plays"><Star/> Play</span></div></Link>;
}
