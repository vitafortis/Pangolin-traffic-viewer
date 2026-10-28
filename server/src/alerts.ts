import { BlockList, isIPv6 } from "node:net";
import { z } from "zod";
import { db, now } from "./db.ts";
import { bus } from "./bus.ts";
import { countryName, geoAttribution } from "./geo.ts";
import type { TrafficEvent } from "./events.ts";

const ScheduleSchema = z.object({
    tz: z.string().default("UTC"),
    /** 0 = Sunday */
    days: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
    startHour: z.number().min(0).max(24),
    endHour: z.number().min(0).max(24),
    /** "inside": only match during the window; "outside": only match outside it (e.g. after-hours access). */
    mode: z.enum(["inside", "outside"]).default("inside")
});

export const ConditionsSchema = z.object({
    kinds: z.array(z.enum(["request", "access", "connection"])).optional(),
    allowed: z.boolean().nullable().optional(),
    countries: z.array(z.string().length(2)).optional(),
    excludeCountries: z.array(z.string().length(2)).optional(),
    /** "connectionId:siteId" */
    sites: z.array(z.string()).optional(),
    /** "connectionId:resourceId" */
    resources: z.array(z.string()).optional(),
    ipCidrs: z.array(z.string()).optional(),
    excludeIpCidrs: z.array(z.string()).optional(),
    /** Case-insensitive substring over host, path, actor, user agent. */
    text: z.string().optional(),
    schedule: ScheduleSchema.optional(),
    /** Only match when this country hasn't been seen for the resource in the prior 30 days. */
    newCountry: z.boolean().optional(),
    /** Count thresholds per distinct value instead of across all matches. */
    groupBy: z.enum(["ip", "country", "resource", "site", "actor"]).nullable().optional()
});

export const ChannelSchema = z.object({
    type: z.literal("webhook"),
    url: z.url(),
    format: z.enum(["json", "slack", "discord"]).default("json")
});

export const RuleInputSchema = z.object({
    name: z.string().min(1),
    enabled: z.boolean().default(true),
    conditions: ConditionsSchema.default({}),
    threshold: z.number().int().min(1).default(1),
    window_s: z.number().int().min(10).default(300),
    cooldown_s: z.number().int().min(0).default(900),
    channels: z.array(ChannelSchema).default([])
});

export type Conditions = z.infer<typeof ConditionsSchema>;
export type RuleInput = z.infer<typeof RuleInputSchema>;
type RuleRow = { id: number; name: string; enabled: number; conditions: string; threshold: number; window_s: number; cooldown_s: number; channels: string; last_fired_at: number | null };
type CompiledRule = RuleRow & { cond: Conditions; channelList: z.infer<typeof ChannelSchema>[]; allow?: BlockList; deny?: BlockList };

function blockList(cidrs: string[] | undefined) {
    if (!cidrs?.length) return undefined;
    const bl = new BlockList();
    for (const c of cidrs) {
        const [addr, bits] = c.split("/");
        const type = isIPv6(addr) ? "ipv6" : "ipv4";
        if (bits) bl.addSubnet(addr, Number(bits), type);
        else bl.addAddress(addr, type);
    }
    return bl;
}

function ipIn(bl: BlockList, ip: string | null) {
    if (!ip) return false;
    try {
        return bl.check(ip, isIPv6(ip) ? "ipv6" : "ipv4");
    } catch {
        return false;
    }
}

const hourFmt = new Map<string, Intl.DateTimeFormat>();
function localDayHour(ts: number, tz: string) {
    let f = hourFmt.get(tz);
    if (!f) {
        f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
        hourFmt.set(tz, f);
    }
    const parts = Object.fromEntries(f.formatToParts(new Date(ts * 1000)).map((p) => [p.type, p.value]));
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
    return { day, hour: Number(parts.hour) + Number(parts.minute) / 60 };
}

export function inSchedule(ts: number, s: z.infer<typeof ScheduleSchema>) {
    const { day, hour } = localDayHour(ts, s.tz);
    const inHours = s.startHour <= s.endHour ? hour >= s.startHour && hour < s.endHour : hour >= s.startHour || hour < s.endHour;
    const inside = s.days.includes(day) && inHours;
    return s.mode === "inside" ? inside : !inside;
}

const seenCountryStmt = db.prepare(
    "SELECT 1 FROM events WHERE connection_id = ? AND resource_id IS ? AND country = ? AND ts > ? AND id < ? LIMIT 1"
);

export function matches(r: CompiledRule, e: TrafficEvent): boolean {
    const c = r.cond;
    if (c.kinds?.length && !c.kinds.includes(e.kind)) return false;
    if (c.allowed != null && e.allowed !== (c.allowed ? 1 : 0)) return false;
    if (c.countries?.length && !c.countries.includes(e.country ?? "")) return false;
    if (c.excludeCountries?.length && c.excludeCountries.includes(e.country ?? "")) return false;
    if (c.sites?.length && !c.sites.includes(`${e.connection_id}:${e.site_id}`)) return false;
    if (c.resources?.length && !c.resources.includes(`${e.connection_id}:${e.resource_id}`)) return false;
    if (r.allow && !ipIn(r.allow, e.ip)) return false;
    if (r.deny && ipIn(r.deny, e.ip)) return false;
    if (c.text) {
        const needle = c.text.toLowerCase();
        if (![e.host, e.path, e.actor, e.user_agent].some((v) => v?.toLowerCase().includes(needle))) return false;
    }
    if (c.schedule && !inSchedule(e.ts, c.schedule)) return false;
    if (c.newCountry) {
        if (!e.country) return false;
        if (seenCountryStmt.get(e.connection_id, e.resource_id, e.country, e.ts - 30 * 86400, e.id ?? Number.MAX_SAFE_INTEGER)) return false;
    }
    return true;
}

