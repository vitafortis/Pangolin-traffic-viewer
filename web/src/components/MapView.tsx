import { useCallback, useEffect, useState } from "react";
import { MapPin, X } from "lucide-react";
import { api, filterParams, fmtNum, type EventRow, type Filters, type GeoRow, type GroupRow, type Meta, type Site, type Stats } from "../api";
import type { Theme } from "../theme";
import { GlobeView, type Layers } from "./GlobeView";
import { Timeline } from "./Timeline";
import { GroupPanel } from "./GroupPanel";
import { EventDrawer, EventsTable } from "./EventsTable";
import { GeoCredit } from "./GeoCredit";

const DEFAULT_LAYERS: Layers = { arcs: true, countries: true, points: true, heatmap: false, live: true };
const LAYER_LABELS: [keyof Layers, string][] = [
    ["arcs", "Traffic arcs"],
    ["countries", "Country shading"],
    ["points", "Origin dots"],
    ["heatmap", "Density heatmap"],
    ["live", "Live pulses"]
];

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "denied" }) {
    return (
        <div className="float min-w-24 px-3 py-2">
            <div className={`text-lg font-semibold tabular-nums ${tone === "denied" && value !== "0" ? "text-denied" : ""}`}>{value}</div>
            <div className="section-title">
                {label}
                {sub && <span className="normal-case"> · {sub}</span>}
            </div>
        </div>
    );
}

