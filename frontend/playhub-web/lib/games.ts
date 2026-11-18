export type Game = { id: string; slug: string; name: string; category: string; description: string };
const apiBase = (process.env.PLAYHUB_API_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5280/api/v1").replace(/\/$/, "");

export async function getGames(category?: string, q?: string): Promise<Game[]> {
  const url = new URL(`${apiBase}/games`);
  if (category) url.searchParams.set("category", category);
  if (q) url.searchParams.set("q", q);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`PlayHub API returned ${response.status} while loading the game catalog.`);
  const data = await response.json() as { items: Game[] };
  return data.items;
}

export async function getGame(slug: string): Promise<Game | null> {
  const response = await fetch(`${apiBase}/games/${encodeURIComponent(slug)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`PlayHub API returned ${response.status} while loading game "${slug}".`);
  return response.json() as Promise<Game>;
}
