import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, now } from "../db.ts";
import { encrypt } from "../crypto.ts";
import { bus } from "../bus.ts";
import { config } from "../config.ts";
import { countryName, geoAttribution, geoEnabled, lookup } from "../geo.ts";
import { buildWhere, GROUPS, JOINS, type Filters } from "../query.ts";
import { clientFor, pollConnection, startPolling, stopPolling, syncInventory, type ConnectionRow } from "../ingest.ts";
import { ConditionsSchema, RuleInputSchema, compileRule, matches, reloadRules } from "../alerts.ts";
import type { TrafficEvent } from "../events.ts";

const ConnectionInput = z.object({
    name: z.string().min(1),
    base_url: z.string().default(config.defaultPangolinUrl),
    org_id: z.string().min(1),
    api_key: z.string().min(1).optional(),
    enabled: z.boolean().default(true),
    poll_interval_s: z.number().int().min(10).default(60)
});

function publicConnection(c: ConnectionRow) {
    const { api_key_enc: _k, cursors, ...rest } = c;
    const cur = JSON.parse(cursors);
    return { ...rest, enabled: !!c.enabled, disabled_kinds: cur.disabled ?? [], demo: c.base_url.startsWith("demo:") };
}

export async function apiRoutes(app: FastifyInstance) {
    // ---- metadata --------------------------------------------------------
    app.get("/api/meta", async () => {
        const connections = (db.prepare("SELECT * FROM connections ORDER BY id").all() as ConnectionRow[]).map(publicConnection);
        const sites = db.prepare("SELECT * FROM sites ORDER BY name").all();
        const resources = (db.prepare("SELECT * FROM resources ORDER BY name").all() as { site_ids: string }[]).map((r) => ({
            ...r,
            site_ids: JSON.parse(r.site_ids)
        }));
        const countries = (db.prepare("SELECT DISTINCT country FROM events WHERE country IS NOT NULL ORDER BY country").all() as { country: string }[]).map(
            (r) => ({ code: r.country, name: countryName(r.country) })
        );
        return { connections, sites, resources, countries, geoip: geoEnabled(), geoAttribution: geoAttribution(), demo: config.demo };
    });

    // ---- events ----------------------------------------------------------
    app.get<{ Querystring: Filters & { limit?: string; before?: string } }>("/api/events", async (req) => {
        const w = buildWhere(req.query);
        const limit = Math.min(Number(req.query.limit ?? 200), 2000);
        let sql = w.sql;
        if (req.query.before) {
            sql += " AND e.id < ?";
            w.params.push(Number(req.query.before));
        }
        const rows = db.prepare(`
            SELECT e.id, e.connection_id, e.kind, e.ts, e.allowed, e.reason, e.ip, e.country, e.city, e.lat, e.lon,
                   e.resource_id, COALESCE(r.name, e.resource_name) AS resource_name, e.site_id, s.name AS site_name,
                   e.actor, e.actor_type, e.host, e.path, e.method, e.protocol, e.user_agent, e.bytes_tx, e.bytes_rx
            FROM events e ${JOINS} WHERE ${sql} ORDER BY e.ts DESC, e.id DESC LIMIT ?`).all(...w.params, limit);
        return { rows };
    });

    app.get<{ Params: { id: string } }>("/api/events/:id", async (req, reply) => {
        const row = db.prepare(`SELECT e.*, s.name AS site_name FROM events e ${JOINS} WHERE e.id = ?`).get(Number(req.params.id)) as
            | (Record<string, unknown> & { raw: string | null })
            | undefined;
        if (!row) return reply.code(404).send({ error: "not found" });
        return { ...row, raw: row.raw ? JSON.parse(row.raw) : null };
    });

    app.get<{ Querystring: Filters }>("/api/stats", async (req) => {
        const w = buildWhere(req.query);
        return db.prepare(`
            SELECT COUNT(*) AS total, SUM(e.allowed = 0) AS denied, SUM(e.allowed = 1) AS allowed,
                   COUNT(DISTINCT e.ip) AS unique_ips, COUNT(DISTINCT e.country) AS countries,
                   COUNT(DISTINCT e.connection_id || ':' || e.resource_id) AS resources
            FROM events e WHERE ${w.sql}`).get(...w.params);
    });

    /** Origin points aggregated to ~0.25° cells, per destination site: drives arcs, points and heatmap. */
    app.get<{ Querystring: Filters }>("/api/geo", async (req) => {
        const w = buildWhere(req.query);
        const rows = db.prepare(`
            SELECT ROUND(e.lat * 4) / 4 AS lat, ROUND(e.lon * 4) / 4 AS lon, e.connection_id, e.site_id,
                   MAX(e.country) AS country, MAX(e.city) AS city,
                   COUNT(*) AS count, SUM(e.allowed = 0) AS denied, COUNT(DISTINCT e.ip) AS ips, MAX(e.ts) AS last_ts
            FROM events e WHERE ${w.sql} AND e.lat IS NOT NULL
            GROUP BY 1, 2, 3, 4 ORDER BY count DESC LIMIT 5000`).all(...w.params);
        return { rows };
    });

    app.get<{ Querystring: Filters & { by?: string; limit?: string } }>("/api/group", async (req, reply) => {
        const g = GROUPS[(req.query.by ?? "country") as keyof typeof GROUPS];
        if (!g) return reply.code(400).send({ error: `by must be one of ${Object.keys(GROUPS).join(", ")}` });
        const w = buildWhere(req.query);
        const rows = db.prepare(`
            SELECT ${g.key} AS key, ${g.label} AS label, COUNT(*) AS count, SUM(e.allowed = 0) AS denied,
                   COUNT(DISTINCT e.ip) AS ips, COUNT(DISTINCT e.country) AS countries, MAX(e.ts) AS last_ts
            FROM events e ${JOINS} WHERE ${w.sql}
            GROUP BY 1 ORDER BY count DESC LIMIT ?`).all(...w.params, Math.min(Number(req.query.limit ?? 100), 1000)) as {
            key: string;
            label: string;
        }[];
        if (req.query.by === "country") rows.forEach((r) => (r.label = r.key ? `${countryName(r.key)} (${r.key})` : "Unknown"));
        return { rows };
    });

    app.get<{ Querystring: Filters & { buckets?: string } }>("/api/timeseries", async (req) => {
        const w = buildWhere(req.query);
        const span = w.to - w.from;
        const steps = [60, 300, 900, 1800, 3600, 3 * 3600, 6 * 3600, 86400];
        const target = Number(req.query.buckets ?? 96);
        const step = steps.find((s) => span / s <= target) ?? 86400;
        const rows = db.prepare(`
            SELECT (e.ts / ${step}) * ${step} AS t, COUNT(*) AS count, SUM(e.allowed = 0) AS denied
            FROM events e WHERE ${w.sql} GROUP BY 1 ORDER BY 1`).all(...w.params);
        return { step, rows };
    });

    // ---- connections -----------------------------------------------------
    app.post("/api/connections", async (req, reply) => {
        const body = ConnectionInput.parse(req.body);
        if (!body.api_key) return reply.code(400).send({ error: "api_key is required" });
        const r = db.prepare(`INSERT INTO connections (name, base_url, org_id, api_key_enc, enabled, poll_interval_s, created_at)
            VALUES (?,?,?,?,?,?,?)`).run(body.name, body.base_url, body.org_id, encrypt(body.api_key), body.enabled ? 1 : 0, body.poll_interval_s, now());
        const id = Number(r.lastInsertRowid);
        if (body.enabled) startPolling(id);
        return { id };
    });

    app.patch<{ Params: { id: string } }>("/api/connections/:id", async (req, reply) => {
        const id = Number(req.params.id);
        const body = ConnectionInput.partial().parse(req.body);
        const cur = db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as ConnectionRow | undefined;
        if (!cur) return reply.code(404).send({ error: "not found" });
        db.prepare(`UPDATE connections SET name=?, base_url=?, org_id=?, api_key_enc=?, enabled=?, poll_interval_s=? WHERE id=?`).run(
            body.name ?? cur.name,
            body.base_url ?? cur.base_url,
            body.org_id ?? cur.org_id,
            body.api_key ? encrypt(body.api_key) : cur.api_key_enc,
            body.enabled === undefined ? cur.enabled : body.enabled ? 1 : 0,
            body.poll_interval_s ?? cur.poll_interval_s,
            id
        );
        if (body.enabled === false) stopPolling(id);
        else startPolling(id);
        return { ok: true };
    });

    app.delete<{ Params: { id: string } }>("/api/connections/:id", async (req) => {
        const id = Number(req.params.id);
        stopPolling(id);
        db.prepare("DELETE FROM connections WHERE id = ?").run(id);
        return { ok: true };
    });

    /** Validates credentials before saving. */
    app.post("/api/connections/test", async (req) => {
        const body = ConnectionInput.parse(req.body);
        if (!body.api_key) return { ok: false, error: "api_key is required" };
        const fake = { base_url: body.base_url, org_id: body.org_id, api_key_enc: encrypt(body.api_key) } as ConnectionRow;
        try {
            const client = clientFor(fake);
            const [sites, resources] = await Promise.all([client.listSites(), client.listResources()]);
            const probe: Record<string, string> = {};
            for (const kind of ["request", "access", "connection"] as const) {
                try {
                    const it = client.logs(kind, now() - 3600, now(), 1);
                    await it.next();
                    probe[kind] = "ok";
                } catch (e) {
                    probe[kind] = (e as Error).message;
                }
            }
            return { ok: true, sites: sites.length, resources: resources.length, logs: probe };
        } catch (e) {
            return { ok: false, error: (e as Error).message };
        }
    });

    app.post<{ Params: { id: string } }>("/api/connections/:id/sync", async (req, reply) => {
        const c = db.prepare("SELECT * FROM connections WHERE id = ?").get(Number(req.params.id)) as ConnectionRow | undefined;
        if (!c) return reply.code(404).send({ error: "not found" });
        const inv = await syncInventory(c);
        const poll = await pollConnection(c);
        return { ...inv, ...poll };
    });

    // ---- sites (placement on the globe) -----------------------------------
    app.patch<{ Params: { conn: string; site: string } }>("/api/sites/:conn/:site", async (req) => {
        const body = z.object({ lat: z.number().min(-90).max(90).nullable(), lon: z.number().min(-180).max(180).nullable(), place_label: z.string().nullable().optional() }).parse(req.body);
        db.prepare("UPDATE sites SET lat = ?, lon = ?, place_label = ? WHERE connection_id = ? AND site_id = ?").run(
            body.lat, body.lon, body.place_label ?? null, Number(req.params.conn), Number(req.params.site)
        );
        return { ok: true };
    });

    /** Helper for placing a site: geolocate a public IP (e.g. the site's WAN address). */
    app.get<{ Querystring: { ip: string } }>("/api/geoip", async (req) => ({ ...lookup(req.query.ip), attribution: geoAttribution() }));

    // ---- alerts ----------------------------------------------------------
    app.get("/api/alerts/rules", async () => {
        const rows = db.prepare("SELECT * FROM alert_rules ORDER BY id").all() as { conditions: string; channels: string; enabled: number }[];
        return rows.map((r) => ({ ...r, enabled: !!r.enabled, conditions: JSON.parse(r.conditions), channels: JSON.parse(r.channels) }));
    });

    app.post("/api/alerts/rules", async (req) => {
        const b = RuleInputSchema.parse(req.body);
        const r = db.prepare(`INSERT INTO alert_rules (name, enabled, conditions, threshold, window_s, cooldown_s, channels, created_at)
            VALUES (?,?,?,?,?,?,?,?)`).run(b.name, b.enabled ? 1 : 0, JSON.stringify(b.conditions), b.threshold, b.window_s, b.cooldown_s, JSON.stringify(b.channels), now());
        reloadRules();
        return { id: Number(r.lastInsertRowid) };
    });

    app.put<{ Params: { id: string } }>("/api/alerts/rules/:id", async (req) => {
        const b = RuleInputSchema.parse(req.body);
        db.prepare(`UPDATE alert_rules SET name=?, enabled=?, conditions=?, threshold=?, window_s=?, cooldown_s=?, channels=? WHERE id=?`).run(
            b.name, b.enabled ? 1 : 0, JSON.stringify(b.conditions), b.threshold, b.window_s, b.cooldown_s, JSON.stringify(b.channels), Number(req.params.id)
        );
        reloadRules();
        return { ok: true };
    });

    app.delete<{ Params: { id: string } }>("/api/alerts/rules/:id", async (req) => {
        db.prepare("DELETE FROM alert_rules WHERE id = ?").run(Number(req.params.id));
        reloadRules();
        return { ok: true };
    });

    /** Dry-run conditions against the last 24h so users can tune a rule before saving. */
    app.post("/api/alerts/preview", async (req) => {
        const cond = ConditionsSchema.parse((req.body as { conditions?: unknown })?.conditions ?? {});
        const recent = db.prepare("SELECT * FROM events WHERE ts > ? ORDER BY ts DESC LIMIT 20000").all(now() - 86400) as TrafficEvent[];
        const rule = compileRule({ id: 0, name: "preview", enabled: 1, conditions: JSON.stringify(cond), threshold: 1, window_s: 0, cooldown_s: 0, channels: "[]", last_fired_at: null });
        const hit = recent.filter((e) => matches(rule, e));
        return { scanned: recent.length, matched: hit.length, sample: hit.slice(0, 20).map(({ raw: _r, ...e }) => e) };
    });

    app.get<{ Querystring: { limit?: string } }>("/api/alerts/events", async (req) => {
        return db.prepare(`SELECT a.*, r.name AS rule_name FROM alert_events a JOIN alert_rules r ON r.id = a.rule_id
            ORDER BY a.ts DESC LIMIT ?`).all(Math.min(Number(req.query.limit ?? 100), 1000)).map((r) => {
            const row = r as { sample: string };
            return { ...row, sample: JSON.parse(row.sample) };
        });
    });

    app.post<{ Params: { id: string } }>("/api/alerts/events/:id/ack", async (req) => {
        db.prepare("UPDATE alert_events SET acknowledged = 1 WHERE id = ?").run(Number(req.params.id));
        return { ok: true };
    });

    // ---- live stream (SSE) -------------------------------------------------
    app.get("/api/stream", (req, reply) => {
        reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
        const send = (type: string, data: unknown) => reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        const onEvents = (evts: TrafficEvent[]) =>
            send("events", evts.slice(-200).map(({ raw: _r, user_agent: _u, ...e }) => e));
        const onAlert = (a: unknown) => send("alert", a);
        bus.on("events", onEvents);
        bus.on("alert", onAlert);
        const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
        req.raw.on("close", () => {
            clearInterval(ping);
            bus.off("events", onEvents);
            bus.off("alert", onAlert);
        });
    });
}
