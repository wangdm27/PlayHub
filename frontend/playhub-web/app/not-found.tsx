import Link from "next/link";

export default function NotFound() {
  return <main className="catalog"><h1>Game not found</h1><Link className="primary" href="/">Return to PlayHub</Link></main>;
}
