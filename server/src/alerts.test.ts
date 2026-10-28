import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "ptv-test-"));
const { compileRule, inSchedule, matches } = await import("./alerts.ts");
const { cleanIp } = await import("./geo.ts");

const ev = (over: Record<string, unknown> = {}) => ({
    connection_id: 1, kind: "request" as const, source_key: "k", ts: Date.UTC(2026, 9, 28, 14, 0) / 1000, allowed: 1, reason: 100,
    ip: "203.0.113.7", country: "US", city: "Denver", lat: 0, lon: 0, resource_id: 5, resource_name: "Grafana", site_id: 2,
    actor: "alice@example.com", actor_type: "user", host: "grafana.example.com", path: "/login", method: "GET", protocol: "https",
    user_agent: "curl/8", bytes_tx: null, bytes_rx: null, raw: null, ...over
});

const rule = (conditions: object) =>
    compileRule({ id: 1, name: "t", enabled: 1, conditions: JSON.stringify(conditions), threshold: 1, window_s: 60, cooldown_s: 0, channels: "[]", last_fired_at: null });

test("country include/exclude", () => {
    assert.equal(matches(rule({ countries: ["US"] }), ev()), true);
    assert.equal(matches(rule({ countries: ["RU"] }), ev()), false);
    assert.equal(matches(rule({ excludeCountries: ["US"] }), ev()), false);
});

test("verdict, resources and text", () => {
    assert.equal(matches(rule({ allowed: false }), ev()), false);
    assert.equal(matches(rule({ allowed: false }), ev({ allowed: 0 })), true);
    assert.equal(matches(rule({ resources: ["1:5"] }), ev()), true);
    assert.equal(matches(rule({ resources: ["2:5"] }), ev()), false);
    assert.equal(matches(rule({ text: "LOGIN" }), ev()), true);
});

test("CIDR include/exclude", () => {
    assert.equal(matches(rule({ ipCidrs: ["203.0.113.0/24"] }), ev()), true);
    assert.equal(matches(rule({ ipCidrs: ["198.51.100.0/24"] }), ev()), false);
    assert.equal(matches(rule({ excludeIpCidrs: ["203.0.0.0/8"] }), ev()), false);
});

test("schedule windows respect time zone and wrap midnight", () => {
    const ts = Date.UTC(2026, 9, 28, 14, 0) / 1000; // Wed 10:00 in New York
    const ny = { tz: "America/New_York", days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 };
    assert.equal(inSchedule(ts, { ...ny, mode: "inside" }), true);
    assert.equal(inSchedule(ts, { ...ny, mode: "outside" }), false);
    assert.equal(inSchedule(ts, { ...ny, days: [0, 6], mode: "outside" }), true);
    const night = { tz: "UTC", days: [0, 1, 2, 3, 4, 5, 6], startHour: 22, endHour: 6, mode: "inside" as const };
    assert.equal(inSchedule(Date.UTC(2026, 9, 28, 23) / 1000, night), true);
    assert.equal(inSchedule(Date.UTC(2026, 9, 28, 12) / 1000, night), false);
});

test("cleanIp strips ports and brackets", () => {
    assert.equal(cleanIp("1.2.3.4:5678"), "1.2.3.4");
    assert.equal(cleanIp("[2001:db8::1]:443"), "2001:db8::1");
    assert.equal(cleanIp("2001:db8::1"), "2001:db8::1");
    assert.equal(cleanIp("garbage"), null);
});
