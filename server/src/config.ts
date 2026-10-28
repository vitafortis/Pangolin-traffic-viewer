import path from "node:path";

function bool(v: string | undefined) {
    return v === "1" || v === "true";
}

const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");

export const config = {
    port: Number(process.env.PORT ?? 8787),
    host: process.env.HOST ?? "127.0.0.1",
    dataDir,
    dbPath: path.join(dataDir, "ptv.sqlite"),
    geoDir: path.join(dataDir, "geo"),
    appSecret: process.env.APP_SECRET ?? "",
    appPassword: process.env.APP_PASSWORD ?? "",
    demo: bool(process.env.DEMO),
    retentionDays: Number(process.env.RETENTION_DAYS ?? 30),
    /** On first sync, how far back to pull (Pangolin's default retention is 7d). */
    backfillHours: Number(process.env.BACKFILL_HOURS ?? 24),
    /** Download DB-IP City Lite on startup when no .mmdb is present. */
    geoipAutoDownload: bool(process.env.GEOIP_AUTO_DOWNLOAD),
    /** Set when behind a reverse proxy so client IPs and https detection (secure cookies) are correct. */
    trustProxy: bool(process.env.TRUST_PROXY),
    defaultPangolinUrl: "https://api.pangolin.net/v1"
};

export function assertConfig() {
    if (!config.appSecret || config.appSecret.length < 32) {
        if (process.env.NODE_ENV === "production") {
            throw new Error("APP_SECRET must be set to at least 32 characters");
        }
        console.warn(
            "[config] APP_SECRET is unset or short; using an insecure dev secret. Stored API keys are NOT safely encrypted."
        );
        config.appSecret = "insecure-dev-secret-insecure-dev-secret";
    }
    if (!config.appPassword && config.host !== "127.0.0.1" && config.host !== "localhost") {
        console.warn(`[config] Listening on ${config.host} without APP_PASSWORD; anyone who can reach it can read your traffic.`);
    }
}
