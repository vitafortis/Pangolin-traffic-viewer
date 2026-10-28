import { useEffect, useState } from "react";
import { Bell, Filter, Globe2, ShieldBan, User } from "lucide-react";
import { ago, api, filterParams, fmtNum, fmtTime, type Conditions, type Entity, type EntityProfile, type Filters, type GeoAttribution, type GroupRow, type PolicyDraft } from "../api";
import { Drawer } from "./Drawer";
import { EntityLink, Verdict } from "./EventsTable";
import { GeoCredit } from "./GeoCredit";

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "denied" }) {
    return (
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <div className={`text-base font-semibold tabular-nums ${tone === "denied" ? "text-denied" : ""}`}>{value}</div>
            <div className="section-title">{label}</div>
        </div>
    );
}

function List({ title, rows, render }: { title: string; rows: GroupRow[]; render?: (r: GroupRow) => React.ReactNode }) {
    if (!rows.length) return null;
    const max = Math.max(1, ...rows.map((r) => r.count));
    return (
        <section className="px-4 py-3">
            <div className="section-title mb-2">{title}</div>
            <ul className="space-y-1">
                {rows.map((r) => (
                    <li key={r.key ?? "null"} className="relative flex items-center gap-2 rounded px-2 py-1 text-[0.8125rem]">
                        <div className="absolute inset-y-0 left-0 rounded bg-primary-soft" style={{ width: `${(r.count / max) * 100}%` }} />
                        <span className="relative min-w-0 flex-1 truncate">{render ? render(r) : r.label ?? "—"}</span>
                        <span className="relative tabular-nums">{fmtNum(r.count)}</span>
                        <span className={`relative w-12 text-right tabular-nums ${r.denied ? "text-denied" : "text-muted-foreground"}`}>{fmtNum(r.denied)}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

/** Mini bar timeline of activity for the entity across the selected range. */
function Spark({ rows, step }: { rows: { t: number; count: number; denied: number }[]; step: number }) {
    if (!rows.length) return null;
    const t0 = rows[0].t;
    const n = Math.max(1, Math.round((rows[rows.length - 1].t - t0) / step) + 1);
    const max = Math.max(1, ...rows.map((r) => r.count));
    return (
        <svg viewBox={`0 0 ${n} 40`} preserveAspectRatio="none" className="h-10 w-full" role="img" aria-label="Activity over time">
            {rows.map((r) => {
                const x = (r.t - t0) / step;
                const h = (r.count / max) * 38;
                const hd = (r.denied / max) * 38;
                return (
                    <g key={r.t}>
                        <rect x={x + 0.1} y={40 - h} width={0.8} height={h - hd} fill="var(--allowed)" />
                        <rect x={x + 0.1} y={40 - hd} width={0.8} height={hd} fill="var(--denied)" />
                    </g>
                );
            })}
        </svg>
    );
}

export function EntityDrawer({
    entity,
    filters,
    attribution,
    onClose,
    onOpenEntity,
    onFilter,
    onBlock,
    onAlert
}: {
    entity: Entity;
    filters: Filters;
    attribution: GeoAttribution | null | undefined;
    onClose: () => void;
    onOpenEntity: (e: Entity) => void;
    onFilter: (e: Entity) => void;
    onBlock: (d: PolicyDraft) => void;
    onAlert: (name: string, c: Conditions) => void;
}) {
    const [p, setP] = useState<EntityProfile | null>(null);
    const [err, setErr] = useState<string | null>(null);
    useEffect(() => {
        setP(null);
        api<EntityProfile>("/api/entity", { params: { ...filterParams(filters), type: entity.type, value: entity.value } }).then(setP, (e) => setErr(e.message));
    }, [entity.type, entity.value]); // eslint-disable-line react-hooks/exhaustive-deps

    const isIp = entity.type === "ip";
    const v4 = isIp && /^\d+\.\d+\.\d+\.\d+$/.test(entity.value);
    const topResource = p?.resources[0]?.key?.split(":").map(Number);
    const blockDraft = (match: "IP" | "CIDR", value: string): PolicyDraft => ({
        connectionId: topResource?.[0],
        resourceId: topResource?.[1],
        rules: [{ action: "DROP", match, value }],
        note: `From investigation of ${entity.value}`
    });

    return (
        <Drawer
            width={620}
            title={
                <span className="inline-flex items-center gap-2">
                    {isIp ? <Globe2 className="size-4 text-muted-foreground" /> : <User className="size-4 text-muted-foreground" />}
                    <span className={isIp ? "font-mono" : ""}>{entity.value}</span>
                </span>
            }
            subtitle={p ? `Seen ${fmtNum(p.allTime.total)} times since ${p.allTime.first_ts ? fmtTime(p.allTime.first_ts) : "—"} · last ${ago(p.allTime.last_ts)}` : isIp ? "IP address" : "User"}
            onClose={onClose}
        >
            <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
                <button className="btn btn-secondary btn-sm" onClick={() => (onFilter(entity), onClose())}>
                    <Filter /> Filter to {isIp ? "this IP" : "this user"}
                </button>
                {isIp && (
                    <button className="btn btn-danger btn-sm" onClick={() => onBlock(blockDraft("IP", entity.value))}>
                        <ShieldBan /> Block IP…
                    </button>
                )}
                {v4 && (
                    <button className="btn btn-secondary btn-sm" onClick={() => onBlock(blockDraft("CIDR", entity.value.split(".").slice(0, 3).join(".") + ".0/24"))}>
                        <ShieldBan /> Block /24…
                    </button>
                )}
                <button
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                        onAlert(
                            isIp ? `Activity from ${entity.value}` : `Activity by ${entity.value}`,
                            isIp ? { ipCidrs: [entity.value] } : { text: entity.value }
                        )
                    }
                >
                    <Bell /> Alert on activity…
                </button>
            </div>

            {err && <p className="p-4 text-xs text-danger">{err}</p>}
            {!p && !err && <p className="p-4 text-xs text-muted-foreground">Loading…</p>}
            {p && (
                <>
                    <div className="grid grid-cols-2 gap-2 px-4 pt-3 sm:grid-cols-4">
                        <Tile label="Events" value={fmtNum(p.summary.total)} />
                        <Tile label="Denied" value={fmtNum(p.summary.denied)} tone={p.summary.denied ? "denied" : undefined} />
                        <Tile label={isIp ? "Users" : "IPs"} value={fmtNum(isIp ? p.summary.actors : p.summary.ips)} />
                        <Tile label="Countries" value={fmtNum(p.summary.countries)} />
                    </div>
                    <div className="px-4 pt-3">
                        <Spark rows={p.timeline.rows} step={p.timeline.step} />
                        <div className="flex justify-between text-[0.6875rem] text-muted-foreground">
                            <span>{p.summary.first_ts ? fmtTime(p.summary.first_ts) : ""}</span>
                            <span>in selected range</span>
                            <span>{p.summary.last_ts ? fmtTime(p.summary.last_ts) : ""}</span>
                        </div>
                    </div>
                    <div className="grid sm:grid-cols-2">
                        <List title="Resources" rows={p.resources} />
                        <div>
                            <List title="Locations" rows={p.locations} />
                            <div className="px-6 pb-2">
                                <GeoCredit attribution={attribution} />
                            </div>
                        </div>
                        <List
                            title={isIp ? "Users from this IP" : "IPs used"}
                            rows={p.related}
                            render={(r) =>
                                r.key === "(anonymous)" ? <span className="text-muted-foreground">anonymous</span> : <EntityLink entity={{ type: isIp ? "actor" : "ip", value: r.key }} onOpen={onOpenEntity} className={isIp ? "" : "font-mono text-xs"} />
                            }
                        />
                        {p.neighbours.length > 0 && (
                            <List
                                title="Same /24"
                                rows={p.neighbours.map((n) => ({ ...n, label: n.key, ips: 1, countries: 1, last_ts: 0 }))}
                                render={(r) => <EntityLink entity={{ type: "ip", value: r.key }} onOpen={onOpenEntity} className="font-mono text-xs" />}
                            />
                        )}
                    </div>
                    <List title="Requests" rows={p.paths} render={(r) => <span className="font-mono text-xs">{r.label}</span>} />
                    <List title="User agents" rows={p.agents} render={(r) => <span className="font-mono text-xs">{r.label ?? "—"}</span>} />
                    <section className="pb-4">
                        <div className="section-title px-4 pt-3 pb-2">Recent events</div>
                        <table className="data-table">
                            <tbody>
                                {p.recent.map((e) => (
                                    <tr key={e.id}>
                                        <td className="text-muted-foreground tabular-nums">{fmtTime(e.ts)}</td>
                                        <td>
                                            <Verdict allowed={e.allowed} />
                                        </td>
                                        <td>{e.resource_name ?? "—"}</td>
                                        <td className="font-mono text-xs">{e.kind === "access" ? `auth: ${e.method}` : `${e.method ?? ""} ${e.path ?? ""}`}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                </>
            )}
        </Drawer>
    );
}
