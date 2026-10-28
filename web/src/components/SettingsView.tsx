import { useState } from "react";
import { Plus } from "lucide-react";
import { ago, api, type Connection, type Meta, type Site } from "../api";
import { GeoCredit } from "./GeoCredit";

type ConnDraft = { id?: number; name: string; base_url: string; org_id: string; api_key: string; poll_interval_s: number; enabled: boolean };
type TestResult = { ok: boolean; error?: string; sites?: number; resources?: number; logs?: Record<string, string> };

const DEFAULT_URL = "https://api.pangolin.net/v1";

export function SettingsView({ meta, reload, onPlace }: { meta: Meta | null; reload: () => void; onPlace: (s: Site) => void }) {
    const [draft, setDraft] = useState<ConnDraft | null>(null);
    const [test, setTest] = useState<TestResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [syncing, setSyncing] = useState<number | null>(null);

    const edit = (c?: Connection) => {
        setTest(null);
        setErr(null);
        setDraft(c ? { id: c.id, name: c.name, base_url: c.base_url, org_id: c.org_id, api_key: "", poll_interval_s: c.poll_interval_s, enabled: c.enabled } : { name: "", base_url: DEFAULT_URL, org_id: "", api_key: "", poll_interval_s: 60, enabled: true });
    };

    const runTest = async () => {
        if (!draft) return;
        setBusy(true);
        setTest(await api<TestResult>("/api/connections/test", { method: "POST", body: { ...draft, id: undefined } }).catch((e) => ({ ok: false, error: e.message })));
        setBusy(false);
    };

    const save = async () => {
        if (!draft) return;
        try {
            const { id, api_key, ...rest } = draft;
            const body = api_key ? { ...rest, api_key } : rest;
            if (id) await api(`/api/connections/${id}`, { method: "PATCH", body });
            else await api("/api/connections", { method: "POST", body });
            setDraft(null);
            setTimeout(reload, 1500);
            reload();
        } catch (e) {
            setErr((e as Error).message);
        }
    };

    const sync = async (id: number) => {
        setSyncing(id);
        await api(`/api/connections/${id}/sync`, { method: "POST" }).catch((e) => alert(e.message));
        setSyncing(null);
        reload();
    };

    const saveSite = async (s: Site, patch: Partial<Site>) => {
        const n = { ...s, ...patch };
        await api(`/api/sites/${s.connection_id}/${s.site_id}`, { method: "PATCH", body: { lat: n.lat, lon: n.lon, place_label: n.place_label } });
        reload();
    };

    const geolocate = async (s: Site) => {
        const ip = prompt(`Public IP of ${s.name} (its WAN address):`);
        if (!ip) return;
        const g = await api<{ lat: number | null; lon: number | null; city: string | null; country: string | null }>("/api/geoip", { params: { ip } });
        if (g.lat == null) return alert(meta?.geoip ? "No location found for that IP." : "No GeoIP database loaded. Run `npm run geoip:download` and restart, or place the site on the globe.");
        await saveSite(s, { lat: g.lat, lon: g.lon, place_label: [g.city, g.country].filter(Boolean).join(", ") });
    };

    return (
        <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 md:p-6">
                <div className="card">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                        <h3 className="text-[0.9375rem] font-semibold">Pangolin connections</h3>
                        <span className="flex-1" />
                        <button className="btn btn-primary btn-sm" onClick={() => edit()}>
                            <Plus /> Add connection
                        </button>
                    </div>
                    {draft && (
                        <div className="grid grid-cols-1 items-center gap-x-4 gap-y-3 border-b border-border p-4 md:grid-cols-[160px_1fr]">
                            <label className="text-[0.8125rem] text-muted-foreground">Name</label>
                            <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Production org" />
                            <label className="text-[0.8125rem] text-muted-foreground">API base URL</label>
                            <div>
                                <input className="input w-full" value={draft.base_url} onChange={(e) => setDraft({ ...draft, base_url: e.target.value })} />
                                <div className="text-xs text-muted-foreground">Pangolin Cloud: {DEFAULT_URL}. Self-hosted: your Integration API URL, e.g. https://api.example.com/v1</div>
                            </div>
                            <label className="text-[0.8125rem] text-muted-foreground">Organization ID</label>
                            <input className="input" value={draft.org_id} onChange={(e) => setDraft({ ...draft, org_id: e.target.value })} placeholder="my-org" />
                            <label className="text-[0.8125rem] text-muted-foreground">API key</label>
                            <div>
                                <input className="input w-full" type="password" autoComplete="off" value={draft.api_key} onChange={(e) => setDraft({ ...draft, api_key: e.target.value })} placeholder={draft.id ? "(unchanged)" : "Org API key"} />
                                <div className="text-xs text-muted-foreground">Create in Pangolin → Organization → API Keys. Grant read access to logs, sites, and resources. Stored encrypted.</div>
                            </div>
                            <label className="text-[0.8125rem] text-muted-foreground">Poll every</label>
                            <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                                <input className="input w-24" type="number" min={10} value={draft.poll_interval_s} onChange={(e) => setDraft({ ...draft, poll_interval_s: Number(e.target.value) })} /> seconds
                                <label>
                                    <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled
                                </label>
                            </div>
                            <span />
                            <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                                <button className="btn btn-secondary btn-sm" onClick={runTest} disabled={busy || !draft.org_id || !draft.api_key}>
                                    {busy ? "Testing…" : "Test connection"}
                                </button>
                                <button className="btn btn-primary btn-sm" onClick={save} disabled={!draft.name || !draft.org_id || (!draft.id && !draft.api_key)}>
                                    Save
                                </button>
                                <button className="btn btn-secondary btn-sm" onClick={() => setDraft(null)}>
                                    Cancel
                                </button>
                                {err && <span className="text-xs text-danger">{err}</span>}
                            </div>
                            {test && (
                                <>
                                    <span />
                                    <div className={`text-[0.8125rem] ${test.ok ? "" : "text-danger"}`}>
                                        {test.ok ? (
                                            <>
                                                <span className="text-success">Connected.</span> {test.sites} sites, {test.resources} resources. Logs:{" "}
                                                {Object.entries(test.logs ?? {}).map(([k, v]) => (
                                                    <span key={k} className="mr-3">
                                                        {k} <span className={v === "ok" ? "text-success" : "text-danger"}>{v === "ok" ? "✓" : `✗ ${v}`}</span>
                                                    </span>
                                                ))}
                                            </>
                                        ) : (
                                            test.error
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    <div className="overflow-x-auto"><table className="data-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Org</th>
                                <th>Last poll</th>
                                <th>Status</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {meta?.connections.map((c) => (
                                <tr key={c.id}>
                                    <td>
                                        <span className="inline-flex items-center gap-2"><span className={`size-2 rounded-full ${c.enabled ? "bg-success" : "bg-muted-foreground/40"}`} title={c.enabled ? "Enabled" : "Disabled"} />{c.name}{c.demo && <span className="badge badge-warning">demo</span>}</span>
                                    </td>
                                    <td className="font-mono text-xs">{c.org_id}</td>
                                    <td className="text-muted-foreground">{ago(c.last_poll_at)}</td>
                                    <td className="max-w-[340px] whitespace-normal">
                                        {c.last_error ? <span className="text-xs text-danger">{c.last_error}</span> : <span className="text-success">OK</span>}
                                        {c.disabled_kinds.length > 0 && <div className="text-xs text-muted-foreground">Unavailable: {c.disabled_kinds.join(", ")} logs</div>}
                                    </td>
                                    <td className="text-right">
                                        <button className="btn btn-ghost btn-sm" onClick={() => sync(c.id)} disabled={syncing === c.id}>
                                            {syncing === c.id ? "Syncing…" : "Sync now"}
                                        </button>
                                        {!c.demo && (
                                            <button className="btn btn-ghost btn-sm" onClick={() => edit(c)}>
                                                Edit
                                            </button>
                                        )}
                                        <button
                                            className="btn btn-ghost btn-sm hover:text-danger"
                                            onClick={async () => {
                                                if (confirm(`Remove "${c.name}" and all of its stored events?`)) {
                                                    await api(`/api/connections/${c.id}`, { method: "DELETE" });
                                                    reload();
                                                }
                                            }}
                                        >
                                            Remove
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {meta?.connections.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                                        Add a Pangolin API key to start pulling traffic.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table></div>
                </div>

                <div className="card">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                        <h3 className="text-[0.9375rem] font-semibold">Site locations</h3>
                        <span className="text-xs text-muted-foreground">Pangolin doesn't know where your sites are. Place them so traffic arcs have a destination.</span>
                    </div>
                    <div className="overflow-x-auto"><table className="data-table">
                        <thead>
                            <tr>
                                <th>Site</th>
                                <th>Label</th>
                                <th>Latitude</th>
                                <th>Longitude</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {meta?.sites.map((s) => (
                                <tr key={`${s.connection_id}:${s.site_id}`}>
                                    <td>
                                        <span className="inline-flex items-center gap-2"><span className={`size-2 rounded-full ${s.online ? "bg-success" : "bg-muted-foreground/40"}`} title={s.online ? "Online" : "Offline"} />{s.name}</span>
                                    </td>
                                    <td>
                                        <input className="input" defaultValue={s.place_label ?? ""} placeholder="City" onBlur={(e) => e.target.value !== (s.place_label ?? "") && saveSite(s, { place_label: e.target.value || null })} />
                                    </td>
                                    <td>
                                        <input className="input w-24" defaultValue={s.lat ?? ""} key={`lat${s.lat}`} onBlur={(e) => saveSite(s, { lat: e.target.value === "" ? null : Number(e.target.value) })} />
                                    </td>
                                    <td>
                                        <input className="input w-24" defaultValue={s.lon ?? ""} key={`lon${s.lon}`} onBlur={(e) => saveSite(s, { lon: e.target.value === "" ? null : Number(e.target.value) })} />
                                    </td>
                                    <td className="text-right">
                                        <button className="btn btn-ghost btn-sm" onClick={() => onPlace(s)}>
                                            Place on globe
                                        </button>
                                        <button className="btn btn-ghost btn-sm" onClick={() => geolocate(s)}>
                                            From IP
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {meta?.sites.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                                        Sites appear after the first sync.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table></div>
                </div>

                <div className="card">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                        <h3 className="text-[0.9375rem] font-semibold">Geolocation</h3>
                    </div>
                    <div className="p-4 text-[0.8125rem]">
                        {meta?.geoip ? (
                            <>
                                <span className="text-success">City-level GeoIP database loaded.</span> <GeoCredit attribution={meta?.geoAttribution} />
                            </>
                        ) : (
                            <>
                                <span>Using Pangolin's country codes only, so origins are placed at country centroids.</span>
                                <div className="mt-1.5 text-xs text-muted-foreground">
                                    For city-level placement run <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">npm run geoip:download</code> (DB-IP City Lite, CC BY 4.0) or drop a MaxMind GeoLite2-City.mmdb into <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">data/geo/</code>, then restart.
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
