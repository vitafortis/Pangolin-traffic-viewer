import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { assertConfig, config } from "./config.ts";
import { db, now } from "./db.ts";
import { encrypt } from "./crypto.ts";
import { initGeo } from "./geo.ts";
import { initAlerts } from "./alerts.ts";
import { startAllPollers } from "./ingest.ts";
import { apiRoutes } from "./routes/api.ts";
import { exploreRoutes } from "./routes/explore.ts";
import { policyRoutes } from "./routes/policies.ts";

assertConfig();
await initGeo();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "warn" }, trustProxy: config.trustProxy });
await app.register(cookie, { secret: config.appSecret });

app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "invalid input", issues: err.issues });
    app.log.error(err);
    const e = err as { statusCode?: number; message: string };
    return reply.code(e.statusCode ?? 500).send({ error: e.message });
});

// ---- optional single-password auth ----------------------------------------
const SESSION = "ptv_session";
function passwordOk(given: string) {
    const a = Buffer.from(given);
    const b = Buffer.from(config.appPassword);
    return a.length === b.length && timingSafeEqual(a, b);
}

app.post("/api/login", async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: string };
    if (!config.appPassword) return { ok: true };
    if (!password || !passwordOk(password)) return reply.code(401).send({ error: "invalid password" });
    reply.setCookie(SESSION, String(now()), { signed: true, httpOnly: true, sameSite: "strict", path: "/", maxAge: 7 * 86400, secure: req.protocol === "https" });
    return { ok: true };
});

app.get("/api/health", async () => {
    db.prepare("SELECT 1").get();
    return { ok: true };
});

app.post("/api/logout", async (_req, reply) => reply.clearCookie(SESSION, { path: "/" }).send({ ok: true }));

app.get("/api/session", async (req) => ({ authRequired: !!config.appPassword, authenticated: !config.appPassword || isAuthed(req.cookies[SESSION], req.unsignCookie) }));

function isAuthed(raw: string | undefined, unsign: (v: string) => { valid: boolean; value: string | null }) {
    if (!raw) return false;
    const u = unsign(raw);
    return u.valid && now() - Number(u.value) < 7 * 86400;
}

app.addHook("onRequest", async (req, reply) => {
    if (!config.appPassword || !req.url.startsWith("/api/") || ["/api/login", "/api/session", "/api/health"].includes(req.url)) return;
    if (!isAuthed(req.cookies[SESSION], req.unsignCookie.bind(req))) return reply.code(401).send({ error: "unauthorized" });
});

await app.register(apiRoutes);
await app.register(exploreRoutes);
await app.register(policyRoutes);

// ---- web UI (built by `npm run build`) -------------------------------------
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api/") ? reply.code(404).send({ error: "not found" }) : reply.sendFile("index.html")));
}

// ---- demo connection -------------------------------------------------------
if (config.demo && !db.prepare("SELECT 1 FROM connections WHERE base_url LIKE 'demo:%'").get()) {
    db.prepare(`INSERT INTO connections (name, base_url, org_id, api_key_enc, poll_interval_s, created_at) VALUES (?,?,?,?,?,?)`).run(
        "Demo org", "demo://local", "demo", encrypt("demo"), 10, now()
    );
    console.log("[demo] created demo connection");
}

initAlerts();
startAllPollers();

for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, async () => {
        console.log(`[server] ${sig}, shutting down`);
        await app.close();
        db.close();
        process.exit(0);
    });
}

await app.listen({ port: config.port, host: config.host });
console.log(`Pangolin Traffic Viewer on http://${config.host}:${config.port}${existsSync(webDist) ? "" : " (API only; run the web dev server)"}`);
