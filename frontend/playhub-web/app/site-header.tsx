"use client";

import { Gamepad2, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function SiteHeader() {
  const [query, setQuery] = useState("");
  return <header className="topbar"><Link className="brand" href="/"><span className="brandMark"><Gamepad2/></span><span>PLAYHUB</span></Link>
    <nav><Link href="/">Discover</Link><Link href="/category/Sports">Sports</Link><Link href="/category/Puzzle">Puzzle</Link></nav>
    <form className="search" action="/search" method="get"><Search/><input name="q" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search games"/></form>
  </header>;
}
