import { useEffect, useState } from "react";
import { api, countryLabel, flag, fmtTime, type EventRow } from "../api";

export function Verdict({ allowed }: { allowed: number | null }) {
    return allowed === 1 ? <span className="verdict allow">allow</span> : allowed === 0 ? <span className="verdict deny">deny</span> : <span className="verdict na">—</span>;
}

export function EventsTable({ rows, newIds, onOpen }: { rows: EventRow[]; newIds: Set<number>; onOpen: (id: number) => void }) {
    return (
        <div className="scroll">
            <table className="grid">
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
                            <td className="muted">{fmtTime(e.ts)}</td>
                            <td>
                                <Verdict allowed={e.allowed} />
                            </td>
                            <td>
                                {flag(e.country)} {[e.city, e.country].filter(Boolean).join(", ") || "—"}
                            </td>
                            <td className="mono">{e.ip ?? "—"}</td>
                            <td>
                                {e.resource_name ?? "—"}
                                {e.site_name && <span className="muted"> @ {e.site_name}</span>}
                            </td>
                            <td className="mono" style={{ maxWidth: 320 }}>
                                {e.kind === "connection" ? `${e.protocol ?? ""} → ${e.host ?? ""}` : e.kind === "access" ? `auth: ${e.method}` : `${e.method ?? ""} ${e.host ?? ""}${e.path ?? ""}`}
                            </td>
                            <td>{e.actor ?? <span className="muted">anonymous</span>}</td>
                        </tr>
                    ))}
                    {rows.length === 0 && (
                        <tr>
                            <td colSpan={7} className="muted" style={{ padding: 16, textAlign: "center" }}>
                                No events match these filters
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

export function EventDrawer({ id, onClose, onFilterIp }: { id: number; onClose: () => void; onFilterIp: (ip: string) => void }) {
    const [ev, setEv] = useState<(EventRow & { raw: unknown }) | null>(null);
    useEffect(() => {
        api<EventRow & { raw: unknown }>(`/api/events/${id}`).then(setEv);
        const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        window.addEventListener("keydown", k);
        return () => window.removeEventListener("keydown", k);
    }, [id, onClose]);
    return (
        <>
            <div className="drawer-bg" onClick={onClose} />
            <aside className="drawer" role="dialog" aria-label="Event detail">
                <div className="panel-h">
                    <h3>Event #{id}</h3>
                    <span className="spacer" />
                    <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
                </div>
                {ev && (
                    <div className="scroll">
                        <dl className="kv">
                            <dt>Time</dt>
                            <dd>{fmtTime(ev.ts)}</dd>
                            <dt>Type</dt>
                            <dd>{ev.kind}</dd>
                            <dt>Verdict</dt>
                            <dd>
                                <Verdict allowed={ev.allowed} /> {ev.reason != null && <span className="muted">(reason {ev.reason})</span>}
                            </dd>
                            <dt>Source IP</dt>
                            <dd className="mono">
                                {ev.ip}{" "}
                                {ev.ip && (
                                    <button className="btn" style={{ marginLeft: 8, padding: "1px 8px" }} onClick={() => (onFilterIp(ev.ip!), onClose())}>
                                        Filter to this IP
                                    </button>
                                )}
                            </dd>
                            <dt>Origin</dt>
                            <dd>
                                {flag(ev.country)} {[ev.city, countryLabel(ev.country)].filter(Boolean).join(", ")}
                                {ev.lat != null && <span className="muted"> ({ev.lat.toFixed(2)}, {ev.lon!.toFixed(2)})</span>}
                            </dd>
                            <dt>Resource</dt>
                            <dd>{ev.resource_name ?? ev.resource_id ?? "—"}</dd>
                            <dt>Site</dt>
                            <dd>{ev.site_name ?? ev.site_id ?? "—"}</dd>
                            <dt>Actor</dt>
                            <dd>{ev.actor ?? "anonymous"}</dd>
                            {ev.host && (
                                <>
                                    <dt>{ev.kind === "connection" ? "Destination" : "Host / path"}</dt>
                                    <dd className="mono">
                                        {ev.method} {ev.host}
                                        {ev.path}
                                    </dd>
                                </>
                            )}
                            {ev.user_agent && (
                                <>
                                    <dt>User agent</dt>
                                    <dd className="mono">{ev.user_agent}</dd>
                                </>
                            )}
                        </dl>
                        {ev.raw != null && (
                            <>
                                <div className="panel-h">
                                    <h3>Raw Pangolin log</h3>
                                </div>
                                <pre>{JSON.stringify(ev.raw, null, 2)}</pre>
                            </>
                        )}
                    </div>
                )}
            </aside>
        </>
    );
}
