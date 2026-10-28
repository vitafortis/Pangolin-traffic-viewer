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
            <div className="panel-h">
                <h3>Group by</h3>
                <select className="input" value={by} onChange={(e) => setBy(e.target.value)} style={{ flex: 1 }}>
                    {GROUP_OPTIONS.map(([v, l]) => (
                        <option key={v} value={v}>
                            {l}
                        </option>
                    ))}
                </select>
            </div>
            <div className="scroll">
                <table className="grid">
                    <thead>
                        <tr>
                            <th>{GROUP_OPTIONS.find((g) => g[0] === by)?.[1]}</th>
                            <th className="num">Events</th>
                            <th className="num">Denied</th>
                            <th className="num">IPs</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.key ?? "null"} className={pickable ? "click" : ""} onClick={() => pickable && onPick(r)} title={`${r.label ?? "—"} · last seen ${ago(r.last_ts)}`}>
                                <td className="bar-cell" style={{ maxWidth: 180 }}>
                                    <div className="bar" style={{ width: `${(r.count / max) * 100}%` }}>
                                        <div className="dn" style={{ width: `${(r.denied / Math.max(1, r.count)) * 100}%` }} />
                                    </div>
                                    <span className={by === "ip" || by === "path" ? "mono" : ""}>
                                        {by === "country" ? `${flag(r.key)} ` : ""}
                                        {r.label ?? "—"}
                                    </span>
                                </td>
                                <td className="num">{fmtNum(r.count)}</td>
                                <td className="num" style={{ color: r.denied ? "var(--denied)" : undefined }}>{fmtNum(r.denied)}</td>
                                <td className="num muted">{fmtNum(r.ips)}</td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={4} className="muted" style={{ padding: 16, textAlign: "center" }}>
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
