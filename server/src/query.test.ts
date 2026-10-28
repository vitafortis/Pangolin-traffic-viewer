import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ptv-q-"));
const { db, now } = await import("./db.ts");
const { insertEvents } = await import("./events.ts");
const { buildWhere } = await import("./query.ts");

db.prepare("INSERT INTO connections (id, name, base_url, org_id, api_key_enc, created_at) VALUES (1,'Prod','x','o','k',0)").run();
db.prepare("INSERT INTO sites (connection_id, site_id, name) VALUES (1, 7, 'edge-frankfurt')").run();

const t = now() - 10;
const base = { connection_id: 1, kind: "request" as const, ts: t, reason: 100, city: null, lat: null, lon: null, resource_id: 5, site_id: 7, actor_type: null, protocol: "https", bytes_tx: null, bytes_rx: null, raw: null };
insertEvents([
    { ...base, source_key: "a", allowed: 1, ip: "45.12.1.9", country: "RU", resource_name: "Gitea", actor: "alice@example.com", host: "git.example.com", path: "/login", method: "GET", user_agent: "Mozilla" },
    { ...base, source_key: "b", allowed: 0, ip: "45.200.3.4", country: "RU", resource_name: "Gitea", actor: null, host: "git.example.com", path: "/wp-login.php", method: "POST", user_agent: "curl/8" },
    { ...base, source_key: "c", allowed: 0, ip: "8.8.8.8", country: "US", resource_name: "Grafana", actor: null, host: "grafana.example.com", path: "/.env", method: "GET", user_agent: "python-requests" },
    { ...base, source_key: "d", allowed: 1, ip: "2001:db8::1", country: "DE", resource_name: "Grafana", actor: "bob@example.com", host: "grafana.example.com", path: "/d/abc", method: "GET", user_agent: "Mozilla", site_id: 9 }
]);

const keys = (q: string) => {
    const w = buildWhere({ q, from: "0" });
    return (db.prepare(`SELECT source_key FROM events e WHERE ${w.sql} ORDER BY source_key`).all(...w.params) as { source_key: string }[]).map((r) => r.source_key).join("");
};

test("field terms, OR lists and aliases", () => {
    assert.equal(keys("country:RU"), "ab");
    assert.equal(keys("cc:us,de"), "cd");
    assert.equal(keys("verdict:deny"), "bc");
    assert.equal(keys("method:post"), "b");
    assert.equal(keys("resource:graf"), "cd");
    assert.equal(keys("site:frankfurt"), "abc");
});

test("negation keeps NULLs", () => {
    assert.equal(keys("-actor:alice"), "bcd");
    assert.equal(keys("user:anonymous"), "bc");
    assert.equal(keys("-verdict:deny country:RU"), "a");
});

test("globs are anchored, plain text is substring", () => {
    assert.equal(keys("path:/wp-*"), "b");
    assert.equal(keys("path:login"), "ab");
    assert.equal(keys("path:/login"), "a");
    assert.equal(keys("agent:curl*"), "b");
});

test("IP: exact, CIDR range, wildcard, IPv6 prefix", () => {
    assert.equal(keys("ip:8.8.8.8"), "c");
    assert.equal(keys("ip:45.0.0.0/8"), "ab");
    assert.equal(keys("ip:45.12.0.0/16"), "a");
    assert.equal(keys("ip:45.*"), "ab");
    assert.equal(keys("ip:2001:db8::/32"), "d");
    assert.equal(keys("-ip:45.0.0.0/8"), "cd");
});

test("free text, quotes and LIKE metacharacters", () => {
    assert.equal(keys("grafana"), "cd");
    assert.equal(keys('"wp-login"'), "b");
    assert.equal(keys("100%"), "");
    assert.equal(keys("_"), "");
    assert.equal(keys("country:RU -path:/wp-*"), "a");
});
