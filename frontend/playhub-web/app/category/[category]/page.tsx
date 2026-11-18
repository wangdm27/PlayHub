import GameCard from "../../../components/game-card";
import { getGames } from "../../../lib/games";

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const games = await getGames(category);
  return <main className="catalog"><span className="eyebrow">{category}</span><h1>{category} games</h1><div className="grid">{games.map(game => <GameCard key={game.id} game={game}/>)}</div></main>;
}
