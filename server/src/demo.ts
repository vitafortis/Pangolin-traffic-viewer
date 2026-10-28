/** Synthetic traffic so the UI can be explored without a Pangolin API key (DEMO=1). */
import { db, now, tx } from "./db.ts";
import type { Kind, TrafficEvent } from "./events.ts";

const SITES = [
    { id: 1, name: "hq-ashburn", lat: 39.04, lon: -77.49, label: "Ashburn, US" },
    { id: 2, name: "edge-frankfurt", lat: 50.11, lon: 8.68, label: "Frankfurt, DE" },
    { id: 3, name: "lab-singapore", lat: 1.35, lon: 103.82, label: "Singapore" },
    { id: 4, name: "home-denver", lat: 39.74, lon: -104.99, label: "Denver, US" }
];

const RESOURCES = [
    { id: 11, name: "Grafana", domain: "grafana.example.com", site: 1 },
    { id: 12, name: "Gitea", domain: "git.example.com", site: 1 },
    { id: 13, name: "Jellyfin", domain: "media.example.com", site: 4 },
    { id: 14, name: "Home Assistant", domain: "ha.example.com", site: 4 },
    { id: 15, name: "Customer API", domain: "api.example.com", site: 2 },
    { id: 16, name: "Docs", domain: "docs.example.com", site: 2 },
    { id: 17, name: "Build Runner", domain: "ci.example.com", site: 3 }
];

// [country, city, lat, lon, weight]
const ORIGINS: [string, string, number, number, number][] = [
    ["US", "New York", 40.71, -74.0, 14], ["US", "San Francisco", 37.77, -122.42, 10], ["US", "Chicago", 41.88, -87.63, 7],
    ["US", "Denver", 39.74, -104.99, 8], ["CA", "Toronto", 43.65, -79.38, 5], ["GB", "London", 51.51, -0.13, 8],
    ["DE", "Berlin", 52.52, 13.4, 6], ["FR", "Paris", 48.86, 2.35, 4], ["NL", "Amsterdam", 52.37, 4.9, 5],
    ["IN", "Bengaluru", 12.97, 77.59, 4], ["JP", "Tokyo", 35.68, 139.69, 3], ["SG", "Singapore", 1.29, 103.85, 4],
    ["AU", "Sydney", -33.87, 151.21, 3], ["BR", "São Paulo", -23.55, -46.63, 3], ["ZA", "Johannesburg", -26.2, 28.05, 1],
    ["CN", "Shanghai", 31.23, 121.47, 3], ["RU", "Moscow", 55.76, 37.62, 2], ["VN", "Hanoi", 21.03, 105.85, 1],
    ["IR", "Tehran", 35.69, 51.39, 1], ["KR", "Seoul", 37.57, 126.98, 2]
];
const SCANNERS = new Set(["CN", "RU", "VN", "IR"]);
const totalWeight = ORIGINS.reduce((s, o) => s + o[4], 0);

const USERS = ["alice@example.com", "bob@example.com", "carol@example.com", null, null];
const PATHS = ["/", "/api/v1/health", "/login", "/dashboard", "/assets/app.js", "/api/v1/query", "/wp-login.php", "/.env", "/admin"];
const UAS = ["Mozilla/5.0 (Macintosh)", "Mozilla/5.0 (Windows NT 10.0)", "curl/8.5.0", "python-requests/2.32", "Go-http-client/1.1"];

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function origin() {
    let r = Math.random() * totalWeight;
    for (const o of ORIGINS) if ((r -= o[4]) <= 0) return o;
    return ORIGINS[0];
}

function ipFor(cc: string, city: string) {
    // stable-ish /16 per city so grouping by IP shows repeat visitors
    let h = 0;
    for (const ch of cc + city) h = (h * 31 + ch.charCodeAt(0)) & 0xff;
    return `${(h % 200) + 20}.${(h * 7) % 255}.${Math.floor(Math.random() * 8)}.${Math.floor(Math.random() * 254) + 1}`;
}

export function syncDemoInventory(connectionId: number) {
    const t = now();
    tx(() => {
        for (const s of SITES) {
            db.prepare(`INSERT INTO sites (connection_id, site_id, name, nice_id, type, online, lat, lon, place_label, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET updated_at=excluded.updated_at`)
                .run(connectionId, s.id, s.name, s.name, "newt", 1, s.lat, s.lon, s.label, t);
        }
        for (const r of RESOURCES) {
            db.prepare(`INSERT INTO resources (connection_id, resource_id, name, nice_id, full_domain, site_ids, updated_at)
                VALUES (?,?,?,?,?,?,?) ON CONFLICT DO UPDATE SET updated_at=excluded.updated_at`)
                .run(connectionId, r.id, r.name, r.name.toLowerCase().replace(/\s/g, "-"), r.domain, JSON.stringify([r.site]), t);
        }
    });
    return { sites: SITES.length, resources: RESOURCES.length };
}

let seq = 0;

function makeEvent(connectionId: number, ts: number): TrafficEvent {
    const [cc, city, lat, lon] = origin();
    const res = pick(RESOURCES);
    const scanner = SCANNERS.has(cc) && Math.random() < 0.8;
    const kind: Kind = Math.random() < 0.85 ? "request" : "access";
    const allowed = scanner ? Math.random() < 0.1 : Math.random() < 0.93;
    const actor = allowed ? pick(USERS) : null;
    return {
        connection_id: connectionId,
        kind,
        source_key: `demo-${ts}-${seq++}-${Math.random().toString(36).slice(2, 8)}`,
        ts,
        allowed: allowed ? 1 : 0,
        reason: allowed ? 100 : 201,
        ip: ipFor(cc, city),
        country: cc,
        city,
        lat: lat + (Math.random() - 0.5) * 0.6,
        lon: lon + (Math.random() - 0.5) * 0.6,
        resource_id: res.id,
        resource_name: res.name,
        site_id: res.site,
        actor,
        actor_type: actor ? "user" : null,
        host: res.domain,
        path: scanner ? pick(PATHS.slice(6)) : pick(PATHS.slice(0, 6)),
        method: kind === "access" ? pick(["login", "password", "pincode", "whitelistedEmail"]) : pick(["GET", "GET", "GET", "POST"]),
        protocol: "https",
        user_agent: scanner ? pick(UAS.slice(2)) : pick(UAS),
        bytes_tx: null,
        bytes_rx: null,
        raw: null
    };
}

export function generateDemoEvents(connectionId: number, cursors: Partial<Record<Kind, number>>): TrafficEvent[] {
    const t = now();
    const from = cursors.request ?? t - 24 * 3600;
    const out: TrafficEvent[] = [];
    // ~0.08 ev/s for backfill, ~0.5 ev/s live
    const rate = t - from > 3600 ? 0.08 : 0.5;
    const n = Math.min(20000, Math.round((t - from) * rate * (0.5 + Math.random())));
    for (let i = 0; i < n; i++) out.push(makeEvent(connectionId, from + Math.floor(Math.random() * (t - from))));
    // Occasional burst from a single scanner IP so alerts have something to catch.
    if (Math.random() < 0.15) {
        const burstIp = `45.${Math.floor(Math.random() * 255)}.12.${Math.floor(Math.random() * 254) + 1}`;
        for (let i = 0; i < 25; i++) {
            const e = makeEvent(connectionId, t - Math.floor(Math.random() * 30));
            Object.assign(e, { ip: burstIp, country: "RU", city: "Moscow", lat: 55.76, lon: 37.62, allowed: 0, reason: 201, path: "/wp-login.php", actor: null });
            out.push(e);
        }
    }
    cursors.request = t;
    return out;
}
