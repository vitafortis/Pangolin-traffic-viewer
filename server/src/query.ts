import type { SQLInputValue } from "node:sqlite";
import { ipv4ToNum, now } from "./db.ts";

export type Filters = {
    from?: string;
    to?: string;
    kinds?: string;
    connections?: string;
    sites?: string;
    resources?: string;
    countries?: string;
    allowed?: string;
    ip?: string;
    q?: string;
};

const csv = (s?: string) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

function pairs(s: string | undefined) {
    return csv(s).map((p) => p.split(":").map(Number)).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
}

/** Builds a WHERE clause over the events table (aliased `e`) from UI filters. */
export function buildWhere(f: Filters) {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    const from = f.from ? Number(f.from) : now() - 86400;
    const to = f.to ? Number(f.to) : now() + 60;
    where.push("e.ts >= ? AND e.ts <= ?");
    params.push(from, to);

    const inList = (col: string, vals: SQLInputValue[]) => {
        if (!vals.length) return;
        where.push(`${col} IN (${vals.map(() => "?").join(",")})`);
        params.push(...vals);
    };
    inList("e.kind", csv(f.kinds));
    inList("e.connection_id", csv(f.connections).map(Number));
    inList("e.country", csv(f.countries).map((c) => c.toUpperCase()));

    for (const [col, raw] of [["site_id", f.sites], ["resource_id", f.resources]] as const) {
        const ps = pairs(raw);
        if (ps.length) {
            where.push(`(${ps.map(() => `(e.connection_id = ? AND e.${col} = ?)`).join(" OR ")})`);
            ps.forEach(([c, id]) => params.push(c, id));
        }
    }
    if (f.allowed === "1" || f.allowed === "0") {
        where.push("e.allowed = ?");
        params.push(Number(f.allowed));
    }
    if (f.ip) {
        const c = ipCondition(f.ip);
        where.push(c.sql);
        params.push(...c.params);
    }
    if (f.q) {
        const q = parseQuery(f.q);
        if (q.sql) {
            where.push(q.sql);
            params.push(...q.params);
        }
    }
    return { sql: where.join(" AND "), params, from, to };
}

export const GROUPS = {
    country: { key: "e.country", label: "e.country" },
    city: { key: "e.country || '/' || COALESCE(e.city,'?')", label: "COALESCE(e.city,'?') || ', ' || COALESCE(e.country,'?')" },
    ip: { key: "e.ip", label: "e.ip" },
    resource: { key: "e.connection_id || ':' || e.resource_id", label: "COALESCE(r.name, e.resource_name, 'resource ' || e.resource_id)" },
    site: { key: "e.connection_id || ':' || e.site_id", label: "COALESCE(s.name, 'site ' || e.site_id)" },
    actor: { key: "COALESCE(e.actor,'(anonymous)')", label: "COALESCE(e.actor,'(anonymous)')" },
    host: { key: "e.host", label: "e.host" },
    path: { key: "e.path", label: "e.path" },
    user_agent: { key: "e.user_agent", label: "e.user_agent" },
    kind: { key: "e.kind", label: "e.kind" },
    connection: { key: "e.connection_id", label: "c.name" }
} as const;

export const EVENT_COLUMNS = `e.id, e.connection_id, e.kind, e.ts, e.allowed, e.reason, e.ip, e.country, e.city, e.lat, e.lon,
    e.resource_id, COALESCE(r.name, e.resource_name) AS resource_name, e.site_id, s.name AS site_name,
    e.actor, e.actor_type, e.host, e.path, e.method, e.protocol, e.user_agent, e.bytes_tx, e.bytes_rx`;

const SORTS: Record<string, string> = {
    ts: "e.ts",
    verdict: "e.allowed",
    country: "e.country",
    city: "e.city",
    ip: "COALESCE(e.ip_num, e.ip)",
    resource: "COALESCE(r.name, e.resource_name)",
    site: "s.name",
    actor: "e.actor",
    host: "e.host",
    path: "e.path",
    method: "e.method",
    kind: "e.kind",
    agent: "e.user_agent"
};

/** Whitelisted ORDER BY; ties break on time then id so paging is stable. */
export function orderBy(sort?: string, dir?: string) {
    const d = dir === "asc" ? "ASC" : "DESC";
    const col = SORTS[sort ?? "ts"] ?? "e.ts";
    return col === "e.ts" ? `e.ts ${d}, e.id ${d}` : `${col} ${d} NULLS LAST, e.ts DESC, e.id DESC`;
}

export const JOINS = `
    LEFT JOIN resources r ON r.connection_id = e.connection_id AND r.resource_id = e.resource_id
    LEFT JOIN sites s ON s.connection_id = e.connection_id AND s.site_id = e.site_id
    LEFT JOIN connections c ON c.id = e.connection_id`;

// ---- query language ---------------------------------------------------------
//
//   country:RU,CN  -verdict:allow  path:/wp-*  ip:45.0.0.0/8  user:anonymous  "free text"
//
// key:value terms AND together; commas OR values within a term; a leading "-" negates it.
// Values with * are anchored globs; other text values match as case-insensitive substrings.

type Cond = { sql: string; params: SQLInputValue[] };

const escLike = (v: string) => v.replace(/[\\%_]/g, (m) => "\\" + m);
/** glob → anchored LIKE; plain text → substring LIKE. */
function likeOf(v: string) {
    return v.includes("*") ? escLike(v).replace(/\*/g, "%") : `%${escLike(v)}%`;
}
function textCond(col: string, vals: string[]): Cond {
    return { sql: `(${vals.map(() => `${col} LIKE ? ESCAPE '\\'`).join(" OR ")})`, params: vals.map(likeOf) };
}
function inCond(col: string, vals: SQLInputValue[]): Cond {
    return { sql: `${col} IN (${vals.map(() => "?").join(",")})`, params: vals };
}

