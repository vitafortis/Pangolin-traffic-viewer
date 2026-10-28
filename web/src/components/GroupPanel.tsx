import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { ago, flag, fmtNum, type GroupRow } from "../api";

export const GROUP_OPTIONS = [
    ["country", "Origin country"],
    ["city", "Origin city"],
    ["ip", "Source IP"],
    ["resource", "Resource"],
    ["site", "Site"],
    ["actor", "User / actor"],
    ["host", "Host"],
    ["path", "Path"],
    ["user_agent", "User agent"],
    ["kind", "Log type"]
] as const;

type Sort = { by: "count" | "denied" | "ips" | "label"; dir: 1 | -1 };

function Head({ k, sort, setSort, right, children }: { k: Sort["by"]; sort: Sort; setSort: (f: (s: Sort) => Sort) => void; right?: boolean; children: React.ReactNode }) {
    return (
        <button className={`inline-flex items-center gap-1 uppercase hover:text-foreground ${right ? "flex-row-reverse" : ""} ${sort.by === k ? "text-foreground" : ""}`} onClick={() => setSort((s) => ({ by: k, dir: s.by === k ? (s.dir === 1 ? -1 : 1) : k === "label" ? 1 : -1 }))}>
            {children}
            {sort.by === k && (sort.dir === -1 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
        </button>
    );
}

export function GroupPanel({ by, setBy, rows, onPick }: { by: string; setBy: (b: string) => void; rows: GroupRow[]; onPick: (row: GroupRow) => void }) {
    const [sort, setSort] = useState<Sort>({ by: "count", dir: -1 });
    const max = Math.max(1, ...rows.map((r) => r.count));
    const pickable = ["country", "ip", "resource", "site", "actor"].includes(by);
    const sorted = [...rows].sort((a, b) => (sort.by === "label" ? String(a.label ?? "").localeCompare(String(b.label ?? "")) : a[sort.by] - b[sort.by]) * sort.dir);
    return (
        <>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <span className="section-title">Group by</span>
                <select className="input flex-1" value={by} onChange={(e) => setBy(e.target.value)}>
                    {GROUP_OPTIONS.map(([v, l]) => (
                        <option key={v} value={v}>
                            {l}
                        </option>
                    ))}
                </select>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
                <table className="data-table table-fixed">
                    <colgroup>
                        <col />
                        <col className="w-[64px]" />
                        <col className="w-[56px]" />
                        <col className="w-[64px]" />
                    </colgroup>
                    <thead>
                        <tr>
                            <th>
                                <Head k="label" sort={sort} setSort={setSort}>{GROUP_OPTIONS.find((g) => g[0] === by)?.[1]}</Head>
                            </th>
                            <th className="text-right">
                                <Head k="count" sort={sort} setSort={setSort} right>Events</Head>
                            </th>
                            <th className="text-right">
                                <Head k="denied" sort={sort} setSort={setSort} right>Denied</Head>
                            </th>
                            <th className="text-right">
                                <Head k="ips" sort={sort} setSort={setSort} right>IPs</Head>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((r) => (
                            <tr key={r.key ?? "null"} className={pickable ? "click" : ""} onClick={() => pickable && onPick(r)} title={`${r.label ?? "—"} · last seen ${ago(r.last_ts)}${pickable ? (by === "ip" || by === "actor" ? " · click to investigate" : " · click to filter") : ""}`}>
                                <td className="relative max-w-none">
                                    {/* Share of the largest row; the denied share sits at its right end. */}
                                    <div className="absolute inset-y-1 left-0 flex overflow-hidden rounded-r-[4px]" style={{ width: `${(r.count / max) * 100}%` }}>
                                        <div className="flex-1 bg-primary-soft" />
                                        <div className="bg-denied/25" style={{ width: `${(r.denied / Math.max(1, r.count)) * 100}%` }} />
                                    </div>
                                    <span className={`relative ${by === "ip" || by === "path" || by === "user_agent" ? "font-mono text-xs" : ""}`}>
                                        {by === "country" ? `${flag(r.key)} ` : ""}
                                        {r.label ?? "—"}
                                    </span>
                                </td>
                                <td className="text-right tabular-nums">{fmtNum(r.count)}</td>
                                <td className={`text-right tabular-nums ${r.denied ? "text-denied" : "text-muted-foreground"}`}>{fmtNum(r.denied)}</td>
                                <td className="text-right text-muted-foreground tabular-nums">{fmtNum(r.ips)}</td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={4} className="py-8 text-center text-muted-foreground">
                                    No events in this range
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </>
    );
}
