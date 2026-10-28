import { db, ipv4ToNum } from "./db.ts";
import { sha1 } from "./crypto.ts";
import { lookup, cleanIp } from "./geo.ts";
import type { AccessLog, ConnectionLog, RequestLog } from "./pangolin.ts";

export type Kind = "request" | "access" | "connection";

export type TrafficEvent = {
    id?: number;
    connection_id: number;
    kind: Kind;
    source_key: string;
    ts: number;
    allowed: number | null;
    reason: number | null;
    ip: string | null;
    country: string | null;
    city: string | null;
    lat: number | null;
    lon: number | null;
    resource_id: number | null;
    resource_name: string | null;
    site_id: number | null;
    actor: string | null;
    actor_type: string | null;
    host: string | null;
    path: string | null;
    method: string | null;
    protocol: string | null;
    user_agent: string | null;
    bytes_tx: number | null;
    bytes_rx: number | null;
    raw: string | null;
    ip_num?: number | null;
};

const COLS = [
    "connection_id", "kind", "source_key", "ts", "allowed", "reason", "ip", "country", "city", "lat", "lon",
    "resource_id", "resource_name", "site_id", "actor", "actor_type", "host", "path", "method", "protocol",
    "user_agent", "bytes_tx", "bytes_rx", "raw", "ip_num"
] as const;

const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO events (${COLS.join(",")}) VALUES (${COLS.map(() => "?").join(",")})`
);

/** Inserts events, returning only the ones that were new (with ids). */
export function insertEvents(evts: TrafficEvent[]): TrafficEvent[] {
    const fresh: TrafficEvent[] = [];
    for (const e of evts) {
        const r = insertStmt.run(...COLS.map((c) => (c === "ip_num" ? ipv4ToNum(e.ip) : e[c] ?? null)));
        if (r.changes > 0) fresh.push({ ...e, id: Number(r.lastInsertRowid) });
    }
    return fresh;
}

/** resource_id -> first site_id it targets, per connection. */
export type SiteIndex = Map<number, number>;

export function siteIndex(connectionId: number): SiteIndex {
    const rows = db.prepare("SELECT resource_id, site_ids FROM resources WHERE connection_id = ?").all(connectionId) as {
        resource_id: number;
        site_ids: string;
    }[];
    return new Map(rows.flatMap((r) => {
        const ids = JSON.parse(r.site_ids) as number[];
        return ids.length ? [[r.resource_id, ids[0]] as [number, number]] : [];
    }));
}

export function fromRequestLog(connectionId: number, l: RequestLog, sites: SiteIndex): TrafficEvent {
    const g = lookup(l.ip, l.location);
    const resourceId = l.resourceId ?? l.siteResourceId ?? null;
    return {
        connection_id: connectionId,
        kind: "request",
        source_key: l.id != null ? String(l.id) : sha1(JSON.stringify([l.timestamp, l.ip, l.method, l.host, l.path, l.reason, l.actorId])),
        ts: l.timestamp,
        allowed: l.action ? 1 : 0,
        reason: l.reason ?? null,
        ip: cleanIp(l.ip) ?? l.ip,
        ...g,
        resource_id: resourceId,
        resource_name: l.resourceName ?? null,
        site_id: l.resourceId != null ? sites.get(l.resourceId) ?? null : null,
        actor: l.actor,
        actor_type: l.actorType,
        host: l.host,
        path: l.path,
        method: l.method,
        protocol: l.scheme,
        user_agent: l.userAgent,
        bytes_tx: null,
        bytes_rx: null,
        raw: JSON.stringify(l)
    };
}

export function fromAccessLog(connectionId: number, l: AccessLog, sites: SiteIndex): TrafficEvent {
    const g = lookup(l.ip, l.location);
    return {
        connection_id: connectionId,
        kind: "access",
        source_key: sha1(JSON.stringify([l.timestamp, l.ip, l.type, l.actorId, l.resourceId, l.siteResourceId, l.action])),
        ts: l.timestamp,
        allowed: l.action ? 1 : 0,
        reason: null,
        ip: cleanIp(l.ip) ?? l.ip,
        ...g,
        resource_id: l.resourceId ?? l.siteResourceId ?? null,
        resource_name: l.resourceName ?? null,
        site_id: l.resourceId != null ? sites.get(l.resourceId) ?? null : null,
        actor: l.actor,
        actor_type: l.actorType,
        host: null,
        path: null,
        method: l.type,
        protocol: null,
        user_agent: l.userAgent,
        bytes_tx: null,
        bytes_rx: null,
        raw: JSON.stringify(l)
    };
}

export function fromConnectionLog(connectionId: number, l: ConnectionLog): TrafficEvent {
    const g = lookup(l.clientEndpoint);
    return {
        connection_id: connectionId,
        kind: "connection",
        source_key: l.sessionId,
        ts: l.startedAt,
        allowed: null,
        reason: null,
        ip: cleanIp(l.clientEndpoint),
        ...g,
        resource_id: l.siteResourceId,
        resource_name: l.resourceName,
        site_id: l.siteId,
        actor: l.userEmail ?? l.clientName ?? l.userId,
        actor_type: l.userId ? "user" : "client",
        host: l.destAddr,
        path: null,
        method: null,
        protocol: l.protocol,
        user_agent: null,
        bytes_tx: l.bytesTx,
        bytes_rx: l.bytesRx,
        raw: JSON.stringify(l)
    };
}
