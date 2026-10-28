import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import maxmind, { type CityResponse, type Reader } from "maxmind";
import type { Country } from "world-countries";
import countriesJson from "world-countries/countries.json" with { type: "json" };

const countries = countriesJson as unknown as Country[];
import { config } from "./config.ts";
import { downloadGeoip } from "./geoipDownload.ts";

export type Geo = { country: string | null; city: string | null; lat: number | null; lon: number | null };

const centroids = new Map<string, { lat: number; lon: number; name: string }>(
    countries.map((c) => [c.cca2, { lat: c.latlng[0], lon: c.latlng[1], name: c.name.common }])
);

export function countryName(code: string) {
    return centroids.get(code)?.name ?? code;
}

let reader: Reader<CityResponse> | null = null;

/** Loads the first *.mmdb in DATA_DIR/geo (GeoLite2-City or DB-IP City Lite). */
export async function initGeo() {
    const findDb = () => (existsSync(config.geoDir) ? readdirSync(config.geoDir).find((f) => f.endsWith(".mmdb")) : undefined);
    let file = findDb();
    if (!file && config.geoipAutoDownload) {
        try {
            console.log("[geo] downloading DB-IP City Lite…");
            await downloadGeoip(config.geoDir);
            file = findDb();
        } catch (e) {
            console.warn(`[geo] ${(e as Error).message}; falling back to country centroids`);
        }
    }
    if (!file) return;
    reader = await maxmind.open<CityResponse>(path.join(config.geoDir, file));
    console.log(`[geo] loaded ${file}`);
}

export function geoEnabled() {
    return reader !== null;
}

/** Credit required by the loaded database's license (DB-IP Lite and GeoLite2 both require one). */
export function geoAttribution(): { text: string; url: string } | null {
    const type = reader?.metadata.databaseType ?? "";
    if (type.startsWith("DBIP")) return { text: "IP Geolocation by DB-IP", url: "https://db-ip.com" };
    if (type.startsWith("GeoLite2")) return { text: "This product includes GeoLite2 data created by MaxMind", url: "https://www.maxmind.com" };
    return null;
}

/** Strips ports / brackets from "1.2.3.4:5678" or "[::1]:5678". */
export function cleanIp(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let s = raw.trim();
    const v6 = s.match(/^\[([^\]]+)\](?::\d+)?$/);
    if (v6) s = v6[1];
    else if (s.includes(".") && s.includes(":")) s = s.slice(0, s.lastIndexOf(":"));
    return isIP(s) ? s : null;
}

export function isPrivateIp(ip: string) {
    return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|f[cd]|fe80:)/i.test(ip);
}

export function lookup(ipRaw: string | null | undefined, countryHint?: string | null): Geo {
    const ip = cleanIp(ipRaw);
    if (ip && reader && !isPrivateIp(ip)) {
        const r = reader.get(ip);
        if (r?.location) {
            return {
                country: r.country?.iso_code ?? countryHint ?? null,
                city: r.city?.names?.en ?? null,
                lat: r.location.latitude,
                lon: r.location.longitude
            };
        }
    }
    const cc = countryHint?.toUpperCase() ?? null;
    const c = cc ? centroids.get(cc) : undefined;
    return { country: cc, city: null, lat: c?.lat ?? null, lon: c?.lon ?? null };
}
