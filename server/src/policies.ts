/**
 * Policy builder: suggests Pangolin resource rules from stored traffic, previews their effect by
 * replaying that traffic through a local model of Pangolin's rule engine, and writes them back
 * (recording every write so it can be undone). Only DROP and PASS rules are ever generated —
 * Pangolin's ACCEPT skips authentication entirely.
 */
import { createHash } from "node:crypto";
import { db, now, tx } from "./db.ts";
import { lookup, countryName } from "./geo.ts";
import { clientFor, type ConnectionRow } from "./ingest.ts";
import { PangolinError, type NewRule, type PangolinRule } from "./pangolin.ts";
import { evaluate, orderRules, type SimRule } from "./rules.ts";

export type DraftRule = Omit<NewRule, "priority" | "enabled">;
export type Position = "top" | "bottom";
export type RuleSet = { applyRules: boolean; policyName: string | null; direct: PangolinRule[]; policy: PangolinRule[] };

interface RuleStore {
    ruleSet(resourceId: number): Promise<RuleSet>;
    create(resourceId: number, rule: NewRule): Promise<PangolinRule>;
    remove(resourceId: number, ruleId: number): Promise<void>;
    setApplyRules(resourceId: number, on: boolean): Promise<void>;
}

class PangolinStore implements RuleStore {
    constructor(private c: ConnectionRow) {}
    private get client() {
        return clientFor(this.c);
    }
    async ruleSet(resourceId: number): Promise<RuleSet> {
        const [res, direct] = await Promise.all([this.client.getResource(resourceId), this.client.listResourceRules(resourceId)]);
        const policyId = res.resourcePolicyId ?? res.defaultResourcePolicyId;
        let policy = { name: null as string | null, applyRules: null as boolean | null, rules: [] as PangolinRule[] };
        if (policyId != null) policy = await this.client.getResourcePolicyRules(policyId).catch(() => policy);
        return { applyRules: !!(res.applyRules ?? policy.applyRules), policyName: res.resourcePolicyId != null ? policy.name : null, direct, policy: policy.rules };
    }
    create(resourceId: number, rule: NewRule) {
        return this.client.createResourceRule(resourceId, rule);
    }
    async remove(resourceId: number, ruleId: number) {
        await this.client.deleteResourceRule(resourceId, ruleId).catch((e) => {
            if (!(e instanceof PangolinError && e.status === 404)) throw e;
        });
    }
    async setApplyRules(resourceId: number, on: boolean) {
        await this.client.setApplyRules(resourceId, on);
    }
}

/** The demo connection keeps "Pangolin" rules in a local table; the demo generator honours them. */
class DemoStore implements RuleStore {
    constructor(private connectionId: number) {}
    async ruleSet(resourceId: number): Promise<RuleSet> {
        const direct = (db.prepare("SELECT * FROM demo_rules WHERE connection_id = ? AND resource_id = ?").all(this.connectionId, resourceId) as DemoRuleRow[]).map(fromDemoRow);
        const r = db.prepare("SELECT demo_apply_rules FROM resources WHERE connection_id = ? AND resource_id = ?").get(this.connectionId, resourceId) as { demo_apply_rules: number } | undefined;
        return { applyRules: !!r?.demo_apply_rules, policyName: null, direct, policy: [] };
    }
    async create(resourceId: number, rule: NewRule) {
        const r = db.prepare("INSERT INTO demo_rules (connection_id, resource_id, action, match, value, priority, enabled) VALUES (?,?,?,?,?,?,?)")
            .run(this.connectionId, resourceId, rule.action, rule.match, rule.value, rule.priority, rule.enabled ? 1 : 0);
        return { ...rule, ruleId: Number(r.lastInsertRowid) };
    }
    async remove(resourceId: number, ruleId: number) {
        db.prepare("DELETE FROM demo_rules WHERE connection_id = ? AND resource_id = ? AND rule_id = ?").run(this.connectionId, resourceId, ruleId);
    }
    async setApplyRules(resourceId: number, on: boolean) {
        db.prepare("UPDATE resources SET demo_apply_rules = ? WHERE connection_id = ? AND resource_id = ?").run(on ? 1 : 0, this.connectionId, resourceId);
    }
}

type DemoRuleRow = { rule_id: number; action: string; match: string; value: string; priority: number; enabled: number; resource_id: number };
const fromDemoRow = (r: DemoRuleRow): PangolinRule => ({ ruleId: r.rule_id, action: r.action as NewRule["action"], match: r.match as NewRule["match"], value: r.value, priority: r.priority, enabled: !!r.enabled });

