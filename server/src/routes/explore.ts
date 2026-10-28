import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, now } from "../db.ts";
import { countryName } from "../geo.ts";
import { buildWhere, EVENT_COLUMNS, GROUPS, JOINS, orderBy, type Filters } from "../query.ts";

const EXPORT_LIMIT = 100_000;

const csvCell = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    // Quote when needed, and defuse spreadsheet formulas (CSV injection) from attacker-controlled fields.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function exploreRoutes(app: FastifyInstance) {
    /** Every event matching the filters, as CSV or NDJSON, streamed. */
    app.get<{ Querystring: Filters & { format?: string; sort?: string; dir?: string; columns?: string } }>("/api/export", async (req, reply) => {
        const w = buildWhere(req.query);
        const format = req.query.format === "json" ? "json" : "csv";
        const stmt = db.prepare(`SELECT ${EVENT_COLUMNS} FROM events e ${JOINS} WHERE ${w.sql} ORDER BY ${orderBy(req.query.sort, req.query.dir)} LIMIT ${EXPORT_LIMIT}`);
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        reply.raw.writeHead(200, {
            "Content-Type": format === "json" ? "application/x-ndjson" : "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="pangolin-traffic-${stamp}.${format === "json" ? "ndjson" : "csv"}"`
        });
        let cols: string[] | null = req.query.columns ? ["time", ...req.query.columns.split(",")] : null;
        let header = false;
        for (const row of stmt.iterate(...w.params) as Iterable<Record<string, unknown>>) {
            const r: Record<string, unknown> = { time: new Date(Number(row.ts) * 1000).toISOString(), ...row };
            if (format === "json") {
                reply.raw.write(JSON.stringify(r) + "\n");
                continue;
            }
            cols ??= Object.keys(r);
            if (!header) {
                reply.raw.write(cols.join(",") + "\n");
                header = true;
            }
            reply.raw.write(cols.map((c) => csvCell(r[c])).join(",") + "\n");
        }
        reply.raw.end();
        return reply;
    });

    /** Two-dimensional breakdown: top `rows` × top `cols` values with counts, denials or unique IPs. */
    app.get<{ Querystring: Filters & { rows?: string; cols?: string; metric?: string; nrows?: string; ncols?: string } }>("/api/pivot", async (req, reply) => {
        const R = GROUPS[(req.query.rows ?? "country") as keyof typeof GROUPS];
        const C = GROUPS[(req.query.cols ?? "resource") as keyof typeof GROUPS];
        if (!R || !C) return reply.code(400).send({ error: `rows/cols must be one of ${Object.keys(GROUPS).join(", ")}` });
        const metric = { count: "COUNT(*)", denied: "SUM(e.allowed = 0)", ips: "COUNT(DISTINCT e.ip)" }[req.query.metric ?? "count"] ?? "COUNT(*)";
        const w = buildWhere(req.query);
        const top = (g: typeof R, n: number) =>
            db.prepare(`SELECT ${g.key} AS key, ${g.label} AS label, ${metric} AS v FROM events e ${JOINS} WHERE ${w.sql} GROUP BY 1 ORDER BY v DESC LIMIT ?`).all(...w.params, n) as { key: string; label: string; v: number }[];
        const rows = top(R, Math.min(Number(req.query.nrows ?? 25), 100));
        const cols = top(C, Math.min(Number(req.query.ncols ?? 12), 40));
        const ri = new Map(rows.map((r, i) => [String(r.key), i]));
        const ci = new Map(cols.map((c, i) => [String(c.key), i]));
        const cells = rows.map(() => cols.map(() => 0));
        const pairs = db.prepare(`SELECT ${R.key} AS rk, ${C.key} AS ck, ${metric} AS v FROM events e ${JOINS} WHERE ${w.sql} GROUP BY 1, 2`).all(...w.params) as { rk: string; ck: string; v: number }[];
        for (const p of pairs) {
            const i = ri.get(String(p.rk));
            const j = ci.get(String(p.ck));
            if (i != null && j != null) cells[i][j] = p.v;
        }
        const label = (by: string | undefined, r: { key: string; label: string }) => (by === "country" && r.key ? `${countryName(r.key)} (${r.key})` : r.label ?? "—");
        return {
            rows: rows.map((r) => ({ key: r.key, label: label(req.query.rows ?? "country", r), total: r.v })),
            cols: cols.map((c) => ({ key: c.key, label: label(req.query.cols, c), total: c.v })),
            cells
        };
    });

    /** Profile of one IP or actor across the selected time range. */
    app.get<{ Querystring: Filters & { type: string; value: string } }>("/api/entity", async (req, reply) => {
        const type = req.query.type;
        if (!["ip", "actor"].includes(type)) return reply.code(400).send({ error: "type must be ip or actor" });
        const value = req.query.value;
        const w = buildWhere({ ...req.query, ip: undefined, q: undefined });
        const anon = type === "actor" && value === "(anonymous)";
        const match = type === "ip" ? "e.ip = ?" : anon ? "e.actor IS NULL" : "e.actor = ?";
        const matchParams = anon ? [] : [value];
        const where = `${w.sql} AND ${match}`;
        const p = [...w.params, ...matchParams];
        const summary = db.prepare(`SELECT COUNT(*) AS total, SUM(e.allowed = 1) AS allowed, SUM(e.allowed = 0) AS denied, MIN(e.ts) AS first_ts, MAX(e.ts) AS last_ts,
            COUNT(DISTINCT e.ip) AS ips, COUNT(DISTINCT e.actor) AS actors, COUNT(DISTINCT e.country) AS countries FROM events e WHERE ${where}`).get(...p);
        const allTime = db.prepare(`SELECT MIN(ts) AS first_ts, MAX(ts) AS last_ts, COUNT(*) AS total FROM events e WHERE ${match}`).get(...matchParams);
        const v4 = type === "ip" ? value.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/) : null;
        const net24 = v4 ? ((Number(v4[1]) * 256 + Number(v4[2])) * 256 + Number(v4[3])) * 256 : null;
        const group = (key: string, label: string, n = 10) =>
            db.prepare(`SELECT ${key} AS key, ${label} AS label, COUNT(*) AS count, SUM(e.allowed = 0) AS denied, MAX(e.ts) AS last_ts FROM events e ${JOINS} WHERE ${where} GROUP BY 1 ORDER BY count DESC LIMIT ?`).all(...p, n);
        const span = w.to - w.from;
        const step = [300, 900, 3600, 3 * 3600, 6 * 3600, 86400].find((s) => span / s <= 60) ?? 86400;
        return {
            type,
            value,
            summary,
            allTime,
            resources: group(GROUPS.resource.key, GROUPS.resource.label),
            locations: (group("e.country || '/' || COALESCE(e.city,'')", "e.country", 8) as { key: string; label: string }[]).map((r) => ({ ...r, label: [r.key.split("/")[1], r.label ? countryName(r.label) : null].filter(Boolean).join(", ") || "Unknown" })),
            related: type === "ip" ? group("COALESCE(e.actor,'(anonymous)')", "COALESCE(e.actor,'(anonymous)')") : group("e.ip", "e.ip", 15),
            agents: group("e.user_agent", "e.user_agent", 6),
            paths: group("COALESCE(e.method,'') || ' ' || COALESCE(e.host,'') || COALESCE(e.path,'')", "COALESCE(e.method,'') || ' ' || COALESCE(e.host,'') || COALESCE(e.path,'')", 10),
            // Other addresses in the same /24, which often belong to the same actor.
            neighbours:
                net24 != null
                    ? db.prepare(`SELECT e.ip AS key, COUNT(*) AS count, SUM(e.allowed = 0) AS denied FROM events e WHERE e.ts >= ? AND e.ip_num BETWEEN ? AND ? AND e.ip != ? GROUP BY 1 ORDER BY count DESC LIMIT 10`)
                          .all(w.from, net24, net24 + 255, value)
                    : [],
            timeline: { step, rows: db.prepare(`SELECT (e.ts / ${step}) * ${step} AS t, COUNT(*) AS count, SUM(e.allowed = 0) AS denied FROM events e WHERE ${where} GROUP BY 1 ORDER BY 1`).all(...p) },
            recent: db.prepare(`SELECT ${EVENT_COLUMNS} FROM events e ${JOINS} WHERE ${where} ORDER BY e.ts DESC LIMIT 50`).all(...p)
        };
    });

    // ---- saved views -------------------------------------------------------
    const ViewInput = z.object({ name: z.string().min(1).max(100), state: z.record(z.string(), z.unknown()) });

    app.get("/api/views", async () =>
        (db.prepare("SELECT * FROM saved_views ORDER BY name COLLATE NOCASE").all() as { state: string }[]).map((v) => ({ ...v, state: JSON.parse(v.state) }))
    );
    app.post("/api/views", async (req) => {
        const b = ViewInput.parse(req.body);
        const r = db.prepare("INSERT INTO saved_views (name, state, created_at) VALUES (?,?,?)").run(b.name, JSON.stringify(b.state), now());
        return { id: Number(r.lastInsertRowid) };
    });
    app.put<{ Params: { id: string } }>("/api/views/:id", async (req) => {
        const b = ViewInput.parse(req.body);
        db.prepare("UPDATE saved_views SET name = ?, state = ? WHERE id = ?").run(b.name, JSON.stringify(b.state), Number(req.params.id));
        return { ok: true };
    });
    app.delete<{ Params: { id: string } }>("/api/views/:id", async (req) => {
        db.prepare("DELETE FROM saved_views WHERE id = ?").run(Number(req.params.id));
        return { ok: true };
    });
}
