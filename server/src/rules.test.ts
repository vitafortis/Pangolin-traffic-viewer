import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, orderRules, pathMatches, ruleMatches, type SimRule } from "./rules.ts";

const ev = (o: Partial<{ ip: string; country: string | null; path: string; method: string }> = {}) => ({ ip: "203.0.113.5", country: "RU", path: "/login", method: "GET", ...o });
const r = (match: SimRule["match"], value: string, action: SimRule["action"] = "DROP", priority = 1, source: SimRule["source"] = "resource"): SimRule => ({ match, value, action, priority, enabled: true, source });

test("path rules match by segment like Pangolin", () => {
    assert.equal(pathMatches("/wp-login.php", "/wp-login.php"), true);
    assert.equal(pathMatches("/wp-login.php", "/blog/wp-login.php"), false);
    assert.equal(pathMatches("/*/wp-login.php", "/blog/wp-login.php"), true);
    assert.equal(pathMatches("/*", "/a/b/c"), true);
    assert.equal(pathMatches("/api/*", "/api"), true);
    assert.equal(pathMatches("/admin*", "/administrator"), true);
    assert.equal(pathMatches("/admin*", "/x/admin"), false);
    assert.equal(pathMatches("/.env", "/.env?x=1"), true);
});

test("country rules, ALL and private addresses", () => {
    assert.equal(ruleMatches(r("COUNTRY", "RU"), ev()), true);
    assert.equal(ruleMatches(r("COUNTRY", "ru"), ev()), true);
    assert.equal(ruleMatches(r("COUNTRY_IS_NOT", "US"), ev()), true);
    assert.equal(ruleMatches(r("COUNTRY_IS_NOT", "RU"), ev()), false);
    assert.equal(ruleMatches(r("COUNTRY", "ALL"), ev()), true);
    // COUNTRY=ALL never applies to LAN/CGNAT clients
    assert.equal(ruleMatches(r("COUNTRY", "ALL"), ev({ ip: "192.168.1.4" })), false);
    assert.equal(ruleMatches(r("COUNTRY", "ALL"), ev({ ip: "100.64.0.9" })), false);
    // unknown country: COUNTRY_IS_NOT matches, as in Pangolin
    assert.equal(ruleMatches(r("COUNTRY_IS_NOT", "US"), ev({ country: null })), true);
});

test("ip, cidr, method; REGION/ASN are unknown", () => {
    assert.equal(ruleMatches(r("IP", "203.0.113.5"), ev()), true);
    assert.equal(ruleMatches(r("CIDR", "203.0.113.0/24"), ev()), true);
    assert.equal(ruleMatches(r("CIDR", "10.0.0.0/8"), ev()), false);
    assert.equal(ruleMatches(r("METHOD", "POST, PUT"), ev({ method: "put" })), true);
    assert.equal(ruleMatches(r("REGION", "150"), ev()), "unknown");
});

test("first match wins; resource rules before policy rules; allowlist pattern", () => {
    const allow = orderRules([r("COUNTRY", "ALL", "DROP", 3), r("COUNTRY", "US", "PASS", 1), r("COUNTRY", "CA", "PASS", 2)]);
    assert.equal(evaluate(allow, ev({ country: "US" })).action, "PASS");
    assert.equal(evaluate(allow, ev({ country: "RU" })).action, "DROP");
    assert.equal(evaluate(allow, ev({ ip: "10.1.1.1", country: null })).action, undefined);

    const mixed = orderRules([r("COUNTRY", "RU", "PASS", 1, "policy"), r("COUNTRY", "RU", "DROP", 50, "resource")]);
    assert.equal(evaluate(mixed, ev()).action, "DROP");

    const approx = evaluate(orderRules([r("REGION", "150"), r("COUNTRY", "RU", "DROP", 2)]), ev());
    assert.deepEqual([approx.action, approx.approximate], ["DROP", true]);
});
