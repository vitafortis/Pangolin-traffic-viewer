import { useCallback, useEffect, useState } from "react";
import { Bookmark, Check, CircleHelp, Download, Link2, Search, Trash2, X } from "lucide-react";
import { RANGES, api, downloadUrl, emptyFilters, filterParams, flag, type Filters, type Kind, type Meta, type SavedView } from "../api";
import { MultiSelect } from "./MultiSelect";
import { Popover, menuItem } from "./Drawer";

const QUERY_HELP: [string, string][] = [
    ["country:RU,CN", "origin country (ISO code); commas mean OR"],
    ["verdict:deny", "allow / deny"],
    ["ip:45.0.0.0/8", "exact IP, CIDR range or 45.12.*"],
    ["path:/wp-*", "* makes an anchored glob; plain text matches anywhere"],
    ["host:git  method:POST", "request host and method"],
    ["resource:grafana  site:frankfurt", "resource or site name (or id)"],
    ["user:alice  user:anonymous", "signed-in user, or no user"],
    ["agent:curl  city:berlin", "user agent, origin city"],
    ["kind:access  reason:203", "log type; Pangolin reason code"],
    ["-country:US", "a leading - excludes matches"],
    ['"some text"', "anything else searches IP, host, path, user, agent, resource and city"]
];

