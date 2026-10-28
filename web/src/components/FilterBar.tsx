import { useEffect, useState } from "react";
import { RANGES, emptyFilters, flag, type Filters, type Kind, type Meta } from "../api";
import { MultiSelect } from "./MultiSelect";

export function FilterBar({ meta, filters, setFilters }: { meta: Meta | null; filters: Filters; setFilters: (f: Filters) => void }) {
    const [q, setQ] = useState(filters.q);
    useEffect(() => setQ(filters.q), [filters.q]);
    useEffect(() => {
        const t = setTimeout(() => q !== filters.q && setFilters({ ...filters, q }), 350);
        return () => clearTimeout(t);
    }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

    const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters({ ...filters, [k]: v });
    const multiConn = (meta?.connections.length ?? 0) > 1;
    const connName = (id: number) => meta?.connections.find((c) => c.id === id)?.name ?? `#${id}`;
    const active = filters.kinds.length + filters.sites.length + filters.resources.length + filters.countries.length + filters.connections.length + (filters.allowed ? 1 : 0) + (filters.q ? 1 : 0) + (filters.ip ? 1 : 0);

    return (
        <div className="filters">
            <div className="seg" role="group" aria-label="Time range">
                {Object.keys(RANGES).map((r) => (
                    <button key={r} className={filters.range === r ? "on" : ""} onClick={() => setFilters({ ...filters, range: r, from: undefined, to: undefined })}>
                        {r}
                    </button>
                ))}
                {filters.range === "custom" && <button className="on">custom</button>}
            </div>
            <input className="input search" placeholder="Search IP, host, path, user, agent…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="seg" role="group" aria-label="Verdict">
                {([["", "All"], ["1", "Allowed"], ["0", "Denied"]] as const).map(([v, l]) => (
                    <button key={v} className={filters.allowed === v ? "on" : ""} onClick={() => set("allowed", v)}>
                        {l}
                    </button>
                ))}
            </div>
            <MultiSelect
                label="Log type"
                value={filters.kinds}
                onChange={(v) => set("kinds", v as Kind[])}
                options={[
                    { value: "request", label: "HTTP requests" },
                    { value: "access", label: "Auth / access" },
                    { value: "connection", label: "Private connections" }
                ]}
            />
            <MultiSelect
                label="Sites"
                value={filters.sites}
                onChange={(v) => set("sites", v)}
                options={(meta?.sites ?? []).map((s) => ({ value: `${s.connection_id}:${s.site_id}`, label: s.name, hint: multiConn ? connName(s.connection_id) : s.place_label ?? undefined }))}
            />
            <MultiSelect
                label="Resources"
                value={filters.resources}
                onChange={(v) => set("resources", v)}
                options={(meta?.resources ?? []).map((r) => ({ value: `${r.connection_id}:${r.resource_id}`, label: r.name, hint: r.full_domain ?? undefined }))}
            />
            <MultiSelect
                label="Origin"
                value={filters.countries}
                onChange={(v) => set("countries", v)}
                options={(meta?.countries ?? []).map((c) => ({ value: c.code, label: `${flag(c.code)} ${c.name}`, hint: c.code }))}
            />
            {multiConn && (
                <MultiSelect label="Orgs" value={filters.connections} onChange={(v) => set("connections", v)} options={meta!.connections.map((c) => ({ value: String(c.id), label: c.name }))} />
            )}
            {filters.ip && (
                <span className="chip">
                    ip: {filters.ip}
                    <button onClick={() => set("ip", "")} aria-label="Remove IP filter">×</button>
                </span>
            )}
            {active > 0 && (
                <button className="btn ghost" onClick={() => setFilters({ ...emptyFilters(), range: filters.range, from: filters.from, to: filters.to })}>
                    Reset filters
                </button>
            )}
        </div>
    );
}
