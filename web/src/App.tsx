import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Globe2, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Settings, Sun } from "lucide-react";
import { ApiError, api, emptyFilters, type EventRow, type Filters, type Meta, type Site } from "./api";
import { useTheme } from "./theme";
import { Logo } from "./components/Logo";
import { FilterBar } from "./components/FilterBar";
import { MapView } from "./components/MapView";
import { AlertsView } from "./components/AlertsView";
import { SettingsView } from "./components/SettingsView";
import pkg from "../package.json";

type Tab = "map" | "alerts" | "settings";

const NAV = [
    { id: "map", label: "Traffic", icon: Globe2 },
    { id: "alerts", label: "Alerts", icon: Bell },
    { id: "settings", label: "Settings", icon: Settings }
] as const;

export function App() {
    const [session, setSession] = useState<{ authRequired: boolean; authenticated: boolean } | null>(null);
    useEffect(() => {
        api<{ authRequired: boolean; authenticated: boolean }>("/api/session").then(setSession);
    }, []);
    if (!session) return null;
    if (!session.authenticated) return <Login onDone={() => setSession({ ...session, authenticated: true })} />;
    return <Main authRequired={session.authRequired} />;
}

function Login({ onDone }: { onDone: () => void }) {
    const [pw, setPw] = useState("");
    const [err, setErr] = useState<string | null>(null);
    return (
        <div className="glow-top grid h-dvh place-items-center px-4">
            <form
                className="card w-full max-w-sm space-y-4 p-6"
                onSubmit={async (e) => {
                    e.preventDefault();
                    try {
                        await api("/api/login", { method: "POST", body: { password: pw } });
                        onDone();
                    } catch (e) {
                        setErr((e as Error).message);
                    }
                }}
            >
                <div className="flex items-center gap-2.5">
                    <Logo size={28} />
                    <span className="text-base font-semibold tracking-tight">Pangolin Traffic</span>
                </div>
                <div>
                    <label className="label" htmlFor="pw">
                        Password
                    </label>
                    <input id="pw" className="input h-9 w-full" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
                </div>
                <button className="btn btn-primary w-full">Sign in</button>
                {err && <p className="text-xs text-danger">{err}</p>}
            </form>
        </div>
    );
}

