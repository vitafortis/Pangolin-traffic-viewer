import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

const migrations: string[] = [
    `
    CREATE TABLE connections (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        org_id TEXT NOT NULL,
        api_key_enc TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        poll_interval_s INTEGER NOT NULL DEFAULT 60,
        cursors TEXT NOT NULL DEFAULT '{}',
        last_poll_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL
    );

    CREATE TABLE sites (
        connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        site_id INTEGER NOT NULL,
        name TEXT,
        nice_id TEXT,
        type TEXT,
        online INTEGER,
        lat REAL,
        lon REAL,
        place_label TEXT,
        updated_at INTEGER,
        PRIMARY KEY (connection_id, site_id)
    );

    CREATE TABLE resources (
        connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        resource_id INTEGER NOT NULL,
        name TEXT,
        nice_id TEXT,
        full_domain TEXT,
        site_ids TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER,
        PRIMARY KEY (connection_id, resource_id)
    );

    -- Normalized traffic events from all Pangolin log types.
    CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,              -- request | access | connection
        source_key TEXT NOT NULL,
        ts INTEGER NOT NULL,             -- unix seconds
        allowed INTEGER,                 -- 1 allow, 0 deny, NULL n/a
        reason INTEGER,
        ip TEXT,
        country TEXT,
        city TEXT,
        lat REAL,
        lon REAL,
        resource_id INTEGER,
        resource_name TEXT,
        site_id INTEGER,
        actor TEXT,
        actor_type TEXT,
        host TEXT,
        path TEXT,
        method TEXT,
        protocol TEXT,
        user_agent TEXT,
        bytes_tx INTEGER,
        bytes_rx INTEGER,
        raw TEXT,
        UNIQUE (connection_id, kind, source_key)
    );
    CREATE INDEX events_ts ON events(ts);
    CREATE INDEX events_country ON events(country, ts);
    CREATE INDEX events_resource ON events(resource_id, ts);
    CREATE INDEX events_site ON events(site_id, ts);
    CREATE INDEX events_ip ON events(ip, ts);

    CREATE TABLE alert_rules (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        conditions TEXT NOT NULL DEFAULT '{}',
        threshold INTEGER NOT NULL DEFAULT 1,
        window_s INTEGER NOT NULL DEFAULT 300,
        cooldown_s INTEGER NOT NULL DEFAULT 900,
        channels TEXT NOT NULL DEFAULT '[]',
        last_fired_at INTEGER,
        created_at INTEGER NOT NULL
    );

    CREATE TABLE alert_events (
        id INTEGER PRIMARY KEY,
        rule_id INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
        ts INTEGER NOT NULL,
        match_count INTEGER NOT NULL,
        summary TEXT NOT NULL,
        sample TEXT NOT NULL,
        delivery TEXT,
        acknowledged INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX alert_events_ts ON alert_events(ts);
    `,
    `
    -- IPv4 as an integer so CIDR filters become range scans (backfilled in code below).
    ALTER TABLE events ADD COLUMN ip_num INTEGER;
    CREATE INDEX events_ip_num ON events(ip_num);

    CREATE TABLE saved_views (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );

    -- Every rule this app writes to Pangolin, so it can be shown and undone.
    CREATE TABLE policy_actions (
        id INTEGER PRIMARY KEY,
        connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        resource_id INTEGER NOT NULL,
        ts INTEGER NOT NULL,
        rules TEXT NOT NULL,
        enabled_apply_rules INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        undone_at INTEGER
    );

    -- Stand-in for Pangolin's rule store when the connection is the demo.
    CREATE TABLE demo_rules (
        rule_id INTEGER PRIMARY KEY,
        connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        resource_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        match TEXT NOT NULL,
        value TEXT NOT NULL,
        priority INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
    );
    ALTER TABLE resources ADD COLUMN demo_apply_rules INTEGER NOT NULL DEFAULT 0;
    `
];

const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
for (let v = current; v < migrations.length; v++) {
    db.exec("BEGIN");
    try {
        db.exec(migrations[v]);
        db.exec(`PRAGMA user_version = ${v + 1}`);
        db.exec("COMMIT");
    } catch (e) {
        db.exec("ROLLBACK");
        throw e;
    }
}

export function ipv4ToNum(ip: string | null | undefined): number | null {
    const m = ip?.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;
    const o = m.slice(1).map(Number);
    return o.some((x) => x > 255) ? null : ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
}

if (current < 2) {
    const rows = db.prepare("SELECT id, ip FROM events WHERE ip_num IS NULL AND ip LIKE '%.%.%.%'").all() as { id: number; ip: string }[];
    const upd = db.prepare("UPDATE events SET ip_num = ? WHERE id = ?");
    db.exec("BEGIN");
    for (const r of rows) upd.run(ipv4ToNum(r.ip), r.id);
    db.exec("COMMIT");
}

export function tx<T>(fn: () => T): T {
    db.exec("BEGIN");
    try {
        const r = fn();
        db.exec("COMMIT");
        return r;
    } catch (e) {
        db.exec("ROLLBACK");
        throw e;
    }
}

export const now = () => Math.floor(Date.now() / 1000);
