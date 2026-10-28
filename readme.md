# Pangolin Traffic Viewer

See who is reaching your [Pangolin](https://pangolin.net) resources, and from where. The app pulls traffic logs from Pangolin Cloud (or a self-hosted Integration API) and plots them on a 3D globe: arcs from origin to site, countries shaded by traffic, and origin dots, with light and dark themes. You can search, filter and group the traffic, and set alerts on location, time, IP and volume.

## Deploy with Docker

```bash
curl -O https://raw.githubusercontent.com/vitafortis/Pangolin-traffic-viewer/main/docker-compose.yml
echo "APP_SECRET=$(openssl rand -hex 32)" > .env
echo "APP_PASSWORD=choose-a-password" >> .env
docker compose up -d     # → http://<host>:8787
```

Or without Compose:

```bash
docker run -d --name pangolin-traffic-viewer -p 8787:8787 \
  -e APP_SECRET="$(openssl rand -hex 32)" -e APP_PASSWORD=choose-a-password \
  -v ptv-data:/data ghcr.io/vitafortis/pangolin-traffic-viewer:latest
```

Images are built for `linux/amd64` and `linux/arm64` and published to GHCR. Each push to `main` publishes `latest`, and each `vX.Y.Z` tag publishes matching version tags. To build locally, run `docker build -t pangolin-traffic-viewer .`.

| Variable | Default | |
|---|---|---|
| `APP_SECRET` | — | **Required.** 32+ chars. Encrypts stored API keys. Changing it makes saved keys unreadable, so you'd have to re-enter them |
| `APP_PASSWORD` | empty | Login password. Set this whenever the port is reachable by anyone else |
| `TRUST_PROXY` | `0` | Set to `1` behind a reverse proxy so client IPs and HTTPS-only cookies work |
| `GEOIP_AUTO_DOWNLOAD` | `1` (compose) | Downloads the DB-IP City Lite database (~130 MB) into `/data/geo` on first start |
| `RETENTION_DAYS` | `30` | How long events are kept locally |
| `BACKFILL_HOURS` | `24` | How far back the first sync for a new connection pulls |
| `DEMO` | `0` | Adds a connection with synthetic traffic |

All state (SQLite and the GeoIP database) is stored in the `/data` volume, so back that up. The container runs as a non-root user and has a health check at `/api/health`. If a reverse proxy sits in front, it must not buffer `/api/stream`, which is a server-sent events feed. nginx is handled automatically via the `X-Accel-Buffering: no` response header.

## Local development

```bash
npm install
npm run build          # builds the web UI
npm run demo           # synthetic traffic, no API key needed → http://127.0.0.1:8787
```

To use real data, copy `.env.example` to `.env` and set `APP_SECRET`. Then run `npm start` and add a connection under **Settings** with your org ID and an org API key. Create the key in Pangolin → Organization → API Keys, with read access to logs, sites and resources.

During development, `npm run dev` runs the API on :8787 and Vite on :5173 with hot reload.

### City-level geolocation (optional)

Pangolin includes a country code for each request, so by default origins are placed at country centroids. To place origins by city:

```bash
npm run geoip:download   # DB-IP City Lite (CC BY 4.0) → data/geo/
```

You can also put a MaxMind `GeoLite2-City.mmdb` in `data/geo/`. Restart the server after adding either database. In Docker, `GEOIP_AUTO_DOWNLOAD=1` does this for you. The DB-IP data is licensed [CC BY 4.0](https://db-ip.com/db/lite.php). When it is loaded, the UI shows the required "IP Geolocation by DB-IP" link on every page that displays location results, and webhook payloads include a `geoAttribution` field. A GeoLite2 database gets MaxMind's required credit in the same places.

### Site locations

Pangolin has no geo data for sites, so you set each site's location yourself. Under **Settings → Site locations**, click **Place on globe**, enter lat/lon, or geolocate the site's WAN IP. Arcs are only drawn to sites that have a location.

## What gets ingested

| Pangolin endpoint | Becomes | Notes |
|---|---|---|
| `GET /org/{orgId}/logs/request` | `request` events | Every HTTP(S) request through the proxy, with allow/deny + reason |
| `GET /org/{orgId}/logs/access` | `access` events | Auth attempts (password, pincode, SSO…). Cloud/Enterprise only |
| `GET /org/{orgId}/logs/connection` | `connection` events | Private-resource sessions with site, client endpoint and bytes. Cloud/Enterprise only |
| `GET /org/{orgId}/sites`, `/resources` | inventory | Maps each resource to its site via its targets |

Each connection polls on its own interval, every 60s by default. The poller re-reads a 2-minute overlap and dedupes, so short outages don't lose data. If an endpoint returns 403 or 404, for example on a plan without access logs, the poller turns that endpoint off for the connection and keeps polling the others. Events are kept locally for `RETENTION_DAYS`, 30 by default. Pangolin's own default retention is 7 days.

## Alerts

Each rule combines optional conditions:

- **Location:** only from, or never from, these countries. A rule can also fire the first time a resource is reached from a country not seen for it in the past 30 days.
- **Time:** inside or outside a weekly window in any IANA time zone, e.g. "allowed access outside Mon–Fri 08:00–18:00 America/Denver".
- **Who and what:** allowed or denied, log type, resources, sites, IP/CIDR include/exclude, and a text match on host, path, user or user agent.
- **Volume:** N matches within M minutes, counted overall or per IP, country, resource, site or user, with a cooldown.

Alerts always appear in the app. Webhooks can also post them as JSON, Slack or Discord messages. The rule editor shows how many events from the last 24h each rule would have matched.

## Architecture

```
server/  Fastify + node:sqlite (no native deps)
  pangolin.ts   Integration API client
  ingest.ts     per-connection pollers → events.ts (normalize + geo) → SQLite
  bus.ts        in-process fan-out of new events → alerts.ts (and future sinks)
  routes/api.ts query, group-by, geo aggregation, timeseries, SSE live stream, CRUD
web/     React + Vite + Tailwind v4 + react-globe.gl (three.js), styled with the ·modern palette (Orbital, debrief) in orange
e2e/     Playwright screenshot smoke test (runs on every PR; screenshots are uploaded as a CI artifact)
```

API keys are stored encrypted with AES-256-GCM, using a key derived from `APP_SECRET`. Set `APP_PASSWORD` to require a login, which you should do whenever `HOST` is not loopback.

## Roadmap

- **SIEM streaming:** add a sink that subscribes to `bus.on("events")` and forwards to syslog/CEF, Splunk HEC, Elastic, etc. Pangolin also exposes `/org/{orgId}/event-streaming-destination` natively, which may cover some setups.
- Update `connection` events in place when sessions end (bytes, `endedAt`).
- Email/PagerDuty alert channels.

## License

[MIT](LICENSE). Bundled and downloaded data has its own terms: the optional DB-IP City Lite database is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) ([IP Geolocation by DB-IP](https://db-ip.com)), and country outlines come from [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth, public domain).
