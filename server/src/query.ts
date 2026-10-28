import type { SQLInputValue } from "node:sqlite";
import { now } from "./db.ts";

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
        where.push("e.ip LIKE ?");
        params.push(f.ip.endsWith("*") ? f.ip.slice(0, -1) + "%" : f.ip);
    }
    if (f.q) {
        const like = `%${f.q.replace(/[%_]/g, (m) => "\\" + m)}%`;
        where.push(
            "(e.ip LIKE ? ESCAPE '\\' OR e.host LIKE ? ESCAPE '\\' OR e.path LIKE ? ESCAPE '\\' OR e.actor LIKE ? ESCAPE '\\' OR e.user_agent LIKE ? ESCAPE '\\' OR e.resource_name LIKE ? ESCAPE '\\' OR e.city LIKE ? ESCAPE '\\')"
        );
        params.push(like, like, like, like, like, like, like);
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

export const JOINS = `
    LEFT JOIN resources r ON r.connection_id = e.connection_id AND r.resource_id = e.resource_id
    LEFT JOIN sites s ON s.connection_id = e.connection_id AND s.site_id = e.site_id
    LEFT JOIN connections c ON c.id = e.connection_id`;
