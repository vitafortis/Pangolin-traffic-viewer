import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Columns3, Filter } from "lucide-react";
import { api, countryLabel, filterParams, flag, fmtTime, type Entity, type EventRow, type Filters, type GeoAttribution } from "../api";
import { Drawer, Popover, menuItem } from "./Drawer";
import { GeoCredit } from "./GeoCredit";

export function Verdict({ allowed }: { allowed: number | null }) {
    return allowed === 1 ? <span className="verdict allow">allow</span> : allowed === 0 ? <span className="verdict deny">deny</span> : <span className="verdict na">—</span>;
}

/** An IP or user that opens its profile; stops the row's own click. */
export function EntityLink({ entity, onOpen, className = "" }: { entity: Entity; onOpen: (e: Entity) => void; className?: string }) {
    return (
        <button className={`max-w-full truncate text-left decoration-primary/50 underline-offset-2 hover:text-primary-ink hover:underline ${className}`} onClick={(e) => (e.stopPropagation(), onOpen(entity))} title={`Investigate ${entity.value}`}>
            {entity.value}
        </button>
    );
}

type Col = { id: string; label: string; sort?: string; cell: (e: EventRow, open: (x: Entity) => void) => React.ReactNode; className?: string };

const COLUMNS: Col[] = [
    { id: "time", label: "Time", sort: "ts", cell: (e) => fmtTime(e.ts), className: "text-muted-foreground tabular-nums" },
    { id: "verdict", label: "Verdict", sort: "verdict", cell: (e) => <Verdict allowed={e.allowed} /> },
    { id: "origin", label: "Origin", sort: "country", cell: (e) => <>{flag(e.country)} {[e.city, e.country].filter(Boolean).join(", ") || "—"}</> },
    { id: "ip", label: "IP", sort: "ip", cell: (e, o) => (e.ip ? <EntityLink entity={{ type: "ip", value: e.ip }} onOpen={o} className="font-mono text-xs" /> : "—") },
    {
        id: "resource",
        label: "Resource",
        sort: "resource",
        cell: (e) => (
            <>
                {e.resource_name ?? "—"}
                {e.site_name && <span className="text-muted-foreground"> @ {e.site_name}</span>}
            </>
        )
    },
    {
        id: "request",
        label: "Request",
        sort: "path",
        cell: (e) => (e.kind === "connection" ? `${e.protocol ?? ""} → ${e.host ?? ""}` : e.kind === "access" ? `auth: ${e.method}` : `${e.method ?? ""} ${e.host ?? ""}${e.path ?? ""}`),
        className: "max-w-[320px] font-mono text-xs"
    },
    { id: "actor", label: "User", sort: "actor", cell: (e, o) => (e.actor ? <EntityLink entity={{ type: "actor", value: e.actor }} onOpen={o} /> : <span className="text-muted-foreground">anonymous</span>) },
    { id: "kind", label: "Type", sort: "kind", cell: (e) => e.kind, className: "text-muted-foreground" },
    { id: "agent", label: "User agent", sort: "agent", cell: (e) => e.user_agent ?? "—", className: "max-w-[280px] font-mono text-xs text-muted-foreground" },
    { id: "reason", label: "Reason", cell: (e) => e.reason ?? "—", className: "tabular-nums text-muted-foreground" }
];
const DEFAULT_COLS = ["time", "verdict", "origin", "ip", "resource", "request", "actor"];
const PAGE = 200;

function readCols(): string[] {
    try {
        const v = JSON.parse(localStorage.getItem("ptv.columns") ?? "null");
        return Array.isArray(v) && v.length ? v : DEFAULT_COLS;
    } catch {
        return DEFAULT_COLS;
    }
}

