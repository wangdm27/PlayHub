"use client";

import React, { useEffect, useState } from "react";
import { LayoutDashboard, Gamepad2, Upload, ClipboardCheck, BarChart3, Settings, Search, Bell, Check, ChevronRight, LogOut, LockKeyhole } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5280/api/v1";
const nav = [{ name: "Overview", icon: LayoutDashboard }, { name: "Games", icon: Gamepad2 }, { name: "Uploads", icon: Upload }, { name: "Reviews", icon: ClipboardCheck }, { name: "Analytics", icon: BarChart3 }, { name: "Settings", icon: Settings }];
type Game = { id: string; name: string; slug: string; status: string; category: string };
type Overview = { publishedGames: number; draftGames: number; pendingReviews: number; totalGames: number };
type Review = { id: string; gameId: string; status: string; comment?: string; createdAt: string };

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("登录已失效或当前账号没有管理权限，请重新登录。");
    const body = await response.text();
    throw new Error(body || `请求失败 (${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function Login({ onLogin }: { onLogin: (token: string, email: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (!response.ok) throw new Error(response.status === 423 ? "账号暂时锁定，请稍后再试。" : "邮箱或密码错误，或账号未启用。");
      const data = await response.json() as { accessToken: string; email: string; roles: string[] };
      if (!data.roles.includes("Administrator") && !data.roles.includes("Operator")) throw new Error("该账号没有运营后台权限。");
      sessionStorage.setItem("playhub-token", data.accessToken);
      onLogin(data.accessToken, data.email);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "登录失败，请检查 API 服务。"); }
    finally { setBusy(false); }
  };
  return <div className="loginPage"><form className="loginCard" onSubmit={submit}><div className="loginLogo"><Gamepad2/></div><span className="loginEyebrow">PLAYHUB CONSOLE</span><h1>欢迎回来</h1><p>登录运营账号以继续</p>
    <label>邮箱<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@example.com"/></label>
    <label>密码<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="输入密码"/></label>
    {error && <div className="loginError" role="alert">{error}</div>}<button className="loginButton" disabled={busy}>{busy ? "正在登录…" : "登录管理后台"} <LockKeyhole/></button><small>仅授权的 Administrator / Operator 账号可访问</small>
  </form></div>;
}

function App() {
  const [token, setToken] = useState(() => typeof window === "undefined" ? "" : sessionStorage.getItem("playhub-token") ?? "");
  const [email, setEmail] = useState("");
  const [active, setActive] = useState("Overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showGameForm, setShowGameForm] = useState(false);

  const logout = () => { sessionStorage.removeItem("playhub-token"); setToken(""); setEmail(""); };
  const onLogin = (newToken: string, newEmail: string) => { setToken(newToken); setEmail(newEmail); };

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      setBusy(true); setError("");
      try {
        const [me] = await Promise.all([request<{ email: string } & Record<string, unknown>>("/auth/me", token)]);
        if (cancelled) return;
        setEmail(me.email);
        if (active === "Overview") {
          const result = await request<Overview>("/admin/overview", token);
          if (!cancelled) setOverview(result);
        } else if (active === "Games") {
          const result = await request<Game[]>("/admin/games", token);
          if (!cancelled) setGames(result);
        } else if (active === "Reviews") {
          const result = await request<Review[]>("/admin/reviews", token);
          if (!cancelled) setReviews(result);
        }
      } catch (reason) {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : "加载数据失败";
        setError(message);
        if (message.includes("登录已失效") || message.includes("没有管理权限")) logout();
      } finally { if (!cancelled) setBusy(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [token, active]);

  const createGame = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError("");
    const form = new FormData(e.currentTarget);
    try {
      const game = await request<Game>("/admin/games", token, { method: "POST", body: JSON.stringify({ name: form.get("name"), category: form.get("category"), description: form.get("description") }) });
      setGames(current => [...current, game]); setShowGameForm(false);
      setActive("Games");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "创建游戏失败"); }
  };

  if (!token) return <Login onLogin={onLogin}/>;
  return <div className="shell"><aside><div className="brand">PLAYHUB <span>CONSOLE</span></div><nav>{nav.map(n => { const I = n.icon; return <button key={n.name} className={active === n.name ? "active" : ""} onClick={() => setActive(n.name)}><I/> {n.name}</button>; })}</nav><div className="profile"><div className="avatar">{email.slice(0, 2).toUpperCase()}</div><div><b>{email}</b><small>已验证管理账号</small></div><button className="logout" title="退出登录" onClick={logout}><LogOut/></button></div></aside>
    <main><header><div><h1>{active}</h1><p>Manage and monitor the PlayHub platform</p></div><div className="tools"><label className="search"><Search/><input placeholder="Search"/></label><button className="icon"><Bell/></button><div className="avatar small">{email.slice(0, 2).toUpperCase()}</div></div></header>
      {error && <div className="apiError" role="alert">{error}</div>}
      {busy && <div className="loadMessage">正在从平台 API 加载数据…</div>}
      {active === "Overview" && <section><div className="stats">
        <div><span>Catalog games</span><b>{overview?.totalGames ?? "—"}</b><small>数据库中的游戏</small></div>
        <div><span>Published games</span><b>{overview?.publishedGames ?? "—"}</b><small className="up">当前公开上架</small></div>
        <div><span>Draft games</span><b>{overview?.draftGames ?? "—"}</b><small>尚未发布</small></div>
        <div><span>Pending reviews</span><b>{overview?.pendingReviews ?? "—"}</b><small className="warn">等待人工审核</small></div>
      </div><div className="panel"><div className="panelHead"><div><h2>平台数据</h2><p>来自 SQL Server 的实时汇总</p></div><button onClick={() => setActive("Games")}><Gamepad2/> 管理游戏</button></div><p className="dataNote">指标由服务端数据库查询，不再使用前端演示数字。</p></div></section>}
      {active === "Games" && <section><div className="panel"><div className="panelHead"><div><h2>Game catalog</h2><p>从平台数据库读取的游戏</p></div><button onClick={() => setShowGameForm(!showGameForm)}>＋ 新建游戏</button></div>
        {showGameForm && <form className="gameForm" onSubmit={createGame}><input name="name" required maxLength={160} placeholder="游戏名称"/><input name="category" required placeholder="分类，例如 Puzzle"/><input name="description" maxLength={2000} placeholder="简介"/><button>保存草稿</button></form>}
        <table><thead><tr><th>游戏</th><th>状态</th><th>分类</th><th>Slug</th><th></th></tr></thead><tbody>{games.map(g => <tr key={g.id}><td><div className="gameName"><div className="gameIcon"><Gamepad2/></div><b>{g.name}</b></div></td><td><span className={`status ${g.status.toLowerCase()}`}>{g.status}</span></td><td>{g.category}</td><td>{g.slug}</td><td><ChevronRight/></td></tr>)}</tbody></table>
        {!busy && games.length === 0 && <p className="emptyState">数据库中暂无游戏。</p>}</div></section>}
      {active === "Reviews" && <section><div className="panel"><div className="panelHead"><div><h2>Pending review</h2><p>来自平台数据库的待审核记录</p></div></div>{reviews.map(review => <div className="review" key={review.id}><div><b>Game {review.gameId}</b><small>提交于 {new Date(review.createdAt).toLocaleString()}</small></div><span className="status draft">{review.status}</span></div>)}{!busy && reviews.length === 0 && <p className="emptyState">当前没有待审核记录。</p>}</div></section>}
      {active === "Uploads" && <section><div className="placeholder"><Upload/><h2>上传处理尚未接通</h2><p>当前版本不会假装上传成功；上传会话、ZIP 隔离校验和对象存储流程待实现。</p></div></section>}
      {["Analytics", "Settings"].includes(active) && <section><div className="placeholder"><BarChart3/><h2>{active} 尚未接入</h2><p>当前模块尚无真实后端数据。</p></div></section>}
    </main></div>;
}

export default App;