export function FilterBar({
    meta,
    filters,
    setFilters,
    viewExtras,
    onApplyView
}: {
    meta: Meta | null;
    filters: Filters;
    setFilters: (f: Filters) => void;
    /** Extra page state saved with a view (group-by, tab). */
    viewExtras: Omit<SavedView["state"], "filters">;
    onApplyView: (v: SavedView) => void;
}) {
    const [q, setQ] = useState(filters.q);
    const [help, setHelp] = useState(false);
    const [viewsOpen, setViewsOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [views, setViews] = useState<SavedView[]>([]);
    const [naming, setNaming] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    useEffect(() => setQ(filters.q), [filters.q]);
    useEffect(() => {
        const t = setTimeout(() => q !== filters.q && setFilters({ ...filters, q }), 400);
        return () => clearTimeout(t);
    }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

    const loadViews = useCallback(() => api<SavedView[]>("/api/views").then(setViews), []);
    useEffect(() => {
        loadViews();
    }, [loadViews]);

    const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters({ ...filters, [k]: v });
    const multiConn = (meta?.connections.length ?? 0) > 1;
    const connName = (id: number) => meta?.connections.find((c) => c.id === id)?.name ?? `#${id}`;
    const active =
        filters.kinds.length + filters.sites.length + filters.resources.length + filters.countries.length + filters.connections.length + (filters.allowed ? 1 : 0) + (filters.q ? 1 : 0) + (filters.ip ? 1 : 0);

    const saveView = async () => {
        if (!naming?.trim()) return;
        const { from: _f, to: _t, ...rest } = filters;
        await api("/api/views", { method: "POST", body: { name: naming.trim(), state: { filters: filters.range === "custom" ? filters : rest, ...viewExtras } } });
        setNaming(null);
        loadViews();
    };
    const copyLink = async () => {
        await navigator.clipboard.writeText(location.href).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
            <div className="seg" role="group" aria-label="Time range">
                {Object.keys(RANGES).map((r) => (
                    <button key={r} className={filters.range === r ? "on" : ""} onClick={() => setFilters({ ...filters, range: r, from: undefined, to: undefined })}>
                        {r}
                    </button>
                ))}
                {filters.range === "custom" && <button className="on">Custom</button>}
            </div>

            <div className="relative w-full sm:w-80 lg:w-96">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                    className="input w-full pr-8 pl-8 font-mono text-xs"
                    placeholder="country:RU verdict:deny path:/wp-* …"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && setFilters({ ...filters, q })}
                    spellCheck={false}
                    aria-label="Search or filter"
                />
                <button className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" onClick={(e) => (e.stopPropagation(), setHelp(!help))} aria-label="Query syntax">
                    <CircleHelp className="size-3.5" />
                </button>
                <Popover open={help} onClose={() => setHelp(false)} className="w-[min(92vw,460px)] p-3">
                    <div className="section-title mb-2">Query syntax</div>
                    <table className="w-full text-xs">
                        <tbody>
                            {QUERY_HELP.map(([ex, d]) => (
                                <tr key={ex} className="align-top">
                                    <td className="py-1 pr-3 whitespace-nowrap">
                                        <button className="font-mono text-primary-ink hover:underline" onClick={() => (setQ(ex.split("  ")[0]), setFilters({ ...filters, q: ex.split("  ")[0] }), setHelp(false))}>
                                            {ex}
                                        </button>
                                    </td>
                                    <td className="py-1 text-muted-foreground">{d}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <p className="mt-2 text-xs text-muted-foreground">Terms are combined with AND. Click an example to try it.</p>
                </Popover>
            </div>

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
            {multiConn && <MultiSelect label="Orgs" value={filters.connections} onChange={(v) => set("connections", v)} options={meta!.connections.map((c) => ({ value: String(c.id), label: c.name }))} />}
            {filters.ip && (
                <span className="badge badge-primary h-7 gap-1.5 pr-1 font-mono">
                    ip {filters.ip}
                    <button className="rounded p-0.5 hover:bg-primary-soft" onClick={() => set("ip", "")} aria-label="Remove IP filter">
                        <X />
                    </button>
                </span>
            )}
            {active > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ ...emptyFilters(), range: filters.range, from: filters.from, to: filters.to })}>
                    Reset
                </button>
            )}

            <span className="flex-1" />

            <div className="relative">
                <button className="btn btn-secondary btn-sm" onClick={(e) => (e.stopPropagation(), setViewsOpen(!viewsOpen))}>
                    <Bookmark /> Views
                </button>
                <Popover open={viewsOpen} onClose={() => (setViewsOpen(false), setNaming(null))} align="right" className="w-72">
                    {views.length === 0 && naming == null && <div className="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet.</div>}
                    {views.map((v) => (
                        <div key={v.id} className="group flex items-center">
                            <button className={menuItem} onClick={() => (onApplyView(v), setViewsOpen(false))}>
                                <Bookmark /> <span className="truncate">{v.name}</span>
                            </button>
                            <button
                                className="rounded p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-danger focus:opacity-100"
                                aria-label={`Delete view ${v.name}`}
                                onClick={async () => {
                                    await api(`/api/views/${v.id}`, { method: "DELETE" });
                                    loadViews();
                                }}
                            >
                                <Trash2 className="size-3.5" />
                            </button>
                        </div>
                    ))}
                    <div className="mt-1 border-t border-border pt-1.5">
                        {naming == null ? (
                            <button className={menuItem} onClick={() => setNaming("")}>
                                <Check /> Save current view…
                            </button>
                        ) : (
                            <form className="flex gap-1.5 p-1" onSubmit={(e) => (e.preventDefault(), saveView())}>
                                <input className="input min-w-0 flex-1" placeholder="View name" value={naming} onChange={(e) => setNaming(e.target.value)} autoFocus />
                                <button className="btn btn-primary btn-sm" disabled={!naming.trim()}>
                                    Save
                                </button>
                            </form>
                        )}
                    </div>
                </Popover>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={copyLink} title="Copy a link to exactly this view">
                {copied ? <Check /> : <Link2 />} {copied ? "Copied" : "Link"}
            </button>
            <div className="relative">
                <button className="btn btn-secondary btn-sm" onClick={(e) => (e.stopPropagation(), setExportOpen(!exportOpen))}>
                    <Download /> Export
                </button>
                <Popover open={exportOpen} onClose={() => setExportOpen(false)} align="right" className="w-56">
                    <a className={menuItem} href={downloadUrl("/api/export", { ...filterParams(filters), format: "csv" })} onClick={() => setExportOpen(false)}>
                        <Download /> CSV <span className="ml-auto text-xs text-muted-foreground">spreadsheets</span>
                    </a>
                    <a className={menuItem} href={downloadUrl("/api/export", { ...filterParams(filters), format: "json" })} onClick={() => setExportOpen(false)}>
                        <Download /> NDJSON <span className="ml-auto text-xs text-muted-foreground">jq, SIEMs</span>
                    </a>
                    <div className="px-2 pt-1 text-[0.6875rem] text-muted-foreground">All events matching the current filters (up to 100k).</div>
                </Popover>
            </div>
        </div>
    );
}
