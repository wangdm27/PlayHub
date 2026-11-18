import Link from "next/link";
import GameCard from "../components/game-card";
import { getGames } from "../lib/games";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const games = await getGames();
  return <main><section className="hero"><div><span className="eyebrow">FEATURED GAME</span><h1>Poolside.<br/><em>Own the table.</em></h1><p>Precision shots, clean angles, pure 8-ball competition.</p><Link className="primary" href="/games/8-ball-pool">Play Now <span>▶</span></Link></div><div className="heroBall"><div className="ball big">8</div></div></section>
    <section><div className="sectionTitle"><div><span>HAND-PICKED</span><h2>Popular games</h2></div><Link href="/search">View all</Link></div><div className="grid">{games.map(game => <GameCard key={game.id} game={game}/>)}</div></section></main>;
}
