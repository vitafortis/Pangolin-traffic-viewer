import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, emptyFilters, type EventRow, type Filters, type Meta, type Site } from "./api";
import { FilterBar } from "./components/FilterBar";
import { MapView } from "./components/MapView";
import { AlertsView } from "./components/AlertsView";
import { SettingsView } from "./components/SettingsView";

type Tab = "map" | "alerts" | "settings";

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
        <div className="login">
            <form
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
                <Brand />
                <input className="input" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
                <button className="btn primary">Sign in</button>
                {err && <span className="err">{err}</span>}
            </form>
        </div>
    );
}

function Brand() {
    return (
        <div className="brand">
            <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
                <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5" />
                <path d="M3 16h26M16 3c5 5 5 21 0 26M16 3c-5 5-5 21 0 26" stroke="currentColor" strokeWidth="1.8" fill="none" />
            </svg>
            Pangolin Traffic
        </div>
    );
}

function Main({ authRequired }: { authRequired: boolean }) {
    const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || "map");
    const [meta, setMeta] = useState<Meta | null>(null);
    const [filters, setFilters] = useState<Filters>(emptyFilters);
    const [tick, setTick] = useState(0);
    const [live, setLive] = useState<EventRow[]>([]);
    const [connected, setConnected] = useState(false);
    const [unacked, setUnacked] = useState(0);
    const [placing, setPlacing] = useState<Site | null>(null);
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
    }, [reloadMeta, reloadUnacked]);

    useEffect(() => {
        location.hash = tab;
    }, [tab]);

    // Live updates: refetch aggregates at most every 5s while new events stream in (not when zoomed to a fixed range).
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

    // Pick up newly synced sites/resources/countries every minute.
    useEffect(() => {
        const t = setInterval(reloadMeta, 60_000);
        return () => clearInterval(t);
    }, [reloadMeta]);

    const startPlacing = (s: Site) => {
        setPlacing(s);
        setTab("map");
    };

    return (
        <div className="shell">
            <header className="top">
                <Brand />
                <nav className="tabs">
                    <button className={tab === "map" ? "on" : ""} onClick={() => setTab("map")}>
                        Traffic
                    </button>
                    <button className={tab === "alerts" ? "on" : ""} onClick={() => setTab("alerts")}>
                        Alerts{unacked > 0 && <span className="badge">{unacked}</span>}
                    </button>
                    <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
                        Settings
                    </button>
                </nav>
                <span className="spacer" />
                {meta?.demo && <span className="muted">Demo data</span>}
                <span className={`live ${connected ? "on" : ""}`}>
                    <i /> {connected ? "Live" : "Reconnecting…"}
                </span>
                {authRequired && (
                    <button className="btn ghost" onClick={() => api("/api/logout", { method: "POST" }).then(() => location.reload())}>
                        Sign out
                    </button>
                )}
            </header>
            {tab === "map" ? <FilterBar meta={meta} filters={filters} setFilters={setFilters} /> : <div />}
            {tab === "map" && (
                <MapView
                    meta={meta}
                    filters={filters}
                    setFilters={setFilters}
                    tick={filters.range === "custom" ? 0 : tick}
                    live={live}
                    placing={placing}
                    setPlacing={setPlacing}
                    reloadMeta={reloadMeta}
                />
            )}
            {tab === "alerts" && <AlertsView meta={meta} onAck={reloadUnacked} />}
            {tab === "settings" && <SettingsView meta={meta} reload={reloadMeta} onPlace={startPlacing} />}
        </div>
    );
}