function Main({ authRequired }: { authRequired: boolean }) {
    const [tab, setTab] = useState<Tab>(() => (["map", "alerts", "settings"].includes(location.hash.slice(1)) ? (location.hash.slice(1) as Tab) : "map"));
    const [meta, setMeta] = useState<Meta | null>(null);
    const [filters, setFilters] = useState<Filters>(emptyFilters);
    const [tick, setTick] = useState(0);
    const [live, setLive] = useState<EventRow[]>([]);
    const [connected, setConnected] = useState(false);
    const [unacked, setUnacked] = useState(0);
    const [placing, setPlacing] = useState<Site | null>(null);
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem("ptv.sidebar") === "collapsed");
    const [theme, setTheme] = useTheme();
    const pending = useRef(false);

    const reloadMeta = useCallback(() => {
        api<Meta>("/api/meta").then(setMeta).catch((e) => e instanceof ApiError && e.status === 401 && location.reload());
    }, []);
    const reloadUnacked = useCallback(() => {
        api<{ acknowledged: number }[]>("/api/alerts/events", { params: { limit: "200" } }).then((r) => setUnacked(r.filter((a) => !a.acknowledged).length));
    }, []);

    useEffect(() => {
        reloadMeta();
        reloadUnacked();
        const t = setInterval(reloadMeta, 60_000);
        return () => clearInterval(t);
    }, [reloadMeta, reloadUnacked]);

    useEffect(() => {
        history.replaceState(null, "", `#${tab}`);
    }, [tab]);

    useEffect(() => {
        localStorage.setItem("ptv.sidebar", collapsed ? "collapsed" : "open");
    }, [collapsed]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "b") {
                e.preventDefault();
                setCollapsed((c) => !c);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // Live updates: refetch aggregates at most every 5s while new events stream in.
    useEffect(() => {
        const es = new EventSource("/api/stream");
        es.onopen = () => setConnected(true);
        es.onerror = () => setConnected(false);
        es.addEventListener("events", (m) => {
            setLive(JSON.parse((m as MessageEvent).data));
            if (!pending.current) {
                pending.current = true;
                setTimeout(() => {
                    pending.current = false;
                    setTick((t) => t + 1);
                }, 5000);
            }
        });
        es.addEventListener("alert", () => reloadUnacked());
        return () => es.close();
    }, [reloadUnacked]);

    const startPlacing = (s: Site) => {
        setPlacing(s);
        setTab("map");
    };
    const signOut = () => api("/api/logout", { method: "POST" }).then(() => location.reload());

    const item = "relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[0.8125rem] font-medium transition-colors";
    const on = "bg-accent text-foreground shadow-surface";
    const off = "text-muted-foreground hover:bg-accent/70 hover:text-foreground";
    const LiveDot = (
        <span className={`size-2 shrink-0 rounded-full ${connected ? "bg-success shadow-[0_0_0_3px_color-mix(in_oklch,var(--success)_25%,transparent)]" : "bg-muted-foreground/50"}`} />
    );

    return (
        <div className="flex h-dvh overflow-hidden">
            <aside className={`hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 md:flex ${collapsed ? "w-14" : "w-60"}`}>
                <div className="flex h-14 items-center gap-2.5 px-3.5">
                    <Logo size={26} />
                    {!collapsed && <span className="text-[0.9375rem] font-semibold tracking-tight">Pangolin Traffic</span>}
                </div>
                <nav className="space-y-0.5 px-2 pt-1">
                    {NAV.map((n) => (
                        <button key={n.id} title={n.label} onClick={() => setTab(n.id)} className={`${item} w-full text-left ${tab === n.id ? on : off}`}>
                            {tab === n.id && <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary" />}
                            <n.icon className="size-4 shrink-0" />
                            {!collapsed && <span className="flex-1">{n.label}</span>}
                            {n.id === "alerts" && unacked > 0 && (
                                <span className={`rounded-md bg-primary-soft px-1.5 font-mono text-[0.6875rem] text-primary tabular-nums ${collapsed ? "absolute -top-1 -right-1" : ""}`}>{unacked}</span>
                            )}
                        </button>
                    ))}
                </nav>

                <div className="flex-1" />
                <div className={`flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground ${collapsed ? "justify-center px-0" : ""}`} title={connected ? "Receiving live events" : "Reconnecting to the live stream"}>
                    {LiveDot}
                    {!collapsed && (connected ? "Live" : "Reconnecting…")}
                    {!collapsed && meta?.demo && <span className="badge badge-warning ml-auto">Demo data</span>}
                </div>
                <div className={`flex items-center gap-1 border-t border-border p-2 ${collapsed ? "flex-col" : ""}`}>
                    <button className="btn btn-ghost btn-icon btn-sm" title="Toggle sidebar (⌘B)" onClick={() => setCollapsed(!collapsed)}>
                        {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                    </button>
                    <button className="btn btn-ghost btn-icon btn-sm" title="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                        {theme === "dark" ? <Sun /> : <Moon />}
                    </button>
                    {!collapsed && <span className="ml-1 truncate font-mono text-[0.6875rem] text-muted-foreground/70">v{pkg.version}</span>}
                    {authRequired && (
                        <button className={`btn btn-ghost btn-icon btn-sm ${collapsed ? "" : "ml-auto"}`} title="Sign out" onClick={signOut}>
                            <LogOut />
                        </button>
                    )}
                </div>
            </aside>

            <main className="relative flex min-w-0 flex-1 flex-col pb-14 md:pb-0">
                {/* Phones: a top bar with live status and theme, and a bottom bar instead of the sidebar. */}
                <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface/95 px-4 backdrop-blur md:hidden">
                    <Logo size={22} />
                    <span className="text-[0.9375rem] font-semibold tracking-tight">Pangolin Traffic</span>
                    <span className="flex-1" />
                    {LiveDot}
                    <button className="btn btn-ghost btn-icon btn-sm" title="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                        {theme === "dark" ? <Sun /> : <Moon />}
                    </button>
                    {authRequired && (
                        <button className="btn btn-ghost btn-icon btn-sm" title="Sign out" onClick={signOut}>
                            <LogOut />
                        </button>
                    )}
                </div>

                {tab === "map" && (
                    <>
                        <FilterBar meta={meta} filters={filters} setFilters={setFilters} />
                        <MapView
                            meta={meta}
                            theme={theme}
                            filters={filters}
                            setFilters={setFilters}
                            tick={filters.range === "custom" ? 0 : tick}
                            live={live}
                            placing={placing}
                            setPlacing={setPlacing}
                            reloadMeta={reloadMeta}
                        />
                    </>
                )}
                {tab === "alerts" && <AlertsView meta={meta} onAck={reloadUnacked} />}
                {tab === "settings" && <SettingsView meta={meta} reload={reloadMeta} onPlace={startPlacing} />}

                <nav className="fixed inset-x-0 bottom-0 z-30 flex h-14 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
                    {NAV.map((n) => (
                        <button key={n.id} onClick={() => setTab(n.id)} className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium ${tab === n.id ? "text-primary" : "text-muted-foreground"}`}>
                            <n.icon className="size-[18px]" />
                            {n.label}
                            {n.id === "alerts" && unacked > 0 && <span className="absolute top-1.5 left-[calc(50%+6px)] size-2 rounded-full bg-primary" />}
                        </button>
                    ))}
                </nav>
            </main>
        </div>
    );
}