function connection(id: number): ConnectionRow {
    const c = db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as ConnectionRow | undefined;
    if (!c) throw Object.assign(new Error("connection not found"), { statusCode: 404 });
    return c;
}

function storeFor(c: ConnectionRow): RuleStore {
    return c.base_url.startsWith("demo:") ? new DemoStore(c.id) : new PangolinStore(c);
}

const cache = new Map<string, { at: number; rs: RuleSet }>();
export async function getRuleSet(connectionId: number, resourceId: number, fresh = false): Promise<RuleSet> {
    const k = `${connectionId}:${resourceId}`;
    const hit = cache.get(k);
    if (!fresh && hit && Date.now() - hit.at < 30_000) return hit.rs;
    try {
        const rs = await storeFor(connection(connectionId)).ruleSet(resourceId);
        cache.set(k, { at: Date.now(), rs });
        return rs;
    } catch (e) {
        throw friendly(e, "read rules");
    }
}

/** Pangolin's errors, reworded for the two failures people actually hit. */
function friendly(e: unknown, what: string) {
    if (e instanceof PangolinError && (e.status === 401 || e.status === 403)) {
        return Object.assign(new Error(`Pangolin refused to ${what}: this API key lacks permission (${e.message}). Give the key access to resource rules${what.includes("write") || what.includes("create") ? " with write permission" : ""}.`), { statusCode: 403 });
    }
    if (e instanceof PangolinError) return Object.assign(new Error(`Pangolin: ${e.message}`), { statusCode: 502 });
    return e as Error;
}

function simRules(rs: RuleSet): SimRule[] {
    return orderRules([...rs.direct.map((r) => ({ ...r, source: "resource" as const })), ...rs.policy.map((r) => ({ ...r, source: "policy" as const }))]);
}

/** New rules go before (top) or after (bottom) the resource's own rules, keeping their order. */
export function placeRules(rs: RuleSet, drafts: DraftRule[], position: Position): NewRule[] {
    const prios = rs.direct.map((r) => r.priority);
    const start = position === "top" ? Math.min(1, ...prios) - drafts.length : Math.max(0, ...prios) + 1;
    return drafts.map((d, i) => ({ ...d, priority: start + i, enabled: true }));
}

/** Default placement: after existing IP/CIDR rules (deliberate exceptions should keep winning), else first. */
export function defaultPosition(rs: RuleSet): Position {
    return rs.direct.some((r) => r.enabled && (r.match === "IP" || r.match === "CIDR") && r.action !== "DROP") ? "bottom" : "top";
}

type EvRow = { id: number; ts: number; ip: string | null; country: string | null; city: string | null; path: string | null; method: string | null; allowed: number | null; actor: string | null; reason: number | null };

function resourceEvents(connectionId: number, resourceId: number, days: number): EvRow[] {
    return db.prepare(`SELECT id, ts, ip, country, city, path, method, allowed, actor, reason FROM events
        WHERE connection_id = ? AND resource_id = ? AND kind = 'request' AND ts > ? ORDER BY ts DESC LIMIT 100000`).all(connectionId, resourceId, now() - days * 86400) as EvRow[];
}

export type Preview = {
    rules: NewRule[];
    position: Position;
    rulesEnabled: boolean;
    existingRules: (PangolinRule & { source: "resource" | "policy" })[];
    scanned: number;
    days: number;
    newlyDropped: number;
    droppedDenied: number;
    droppedAllowed: number;
    users: { actor: string; events: number }[];
    ips: number;
    countries: { code: string; name: string; events: number }[];
    existingNowActive: number;
    samples: (EvRow & { newlyBy: string })[];
    approximate: boolean;
    requester: { ip: string; country: string | null; blocked: boolean } | null;
};

