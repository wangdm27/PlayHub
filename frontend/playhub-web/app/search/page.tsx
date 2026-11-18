import GameCard from "../../components/game-card";
import { getGames } from "../../lib/games";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const params = await searchParams;
  const query = Array.isArray(params.q) ? params.q[0] : params.q ?? "";
  const games = await getGames(undefined, query);
  return <main className="catalog"><span className="eyebrow">SEARCH</span><h1>{query ? `Results for "${query}"` : "All games"}</h1><div className="grid">{games.map(game => <GameCard key={game.id} game={game}/>)}</div></main>;
}
