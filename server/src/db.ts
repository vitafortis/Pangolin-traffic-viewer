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
