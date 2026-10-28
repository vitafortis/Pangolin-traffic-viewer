// Downloads the free DB-IP "IP to City Lite" database (CC BY 4.0, attribution required)
// into DATA_DIR/geo. A MaxMind GeoLite2-City.mmdb dropped in the same folder also works.
import { createWriteStream, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import { fileURLToPath } from "node:url";

export async function downloadGeoip(dir: string): Promise<string> {
    mkdirSync(dir, { recursive: true });
    const d = new Date();
    // The current month's file may not be published yet on the 1st.
    for (const back of [0, 1]) {
        const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));
        const tag = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
        const res = await fetch(`https://download.db-ip.com/free/dbip-city-lite-${tag}.mmdb.gz`);
        if (!res.ok || !res.body) continue;
        const out = path.join(dir, `dbip-city-lite-${tag}.mmdb`);
        const tmp = `${out}.part`;
        await pipeline(Readable.fromWeb(res.body as ReadableStream), createGunzip(), createWriteStream(tmp));
        for (const f of readdirSync(dir)) if (f.startsWith("dbip-city-lite-") && path.join(dir, f) !== tmp) rmSync(path.join(dir, f));
        renameSync(tmp, out);
        return out;
    }
    throw new Error(`Could not download DB-IP City Lite. You can place any GeoLite2-City.mmdb in ${dir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const dir = path.resolve(process.env.DATA_DIR ?? "./data", "geo");
    downloadGeoip(dir).then(
        (f) => console.log(`Saved ${f}. Restart the server to load it.`),
        (e) => (console.error(e.message), process.exit(1))
    );
}
