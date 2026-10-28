import { config } from "./config.ts";
import { db, now, tx } from "./db.ts";
import { decrypt } from "./crypto.ts";
import { bus } from "./bus.ts";
import { PangolinClient, PangolinError, type AccessLog, type ConnectionLog, type RequestLog } from "./pangolin.ts";
import { fromAccessLog, fromConnectionLog, fromRequestLog, insertEvents, siteIndex, type Kind, type TrafficEvent } from "./events.ts";
import { generateDemoEvents, syncDemoInventory } from "./demo.ts";

export type ConnectionRow = {
    id: number;
    name: string;
    base_url: string;
    org_id: string;
    api_key_enc: string;
    enabled: number;
    poll_interval_s: number;
    cursors: string;
    last_poll_at: number | null;
    last_error: string | null;
    created_at: number;
};

type Cursors = Partial<Record<Kind, number>> & { disabled?: Kind[]; inventoryAt?: number };

/** Logs are second-granular and the API filter is exclusive, so re-read a small overlap and rely on dedupe. */
const OVERLAP_S = 120;
const INVENTORY_EVERY_S = 600;

export function clientFor(c: ConnectionRow) {
    return new PangolinClient({ baseUrl: c.base_url, orgId: c.org_id, apiKey: decrypt(c.api_key_enc) });
}

export async function syncInventory(c: ConnectionRow) {
    if (c.base_url.startsWith("demo:")) return syncDemoInventory(c.id);
    const client = clientFor(c);
    const [sites, resources] = await Promise.all([client.listSites(), client.listResources()]);
    const t = now();
    tx(() => {
        const upSite = db.prepare(`
            INSERT INTO sites (connection_id, site_id, name, nice_id, type, online, updated_at) VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(connection_id, site_id) DO UPDATE SET name=excluded.name, nice_id=excluded.nice_id,
              type=excluded.type, online=excluded.online, updated_at=excluded.updated_at`);
        for (const s of sites) upSite.run(c.id, s.siteId, s.name, s.niceId, s.type ?? null, s.online ? 1 : 0, t);
        const upRes = db.prepare(`
            INSERT INTO resources (connection_id, resource_id, name, nice_id, full_domain, site_ids, updated_at) VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(connection_id, resource_id) DO UPDATE SET name=excluded.name, nice_id=excluded.nice_id,
              full_domain=excluded.full_domain, site_ids=excluded.site_ids, updated_at=excluded.updated_at`);
        for (const r of resources) {
            const siteIds = [...new Set((r.targets ?? []).map((t) => t.siteId).filter((x) => x != null))];
            upRes.run(c.id, r.resourceId, r.name, r.niceId, r.fullDomain ?? null, JSON.stringify(siteIds), t);
        }
    });
    return { sites: sites.length, resources: resources.length };
}

async function pullKind(c: ConnectionRow, client: PangolinClient, kind: Kind, cursors: Cursors): Promise<TrafficEvent[]> {
    const end = now() + 60;
    const start = Math.max((cursors[kind] ?? end - config.backfillHours * 3600) - OVERLAP_S, end - 7 * 86400);
    const sites = siteIndex(c.id);
    let fresh: TrafficEvent[] = [];
    let maxTs = cursors[kind] ?? 0;
    for await (const page of client.logs<RequestLog | AccessLog | ConnectionLog>(kind, start, end)) {
        const evts = page.map((l) =>
            kind === "request"
                ? fromRequestLog(c.id, l as RequestLog, sites)
                : kind === "access"
                  ? fromAccessLog(c.id, l as AccessLog, sites)
                  : fromConnectionLog(c.id, l as ConnectionLog)
        );
        const inserted = tx(() => insertEvents(evts));
        fresh = fresh.concat(inserted);
        for (const e of evts) maxTs = Math.max(maxTs, e.ts);
        // Newest-first ordering: once a whole page is already known we've caught up.
        if (inserted.length === 0 && evts.length > 0 && cursors[kind]) break;
    }
    cursors[kind] = maxTs || start + OVERLAP_S;
    return fresh;
}

export async function pollConnection(c: ConnectionRow): Promise<{ inserted: number; errors: string[] }> {
    const cursors = JSON.parse(c.cursors) as Cursors;
    const errors: string[] = [];
    let fresh: TrafficEvent[] = [];

    if (!cursors.inventoryAt || now() - cursors.inventoryAt > INVENTORY_EVERY_S) {
        try {
            await syncInventory(c);
            cursors.inventoryAt = now();
        } catch (e) {
            errors.push(`inventory: ${(e as Error).message}`);
        }
    }

    if (c.base_url.startsWith("demo:")) {
        fresh = tx(() => insertEvents(generateDemoEvents(c.id, cursors)));
    } else {
        const client = clientFor(c);
        const disabled = new Set(cursors.disabled ?? []);
        for (const kind of ["request", "access", "connection"] as Kind[]) {
            if (disabled.has(kind)) continue;
            try {
                fresh = fresh.concat(await pullKind(c, client, kind, cursors));
            } catch (e) {
                // Access/connection logs are Cloud/Enterprise-only or may need extra key permissions; stop asking.
                if (e instanceof PangolinError && (e.status === 403 || e.status === 404) && kind !== "request") {
                    disabled.add(kind);
                    cursors.disabled = [...disabled];
                    console.warn(`[ingest] ${c.name}: ${kind} logs unavailable (${e.status}); disabling`);
                } else {
                    errors.push(`${kind}: ${(e as Error).message}`);
                }
            }
        }
    }

    db.prepare("UPDATE connections SET cursors = ?, last_poll_at = ?, last_error = ? WHERE id = ?").run(
        JSON.stringify(cursors),
        now(),
        errors.length ? errors.join("; ") : null,
        c.id
    );
    if (fresh.length) bus.emit("events", fresh);
    return { inserted: fresh.length, errors };
}

const timers = new Map<number, NodeJS.Timeout>();
const running = new Set<number>();

function schedule(id: number, delayMs: number) {
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => tick(id), delayMs));
}

async function tick(id: number) {
    const c = db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as ConnectionRow | undefined;
    if (!c || !c.enabled) return void timers.delete(id);
    if (!running.has(id)) {
        running.add(id);
        try {
            const r = await pollConnection(c);
            if (r.inserted) console.log(`[ingest] ${c.name}: +${r.inserted} events`);
            if (r.errors.length) console.warn(`[ingest] ${c.name}: ${r.errors.join("; ")}`);
        } catch (e) {
            console.error(`[ingest] ${c.name} failed`, e);
        } finally {
            running.delete(id);
        }
    }
    schedule(id, Math.max(10, c.poll_interval_s) * 1000);
}

/** (Re)start polling for a connection immediately. */
export function startPolling(id: number) {
    schedule(id, 0);
}

export function stopPolling(id: number) {
    clearTimeout(timers.get(id));
    timers.delete(id);
}

export function startAllPollers() {
    const rows = db.prepare("SELECT id FROM connections WHERE enabled = 1").all() as { id: number }[];
    rows.forEach((r) => startPolling(r.id));
    setInterval(prune, 3600_000).unref();
    prune();
}

function prune() {
    const cutoff = now() - config.retentionDays * 86400;
    const r = db.prepare("DELETE FROM events WHERE ts < ?").run(cutoff);
    if (r.changes) console.log(`[ingest] pruned ${r.changes} events older than ${config.retentionDays}d`);
}
