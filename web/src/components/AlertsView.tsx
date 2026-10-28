import { useEffect, useState } from "react";
import { ago, api, fmtTime, type AlertEvent, type Channel, type Conditions, type Kind, type Meta, type Rule } from "../api";
import { TriangleAlert } from "lucide-react";
import { MultiSelect } from "./MultiSelect";
import { GeoCredit } from "./GeoCredit";

type Draft = Omit<Rule, "id" | "last_fired_at"> & { id?: number };

const TEMPLATES: { label: string; draft: Partial<Draft> }[] = [
    { label: "Blank rule", draft: {} },
    { label: "Traffic from specific countries", draft: { name: "Traffic from watched countries", conditions: { countries: ["RU", "CN", "KP", "IR"] } } },
    { label: "Access outside business hours", draft: { name: "After-hours access", conditions: { allowed: true, schedule: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, days: [1, 2, 3, 4, 5], startHour: 8, endHour: 18, mode: "outside" } } } },
    { label: "Brute force: many denials from one IP", draft: { name: "Repeated denials from one IP", conditions: { allowed: false, groupBy: "ip" }, threshold: 20, window_s: 300 } },
    { label: "First access from a new country", draft: { name: "New country for resource", conditions: { allowed: true, newCountry: true } } }
];

const blank = (): Draft => ({ name: "", enabled: true, conditions: {}, threshold: 1, window_s: 300, cooldown_s: 900, channels: [] });
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const csv = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