export function MapView({
    meta,
    theme,
    filters,
    setFilters,
    tick,
    live,
    placing,
    setPlacing,
    reloadMeta
}: {
    meta: Meta | null;
    theme: Theme;
    filters: Filters;
    setFilters: (f: Filters) => void;
    tick: number;
    live: EventRow[];
    placing: Site | null;
    setPlacing: (s: Site | null) => void;
    reloadMeta: () => void;
}) {
    const [geo, setGeo] = useState<GeoRow[]>([]);
    const [byCountry, setByCountry] = useState<GroupRow[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [ts, setTs] = useState<{ step: number; rows: { t: number; count: number; denied: number }[] }>({ step: 3600, rows: [] });
    const [groupBy, setGroupBy] = useState(() => localStorage.getItem("ptv.groupBy") ?? "country");
    const [groups, setGroups] = useState<GroupRow[]>([]);
    const [events, setEvents] = useState<EventRow[]>([]);
    const [newIds, setNewIds] = useState<Set<number>>(new Set());
    const [openId, setOpenId] = useState<number | null>(null);
    const [layers, setLayers] = useState<Layers>(() => {
        try {
            return { ...DEFAULT_LAYERS, ...JSON.parse(localStorage.getItem("ptv.layers.v2") ?? "{}") };
        } catch {
            return DEFAULT_LAYERS;
        }
    });
    const [err, setErr] = useState<string | null>(null);

    // Relative ranges resolve "now" at fetch time, so key effects on the filter object, not the resolved params.
    const filterKey = JSON.stringify(filters);
    const params = filterParams(filters);

    useEffect(() => {
        const params = filterParams(filters);
        let stale = false;
        Promise.all([
            api<{ rows: GeoRow[] }>("/api/geo", { params }),
            api<{ rows: GroupRow[] }>("/api/group", { params: { ...params, by: "country", limit: "300" } }),
            api<Stats>("/api/stats", { params }),
            api<{ step: number; rows: { t: number; count: number; denied: number }[] }>("/api/timeseries", { params: { ...params, buckets: "120" } }),
            api<{ rows: EventRow[] }>("/api/events", { params: { ...params, limit: "300" } })
        ])
            .then(([g, c, s, t, e]) => {
                if (stale) return;
                setGeo(g.rows);
                setByCountry(c.rows);
                setStats(s);
                setTs(t);
                setEvents((prev) => {
                    const known = new Set(prev.map((x) => x.id));
                    setNewIds(prev.length ? new Set(e.rows.filter((x) => !known.has(x.id)).map((x) => x.id)) : new Set());
                    return e.rows;
                });
                setErr(null);
            })
            .catch((e) => !stale && setErr(e.message));
        return () => {
            stale = true;
        };
    }, [filterKey, tick]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        localStorage.setItem("ptv.groupBy", groupBy);
        const params = filterParams(filters);
        api<{ rows: GroupRow[] }>("/api/group", { params: { ...params, by: groupBy, limit: "200" } }).then((r) => setGroups(r.rows));
    }, [groupBy, filterKey, tick]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => localStorage.setItem("ptv.layers.v2", JSON.stringify(layers)), [layers]);

    const add = (k: "countries" | "resources" | "sites", v: string) => !filters[k].includes(v) && setFilters({ ...filters, [k]: [...filters[k], v] });

    const pickGroup = (r: GroupRow) => {
        if (!r.key) return;
        if (groupBy === "country") add("countries", r.key);
        else if (groupBy === "resource") add("resources", r.key);
        else if (groupBy === "site") add("sites", r.key);
        else if (groupBy === "ip") setFilters({ ...filters, ip: r.key });
    };

    const place = useCallback(
        async (lat: number, lng: number) => {
            if (!placing) return;
            await api(`/api/sites/${placing.connection_id}/${placing.site_id}`, { method: "PATCH", body: { lat: +lat.toFixed(4), lon: +lng.toFixed(4), place_label: placing.place_label } });
            setPlacing(null);
            reloadMeta();
        },
        [placing, setPlacing, reloadMeta]
    );

    const unplaced = (meta?.sites ?? []).filter((s) => s.lat == null);
    const deniedPct = stats?.total ? Math.round(((stats.denied ?? 0) / stats.total) * 100) : 0;

    return (
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(55vh,1fr)_auto_auto] overflow-y-auto lg:grid-cols-[1fr_360px] lg:grid-rows-[1fr_270px] lg:overflow-hidden">
            <div className="dot-grid relative min-h-0 overflow-hidden bg-background">
                <GlobeView
                    theme={theme}
                    geo={geo}
                    byCountry={byCountry}
                    sites={meta?.sites ?? []}
                    live={live}
                    layers={layers}
                    placing={placing}
                    onPlace={place}
                    onPickCountry={(cc) => add("countries", cc)}
                    onPickSite={(s) => add("sites", `${s.connection_id}:${s.site_id}`)}
                />

                <div className="pointer-events-none absolute top-3 right-3 left-3 flex flex-wrap gap-2 [&>*]:pointer-events-auto">
                    <Stat label="Events" value={fmtNum(stats?.total)} />
                    <Stat label="Denied" value={fmtNum(stats?.denied)} sub={`${deniedPct}%`} tone="denied" />
                    <Stat label="Unique IPs" value={fmtNum(stats?.unique_ips)} />
                    <Stat label="Countries" value={fmtNum(stats?.countries)} />
                </div>

                <div className="float absolute right-3 bottom-10 space-y-1 px-3 py-2.5 sm:top-3 sm:bottom-auto" role="group" aria-label="Map layers">
                    <div className="section-title mb-1.5">Layers</div>
                    {LAYER_LABELS.map(([k, l]) => (
                        <label key={k} className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                            <input type="checkbox" className="accent-[var(--primary)]" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
                            {l}
                        </label>
                    ))}
                </div>

                {placing ? (
                    <div className="float absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 border-primary/40 px-3.5 py-2 text-[0.8125rem]">
                        <MapPin className="size-4 text-primary" />
                        <span>
                            Click the globe to place <b>{placing.name}</b>
                        </span>
                        <button className="btn btn-secondary btn-sm" onClick={() => setPlacing(null)}>
                            <X /> Cancel
                        </button>
                    </div>
                ) : (
                    <div className="float absolute bottom-3 left-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-xs text-muted-foreground">
                        <span className="verdict allow">
                            <span className="font-normal text-muted-foreground">mostly allowed</span>
                        </span>
                        <span className="verdict deny">
                            <span className="font-normal text-muted-foreground">mostly denied</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 rounded-full bg-foreground" /> site
                        </span>
                        {layers.countries && (
                            <span className="inline-flex items-center gap-1.5">
                                <span className="h-2 w-10 rounded-sm bg-gradient-to-r from-primary/15 to-primary" /> traffic by country
                            </span>
                        )}
                        {unplaced.length > 0 && (
                            <button className="btn btn-primary btn-sm" onClick={() => setPlacing(unplaced[0])} title="Sites need a location before arcs can be drawn to them">
                                <MapPin /> Place {unplaced.length} site{unplaced.length > 1 ? "s" : ""}
                            </button>
                        )}
                    </div>
                )}
                <GeoCredit attribution={meta?.geoAttribution} className="absolute right-3 bottom-3 rounded bg-card/70 px-1.5 backdrop-blur" />
                {err && <div className="float absolute top-24 left-3 px-3 py-2 text-xs text-danger">{err}</div>}
            </div>

            <aside className="flex min-h-0 flex-col border-t border-border bg-card max-lg:max-h-[480px] lg:row-span-2 lg:border-t-0 lg:border-l">
                <GroupPanel by={groupBy} setBy={setGroupBy} rows={groups} onPick={pickGroup} />
            </aside>

            <section className="grid min-h-0 grid-rows-[92px_1fr] border-t border-border bg-card max-lg:min-h-[420px]">
                <Timeline
                    rows={ts.rows}
                    step={ts.step}
                    from={Number(params.from)}
                    to={Number(params.to)}
                    onRange={(from, to) => setFilters({ ...filters, range: "custom", from, to })}
                />
                <EventsTable rows={events} newIds={newIds} onOpen={setOpenId} />
            </section>

            {openId != null && <EventDrawer id={openId} attribution={meta?.geoAttribution} onClose={() => setOpenId(null)} onFilterIp={(ip) => setFilters({ ...filters, ip })} />}
        </div>
    );
}
