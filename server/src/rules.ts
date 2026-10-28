/**
 * A local model of Pangolin's resource-rule evaluation (server/routers/badger/verifySession.ts
 * checkRules): enabled rules in order, first match wins. Used to preview a rule against stored
 * traffic before it is written. REGION and ASN can't be evaluated here (no region table or ASN
 * data), so they are reported as "unknown" and the preview is flagged approximate.
 */
import { BlockList, isIPv6 } from "node:net";
import { isPrivateIp } from "./geo.ts";
import type { NewRule, RuleAction } from "./pangolin.ts";

export type SimRule = NewRule & { ruleId?: number; source: "resource" | "policy" | "new" };
export type SimEvent = { ip: string | null; country: string | null; path: string | null; method: string | null };
export type Outcome = { action: RuleAction | undefined; rule?: SimRule; approximate: boolean };

function decodeSegments(p: string) {
    return p
        .split("/")
        .filter(Boolean)
        .map((s) => {
            try {
                return decodeURIComponent(s);
            } catch {
                return s;
            }
        });
}

function segmentGlob(pattern: string, seg: string) {
    const re = new RegExp("^" + pattern.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    return re.test(seg);
}

/** Path rules match by "/" segment: a bare `*` spans any number of segments, `*` inside a segment globs. */
export function pathMatches(pattern: string, path: string): boolean {
    const p = decodeSegments(pattern);
    const s = decodeSegments(path.split("?")[0]);
    const m = p.length;
    const n = s.length;
    const dp = Array.from({ length: m + 1 }, () => new Array<boolean>(n + 1).fill(false));
    dp[m][n] = true;
    for (let i = m - 1; i >= 0; i--) dp[i][n] = p.slice(i).every((x) => x === "*");
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            if (p[i] === "*") dp[i][j] = dp[i + 1][j] || dp[i][j + 1];
            else if (p[i].includes("*")) dp[i][j] = dp[i + 1][j + 1] && segmentGlob(p[i], s[j]);
            else dp[i][j] = p[i] === s[j] && dp[i + 1][j + 1];
        }
    }
    return dp[0][0];
}

function inCidr(ip: string, cidr: string) {
    const [addr, bits] = cidr.split("/");
    try {
        const bl = new BlockList();
        const type = isIPv6(addr) ? "ipv6" : "ipv4";
        if (bits) bl.addSubnet(addr, Number(bits), type);
        else bl.addAddress(addr, type);
        return bl.check(ip, isIPv6(ip) ? "ipv6" : "ipv4");
    } catch {
        return false;
    }
}

export function ruleMatches(rule: NewRule, ev: SimEvent): boolean | "unknown" {
    const v = rule.value;
    switch (rule.match) {
        case "CIDR":
            return !!ev.ip && inCidr(ev.ip, v);
        case "IP":
            return !!ev.ip && ev.ip === v;
        case "PATH":
            return !!ev.path && pathMatches(v, ev.path);
        case "METHOD":
            return !!ev.method && v.toUpperCase().split(/[\s,]+/).includes(ev.method.toUpperCase());
        case "COUNTRY":
        case "COUNTRY_IS_NOT": {
            if (!ev.ip) return false;
            // Pangolin: COUNTRY=ALL never applies to local/private/CGNAT clients.
            if (v.toUpperCase() === "ALL" && isPrivateIp(ev.ip)) return false;
            const inCountry = v.toUpperCase() === "ALL" || ev.country?.toUpperCase() === v.toUpperCase();
            return rule.match === "COUNTRY" ? inCountry : !inCountry;
        }
        default:
            return "unknown";
    }
}

/** Resource rules first (by priority), then the attached policy's rules, as Pangolin orders them. */
export function orderRules(rules: SimRule[]): SimRule[] {
    const rank = { new: 0, resource: 0, policy: 1 } as const;
    return [...rules].sort((a, b) => rank[a.source] - rank[b.source] || a.priority - b.priority);
}

export function evaluate(ordered: SimRule[], ev: SimEvent): Outcome {
    let approximate = false;
    for (const r of ordered) {
        if (!r.enabled) continue;
        const m = ruleMatches(r, ev);
        if (m === "unknown") {
            approximate = true;
            continue;
        }
        if (m) return { action: r.action, rule: r, approximate };
    }
    return { action: undefined, approximate };
}
