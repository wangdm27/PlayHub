import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Gamepad2 } from "lucide-react";
import FullscreenButton from "../../../components/fullscreen-button";
import GameFrame from "../../../components/game-frame";
import { getGame } from "../../../lib/games";

export const dynamic = "force-dynamic";

export default async function PlayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = await getGame(slug);
  if (!game) notFound();
  const gameOrigin = process.env.PLAYHUB_GAME_ORIGIN ?? "http://localhost:5174";
  return <main className="playPage"><div className="playHead"><Link href={`/games/${slug}`}><ArrowLeft/> Back to game</Link><h1>{game.name}</h1><FullscreenButton/></div>
    <div className="frameWrap">{slug === "8-ball-pool" ? <GameFrame src={gameOrigin} title={game.name} /> :<div className="emptyGame"><Gamepad2/><h2>Game files not published</h2><p>This title is listed, but its game build has not been published.</p></div>}</div></main>;
}
