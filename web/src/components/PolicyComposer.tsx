import { useEffect, useState } from "react";
import { ArrowDown, CircleAlert, Plus, ShieldBan, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { api, flag, fmtNum, fmtTime, ruleText, type DraftRule, type Meta, type PangolinRule, type PolicyDraft, type Preview, type RuleMatch } from "../api";
import { Drawer } from "./Drawer";
import { Verdict } from "./EventsTable";

export const MATCHES: { value: RuleMatch; label: string; hint: string }[] = [
    { value: "COUNTRY", label: "Country is", hint: "ISO code, e.g. RU — or ALL" },
    { value: "COUNTRY_IS_NOT", label: "Country is not", hint: "one ISO code, e.g. US" },
    { value: "IP", label: "IP is", hint: "203.0.113.7" },
    { value: "CIDR", label: "IP in range", hint: "203.0.113.0/24" },
    { value: "PATH", label: "Path matches", hint: "/wp-login.php or /admin/*" },
    { value: "METHOD", label: "Method is", hint: "POST, PUT" },
    { value: "REGION", label: "Region is", hint: "UN M49 code, e.g. 150 (Europe)" },
    { value: "ASN", label: "Network (ASN) is", hint: "AS14061" }
];

function RuleChip({ r, isNew }: { r: { action: string; match: string; value: string; priority?: number }; isNew?: boolean }) {
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs ${isNew ? "border-primary/40 bg-primary-soft text-primary-ink" : "border-border bg-muted"}`}>
            {r.priority != null && <span className="text-muted-foreground">{r.priority}</span>}
            {r.match} {r.value} → <b className={r.action === "DROP" ? "text-denied" : r.action === "ACCEPT" ? "text-warning" : ""}>{r.action}</b>
        </span>
    );
}

export function PolicyComposer({ meta, initial, onClose, onApplied }: { meta: Meta | null; initial: PolicyDraft; onClose: () => void; onApplied: (msg: string) => void }) {
    const [target, setTarget] = useState(initial.connectionId != null && initial.resourceId != null ? `${initial.connectionId}:${initial.resourceId}` : "");
    const [rules, setRules] = useState<DraftRule[]>(initial.rules.length ? initial.rules : [{ action: "DROP", match: "COUNTRY", value: "" }]);
    const [position, setPosition] = useState<"auto" | "top" | "bottom">("auto");
    const [note, setNote] = useState(initial.note ?? "");
    const [preview, setPreview] = useState<Preview | null>(null);
    const [previewErr, setPreviewErr] = useState<string | null>(null);
    const [ack, setAck] = useState(false);
    const [enable, setEnable] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const [connectionId, resourceId] = target ? target.split(":").map(Number) : [undefined, undefined];
    const ready = connectionId != null && rules.length > 0 && rules.every((r) => r.value.trim());
    const body = { connectionId, resourceId, rules: rules.map((r) => ({ ...r, value: r.value.trim() })), position: position === "auto" ? undefined : position };

    useEffect(() => {
        setPreview(null);
        setPreviewErr(null);
        setAck(false);
        if (!ready) return;
        const t = setTimeout(() => api<Preview>("/api/policies/preview", { method: "POST", body }).then(setPreview, (e) => setPreviewErr(e.message)), 400);
        return () => clearTimeout(t);
    }, [JSON.stringify(body)]); // eslint-disable-line react-hooks/exhaustive-deps

    const risky = !!preview && (preview.droppedAllowed > 0 || !!preview.requester?.blocked || preview.existingNowActive > 0);
    const canApply = !!preview && !busy && (!risky || ack) && (preview.rulesEnabled || enable);

    const applyNow = async () => {
        setBusy(true);
        setErr(null);
        try {
            const r = await api<{ rules: PangolinRule[]; enabledRules: boolean }>("/api/policies/apply", { method: "POST", body: { ...body, enableRules: enable, note: note || null } });
            onApplied(`Wrote ${r.rules.length} rule${r.rules.length === 1 ? "" : "s"} to Pangolin${r.enabledRules ? " and turned rules on" : ""}.`);
            onClose();
        } catch (e) {
            setErr((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const setRule = (i: number, patch: Partial<DraftRule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const ordered = preview
        ? [
              ...[...preview.existingRules.filter((r) => r.source === "resource").map((r) => ({ ...r, isNew: false })), ...preview.rules.map((r) => ({ ...r, enabled: true, isNew: true }))].sort((a, b) => a.priority - b.priority),
              ...preview.existingRules.filter((r) => r.source === "policy").map((r) => ({ ...r, isNew: false, fromPolicy: true }))
          ]
        : [];

    return (
        <Drawer width={720} title="Pangolin rule" subtitle="Preview against your traffic, then write it to Pangolin" onClose={onClose}>
            <div className="space-y-4 p-4 text-[0.8125rem]">
                <div>
                    <label className="label">Resource</label>
                    <select className="input w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
                        <option value="">Choose a resource…</option>
                        {(meta?.resources ?? []).map((r) => (
                            <option key={`${r.connection_id}:${r.resource_id}`} value={`${r.connection_id}:${r.resource_id}`}>
                                {r.name}
                                {r.full_domain ? ` — ${r.full_domain}` : ""}
                                {(meta?.connections.length ?? 0) > 1 ? ` (${meta?.connections.find((c) => c.id === r.connection_id)?.name})` : ""}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="label">Rules (evaluated top to bottom; first match wins)</label>
                    <div className="space-y-2">
                        {rules.map((r, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2">
                                <select className="input" value={r.match} onChange={(e) => setRule(i, { match: e.target.value as RuleMatch })}>
                                    {MATCHES.map((m) => (
                                        <option key={m.value} value={m.value}>
                                            {m.label}
                                        </option>
                                    ))}
                                </select>
                                <input className="input min-w-40 flex-1 font-mono text-xs" placeholder={MATCHES.find((m) => m.value === r.match)?.hint} value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} />
                                <select className="input" value={r.action} onChange={(e) => setRule(i, { action: e.target.value as DraftRule["action"] })} title="DROP blocks the request. PASS skips the remaining rules and continues to normal sign-in.">
                                    <option value="DROP">→ DROP</option>
                                    <option value="PASS">→ PASS (to sign-in)</option>
                                </select>
                                <button className="btn btn-ghost btn-icon btn-sm hover:text-danger" onClick={() => setRules(rules.filter((_, j) => j !== i))} disabled={rules.length === 1} aria-label="Remove rule">
                                    <Trash2 />
                                </button>
                            </div>
                        ))}
                        <button className="btn btn-ghost btn-sm" onClick={() => setRules([...rules, { action: "DROP", match: "COUNTRY", value: "" }])}>
                            <Plus /> Add rule
                        </button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                        This app never creates ACCEPT rules: in Pangolin, ACCEPT skips authentication entirely. To allow some traffic and block the rest, PASS the allowed traffic and DROP the rest.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <span className="label mb-0">Place new rules</span>
                    <div className="seg">
                        {(
                            [
                                ["auto", "Auto"],
                                ["top", "Before existing"],
                                ["bottom", "After existing"]
                            ] as const
                        ).map(([v, l]) => (
                            <button key={v} className={position === v ? "on" : ""} onClick={() => setPosition(v)}>
                                {l}
                            </button>
                        ))}
                    </div>
                    {position === "auto" && preview && <span className="text-xs text-muted-foreground">→ {preview.position === "top" ? "before" : "after"} existing rules</span>}
                </div>

                <div>
                    <label className="label">Note (kept in this app's history)</label>
                    <input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this rule exists" />
                </div>
            </div>

            <div className="border-t border-border bg-surface p-4 text-[0.8125rem]">
                <div className="section-title mb-3">Impact preview</div>
                {!ready && <p className="text-muted-foreground">Choose a resource and fill in each rule to see what it would have done.</p>}
                {ready && !preview && !previewErr && <p className="text-muted-foreground">Replaying traffic…</p>}
                {previewErr && <p className="text-danger">{previewErr}</p>}
                {preview && (
                    <div className="space-y-4">
                        {preview.requester?.blocked && (
                            <div className="flex gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-danger-ink">
                                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                                <div>
                                    <b>This would block you.</b> Your address {preview.requester.ip}
                                    {preview.requester.country ? ` (${flag(preview.requester.country)} ${preview.requester.country})` : ""} matches these rules.
                                </div>
                            </div>
                        )}
                        {!preview.rulesEnabled && (
                            <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
                                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                                <div className="space-y-2">
                                    <div>
                                        <b>Rules are turned off for this resource.</b> New rules do nothing until rules are turned on, and turning them on also activates the {preview.existingRules.length} existing rule
                                        {preview.existingRules.length === 1 ? "" : "s"} shown below.
                                    </div>
                                    <label className="flex items-center gap-2">
                                        <input type="checkbox" className="accent-[var(--primary)]" checked={enable} onChange={(e) => setEnable(e.target.checked)} /> Turn rules on for this resource
                                    </label>
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <div className="rounded-lg border border-border bg-card px-3 py-2">
                                <div className="text-base font-semibold tabular-nums">{fmtNum(preview.newlyDropped)}</div>
                                <div className="section-title">newly blocked</div>
                            </div>
                            <div className="rounded-lg border border-border bg-card px-3 py-2">
                                <div className="text-base font-semibold tabular-nums">{fmtNum(preview.droppedDenied)}</div>
                                <div className="section-title">already denied</div>
                            </div>
                            <div className="rounded-lg border border-border bg-card px-3 py-2">
                                <div className={`text-base font-semibold tabular-nums ${preview.droppedAllowed ? "text-denied" : ""}`}>{fmtNum(preview.droppedAllowed)}</div>
                                <div className="section-title">were allowed</div>
                            </div>
                            <div className="rounded-lg border border-border bg-card px-3 py-2">
                                <div className={`text-base font-semibold tabular-nums ${preview.users.length ? "text-denied" : ""}`}>{fmtNum(preview.users.length)}</div>
                                <div className="section-title">users affected</div>
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Replayed {fmtNum(preview.scanned)} requests to this resource from the last {preview.days} days through its rules, with and without the new ones.
                            {preview.existingNowActive > 0 && ` ${fmtNum(preview.existingNowActive)} of the newly blocked requests come from existing rules being turned on.`}
                            {preview.approximate && " REGION and ASN rules can't be simulated here, so treat these numbers as approximate."}
                        </p>

                        {preview.users.length > 0 && (
                            <div>
                                <div className="section-title mb-1.5 text-denied">Signed-in users who would have been blocked</div>
                                <div className="flex flex-wrap gap-1.5">
                                    {preview.users.map((u) => (
                                        <span key={u.actor} className="badge badge-danger">
                                            {u.actor} · {u.events}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                        {preview.countries.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                                Blocked traffic by origin: {preview.countries.map((c) => `${flag(c.code)} ${c.name} ${fmtNum(c.events)}`).join(" · ")}
                            </div>
                        )}

                        <div>
                            <div className="section-title mb-1.5">Resulting rule order</div>
                            <ol className="space-y-1">
                                {ordered.map((r, i) => (
                                    <li key={i} className="flex items-center gap-2">
                                        <ArrowDown className="size-3 text-muted-foreground" />
                                        <RuleChip r={r} isNew={r.isNew} />
                                        {"fromPolicy" in r && <span className="text-xs text-muted-foreground">from shared policy</span>}
                                        {!r.enabled && <span className="badge">disabled</span>}
                                    </li>
                                ))}
                                <li className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <ArrowDown className="size-3" /> no match → normal sign-in
                                </li>
                            </ol>
                        </div>

                        {preview.samples.length > 0 && (
                            <div>
                                <div className="section-title mb-1.5">Examples of requests it would block</div>
                                <table className="data-table">
                                    <tbody>
                                        {preview.samples.map((s) => (
                                            <tr key={s.id}>
                                                <td className="text-muted-foreground tabular-nums">{fmtTime(s.ts)}</td>
                                                <td>
                                                    <Verdict allowed={s.allowed} />
                                                </td>
                                                <td className="font-mono text-xs">{s.ip}</td>
                                                <td>
                                                    {flag(s.country)} {s.country}
                                                </td>
                                                <td className="font-mono text-xs">{s.path}</td>
                                                <td>{s.actor ?? <span className="text-muted-foreground">anonymous</span>}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {risky && (
                            <label className="flex items-start gap-2 rounded-lg border border-border bg-card p-3">
                                <input type="checkbox" className="mt-0.5 accent-[var(--primary)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                                <span>I've reviewed the impact above, including blocked users{preview.requester?.blocked ? " and blocking myself" : ""}, and want to write these rules.</span>
                            </label>
                        )}
                        {err && <p className="text-danger">{err}</p>}
                        <div className="flex flex-wrap items-center gap-2">
                            <button className="btn btn-danger" disabled={!canApply} onClick={applyNow}>
                                <ShieldBan /> {busy ? "Writing…" : `Write ${rules.length} rule${rules.length === 1 ? "" : "s"} to Pangolin`}
                            </button>
                            <button className="btn btn-secondary" onClick={onClose}>
                                Cancel
                            </button>
                            {!preview.rulesEnabled && !enable && <span className="text-xs text-muted-foreground">Turn rules on above to continue.</span>}
                        </div>
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <ShieldCheck className="size-3.5" /> You can undo this from Policies → History. Rules: {rules.map((r) => ruleText(r)).join(", ")}
                        </p>
                    </div>
                )}
            </div>
        </Drawer>
    );
}
