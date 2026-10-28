import { useCallback, useEffect, useState } from "react";
import { Globe2, ListFilter, Plus, RefreshCw, Route, ShieldBan, Undo2, Wifi } from "lucide-react";
import { api, fmtNum, fmtTime, type Meta, type PolicyAction, type PolicyDraft, type RuleSet, type Suggestion } from "../api";

const KIND_ICON = { "geo-allowlist": Globe2, "country-block": Globe2, "noisy-ips": Wifi, "scanner-paths": Route } as const;

function Chip({ r }: { r: { action: string; match: string; value: string; priority?: number } }) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs">
            {r.priority != null && <span className="text-muted-foreground">{r.priority}</span>}
            {r.match} {r.value} → <b className={r.action === "DROP" ? "text-denied" : r.action === "ACCEPT" ? "text-warning" : ""}>{r.action}</b>
        </span>
    );
}

export function PoliciesView({ meta, onCompose, version }: { meta: Meta | null; onCompose: (d: PolicyDraft) => void; version: number }) {
    const [sugs, setSugs] = useState<{ suggestions: Suggestion[]; errors: string[] } | null>(null);
    const [actions, setActions] = useState<PolicyAction[]>([]);
    const [days, setDays] = useState(7);
    const [browse, setBrowse] = useState("");
    const [ruleSet, setRuleSet] = useState<RuleSet | null>(null);
    const [ruleErr, setRuleErr] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);

    const load = useCallback(() => {
        setSugs(null);
        api<{ suggestions: Suggestion[]; errors: string[] }>("/api/policies/suggestions", { params: { days: String(days) } }).then(setSugs, (e) => setSugs({ suggestions: [], errors: [e.message] }));
        api<PolicyAction[]>("/api/policies/actions").then(setActions);
    }, [days]);
    useEffect(load, [load, version]);

    useEffect(() => {
        setRuleSet(null);
        setRuleErr(null);
        if (!browse) return;
        const [c, r] = browse.split(":");
        api<RuleSet>("/api/policies/rules", { params: { connectionId: c, resourceId: r } }).then(setRuleSet, (e) => setRuleErr(e.message));
    }, [browse, version]);

    const undo = async (a: PolicyAction) => {
        if (!confirm(`Remove the ${a.rules.length} rule(s) this change added to ${a.resource_name}${a.enabled_apply_rules ? " and turn rules back off" : ""}?`)) return;
        try {
            await api(`/api/policies/actions/${a.id}/undo`, { method: "POST" });
            setMsg("Undone.");
            load();
        } catch (e) {
            setMsg((e as Error).message);
        }
    };

    return (
        <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4 md:p-6">
                <div className="card glow-top p-5">
                    <div className="flex flex-wrap items-start gap-4">
                        <div className="min-w-0 flex-1">
                            <h2 className="text-lg font-semibold tracking-tight">Policies</h2>
                            <p className="mt-1 max-w-2xl text-[0.8125rem] text-muted-foreground">
                                Turn what you see into Pangolin resource rules. Pangolin checks a resource's rules top to bottom before sign-in; the first match wins. <b className="text-foreground">DROP</b> blocks the request,{" "}
                                <b className="text-foreground">PASS</b> sends it on to normal sign-in. Every rule is previewed against your recent traffic before it's written, and can be undone.
                            </p>
                        </div>
                        <button className="btn btn-primary" onClick={() => onCompose({ rules: [] })}>
                            <Plus /> New rule
                        </button>
                    </div>
                    {msg && <p className="mt-3 text-xs text-muted-foreground">{msg}</p>}
                </div>

                <div className="card">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                        <h3 className="text-[0.9375rem] font-semibold">Suggestions</h3>
                        <span className="text-xs text-muted-foreground">from the last</span>
                        <div className="seg">
                            {[1, 7, 30].map((d) => (
                                <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>
                                    {d}d
                                </button>
                            ))}
                        </div>
                        <span className="flex-1" />
                        <button className="btn btn-ghost btn-sm" onClick={load}>
                            <RefreshCw /> Refresh
                        </button>
                    </div>
                    {!sugs && <p className="p-4 text-[0.8125rem] text-muted-foreground">Analysing traffic…</p>}
                    {sugs?.errors.map((e) => (
                        <p key={e} className="px-4 pt-3 text-xs text-danger">
                            {e}
                        </p>
                    ))}
                    {sugs && sugs.suggestions.length === 0 && <p className="p-4 text-[0.8125rem] text-muted-foreground">Nothing stands out. Suggestions appear when a resource sees repeated denials from places or addresses that never sign in.</p>}
                    <ul>
                        {sugs?.suggestions.map((s) => {
                            const Icon = KIND_ICON[s.kind];
                            return (
                                <li key={s.id} className="flex flex-wrap gap-3 border-b border-border px-4 py-3.5 last:border-b-0">
                                    <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                                    <div className="min-w-0 flex-1 space-y-1.5">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-medium">{s.title}</span>
                                            <span className="badge">{s.resourceName}</span>
                                        </div>
                                        <p className="text-[0.8125rem] text-muted-foreground">{s.rationale}</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {s.rules.map((r, i) => (
                                                <Chip key={i} r={r} />
                                            ))}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Would have blocked {fmtNum(s.estimate.blocksDenied)} denied request{s.estimate.blocksDenied === 1 ? "" : "s"}
                                            {s.estimate.blocksAllowed > 0 && (
                                                <span className="text-denied">
                                                    {" "}
                                                    and {fmtNum(s.estimate.blocksAllowed)} allowed ({s.estimate.users} signed-in user{s.estimate.users === 1 ? "" : "s"})
                                                </span>
                                            )}
                                            .
                                        </p>
                                    </div>
                                    <button className="btn btn-secondary btn-sm self-start" onClick={() => onCompose({ connectionId: s.connectionId, resourceId: s.resourceId, rules: s.rules, note: s.title })}>
                                        <ShieldBan /> Review…
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>

                <div className="card">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                        <h3 className="text-[0.9375rem] font-semibold">Current rules</h3>
                        <ListFilter className="size-3.5 text-muted-foreground" />
                        <select className="input min-w-56" value={browse} onChange={(e) => setBrowse(e.target.value)}>
                            <option value="">Choose a resource…</option>
                            {(meta?.resources ?? []).map((r) => (
                                <option key={`${r.connection_id}:${r.resource_id}`} value={`${r.connection_id}:${r.resource_id}`}>
                                    {r.name}
                                </option>
                            ))}
                        </select>
                        {ruleSet && <span className={`badge ${ruleSet.applyRules ? "badge-success" : ""}`}>Rules {ruleSet.applyRules ? "on" : "off"}</span>}
                    </div>
                    <div className="p-4 text-[0.8125rem]">
                        {!browse && <p className="text-muted-foreground">Pick a resource to see the rules Pangolin applies to it.</p>}
                        {ruleErr && <p className="text-danger">{ruleErr}</p>}
                        {ruleSet && ruleSet.direct.length + ruleSet.policy.length === 0 && <p className="text-muted-foreground">No rules. All traffic goes straight to sign-in.</p>}
                        {ruleSet && ruleSet.direct.length + ruleSet.policy.length > 0 && (
                            <ol className="space-y-1.5">
                                {[...ruleSet.direct].sort((a, b) => a.priority - b.priority).map((r) => (
                                    <li key={`d${r.ruleId}`} className="flex items-center gap-2">
                                        <Chip r={r} />
                                        {!r.enabled && <span className="badge">disabled</span>}
                                        {r.action === "ACCEPT" && <span className="text-xs text-warning">skips sign-in</span>}
                                    </li>
                                ))}
                                {[...ruleSet.policy].sort((a, b) => a.priority - b.priority).map((r) => (
                                    <li key={`p${r.ruleId}`} className="flex items-center gap-2">
                                        <Chip r={r} />
                                        <span className="text-xs text-muted-foreground">from {ruleSet.policyName ? `policy "${ruleSet.policyName}"` : "default policy"}</span>
                                        {!r.enabled && <span className="badge">disabled</span>}
                                    </li>
                                ))}
                            </ol>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="border-b border-border px-4 py-3">
                        <h3 className="text-[0.9375rem] font-semibold">History</h3>
                    </div>
                    {actions.length === 0 && <p className="p-4 text-[0.8125rem] text-muted-foreground">Rules written from this app show up here, with an undo.</p>}
                    <ul>
                        {actions.map((a) => (
                            <li key={a.id} className={`flex flex-wrap items-start gap-3 border-b border-border px-4 py-3 text-[0.8125rem] last:border-b-0 ${a.undone_at ? "opacity-55" : ""}`}>
                                <div className="min-w-0 flex-1 space-y-1.5">
                                    <div>
                                        <span className="font-medium">{a.resource_name}</span>
                                        <span className="text-muted-foreground">
                                            {" "}
                                            · {fmtTime(a.ts)}
                                            {(meta?.connections.length ?? 0) > 1 ? ` · ${a.connection_name}` : ""}
                                            {a.enabled_apply_rules ? " · turned rules on" : ""}
                                            {a.undone_at ? ` · undone ${fmtTime(a.undone_at)}` : ""}
                                        </span>
                                    </div>
                                    {a.note && <p className="text-muted-foreground">{a.note}</p>}
                                    <div className="flex flex-wrap gap-1.5">
                                        {a.rules.map((r) => (
                                            <Chip key={r.ruleId} r={r} />
                                        ))}
                                    </div>
                                </div>
                                {!a.undone_at && (
                                    <button className="btn btn-secondary btn-sm" onClick={() => undo(a)}>
                                        <Undo2 /> Undo
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
}