export async function preview(connectionId: number, resourceId: number, drafts: DraftRule[], position: Position | undefined, requesterIp: string | null, days = 7): Promise<Preview> {
    const rs = await getRuleSet(connectionId, resourceId);
    const pos = position ?? defaultPosition(rs);
    const rules = placeRules(rs, drafts, pos);
    const existing = simRules(rs);
    const before = rs.applyRules ? existing : [];
    const after = orderRules([...existing, ...rules.map((r) => ({ ...r, source: "new" as const }))]);

    const events = resourceEvents(connectionId, resourceId, days);
    const users = new Map<string, number>();
    const ips = new Set<string>();
    const countries = new Map<string, number>();
    const samples: Preview["samples"] = [];
    let newlyDropped = 0, droppedAllowed = 0, existingNowActive = 0, approximate = false;
    for (const e of events) {
        const b = evaluate(before, e);
        const a = evaluate(after, e);
        approximate ||= a.approximate || b.approximate;
        if (a.action === "DROP" && b.action !== "DROP") {
            newlyDropped++;
            if (a.rule?.source !== "new") existingNowActive++;
            if (e.ip) ips.add(e.ip);
            if (e.country) countries.set(e.country, (countries.get(e.country) ?? 0) + 1);
            if (e.allowed === 1) {
                droppedAllowed++;
                if (e.actor) users.set(e.actor, (users.get(e.actor) ?? 0) + 1);
            }
            const by = `${a.rule!.match} ${a.rule!.value}`;
            if (samples.length < 12 && (e.allowed === 1 || samples.length < 6)) samples.push({ ...e, newlyBy: by });
        }
    }

    let requester: Preview["requester"] = null;
    if (requesterIp) {
        const g = lookup(requesterIp);
        const o = evaluate(after, { ip: requesterIp, country: g.country, path: "/", method: "GET" });
        requester = { ip: requesterIp, country: g.country, blocked: o.action === "DROP" };
    }

    return {
        rules,
        position: pos,
        rulesEnabled: rs.applyRules,
        existingRules: [...rs.direct.map((r) => ({ ...r, source: "resource" as const })), ...rs.policy.map((r) => ({ ...r, source: "policy" as const }))],
        scanned: events.length,
        days,
        newlyDropped,
        droppedDenied: newlyDropped - droppedAllowed,
        droppedAllowed,
        users: [...users].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([actor, events]) => ({ actor, events })),
        ips: ips.size,
        countries: [...countries].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([code, events]) => ({ code, name: countryName(code), events })),
        existingNowActive,
        samples,
        approximate,
        requester
    };
}

// ---- suggestions -------------------------------------------------------------

export type Suggestion = {
    id: string;
    connectionId: number;
    resourceId: number;
    resourceName: string;
    kind: "geo-allowlist" | "country-block" | "noisy-ips" | "scanner-paths";
    title: string;
    rationale: string;
    rules: DraftRule[];
    estimate: { blocksDenied: number; blocksAllowed: number; users: number };
};

const PROBE = /(^|\/)(wp-login\.php|wp-admin|xmlrpc\.php|\.env|\.git|\.aws|phpmyadmin|pma|cgi-bin|boaform|hnap1|actuator|vendor\/phpunit|\.ds_store|server-status|admin\.php|config\.php|setup\.php|shell|eval-stdin\.php)(\/|$|\?)/i;

const sid = (...parts: unknown[]) => createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 12);

function estimate(events: EvRow[], drafts: DraftRule[]) {
    const rules = orderRules(drafts.map((d, i) => ({ ...d, priority: i, enabled: true, source: "new" as const })));
    let blocksDenied = 0, blocksAllowed = 0;
    const users = new Set<string>();
    for (const e of events) {
        if (evaluate(rules, e).action !== "DROP") continue;
        if (e.allowed === 1) {
            blocksAllowed++;
            if (e.actor) users.add(e.actor);
        } else blocksDenied++;
    }
    return { blocksDenied, blocksAllowed, users: users.size };
}

const sameRule = (a: DraftRule, b: DraftRule) => a.action === b.action && a.match === b.match && a.value.toUpperCase() === b.value.toUpperCase();

