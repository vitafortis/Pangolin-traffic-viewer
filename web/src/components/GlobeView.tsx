import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { countryLabel, type EventRow, type GeoRow, type Site } from "../api";

export type Layers = { arcs: boolean; heatmap: boolean; points: boolean; live: boolean };

type Arc = { startLat: number; startLng: number; endLat: number; endLng: number; count: number; denied: number; row: GeoRow; site: Site };
type Ring = { lat: number; lng: number; denied: boolean; born: number };

// Sequential blue ramp (light→dark reversed for a dark globe: low = deep, high = bright).
const HEAT = ["#104281", "#1c5cab", "#2a78d6", "#5598e7", "#86b6ef", "#cde2fb"];
function heatColor(t: number) {
    const x = Math.min(0.999, Math.max(0, t)) * (HEAT.length - 1);
    const i = Math.floor(x);
    const mix = (a: string, b: string, f: number) => {
        const pa = [1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16));
        const pb = [1, 3, 5].map((k) => parseInt(b.slice(k, k + 2), 16));
        return pa.map((v, j) => Math.round(v + (pb[j] - v) * f));
    };
    const [r, g, b] = mix(HEAT[i], HEAT[i + 1] ?? HEAT[i], x - i);
    return `rgba(${r},${g},${b},${Math.min(1, t * 4)})`;
}

const ALLOW = "57,135,229";
const DENY = "230,103,103";

