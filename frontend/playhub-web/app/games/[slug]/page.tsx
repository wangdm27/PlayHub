import { notFound } from "next/navigation";
import { Clock3, Star, Gamepad2 } from "lucide-react";
import Link from "next/link";
import GameCard from "../../../components/game-card";
import { getGame } from "../../../lib/games";

export const dynamic = "force-dynamic";

export default async function GameDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = await getGame(slug);
  if (!game) notFound();
  const accent = game.category === "Sports" ? "#19c7a5" : "#2c8a77";
  return <main className="detail"><Link className="back" href="/"><span aria-hidden="true">←</span> Back</Link><div className="detailLayout"><div className="detailCover" style={{ background: `linear-gradient(145deg, ${accent}, #111827)` }}><div className="ball big">{game.category === "Sports" ? "8" : <Gamepad2/>}</div></div>
    <div className="detailInfo"><span className="eyebrow">{game.category}</span><h1>{game.name}</h1><p>{game.description}</p><div className="meta"><span><Star/> PlayHub</span><span><Clock3/> HTML5</span></div><div className="actions"><Link className="primary" href={`/play/${game.slug}`}>Start Game <span>▶</span></Link></div></div></div></main>;
}