export function ipCondition(raw: string): Cond {
    const parts: Cond[] = raw.split(",").map((v) => {
        const cidr = v.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/);
        if (cidr) {
            const base = ipv4ToNum(cidr[1]);
            const bits = Number(cidr[2]);
            if (base != null && bits <= 32) {
                const size = 2 ** (32 - bits);
                const start = Math.floor(base / size) * size;
                return { sql: "e.ip_num BETWEEN ? AND ?", params: [start, start + size - 1] };
            }
        }
        if (v.includes("/")) return { sql: "e.ip LIKE ? ESCAPE '\\'", params: [escLike(v.split("/")[0].replace(/:+$/, "")) + "%"] }; // IPv6 prefix, approximate
        if (v.includes("*")) return { sql: "e.ip LIKE ? ESCAPE '\\'", params: [escLike(v).replace(/\*/g, "%")] };
        return { sql: "e.ip = ?", params: [v] };
    });
    return { sql: `(${parts.map((p) => p.sql).join(" OR ")})`, params: parts.flatMap((p) => p.params) };
}

const FIELDS: Record<string, (vals: string[]) => Cond> = {
    country: (v) => inCond("e.country", v.map((x) => x.toUpperCase())),
    city: (v) => textCond("e.city", v),
    ip: (v) => ipCondition(v.join(",")),
    resource: (v) => {
        const ids = v.filter((x) => /^\d+$/.test(x)).map(Number);
        const t = textCond("e.resource_name", v);
        return ids.length ? { sql: `(${t.sql} OR e.resource_id IN (${ids.map(() => "?").join(",")}))`, params: [...t.params, ...ids] } : t;
    },
    site: (v) => {
        const t = textCond("name", v);
        return { sql: `e.site_id IN (SELECT site_id FROM sites WHERE connection_id = e.connection_id AND ${t.sql})`, params: t.params };
    },
    actor: (v) => {
        const anon = v.some((x) => ["anonymous", "none", "-"].includes(x.toLowerCase()));
        const rest = v.filter((x) => !["anonymous", "none", "-"].includes(x.toLowerCase()));
        const parts = [anon ? { sql: "e.actor IS NULL", params: [] } : null, rest.length ? textCond("e.actor", rest) : null].filter(Boolean) as Cond[];
        return { sql: `(${parts.map((p) => p.sql).join(" OR ")})`, params: parts.flatMap((p) => p.params) };
    },
    host: (v) => textCond("e.host", v),
    path: (v) => textCond("e.path", v),
    method: (v) => inCond("UPPER(e.method)", v.map((x) => x.toUpperCase())),
    verdict: (v) => {
        const vals = v.map((x) => (/^(allow|allowed|accept|1|yes)$/i.test(x) ? 1 : /^(deny|denied|drop|block|blocked|0|no)$/i.test(x) ? 0 : -1));
        return inCond("e.allowed", vals);
    },
    kind: (v) => inCond("e.kind", v.map((x) => x.toLowerCase())),
    agent: (v) => textCond("e.user_agent", v),
    reason: (v) => inCond("e.reason", v.map(Number)),
    org: (v) => {
        const t = textCond("name", v);
        return { sql: `e.connection_id IN (SELECT id FROM connections WHERE ${t.sql})`, params: t.params };
    }
};
const ALIASES: Record<string, string> = {
    cc: "country", res: "resource", user: "actor", verdict: "verdict", action: "verdict", type: "kind", log: "kind", ua: "agent", connection: "org"
};
export const QUERY_FIELDS = Object.keys(FIELDS);

function freeText(v: string): Cond {
    const like = `%${escLike(v)}%`;
    const cols = ["e.ip", "e.host", "e.path", "e.actor", "e.user_agent", "e.resource_name", "e.city", "e.country"];
    return { sql: `(${cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(" OR ")})`, params: cols.map(() => like) };
}

export function parseQuery(q: string): Cond & { unknown: string[] } {
    const conds: Cond[] = [];
    const unknown: string[] = [];
    const re = /(-?)([a-z_]+):("([^"]*)"|\S+)|(-?)"([^"]*)"|(-?)(\S+)/gi;
    for (const m of q.matchAll(re)) {
        let c: Cond;
        let neg: boolean;
        if (m[2]) {
            const key = ALIASES[m[2].toLowerCase()] ?? m[2].toLowerCase();
            const raw = m[4] ?? m[3];
            const vals = raw.split(",").map((x) => x.trim()).filter(Boolean);
            const build = FIELDS[key];
            if (!build || !vals.length) {
                unknown.push(m[2]);
                c = freeText(`${m[2]}:${raw}`);
            } else c = build(vals);
            neg = m[1] === "-";
        } else {
            const text = m[6] ?? m[8];
            if (!text) continue;
            c = freeText(text);
            neg = (m[5] ?? m[7]) === "-";
        }
        // Negations keep rows where the column is NULL (e.g. -actor:alice still shows anonymous traffic).
        conds.push(neg ? { sql: `IFNULL(${c.sql}, 0) = 0`, params: c.params } : c);
    }
    return { sql: conds.map((c) => c.sql).join(" AND "), params: conds.flatMap((c) => c.params), unknown };
}