export function EventsTable({ filters, tick, onOpenEvent, onOpenEntity }: { filters: Filters; tick: number; onOpenEvent: (id: number) => void; onOpenEntity: (e: Entity) => void }) {
    const [rows, setRows] = useState<EventRow[]>([]);
    const [newIds, setNewIds] = useState<Set<number>>(new Set());
    const [done, setDone] = useState(false);
    const [loading, setLoading] = useState(false);
    const [sort, setSort] = useState<{ by: string; dir: "asc" | "desc" }>({ by: "ts", dir: "desc" });
    const [cols, setCols] = useState<string[]>(readCols);
    const [picker, setPicker] = useState(false);
    const scroller = useRef<HTMLDivElement>(null);
    const loaded = useRef(0);
    const filterKey = JSON.stringify(filters);

    const fetchPage = useCallback(
        (offset: number, limit: number) => api<{ rows: EventRow[] }>("/api/events", { params: { ...filterParams(filters), sort: sort.by, dir: sort.dir, offset: String(offset), limit: String(limit) } }).then((r) => r.rows),
        [filterKey, sort] // eslint-disable-line react-hooks/exhaustive-deps
    );

    // New filters or sort: start over at the top.
    useEffect(() => {
        let stale = false;
        setLoading(true);
        fetchPage(0, PAGE).then((r) => {
            if (stale) return;
            setRows(r);
            setNewIds(new Set());
            loaded.current = r.length;
            setDone(r.length < PAGE);
            setLoading(false);
            scroller.current?.scrollTo({ top: 0 });
        });
        return () => {
            stale = true;
        };
    }, [fetchPage]);

    // Live tick: refresh what's loaded (newest-first only, so rows don't jump under the reader).
    useEffect(() => {
        if (!tick || sort.by !== "ts" || sort.dir !== "desc") return;
        fetchPage(0, Math.min(Math.max(loaded.current, PAGE), 1000)).then((r) => {
            setRows((prev) => {
                const known = new Set(prev.map((x) => x.id));
                setNewIds(new Set(r.filter((x) => !known.has(x.id)).map((x) => x.id)));
                return r;
            });
            loaded.current = r.length;
        });
    }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

    const more = useCallback(() => {
        if (loading || done) return;
        setLoading(true);
        fetchPage(loaded.current, PAGE).then((r) => {
            setRows((prev) => [...prev, ...r]);
            loaded.current += r.length;
            setDone(r.length < PAGE);
            setLoading(false);
        });
    }, [loading, done, fetchPage]);

    useEffect(() => localStorage.setItem("ptv.columns", JSON.stringify(cols)), [cols]);

    const shown = COLUMNS.filter((c) => cols.includes(c.id));
    const toggleSort = (c: Col) => c.sort && setSort((s) => (s.by === c.sort ? { by: c.sort!, dir: s.dir === "desc" ? "asc" : "desc" } : { by: c.sort!, dir: c.sort === "ts" ? "desc" : "asc" }));

    return (
        <div
            ref={scroller}
            className="relative min-h-0 overflow-auto"
            onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight > el.scrollHeight - 300) more();
            }}
        >
            <table className="data-table">
                <thead>
                    <tr>
                        {shown.map((c) => (
                            <th key={c.id}>
                                {c.sort ? (
                                    <button className={`inline-flex items-center gap-1 uppercase hover:text-foreground ${sort.by === c.sort ? "text-foreground" : ""}`} onClick={() => toggleSort(c)} aria-label={`Sort by ${c.label}`}>
                                        {c.label}
                                        {sort.by === c.sort && (sort.dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                                    </button>
                                ) : (
                                    c.label
                                )}
                            </th>
                        ))}
                        <th className="w-8 !px-1 text-right">
                            <div className="relative inline-block">
                                <button className="rounded p-1 hover:bg-accent hover:text-foreground" onClick={(e) => (e.stopPropagation(), setPicker(!picker))} aria-label="Choose columns" title="Choose columns">
                                    <Columns3 className="size-3.5" />
                                </button>
                                <Popover open={picker} onClose={() => setPicker(false)} align="right" className="w-48 normal-case">
                                    {COLUMNS.map((c) => (
                                        <label key={c.id} className={`${menuItem} cursor-pointer font-normal tracking-normal text-foreground`}>
                                            <input type="checkbox" className="accent-[var(--primary)]" checked={cols.includes(c.id)} onChange={(e) => setCols(e.target.checked ? COLUMNS.map((x) => x.id).filter((id) => id === c.id || cols.includes(id)) : cols.filter((x) => x !== c.id))} />
                                            {c.label}
                                        </label>
                                    ))}
                                    <button className={`${menuItem} text-muted-foreground`} onClick={() => setCols(DEFAULT_COLS)}>
                                        Reset columns
                                    </button>
                                </Popover>
                            </div>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((e) => (
                        <tr key={e.id} className={`click ${newIds.has(e.id) ? "new" : ""}`} onClick={() => onOpenEvent(e.id)}>
                            {shown.map((c) => (
                                <td key={c.id} className={c.className}>
                                    {c.cell(e, onOpenEntity)}
                                </td>
                            ))}
                            <td />
                        </tr>
                    ))}
                    {rows.length === 0 && !loading && (
                        <tr>
                            <td colSpan={shown.length + 1} className="py-8 text-center text-muted-foreground">
                                No events match these filters
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
            {rows.length > 0 && (
                <div className="py-3 text-center text-xs text-muted-foreground">
                    {loading ? "Loading…" : done ? `${rows.length.toLocaleString()} events` : <button className="btn btn-ghost btn-sm" onClick={more}>Load more</button>}
                </div>
            )}
        </div>
    );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
    return (
        <>
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-all">{children}</dd>
        </>
    );
}

export function EventDrawer({
    id,
    attribution,
    onClose,
    onFilterIp,
    onOpenEntity
}: {
    id: number;
    attribution: GeoAttribution | null | undefined;
    onClose: () => void;
    onFilterIp: (ip: string) => void;
    onOpenEntity: (e: Entity) => void;
}) {
    const [ev, setEv] = useState<(EventRow & { raw: unknown }) | null>(null);
    useEffect(() => {
        api<EventRow & { raw: unknown }>(`/api/events/${id}`).then(setEv);
    }, [id]);
    return (
        <Drawer title="Event" subtitle={`#${id}`} onClose={onClose}>
            {ev && (
                <>
                    <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2.5 p-4 text-[0.8125rem]">
                        <Row k="Time">{fmtTime(ev.ts)}</Row>
                        <Row k="Type">{ev.kind}</Row>
                        <Row k="Verdict">
                            <Verdict allowed={ev.allowed} /> {ev.reason != null && <span className="text-muted-foreground">(reason {ev.reason})</span>}
                        </Row>
                        <Row k="Source IP">
                            {ev.ip ? <EntityLink entity={{ type: "ip", value: ev.ip }} onOpen={(x) => (onClose(), onOpenEntity(x))} className="font-mono text-xs" /> : "—"}
                            {ev.ip && (
                                <button className="btn btn-secondary btn-sm ml-2" onClick={() => (onFilterIp(ev.ip!), onClose())}>
                                    <Filter /> Filter to this IP
                                </button>
                            )}
                        </Row>
                        <Row k="Origin">
                            {flag(ev.country)} {[ev.city, countryLabel(ev.country)].filter(Boolean).join(", ")}
                            {ev.lat != null && (
                                <span className="text-muted-foreground tabular-nums">
                                    {" "}
                                    ({ev.lat.toFixed(2)}, {ev.lon!.toFixed(2)})
                                </span>
                            )}
                            <div>
                                <GeoCredit attribution={attribution} />
                            </div>
                        </Row>
                        <Row k="Resource">{ev.resource_name ?? ev.resource_id ?? "—"}</Row>
                        <Row k="Site">{ev.site_name ?? ev.site_id ?? "—"}</Row>
                        <Row k="User">{ev.actor ? <EntityLink entity={{ type: "actor", value: ev.actor }} onOpen={(x) => (onClose(), onOpenEntity(x))} /> : "anonymous"}</Row>
                        {ev.host && (
                            <Row k={ev.kind === "connection" ? "Destination" : "Request"}>
                                <span className="font-mono text-xs">
                                    {ev.method} {ev.host}
                                    {ev.path}
                                </span>
                            </Row>
                        )}
                        {ev.user_agent && (
                            <Row k="User agent">
                                <span className="font-mono text-xs">{ev.user_agent}</span>
                            </Row>
                        )}
                    </dl>
                    {ev.raw != null && (
                        <div className="border-t border-border">
                            <div className="section-title px-4 pt-3">Raw Pangolin log</div>
                            <pre className="p-4 font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">{JSON.stringify(ev.raw, null, 2)}</pre>
                        </div>
                    )}
                </>
            )}
        </Drawer>
    );
}