export function AlertsView({ meta, onAck }: { meta: Meta | null; onAck: () => void }) {
    const [rules, setRules] = useState<Rule[]>([]);
    const [events, setEvents] = useState<AlertEvent[]>([]);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [open, setOpen] = useState<number | null>(null);

    const load = () => {
        api<Rule[]>("/api/alerts/rules").then(setRules);
        api<AlertEvent[]>("/api/alerts/events").then(setEvents);
    };
    useEffect(load, []);

    const ack = async (id: number) => {
        await api(`/api/alerts/events/${id}/ack`, { method: "POST" });
        load();
        onAck();
    };

    return (
        <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 md:p-6">
                {draft ? (
                    <RuleEditor meta={meta} draft={draft} setDraft={setDraft} onSaved={() => (setDraft(null), load())} />
                ) : (
                    <div className="card">
                        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                            <h3 className="text-[0.9375rem] font-semibold">Alert rules</h3>
                            <span className="flex-1" />
                            <select className="input" value="" onChange={(e) => e.target.value !== "" && setDraft({ ...blank(), ...TEMPLATES[Number(e.target.value)].draft })}>
                                <option value="">+ New rule…</option>
                                {TEMPLATES.map((t, i) => (
                                    <option key={i} value={i}>
                                        {t.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="overflow-x-auto"><table className="grid">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Conditions</th>
                                    <th className="text-right">Threshold</th>
                                    <th>Notify</th>
                                    <th>Last fired</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {rules.map((r) => (
                                    <tr key={r.id} className="click" onClick={() => setDraft(r)}>
                                        <td>
                                            <span className="inline-flex items-center gap-2"><span className={`size-2 rounded-full ${r.enabled ? "bg-success" : "bg-muted-foreground/40"}`} title={r.enabled ? "Enabled" : "Disabled"} />{r.name}</span>
                                        </td>
                                        <td className="max-w-[380px] text-muted-foreground">{describe(r.conditions)}</td>
                                        <td className="text-right">
                                            {r.threshold}× / {Math.round(r.window_s / 60)}m{r.conditions.groupBy ? ` per ${r.conditions.groupBy}` : ""}
                                        </td>
                                        <td>{r.channels.length ? r.channels.map((c) => c.format).join(", ") : <span className="text-muted-foreground">in-app</span>}</td>
                                        <td className="text-muted-foreground">{ago(r.last_fired_at)}</td>
                                        <td className="text-right">
                                            <button
                                                className="btn btn-ghost btn-sm hover:text-danger"
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    if (confirm(`Delete rule "${r.name}"?`)) {
                                                        await api(`/api/alerts/rules/${r.id}`, { method: "DELETE" });
                                                        load();
                                                    }
                                                }}
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {rules.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="py-8 text-center text-muted-foreground">
                                            No rules yet. Start from a template above.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table></div>
                    </div>
                )}

                <div className="card">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                        <h3 className="text-[0.9375rem] font-semibold">Fired alerts</h3>
                        <span className="flex-1" />
                        <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
                    </div>
                    {events.length === 0 && <div className="p-4 text-[0.8125rem] text-muted-foreground">Nothing has fired yet.</div>}
                    {events.map((a) => (
                        <div key={a.id} className={`flex gap-3 border-b border-border px-4 py-3 text-[0.8125rem] last:border-b-0 ${a.acknowledged ? "opacity-55" : ""}`}>
                            <TriangleAlert className={`mt-0.5 size-4 shrink-0 ${a.acknowledged ? "text-muted-foreground" : "text-warning"}`} aria-hidden />
                            <div className="min-w-0 flex-1">
                                <div>{a.summary}</div>
                                <div className="text-xs text-muted-foreground">
                                    {fmtTime(a.ts)} · {a.rule_name}
                                    {a.delivery && <> · delivered: {a.delivery}</>}
                                    {" · "}
                                    <a href="#" onClick={(e) => (e.preventDefault(), setOpen(open === a.id ? null : a.id))}>
                                        {open === a.id ? "hide" : "show"} {a.sample.length} sample events
                                    </a>
                                </div>
                                {open === a.id && (
                                    <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
                                        {a.sample.map((s) => `${fmtTime(s.ts)}  ${s.allowed === 0 ? "DENY " : "ALLOW"}  ${s.ip}  ${s.country ?? ""}  ${s.resource_name ?? ""}  ${s.method ?? ""} ${s.path ?? ""}`).join("\n")}
                                    </pre>
                                )}
                            </div>
                            {!a.acknowledged && (
                                <button className="btn btn-secondary btn-sm" onClick={() => ack(a.id)}>
                                    Acknowledge
                                </button>
                            )}
                        </div>
                    ))}
                </div>
                <GeoCredit className="self-center" attribution={meta?.geoAttribution} />
            </div>
        </div>
    );
}

function describe(c: Conditions) {
    const parts: string[] = [];
    if (c.kinds?.length) parts.push(c.kinds.join("/"));
    if (c.allowed === true) parts.push("allowed");
    if (c.allowed === false) parts.push("denied");
    if (c.countries?.length) parts.push(`from ${c.countries.join(", ")}`);
    if (c.excludeCountries?.length) parts.push(`not from ${c.excludeCountries.join(", ")}`);
    if (c.resources?.length) parts.push(`${c.resources.length} resource(s)`);
    if (c.sites?.length) parts.push(`${c.sites.length} site(s)`);
    if (c.ipCidrs?.length) parts.push(`IP in ${c.ipCidrs.join(", ")}`);
    if (c.excludeIpCidrs?.length) parts.push(`IP not in ${c.excludeIpCidrs.join(", ")}`);
    if (c.text) parts.push(`contains "${c.text}"`);
    if (c.schedule) parts.push(`${c.schedule.mode} ${c.schedule.startHour}:00–${c.schedule.endHour}:00 ${c.schedule.tz}`);
    if (c.newCountry) parts.push("new country");
    return parts.join(" · ") || "any event";
}

function RuleEditor({ meta, draft, setDraft, onSaved }: { meta: Meta | null; draft: Draft; setDraft: (d: Draft | null) => void; onSaved: () => void }) {
    const [preview, setPreview] = useState<{ scanned: number; matched: number } | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const c = draft.conditions;
    const setC = (patch: Partial<Conditions>) => setDraft({ ...draft, conditions: { ...c, ...patch } });

    useEffect(() => {
        const t = setTimeout(() => api<{ scanned: number; matched: number }>("/api/alerts/preview", { method: "POST", body: { conditions: c } }).then(setPreview, () => setPreview(null)), 400);
        return () => clearTimeout(t);
    }, [JSON.stringify(c)]); // eslint-disable-line react-hooks/exhaustive-deps

    const save = async () => {
        try {
            const body = { ...draft, id: undefined, last_fired_at: undefined };
            if (draft.id) await api(`/api/alerts/rules/${draft.id}`, { method: "PUT", body });
            else await api("/api/alerts/rules", { method: "POST", body });
            onSaved();
        } catch (e) {
            setErr((e as Error).message);
        }
    };

    const setChannel = (i: number, patch: Partial<Channel>) => setDraft({ ...draft, channels: draft.channels.map((ch, j) => (j === i ? { ...ch, ...patch } : ch)) });

    return (
        <div className="card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <h3 className="text-[0.9375rem] font-semibold">{draft.id ? "Edit rule" : "New rule"}</h3>
                <span className="flex-1" />
                {preview && (
                    <span className="text-xs text-muted-foreground">
                        Matches <b className="text-foreground tabular-nums">{preview.matched.toLocaleString()}</b> of {preview.scanned.toLocaleString()} events in the last 24h
                    </span>
                )}
            </div>
            <div className="grid grid-cols-1 items-center gap-x-4 gap-y-3 p-4 md:grid-cols-[160px_1fr]">
                <label className="text-[0.8125rem] text-muted-foreground">Name</label>
                <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                    <input className="input flex-1" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Denied logins from abroad" />
                    <label>
                        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled
                    </label>
                </div>

                <label className="text-[0.8125rem] text-muted-foreground">Log types</label>
                <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                    {(["request", "access", "connection"] as Kind[]).map((k) => (
                        <label key={k}>
                            <input type="checkbox" checked={c.kinds?.includes(k) ?? false} onChange={(e) => setC({ kinds: e.target.checked ? [...(c.kinds ?? []), k] : c.kinds?.filter((x) => x !== k) })} /> {k}
                        </label>
                    ))}
                    <span className="text-xs text-muted-foreground">none checked = all</span>
                </div>

                <label className="text-[0.8125rem] text-muted-foreground">Verdict</label>
                <div className="seg">
                    {([[null, "Any"], [true, "Allowed"], [false, "Denied"]] as const).map(([v, l]) => (
                        <button key={l} className={(c.allowed ?? null) === v ? "on" : ""} onClick={() => setC({ allowed: v })}>
                            {l}
                        </button>
                    ))}
                </div>

                <label className="text-[0.8125rem] text-muted-foreground">Origin countries</label>
                <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                    <input className="input" placeholder="Only from: US, CA" defaultValue={c.countries?.join(", ")} onBlur={(e) => setC({ countries: csv(e.target.value.toUpperCase()) })} />
                    <input className="input" placeholder="Except from: US" defaultValue={c.excludeCountries?.join(", ")} onBlur={(e) => setC({ excludeCountries: csv(e.target.value.toUpperCase()) })} />
                    <label title="Fire when a resource is reached from a country not seen for it in the prior 30 days">
                        <input type="checkbox" checked={!!c.newCountry} onChange={(e) => setC({ newCountry: e.target.checked })} /> first time from a new country
                    </label>
                </div>

                <label className="text-[0.8125rem] text-muted-foreground">Targets</label>
                <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                    <MultiSelect label="Resources" value={c.resources ?? []} onChange={(v) => setC({ resources: v })} options={(meta?.resources ?? []).map((r) => ({ value: `${r.connection_id}:${r.resource_id}`, label: r.name }))} />
                    <MultiSelect label="Sites" value={c.sites ?? []} onChange={(v) => setC({ sites: v })} options={(meta?.sites ?? []).map((s) => ({ value: `${s.connection_id}:${s.site_id}`, label: s.name }))} />
                    <span className="text-xs text-muted-foreground">none = all</span>
                </div>

                <label className="text-[0.8125rem] text-muted-foreground">Source IP / CIDR</label>
                <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                    <input className="input" placeholder="Only: 203.0.113.0/24" defaultValue={c.ipCidrs?.join(", ")} onBlur={(e) => setC({ ipCidrs: csv(e.target.value) })} />
                    <input className="input" placeholder="Ignore: 10.0.0.0/8" defaultValue={c.excludeIpCidrs?.join(", ")} onBlur={(e) => setC({ excludeIpCidrs: csv(e.target.value) })} />
                </div>

                <label className="text-[0.8125rem] text-muted-foreground">Contains text</label>
                <input className="input" placeholder="matches host, path, user or user agent (e.g. wp-login)" value={c.text ?? ""} onChange={(e) => setC({ text: e.target.value || undefined })} />

                <label className="text-[0.8125rem] text-muted-foreground">Time window</label>
                <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                    <label>
                        <input
                            type="checkbox"
                            checked={!!c.schedule}
                            onChange={(e) =>
                                setC({ schedule: e.target.checked ? { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, days: [1, 2, 3, 4, 5], startHour: 8, endHour: 18, mode: "outside" } : undefined })
                            }
                        />{" "}
                        Only match
                    </label>
                    {c.schedule && (
                        <>
                            <select className="input" value={c.schedule.mode} onChange={(e) => setC({ schedule: { ...c.schedule!, mode: e.target.value as "inside" | "outside" } })}>
                                <option value="outside">outside</option>
                                <option value="inside">inside</option>
                            </select>
                            <input type="number" min={0} max={24} className="input w-16" value={c.schedule.startHour} onChange={(e) => setC({ schedule: { ...c.schedule!, startHour: Number(e.target.value) } })} />
                            to
                            <input type="number" min={0} max={24} className="input w-16" value={c.schedule.endHour} onChange={(e) => setC({ schedule: { ...c.schedule!, endHour: Number(e.target.value) } })} />
                            <span className="seg">
                                {DAYS.map((d, i) => (
                                    <button
                                        key={d}
                                        className={c.schedule!.days.includes(i) ? "on" : ""}
                                        onClick={() => setC({ schedule: { ...c.schedule!, days: c.schedule!.days.includes(i) ? c.schedule!.days.filter((x) => x !== i) : [...c.schedule!.days, i].sort() } })}
                                    >
                                        {d}
                                    </button>
                                ))}
                            </span>
                            <input className="input w-44" value={c.schedule.tz} onChange={(e) => setC({ schedule: { ...c.schedule!, tz: e.target.value } })} title="IANA time zone" />
                        </>
                    )}
                </div>

                <label className="text-[0.8125rem] text-muted-foreground">Fire when</label>
                <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                    <input type="number" min={1} className="input w-20" value={draft.threshold} onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })} />
                    matches within
                    <input type="number" min={1} className="input w-20" value={Math.round(draft.window_s / 60)} onChange={(e) => setDraft({ ...draft, window_s: Number(e.target.value) * 60 })} />
                    min, counted
                    <select className="input" value={c.groupBy ?? ""} onChange={(e) => setC({ groupBy: (e.target.value || null) as Conditions["groupBy"] })}>
                        <option value="">across all matches</option>
                        <option value="ip">per source IP</option>
                        <option value="country">per country</option>
                        <option value="resource">per resource</option>
                        <option value="site">per site</option>
                        <option value="actor">per user</option>
                    </select>
                    · then quiet for
                    <input type="number" min={0} className="input w-20" value={Math.round(draft.cooldown_s / 60)} onChange={(e) => setDraft({ ...draft, cooldown_s: Number(e.target.value) * 60 })} />
                    min
                </div>

                <label className="text-[0.8125rem] text-muted-foreground">Notify</label>
                <div className="flex flex-col gap-2">
                    <span className="text-xs text-muted-foreground">Always shown in-app. Add webhooks for Slack, Discord, or anything that accepts JSON.</span>
                    {draft.channels.map((ch, i) => (
                        <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]" key={i}>
                            <select className="input" value={ch.format} onChange={(e) => setChannel(i, { format: e.target.value as Channel["format"] })}>
                                <option value="json">JSON webhook</option>
                                <option value="slack">Slack</option>
                                <option value="discord">Discord</option>
                            </select>
                            <input className="input flex-1" placeholder="https://hooks.slack.com/services/…" value={ch.url} onChange={(e) => setChannel(i, { url: e.target.value })} />
                            <button className="btn btn-ghost btn-sm hover:text-danger" onClick={() => setDraft({ ...draft, channels: draft.channels.filter((_, j) => j !== i) })}>
                                Remove
                            </button>
                        </div>
                    ))}
                    <div>
                        <button className="btn btn-secondary btn-sm" onClick={() => setDraft({ ...draft, channels: [...draft.channels, { type: "webhook", url: "", format: "slack" }] })}>
                            + Add webhook
                        </button>
                    </div>
                </div>

                <span />
                <div className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                    <button className="btn btn-primary btn-sm" onClick={save} disabled={!draft.name}>
                        Save rule
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setDraft(null)}>
                        Cancel
                    </button>
                    {err && <span className="text-xs text-danger">{err}</span>}
                </div>
            </div>
        </div>
    );
}
