import { useCallback, useEffect, useState } from "react";
import { api, filterParams, fmtNum, type EventRow, type Filters, type GeoRow, type GroupRow, type Meta, type Site, type Stats } from "../api";
import { GlobeView, type Layers } from "./GlobeView";
import { Timeline } from "./Timeline";
import { GroupPanel } from "./GroupPanel";
import { EventDrawer, EventsTable } from "./EventsTable";

export function MapView({
    meta,
    filters,
    setFilters,
    tick,
    live,
    placing,
    setPlacing,
    reloadMeta
}: {
    meta: Meta | null;
    filters: Filters;
    setFilters: (f: Filters) => void;
    tick: number;
    live: EventRow[];
    placing: Site | null;
    setPlacing: (s: Site | null) => void;
    reloadMeta: () => void;
}) {
    const [geo, setGeo] = useState<GeoRow[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [ts, setTs] = useState<{ step: number; rows: { t: number; count: number; denied: number }[] }>({ step: 3600, rows: [] });
    const [groupBy, setGroupBy] = useState(() => localStorage.getItem("ptv.groupBy") ?? "country");
    const [groups, setGroups] = useState<GroupRow[]>([]);
    const [events, setEvents] = useState<EventRow[]>([]);
    const [newIds, setNewIds] = useState<Set<number>>(new Set());
    const [openId, setOpenId] = useState<number | null>(null);
    const [layers, setLayers] = useState<Layers>(() => {
        try {
            return { arcs: true, heatmap: true, points: false, live: true, ...JSON.parse(localStorage.getItem("ptv.layers") ?? "{}") };
        } catch {
            return { arcs: true, heatmap: true, points: false, live: true };
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
            api<Stats>("/api/stats", { params }),
            api<{ step: number; rows: { t: number; count: number; denied: number }[] }>("/api/timeseries", { params: { ...params, buckets: "120" } }),
            api<{ rows: EventRow[] }>("/api/events", { params: { ...params, limit: "300" } })
        ])
            .then(([g, s, t, e]) => {
                if (stale) return;
                setGeo(g.rows);
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

    useEffect(() => localStorage.setItem("ptv.layers", JSON.stringify(layers)), [layers]);

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
        <div className="mapview">
            <div className="globe-wrap">
                <GlobeView
                    geo={geo}
                    sites={meta?.sites ?? []}
                    live={live}
                    layers={layers}
                    placing={placing}
                    onPlace={place}
                    onPickOrigin={(r) => r.country && add("countries", r.country)}
                    onPickSite={(s) => add("sites", `${s.connection_id}:${s.site_id}`)}
                />
                <div className="overlay stats">
                    <div className="stat">
                        <div className="v">{fmtNum(stats?.total)}</div>
                        <div className="l">Events</div>
                    </div>
                    <div className="stat">
                        <div className="v" style={{ color: deniedPct ? "var(--denied)" : undefined }}>{fmtNum(stats?.denied)}</div>
                        <div className="l">Denied · {deniedPct}%</div>
                    </div>
                    <div className="stat">
                        <div className="v">{fmtNum(stats?.unique_ips)}</div>
                        <div className="l">Unique IPs</div>
                    </div>
                    <div className="stat">
                        <div className="v">{fmtNum(stats?.countries)}</div>
                        <div className="l">Countries</div>
                    </div>
                </div>
                <div className="overlay layers" role="group" aria-label="Map layers">
                    {(
                        [
                            ["arcs", "Traffic arcs"],
                            ["heatmap", "Origin heatmap"],
                            ["points", "Origin points"],
                            ["live", "Live pulses"]
                        ] as const
                    ).map(([k, l]) => (
                        <label key={k}>
                            <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} /> {l}
                        </label>
                    ))}
                </div>
                {placing ? (
                    <div className="overlay placing">
                        Click the globe to place <b>{placing.name}</b>
                        <button className="btn" onClick={() => setPlacing(null)}>
                            Cancel
                        </button>
                    </div>
                ) : (
                    <div className="overlay legend">
                        <span>
                            <i style={{ background: "var(--allowed)" }} /> mostly allowed
                        </span>
                        <span>
                            <i style={{ background: "var(--denied)" }} /> mostly denied
                        </span>
                        <span>
                            <i className="dot" style={{ background: "var(--site)" }} /> site
                        </span>
                        {unplaced.length > 0 && (
                            <button className="btn" style={{ padding: "1px 8px" }} onClick={() => setPlacing(unplaced[0])} title="Sites need a location before arcs can be drawn to them">
                                Place {unplaced.length} unplaced site{unplaced.length > 1 ? "s" : ""}
                            </button>
                        )}
                    </div>
                )}
                {err && (
                    <div className="overlay" style={{ top: 80, left: 12 }}>
                        <span className="err">{err}</span>
                    </div>
                )}
            </div>
            <div className="side">
                <GroupPanel by={groupBy} setBy={setGroupBy} rows={groups} onPick={pickGroup} />
            </div>
            <div className="bottom">
                <Timeline
                    rows={ts.rows}
                    step={ts.step}
                    from={Number(params.from)}
                    to={Number(params.to)}
                    onRange={(from, to) => setFilters({ ...filters, range: "custom", from, to })}
                />
                <EventsTable rows={events} newIds={newIds} onOpen={setOpenId} />
            </div>
            {openId != null && <EventDrawer id={openId} onClose={() => setOpenId(null)} onFilterIp={(ip) => setFilters({ ...filters, ip })} />}
        </div>
    );
}