export function GlobeView({
    geo,
    sites,
    live,
    layers,
    placing,
    onPlace,
    onPickOrigin,
    onPickSite
}: {
    geo: GeoRow[];
    sites: Site[];
    live: EventRow[];
    layers: Layers;
    placing: Site | null;
    onPlace: (lat: number, lng: number) => void;
    onPickOrigin: (row: GeoRow) => void;
    onPickSite: (site: Site) => void;
}) {
    const wrap = useRef<HTMLDivElement>(null);
    const globe = useRef<GlobeMethods | undefined>(undefined);
    const [size, setSize] = useState({ w: 800, h: 600 });
    const [rings, setRings] = useState<Ring[]>([]);

    useEffect(() => {
        const el = wrap.current!;
        const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        const g = globe.current;
        if (!g) return;
        g.controls().autoRotate = !placing;
        g.controls().autoRotateSpeed = 0.25;
        const placed = sites.filter((s) => s.lat != null);
        if (placed.length) {
            const lat = placed.reduce((a, s) => a + s.lat!, 0) / placed.length;
            const lng = placed.reduce((a, s) => a + s.lon!, 0) / placed.length;
            g.pointOfView({ lat, lng, altitude: 2.3 }, 0);
        }
    }, [globe.current, sites.length, placing]); // eslint-disable-line react-hooks/exhaustive-deps

    // Pulse rings for newly arrived events.
    useEffect(() => {
        if (!layers.live || !live.length) return;
        const t = Date.now();
        const fresh = live.filter((e) => e.lat != null).slice(0, 60).map((e) => ({ lat: e.lat!, lng: e.lon!, denied: e.allowed === 0, born: t }));
        setRings((r) => [...r.filter((x) => t - x.born < 4000), ...fresh]);
    }, [live, layers.live]);

    const siteByKey = useMemo(() => new Map(sites.filter((s) => s.lat != null).map((s) => [`${s.connection_id}:${s.site_id}`, s])), [sites]);

    const arcs = useMemo<Arc[]>(() => {
        if (!layers.arcs) return [];
        const out: Arc[] = [];
        for (const r of geo) {
            const site = siteByKey.get(`${r.connection_id}:${r.site_id}`);
            if (!site) continue;
            out.push({ startLat: r.lat, startLng: r.lon, endLat: site.lat!, endLng: site.lon!, count: r.count, denied: r.denied, row: r, site });
            if (out.length >= 400) break;
        }
        return out;
    }, [geo, siteByKey, layers.arcs]);

    const maxCount = useMemo(() => Math.max(1, ...geo.map((g) => g.count)), [geo]);
    const placedSites = useMemo(() => sites.filter((s) => s.lat != null), [sites]);

    const tip = (r: GeoRow) =>
        `<div class="globe-tip"><b>${[r.city, countryLabel(r.country)].filter(Boolean).join(", ")}</b><br/>${r.count.toLocaleString()} events · ${r.ips.toLocaleString()} IPs${
            r.denied ? `<br/><span class="d">${r.denied.toLocaleString()} denied</span>` : ""
        }</div>`;

    return (
        <div ref={wrap} style={{ position: "absolute", inset: 0, cursor: placing ? "crosshair" : undefined }}>
            <Globe
                ref={globe}
                width={size.w}
                height={size.h}
                globeImageUrl="/earth-night.jpg"
                bumpImageUrl="/earth-topology.png"
                backgroundImageUrl="/night-sky.png"
                atmosphereColor="#3987e5"
                atmosphereAltitude={0.18}
                onGlobeClick={({ lat, lng }) => placing && onPlace(lat, lng)}
                // arcs: origin → site
                arcsData={arcs}
                arcColor={(a: object) => {
                    const x = a as Arc;
                    const c = x.denied / x.count > 0.5 ? DENY : ALLOW;
                    return [`rgba(${c},0.15)`, `rgba(${c},0.9)`];
                }}
                arcStroke={(a: object) => 0.15 + 0.9 * Math.sqrt((a as Arc).count / maxCount)}
                arcDashLength={0.35}
                arcDashGap={0.9}
                arcDashInitialGap={() => Math.random()}
                arcDashAnimateTime={2600}
                arcAltitudeAutoScale={0.4}
                arcLabel={(a: object) => {
                    const x = a as Arc;
                    return tip(x.row).replace("</b>", ` → ${x.site.name}</b>`);
                }}
                onArcClick={(a: object) => onPickOrigin((a as Arc).row)}
                // heatmap of origins
                heatmapsData={layers.heatmap && geo.length ? [geo] : []}
                heatmapPointLat="lat"
                heatmapPointLng="lon"
                heatmapPointWeight={(p: object) => Math.log1p((p as GeoRow).count)}
                heatmapBandwidth={1.6}
                heatmapColorFn={heatColor}
                heatmapTopAltitude={0.06}
                heatmapsTransitionDuration={0}
                // sites (+ origin points when enabled)
                pointsData={[...placedSites.map((s) => ({ kind: "site" as const, s })), ...(layers.points ? geo.slice(0, 1500).map((r) => ({ kind: "origin" as const, r })) : [])]}
                pointLat={(p: object) => ((p as { kind: string }).kind === "site" ? (p as { s: Site }).s.lat! : (p as { r: GeoRow }).r.lat)}
                pointLng={(p: object) => ((p as { kind: string }).kind === "site" ? (p as { s: Site }).s.lon! : (p as { r: GeoRow }).r.lon)}
                pointAltitude={(p: object) => ((p as { kind: string }).kind === "site" ? 0.05 : 0.002 + 0.12 * Math.sqrt((p as { r: GeoRow }).r.count / maxCount))}
                pointRadius={(p: object) => ((p as { kind: string }).kind === "site" ? 0.55 : 0.22)}
                pointColor={(p: object) => {
                    const x = p as { kind: string; r?: GeoRow };
                    if (x.kind === "site") return "#1baf7a";
                    return x.r!.denied / x.r!.count > 0.5 ? `rgb(${DENY})` : `rgb(${ALLOW})`;
                }}
                pointsMerge={false}
                pointLabel={(p: object) => {
                    const x = p as { kind: string; s?: Site; r?: GeoRow };
                    return x.kind === "site"
                        ? `<div class="globe-tip"><b>${x.s!.name}</b><br/>${x.s!.place_label ?? ""} ${x.s!.online ? "· online" : "· offline"}</div>`
                        : tip(x.r!);
                }}
                onPointClick={(p: object) => {
                    const x = p as { kind: string; s?: Site; r?: GeoRow };
                    if (x.kind === "site") onPickSite(x.s!);
                    else onPickOrigin(x.r!);
                }}
                labelsData={placedSites}
                labelLat={(s: object) => (s as Site).lat!}
                labelLng={(s: object) => (s as Site).lon!}
                labelText={(s: object) => (s as Site).name}
                labelSize={0.9}
                labelDotRadius={0}
                labelAltitude={0.055}
                labelColor={() => "rgba(238,240,244,0.85)"}
                labelResolution={2}
                ringsData={rings}
                ringLat="lat"
                ringLng="lng"
                ringColor={(r: object) => (t: number) => `rgba(${(r as Ring).denied ? DENY : ALLOW},${1 - t})`}
                ringMaxRadius={3.5}
                ringPropagationSpeed={2.5}
                ringRepeatPeriod={0}
            />
        </div>
    );
}
