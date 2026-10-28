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

export function GroupPanel({ by, setBy, rows, onPick }: { by: string; setBy: (b: string) => void; rows: GroupRow[]; onPick: (row: GroupRow) => void }) {
    const max = Math.max(1, ...rows.map((r) => r.count));
    const pickable = ["country", "ip", "resource", "site"].includes(by);
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
                        <col className="w-[68px]" />
                        <col className="w-[60px]" />
                        <col className="w-[56px]" />
                    </colgroup>
                    <thead>
                        <tr>
                            <th>{GROUP_OPTIONS.find((g) => g[0] === by)?.[1]}</th>
                            <th className="text-right">Events</th>
                            <th className="text-right">Denied</th>
                            <th className="text-right">IPs</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.key ?? "null"} className={pickable ? "click" : ""} onClick={() => pickable && onPick(r)} title={`${r.label ?? "—"} · last seen ${ago(r.last_ts)}${pickable ? " · click to filter" : ""}`}>
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