export async function suggestions(days = 7): Promise<{ suggestions: Suggestion[]; errors: string[] }> {
    const since = now() - days * 86400;
    const resources = db.prepare(`SELECT e.connection_id, e.resource_id, MAX(COALESCE(r.name, e.resource_name)) AS name, COUNT(*) AS n
        FROM events e LEFT JOIN resources r ON r.connection_id = e.connection_id AND r.resource_id = e.resource_id
        WHERE e.kind = 'request' AND e.ts > ? AND e.resource_id IS NOT NULL GROUP BY 1, 2 HAVING SUM(e.allowed = 0) >= 10`).all(since) as { connection_id: number; resource_id: number; name: string; n: number }[];

    const out: Suggestion[] = [];
    const errors: string[] = [];
    for (const res of resources) {
        const args = [res.connection_id, res.resource_id, since] as const;
        const scope = "connection_id = ? AND resource_id = ? AND kind = 'request' AND ts > ?";
        const byCountry = db.prepare(`SELECT country, SUM(allowed = 0) AS denied, SUM(allowed = 1 AND actor IS NOT NULL) AS authed, COUNT(*) AS total
            FROM events WHERE ${scope} AND country IS NOT NULL GROUP BY country`).all(...args) as { country: string; denied: number; authed: number; total: number }[];
        const events = resourceEvents(res.connection_id, res.resource_id, days);
        const local: Suggestion[] = [];
        const push = (kind: Suggestion["kind"], title: string, rationale: string, rules: DraftRule[]) =>
            local.push({ id: sid(res.connection_id, res.resource_id, kind, rules), connectionId: res.connection_id, resourceId: res.resource_id, resourceName: res.name, kind, title, rationale, rules, estimate: estimate(events, rules) });

        // Geo allowlist: signed-in users only ever come from a few countries.
        const trusted = byCountry.filter((c) => c.authed > 0).sort((a, b) => b.authed - a.authed);
        const untrustedDenied = byCountry.filter((c) => c.authed === 0).reduce((s, c) => s + c.denied, 0);
        if (trusted.length >= 1 && trusted.length <= 5 && untrustedDenied >= 20) {
            const names = trusted.map((c) => countryName(c.country)).join(", ");
            const rules: DraftRule[] =
                trusted.length === 1
                    ? [{ action: "DROP", match: "COUNTRY_IS_NOT", value: trusted[0].country }]
                    : [...trusted.map((c) => ({ action: "PASS" as const, match: "COUNTRY" as const, value: c.country })), { action: "DROP", match: "COUNTRY", value: "ALL" }];
            push("geo-allowlist", `Only allow ${names}`, `Every signed-in request in the last ${days} days came from ${names}. ${untrustedDenied.toLocaleString()} denied requests came from elsewhere. Allowed countries still go through normal sign-in (PASS).`, rules);
        }

        // Country blocks: countries that only ever produce denials.
        const noisy = byCountry.filter((c) => c.authed === 0 && c.denied >= 10 && c.denied / c.total >= 0.8).sort((a, b) => b.denied - a.denied).slice(0, 8);
        if (noisy.length) {
            push("country-block", `Block ${noisy.map((c) => countryName(c.country)).join(", ")}`, `${noisy.map((c) => `${countryName(c.country)}: ${c.denied.toLocaleString()} denied`).join(" · ")}. No signed-in user has reached this resource from these countries.`, noisy.map((c) => ({ action: "DROP", match: "COUNTRY", value: c.country })));
        }

        // Noisy IPs: repeated denials, never a signed-in success. Collapse to /24 when 3+ share one.
        const ips = db.prepare(`SELECT ip, SUM(allowed = 0) AS denied FROM events WHERE ${scope} AND ip IS NOT NULL GROUP BY ip
            HAVING denied >= 15 AND SUM(allowed = 1 AND actor IS NOT NULL) = 0 ORDER BY denied DESC LIMIT 25`).all(...args) as { ip: string; denied: number }[];
        if (ips.length) {
            const by24 = new Map<string, { ip: string; denied: number }[]>();
            for (const r of ips) {
                const k = /^\d+\.\d+\.\d+\.\d+$/.test(r.ip) ? r.ip.split(".").slice(0, 3).join(".") + ".0/24" : r.ip;
                (by24.get(k) ?? by24.set(k, []).get(k)!).push(r);
            }
            const rules: DraftRule[] = [...by24].flatMap<DraftRule>(([net, rows]) => (rows.length >= 3 ? [{ action: "DROP" as const, match: "CIDR" as const, value: net }] : rows.map((r) => ({ action: "DROP" as const, match: "IP" as const, value: r.ip })))).slice(0, 10);
            const total = ips.reduce((s, r) => s + r.denied, 0);
            push("noisy-ips", `Block ${rules.length} noisy address${rules.length === 1 ? "" : "es"}`, `${ips.length} IPs were denied ${total.toLocaleString()} times with no signed-in success (top: ${ips[0].ip}, ${ips[0].denied.toLocaleString()} denials).`, rules);
        }

        // Scanner paths: well-known probe paths, or paths only ever denied from many IPs.
        const paths = db.prepare(`SELECT path, SUM(allowed = 0) AS denied, SUM(allowed = 1) AS ok, COUNT(DISTINCT ip) AS ips FROM events WHERE ${scope} AND path IS NOT NULL AND path != '/'
            GROUP BY path HAVING denied >= 5 ORDER BY denied DESC LIMIT 200`).all(...args) as { path: string; denied: number; ok: number; ips: number }[];
        const probes = paths.filter((p) => p.ok === 0 && (PROBE.test(p.path) || p.ips >= 5)).slice(0, 8);
        if (probes.length) {
            push("scanner-paths", `Drop ${probes.length} scanner path${probes.length === 1 ? "" : "s"}`, `${probes.map((p) => p.path).join(", ")} were requested ${probes.reduce((s, p) => s + p.denied, 0).toLocaleString()} times and never succeeded. Dropping them at the proxy skips the sign-in page for bots.`, probes.map((p) => ({ action: "DROP", match: "PATH", value: p.path.split("?")[0] })));
        }

        if (!local.length) continue;
        // Hide rules that are already in place.
        try {
            const rs = await getRuleSet(res.connection_id, res.resource_id);
            const existing = [...rs.direct, ...rs.policy].filter((r) => r.enabled);
            for (const s of local) {
                const remaining = s.rules.filter((d) => !existing.some((r) => sameRule(r, d)));
                // An allowlist is all-or-nothing: a lone "COUNTRY ALL → DROP" without its PASS rules would block everyone.
                if (s.kind === "geo-allowlist" && remaining.length !== s.rules.length) continue;
                if (remaining.length) out.push({ ...s, rules: remaining, estimate: estimate(events, remaining) });
            }
        } catch (e) {
            errors.push(`${res.name}: ${(e as Error).message}`);
            out.push(...local);
        }
    }
    return { suggestions: out.sort((a, b) => b.estimate.blocksDenied - a.estimate.blocksDenied), errors };
}