function groupKey(r: CompiledRule, e: TrafficEvent) {
    switch (r.cond.groupBy) {
        case "ip": return e.ip ?? "?";
        case "country": return e.country ?? "?";
        case "resource": return `${e.connection_id}:${e.resource_id}`;
        case "site": return `${e.connection_id}:${e.site_id}`;
        case "actor": return e.actor ?? "anonymous";
        default: return "*";
    }
}

let rules: CompiledRule[] = [];
const windows = new Map<string, number[]>();
const lastFired = new Map<string, number>();

export function compileRule(row: RuleRow): CompiledRule {
    const cond = ConditionsSchema.parse(JSON.parse(row.conditions));
    return { ...row, cond, channelList: JSON.parse(row.channels), allow: blockList(cond.ipCidrs), deny: blockList(cond.excludeIpCidrs) };
}

export function reloadRules() {
    const rows = db.prepare("SELECT * FROM alert_rules WHERE enabled = 1").all() as RuleRow[];
    rules = rows.flatMap((row) => {
        try {
            return [compileRule(row)];
        } catch (e) {
            console.error(`[alerts] rule ${row.id} invalid`, e);
            return [];
        }
    });
    windows.clear();
}

function describe(r: CompiledRule, key: string, sample: TrafficEvent, count: number) {
    const where = [sample.city, sample.country ? countryName(sample.country) : null].filter(Boolean).join(", ") || "unknown location";
    const what = sample.resource_name ?? sample.host ?? "resource";
    const verdict = sample.allowed === 0 ? "denied" : sample.allowed === 1 ? "allowed" : "";
    const grp = r.cond.groupBy ? ` [${r.cond.groupBy}=${key}]` : "";
    return `${r.name}${grp}: ${count} match${count === 1 ? "" : "es"} in ${Math.round(r.window_s / 60)}m — e.g. ${verdict} ${sample.kind} from ${sample.ip ?? "?"} (${where}) to ${what}`.replace(/\s+/g, " ");
}

async function deliver(channels: CompiledRule["channelList"], summary: string, payload: object) {
    const results: string[] = [];
    for (const ch of channels) {
        const body = ch.format === "slack" ? { text: summary } : ch.format === "discord" ? { content: summary } : payload;
        try {
            const res = await fetch(ch.url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(10_000)
            });
            results.push(`${new URL(ch.url).host}: ${res.status}`);
        } catch (e) {
            results.push(`${ch.url}: ${(e as Error).message}`);
        }
    }
    return results.join(", ");
}

function evaluate(fresh: TrafficEvent[]) {
    const t = now();
    for (const r of rules) {
        const hits = new Map<string, TrafficEvent[]>();
        for (const e of fresh) {
            // Ignore backfilled history that's already outside the window.
            if (e.ts < t - r.window_s) continue;
            if (!matches(r, e)) continue;
            const k = groupKey(r, e);
            (hits.get(k) ?? hits.set(k, []).get(k)!).push(e);
        }
        for (const [k, evts] of hits) {
            const wk = `${r.id}|${k}`;
            const win = (windows.get(wk) ?? []).concat(evts.map((e) => e.ts)).filter((ts) => ts >= t - r.window_s);
            windows.set(wk, win);
            if (win.length < r.threshold) continue;
            if (t - (lastFired.get(wk) ?? 0) < r.cooldown_s) continue;
            lastFired.set(wk, t);
            windows.set(wk, []);
            fire(r, k, evts, win.length);
        }
    }
}

function fire(r: CompiledRule, key: string, evts: TrafficEvent[], count: number) {
    const sample = evts[evts.length - 1];
    const summary = describe(r, key, sample, count);
    const samples = evts.slice(-10).map(({ raw: _raw, ...rest }) => rest);
    const ins = db.prepare("INSERT INTO alert_events (rule_id, ts, match_count, summary, sample) VALUES (?,?,?,?,?)")
        .run(r.id, now(), count, summary, JSON.stringify(samples));
    const id = Number(ins.lastInsertRowid);
    db.prepare("UPDATE alert_rules SET last_fired_at = ? WHERE id = ?").run(now(), r.id);
    bus.emit("alert", { id, ruleId: r.id, ruleName: r.name, ts: now(), count, summary });
    console.log(`[alerts] ${summary}`);
    if (r.channelList.length) {
        const payload = { source: "pangolin-traffic-viewer", alertId: id, rule: { id: r.id, name: r.name }, group: key, count, summary, samples, geoAttribution: geoAttribution() };
        deliver(r.channelList, summary, payload).then((d) => db.prepare("UPDATE alert_events SET delivery = ? WHERE id = ?").run(d, id));
    }
}

export function initAlerts() {
    reloadRules();
    bus.on("events", evaluate);
}
