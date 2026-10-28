import { useEffect, useState } from "react";
import { ArrowLeftRight, Download } from "lucide-react";
import { api, filterParams, fmtNum, type Filters, type Pivot } from "../api";
import { GROUP_OPTIONS } from "./GroupPanel";

const METRICS = [
    ["count", "Events"],
    ["denied", "Denied"],
    ["ips", "Unique IPs"]
] as const;

/** Dimensions that map onto a structured filter when a cell is clicked; the rest become query terms. */
function drill(f: Filters, dim: string, key: string): Filters {
    if (dim === "country") return { ...f, countries: [...new Set([...f.countries, key])] };
    if (dim === "resource") return { ...f, resources: [...new Set([...f.resources, key])] };
    if (dim === "site") return { ...f, sites: [...new Set([...f.sites, key])] };
    if (dim === "kind") return { ...f, kinds: [...new Set([...f.kinds, key as Filters["kinds"][number]])] };
    if (dim === "ip") return { ...f, ip: key };
    const field = { actor: "user", host: "host", path: "path", user_agent: "agent", city: "city" }[dim];
    if (!field) return f;
    const value = dim === "city" ? key.split("/")[1] : key === "(anonymous)" ? "anonymous" : key;
    return { ...f, q: `${f.q} ${field}:"${value}"`.trim() };
}

export function ExploreView({ filters, setFilters, onDrill }: { filters: Filters; setFilters: (f: Filters) => void; onDrill: () => void }) {
    const [rows, setRows] = useState(() => localStorage.getItem("ptv.pivot.rows") ?? "country");
    const [cols, setCols] = useState(() => localStorage.getItem("ptv.pivot.cols") ?? "resource");
    const [metric, setMetric] = useState("count");
    const [data, setData] = useState<Pivot | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const filterKey = JSON.stringify(filters);

    useEffect(() => {
        localStorage.setItem("ptv.pivot.rows", rows);
        localStorage.setItem("ptv.pivot.cols", cols);
        setErr(null);
        api<Pivot>("/api/pivot", { params: { ...filterParams(filters), rows, cols, metric, nrows: "40", ncols: "16" } }).then(setData, (e) => setErr(e.message));
    }, [rows, cols, metric, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const max = data ? Math.max(1, ...data.cells.flat()) : 1;
    const csv = () => {
        if (!data) return;
        const q = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`;
        const lines = [[q(`${rows} \\ ${cols}`), ...data.cols.map((c) => q(c.label))].join(","), ...data.rows.map((r, i) => [q(r.label), ...data.cells[i]].join(","))];
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
        a.download = `pivot-${rows}-by-${cols}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    return (
        <div className="min-h-0 flex-1 overflow-auto">
            <div className="flex flex-col gap-4 p-4 md:p-6">
                <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                    <span className="section-title">Rows</span>
                    <select className="input" value={rows} onChange={(e) => setRows(e.target.value)}>
                        {GROUP_OPTIONS.map(([v, l]) => (
                            <option key={v} value={v}>
                                {l}
                            </option>
                        ))}
                    </select>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => (setRows(cols), setCols(rows))} title="Swap rows and columns" aria-label="Swap rows and columns">
                        <ArrowLeftRight />
                    </button>
                    <span className="section-title">Columns</span>
                    <select className="input" value={cols} onChange={(e) => setCols(e.target.value)}>
                        {GROUP_OPTIONS.map(([v, l]) => (
                            <option key={v} value={v}>
                                {l}
                            </option>
                        ))}
                    </select>
                    <span className="section-title ml-2">Show</span>
                    <div className="seg">
                        {METRICS.map(([v, l]) => (
                            <button key={v} className={metric === v ? "on" : ""} onClick={() => setMetric(v)}>
                                {l}
                            </button>
                        ))}
                    </div>
                    <span className="flex-1" />
                    <button className="btn btn-secondary btn-sm" onClick={csv} disabled={!data}>
                        <Download /> CSV
                    </button>
                </div>

                {err && <p className="text-xs text-danger">{err}</p>}
                {data && (
                    <div className="card overflow-auto">
                        <table className="w-full border-collapse text-[0.8125rem]">
                            <thead>
                                <tr>
                                    <th className="sticky top-0 left-0 z-[2] border-b border-border bg-card px-3 py-2 text-left text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">
                                        {GROUP_OPTIONS.find((g) => g[0] === rows)?.[1]} \ {GROUP_OPTIONS.find((g) => g[0] === cols)?.[1]}
                                    </th>
                                    {data.cols.map((c) => (
                                        <th key={c.key} className="sticky top-0 z-[1] max-w-[140px] border-b border-border bg-card px-2 py-2 text-right text-xs font-medium" title={c.label}>
                                            <div className="truncate">{c.label}</div>
                                            <div className="font-normal text-muted-foreground tabular-nums">{fmtNum(c.total)}</div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.map((r, i) => (
                                    <tr key={r.key ?? "null"}>
                                        <th className="sticky left-0 z-[1] max-w-[220px] border-b border-border/60 bg-card px-3 py-1.5 text-left font-normal" title={r.label}>
                                            <div className="flex items-center gap-2">
                                                <span className="truncate">{r.label ?? "—"}</span>
                                                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{fmtNum(r.total)}</span>
                                            </div>
                                        </th>
                                        {data.cells[i].map((v, j) => (
                                            <td key={j} className="border-b border-l border-border/60 p-0 text-right tabular-nums">
                                                <button
                                                    className="block h-full w-full px-2 py-1.5 text-right hover:outline hover:outline-2 hover:-outline-offset-2 hover:outline-primary disabled:cursor-default"
                                                    disabled={!v}
                                                    title={`${r.label} × ${data.cols[j].label}: ${fmtNum(v)} — click to drill in`}
                                                    style={{ background: v ? `color-mix(in oklch, ${metric === "denied" ? "var(--denied)" : "var(--primary)"} ${Math.round(8 + 62 * Math.sqrt(v / max))}%, transparent)` : undefined }}
                                                    onClick={() => (setFilters(drill(drill(filters, rows, r.key), cols, data.cols[j].key)), onDrill())}
                                                >
                                                    {v ? fmtNum(v) : <span className="text-muted-foreground/40">·</span>}
                                                </button>
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {data.rows.length === 0 && <p className="p-6 text-center text-[0.8125rem] text-muted-foreground">No events in this range.</p>}
                    </div>
                )}
                <p className="text-xs text-muted-foreground">Top 40 rows × 16 columns by the chosen measure. Click a cell to open those events on the Traffic page.</p>
            </div>
        </div>
    );
}