// ---- apply / undo --------------------------------------------------------------

export async function apply(connectionId: number, resourceId: number, drafts: DraftRule[], position: Position | undefined, enableRules: boolean, note: string | null) {
    if (drafts.some((d) => d.action === "ACCEPT")) {
        throw Object.assign(new Error("ACCEPT rules skip Pangolin's authentication, so this app won't create them. Use PASS to let traffic through to normal sign-in."), { statusCode: 400 });
    }
    const c = connection(connectionId);
    const store = storeFor(c);
    const rs = await getRuleSet(connectionId, resourceId, true);
    if (!rs.applyRules && !enableRules) {
        throw Object.assign(new Error("Rules are turned off for this resource, so the new rules would do nothing. Confirm turning rules on (this also activates its existing rules)."), { statusCode: 409 });
    }
    const rules = placeRules(rs, drafts, position ?? defaultPosition(rs));
    const created: PangolinRule[] = [];
    try {
        for (const r of rules) created.push({ ...r, ...(await store.create(resourceId, r)) });
        if (!rs.applyRules) await store.setApplyRules(resourceId, true);
    } catch (e) {
        // Leave Pangolin as we found it.
        for (const r of created) await store.remove(resourceId, r.ruleId).catch(() => {});
        throw friendly(e, "create rules (write)");
    } finally {
        cache.delete(`${connectionId}:${resourceId}`);
    }
    const id = Number(
        db.prepare("INSERT INTO policy_actions (connection_id, resource_id, ts, rules, enabled_apply_rules, note) VALUES (?,?,?,?,?,?)")
            .run(connectionId, resourceId, now(), JSON.stringify(created), rs.applyRules ? 0 : 1, note).lastInsertRowid
    );
    return { id, rules: created, enabledRules: !rs.applyRules };
}

type ActionRow = { id: number; connection_id: number; resource_id: number; ts: number; rules: string; enabled_apply_rules: number; note: string | null; undone_at: number | null };

export async function undo(actionId: number) {
    const a = db.prepare("SELECT * FROM policy_actions WHERE id = ?").get(actionId) as ActionRow | undefined;
    if (!a) throw Object.assign(new Error("not found"), { statusCode: 404 });
    if (a.undone_at) throw Object.assign(new Error("already undone"), { statusCode: 409 });
    const store = storeFor(connection(a.connection_id));
    try {
        for (const r of JSON.parse(a.rules) as PangolinRule[]) await store.remove(a.resource_id, r.ruleId);
        if (a.enabled_apply_rules) await store.setApplyRules(a.resource_id, false);
    } catch (e) {
        throw friendly(e, "delete rules (write)");
    } finally {
        cache.delete(`${a.connection_id}:${a.resource_id}`);
    }
    tx(() => db.prepare("UPDATE policy_actions SET undone_at = ? WHERE id = ?").run(now(), actionId));
    return { ok: true };
}

export function listActions(limit = 100) {
    return (db.prepare(`SELECT a.*, COALESCE(r.name, 'resource ' || a.resource_id) AS resource_name, c.name AS connection_name FROM policy_actions a
        LEFT JOIN resources r ON r.connection_id = a.connection_id AND r.resource_id = a.resource_id
        LEFT JOIN connections c ON c.id = a.connection_id ORDER BY a.ts DESC LIMIT ?`).all(limit) as (ActionRow & { resource_name: string; connection_name: string })[]).map((a) => ({ ...a, rules: JSON.parse(a.rules) as PangolinRule[] }));
}
