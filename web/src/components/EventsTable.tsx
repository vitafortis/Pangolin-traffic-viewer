import { useEffect, useState } from "react";
import { Filter, X } from "lucide-react";
import { api, countryLabel, flag, fmtTime, type EventRow, type GeoAttribution } from "../api";
import { GeoCredit } from "./GeoCredit";

export function Verdict({ allowed }: { allowed: number | null }) {
    return allowed === 1 ? <span className="verdict allow">allow</span> : allowed === 0 ? <span className="verdict deny">deny</span> : <span className="verdict na">—</span>;
}

export function EventsTable({ rows, newIds, onOpen }: { rows: EventRow[]; newIds: Set<number>; onOpen: (id: number) => void }) {
    return (
        <div className="min-h-0 overflow-auto">
            <table className="data-table">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Verdict</th>
                        <th>Origin</th>
                        <th>IP</th>
                        <th>Resource</th>
                        <th>Request</th>
                        <th>Actor</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((e) => (
                        <tr key={e.id} className={`click ${newIds.has(e.id) ? "new" : ""}`} onClick={() => onOpen(e.id)}>
                            <td className="text-muted-foreground tabular-nums">{fmtTime(e.ts)}</td>
                            <td>
                                <Verdict allowed={e.allowed} />
                            </td>
                            <td>
                                {flag(e.country)} {[e.city, e.country].filter(Boolean).join(", ") || "—"}
                            </td>
                            <td className="font-mono text-xs">{e.ip ?? "—"}</td>
                            <td>
                                {e.resource_name ?? "—"}
                                {e.site_name && <span className="text-muted-foreground"> @ {e.site_name}</span>}
                            </td>
                            <td className="max-w-[320px] font-mono text-xs">
                                {e.kind === "connection" ? `${e.protocol ?? ""} → ${e.host ?? ""}` : e.kind === "access" ? `auth: ${e.method}` : `${e.method ?? ""} ${e.host ?? ""}${e.path ?? ""}`}
                            </td>
                            <td>{e.actor ?? <span className="text-muted-foreground">anonymous</span>}</td>
                        </tr>
                    ))}
                    {rows.length === 0 && (
                        <tr>
                            <td colSpan={7} className="py-8 text-center text-muted-foreground">
                                No events match these filters
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
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

export function EventDrawer({ id, attribution, onClose, onFilterIp }: { id: number; attribution: GeoAttribution | null | undefined; onClose: () => void; onFilterIp: (ip: string) => void }) {
    const [ev, setEv] = useState<(EventRow & { raw: unknown }) | null>(null);
    useEffect(() => {
        api<EventRow & { raw: unknown }>(`/api/events/${id}`).then(setEv);
        const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        window.addEventListener("keydown", k);
        return () => window.removeEventListener("keydown", k);
    }, [id, onClose]);
    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
            <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[560px] flex-col border-l border-border bg-card shadow-surface-lg" role="dialog" aria-label="Event detail">
                <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
                    <span className="text-[0.9375rem] font-semibold">Event</span>
                    <span className="font-mono text-xs text-muted-foreground">#{id}</span>
                    <span className="flex-1" />
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
                        <X />
                    </button>
                </div>
                {ev && (
                    <div className="min-h-0 flex-1 overflow-auto">
                        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2.5 p-4 text-[0.8125rem]">
                            <Row k="Time">{fmtTime(ev.ts)}</Row>
                            <Row k="Type">{ev.kind}</Row>
                            <Row k="Verdict">
                                <Verdict allowed={ev.allowed} /> {ev.reason != null && <span className="text-muted-foreground">(reason {ev.reason})</span>}
                            </Row>
                            <Row k="Source IP">
                                <span className="font-mono text-xs">{ev.ip}</span>
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
                            <Row k="Actor">{ev.actor ?? "anonymous"}</Row>
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
                    </div>
                )}
            </aside>
        </>
    );
}
