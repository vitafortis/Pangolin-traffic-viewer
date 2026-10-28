export type Kind = "request" | "access" | "connection";

export type Filters = {
    range: string; // "15m" | "1h" | ... | "custom"
    from?: number;
    to?: number;
    kinds: Kind[];
    allowed: "" | "1" | "0";
    sites: string[]; // "conn:site"
    resources: string[]; // "conn:res"
    countries: string[];
    connections: string[];
    ip: string;
    q: string;
};

export const RANGES: Record<string, number> = { "15m": 900, "1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800, "30d": 2592000 };

export const emptyFilters = (): Filters => ({ range: "24h", kinds: [], allowed: "", sites: [], resources: [], countries: [], connections: [], ip: "", q: "" });

export function filterParams(f: Filters): Record<string, string> {
    const now = Math.floor(Date.now() / 1000);
    const from = f.range === "custom" ? f.from! : now - RANGES[f.range];
    const to = f.range === "custom" ? f.to! : now + 60;
    const p: Record<string, string> = { from: String(from), to: String(to) };
    if (f.kinds.length) p.kinds = f.kinds.join(",");
    if (f.allowed) p.allowed = f.allowed;
    if (f.sites.length) p.sites = f.sites.join(",");
    if (f.resources.length) p.resources = f.resources.join(",");
    if (f.countries.length) p.countries = f.countries.join(",");
    if (f.connections.length) p.connections = f.connections.join(",");
    if (f.ip) p.ip = f.ip;
    if (f.q) p.q = f.q;
    return p;
}

export class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; params?: Record<string, string> } = {}): Promise<T> {
    const qs = opts.params ? "?" + new URLSearchParams(opts.params).toString() : "";
    const res = await fetch(path + qs, {
        method: opts.method ?? "GET",
        headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        credentials: "same-origin"
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
    return data as T;
}

export type Connection = {
    id: number;
    name: string;
    base_url: string;
    org_id: string;
    enabled: boolean;
    poll_interval_s: number;
    last_poll_at: number | null;
    last_error: string | null;
    disabled_kinds: Kind[];
    demo: boolean;
};
export type Site = { connection_id: number; site_id: number; name: string; nice_id: string; type: string; online: number; lat: number | null; lon: number | null; place_label: string | null };
export type Resource = { connection_id: number; resource_id: number; name: string; full_domain: string | null; site_ids: number[] };
export type GeoAttribution = { text: string; url: string };
export type Meta = {
    connections: Connection[];
    sites: Site[];
    resources: Resource[];
    countries: { code: string; name: string }[];
    geoip: boolean;
    geoAttribution: GeoAttribution | null;
    demo: boolean;
};

export type EventRow = {
    id: number;
    connection_id: number;
    kind: Kind;
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
    site_name?: string | null;
    actor: string | null;
    host: string | null;
    path: string | null;
    method: string | null;
    protocol: string | null;
    user_agent?: string | null;
};
export type GeoRow = { lat: number; lon: number; connection_id: number; site_id: number | null; country: string | null; city: string | null; count: number; denied: number; ips: number; last_ts: number };
export type GroupRow = { key: string; label: string; count: number; denied: number; ips: number; countries: number; last_ts: number };
export type Stats = { total: number; denied: number | null; allowed: number | null; unique_ips: number; countries: number; resources: number };

export type Schedule = { tz: string; days: number[]; startHour: number; endHour: number; mode: "inside" | "outside" };
export type Conditions = {
    kinds?: Kind[];
    allowed?: boolean | null;
    countries?: string[];
    excludeCountries?: string[];
    sites?: string[];
    resources?: string[];
    ipCidrs?: string[];
    excludeIpCidrs?: string[];
    text?: string;
    schedule?: Schedule;
    newCountry?: boolean;
    groupBy?: "ip" | "country" | "resource" | "site" | "actor" | null;
};
export type Channel = { type: "webhook"; url: string; format: "json" | "slack" | "discord" };
export type Rule = { id: number; name: string; enabled: boolean; conditions: Conditions; threshold: number; window_s: number; cooldown_s: number; channels: Channel[]; last_fired_at: number | null };
export type AlertEvent = { id: number; rule_id: number; rule_name: string; ts: number; match_count: number; summary: string; sample: EventRow[]; delivery: string | null; acknowledged: number };

export const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const fmtNum = (n: number | null | undefined) => (n ?? 0).toLocaleString();
export const ago = (ts: number | null) => {
    if (!ts) return "never";
    const s = Math.floor(Date.now() / 1000) - ts;
    return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
export const flag = (cc: string | null) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "🌐");

const regionNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(undefined, { type: "region" }) : null;
export const countryLabel = (cc: string | null) => {
    if (!cc) return "";
    try {
        return regionNames?.of(cc) ?? cc;
    } catch {
        return cc;
    }
};
