import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { MeshPhongMaterial } from "three";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries110m from "world-atlas/countries-110m.json";
import isoNumeric from "../data/iso-numeric.json";
import { countryLabel, type EventRow, type GeoRow, type GroupRow, type Site } from "../api";
import { GLOBE } from "../theme";

export type Layers = { arcs: boolean; countries: boolean; points: boolean; heatmap: boolean; live: boolean };

type Arc = { startLat: number; startLng: number; endLat: number; endLng: number; count: number; denied: number; row: GeoRow; site: Site };
type Ring = { lat: number; lng: number; denied: boolean; born: number };
type Country = Feature<Geometry, { name: string }> & { cc: string | null };
type Pt = { kind: "site"; s: Site } | { kind: "origin"; r: GeoRow };

// Natural Earth has no numeric ISO code for Kosovo; GeoIP databases use XK.
const NAME_TO_CC: Record<string, string> = { Kosovo: "XK" };

const COUNTRIES: Country[] = (() => {
    const topo = countries110m as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
    const fc = feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>;
    const iso = isoNumeric as Record<string, string>;
    return fc.features
        .filter((f) => f.properties.name !== "Antarctica")
        .map((f) => ({ ...f, cc: (f.id != null ? iso[String(f.id)] : undefined) ?? NAME_TO_CC[f.properties.name] ?? null }));
})();

const isDenied = (r: { count: number; denied: number }) => r.denied / Math.max(1, r.count) > 0.5;

export function GlobeView({
    geo,
    byCountry,
    sites,
    live,
    layers,
    placing,
    onPlace,
    onPickCountry,
    onPickSite
}: {
    geo: GeoRow[];
    byCountry: GroupRow[];
    sites: Site[];
    live: EventRow[];
    layers: Layers;
    placing: Site | null;
    onPlace: (lat: number, lng: number) => void;
    onPickCountry: (cc: string) => void;
    onPickSite: (site: Site) => void;
}) {
    const C = GLOBE;
    const wrap = useRef<HTMLDivElement>(null);
    const globe = useRef<GlobeMethods | undefined>(undefined);
    const [size, setSize] = useState({ w: 800, h: 600 });
    const [rings, setRings] = useState<Ring[]>([]);
    const [hover, setHover] = useState<Country | null>(null);

    useEffect(() => {
        const el = wrap.current!;
        const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const placedSites = useMemo(() => sites.filter((s) => s.lat != null), [sites]);

    // Face the sites on load; drift slowly unless the user is placing a site.
    useEffect(() => {
        const g = globe.current;
        if (!g) return;
        g.controls().autoRotate = !placing;
        g.controls().autoRotateSpeed = 0.2;
        if (placedSites.length) {
            const lat = placedSites.reduce((a, s) => a + s.lat!, 0) / placedSites.length;
            const lng = placedSites.reduce((a, s) => a + s.lon!, 0) / placedSites.length;
            g.pointOfView({ lat: Math.max(-30, Math.min(50, lat)), lng, altitude: 2.2 }, 0);
        }
    }, [globe.current, placedSites.length, placing]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!layers.live || !live.length) return;
        const t = Date.now();
        const fresh = live.filter((e) => e.lat != null).slice(0, 60).map((e) => ({ lat: e.lat!, lng: e.lon!, denied: e.allowed === 0, born: t }));
        setRings((r) => [...r.filter((x) => t - x.born < 4000), ...fresh]);
    }, [live, layers.live]);

    const material = useMemo(() => new MeshPhongMaterial({ color: C.ocean, emissive: C.ocean, emissiveIntensity: 0.6, shininess: 0 }), []);

    const counts = useMemo(() => new Map(byCountry.filter((r) => r.key).map((r) => [r.key, r])), [byCountry]);
    const maxCountry = useMemo(() => Math.max(1, ...byCountry.map((r) => r.count)), [byCountry]);
    const shade = (cc: string | null) => {
        const r = cc ? counts.get(cc) : undefined;
        if (!layers.countries || !r) return C.land;
        const t = Math.log1p(r.count) / Math.log1p(maxCountry);
        return C.ramp[Math.min(C.ramp.length - 1, Math.floor(t * C.ramp.length))];
    };

    const siteByKey = useMemo(() => new Map(placedSites.map((s) => [`${s.connection_id}:${s.site_id}`, s])), [placedSites]);
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
    const maxCell = useMemo(() => Math.max(1, ...geo.map((g) => g.count)), [geo]);

    const points = useMemo<Pt[]>(
        () => [...placedSites.map((s) => ({ kind: "site" as const, s })), ...(layers.points ? geo.slice(0, 2000).map((r) => ({ kind: "origin" as const, r })) : [])],
        [placedSites, geo, layers.points]
    );

    const originTip = (r: GeoRow, suffix = "") =>
        `<div class="globe-tip"><b>${[r.city, countryLabel(r.country)].filter(Boolean).join(", ")}${suffix}</b><br/>${r.count.toLocaleString()} events · ${r.ips.toLocaleString()} IPs${
            r.denied ? `<br/><span class="d">◆ ${r.denied.toLocaleString()} denied</span>` : ""
        }</div>`;
    const hex = (h: string, a: number) => h + Math.round(a * 255).toString(16).padStart(2, "0");

    return (
        <div ref={wrap} className="absolute inset-0" style={{ cursor: placing ? "crosshair" : undefined }}>
            <Globe
                ref={globe}
                width={size.w}
                height={size.h}
                backgroundColor="rgba(0,0,0,0)"
                globeMaterial={material}
                showAtmosphere
                atmosphereColor={C.atmosphere}
                atmosphereAltitude={0.16}
                onGlobeClick={({ lat, lng }) => placing && onPlace(lat, lng)}
                // countries: flat land, shaded by traffic
                polygonsData={COUNTRIES}
                polygonCapColor={(f: object) => shade((f as Country).cc)}
                polygonSideColor={() => hex(C.border, 0.6)}
                polygonStrokeColor={() => C.border}
                polygonAltitude={(f: object) => (f === hover ? 0.014 : 0.006)}
                polygonsTransitionDuration={200}
                polygonLabel={(f: object) => {
                    const c = f as Country;
                    const r = c.cc ? counts.get(c.cc) : undefined;
                    return `<div class="globe-tip"><b>${c.cc ? countryLabel(c.cc) : c.properties.name}</b><br/>${
                        r ? `${r.count.toLocaleString()} events · ${r.ips.toLocaleString()} IPs${r.denied ? `<br/><span class="d">◆ ${r.denied.toLocaleString()} denied</span>` : ""}` : "No traffic"
                    }</div>`;
                }}
                onPolygonHover={(f: object | null) => setHover(f as Country | null)}
                onPolygonClick={(f: object, _e: MouseEvent, { lat, lng }: { lat: number; lng: number }) => {
                    if (placing) return onPlace(lat, lng);
                    const c = f as Country;
                    if (c.cc && counts.has(c.cc)) onPickCountry(c.cc);
                }}
                // arcs: origin → site
                arcsData={arcs}
                arcColor={(a: object) => {
                    const c = isDenied(a as Arc) ? C.denied : C.allowed;
                    return [hex(c, 0.1), hex(c, 0.95)];
                }}
                arcStroke={(a: object) => 0.12 + 0.8 * Math.sqrt((a as Arc).count / maxCell)}
                arcDashLength={0.4}
                arcDashGap={0.8}
                arcDashInitialGap={() => Math.random()}
                arcDashAnimateTime={2800}
                arcAltitudeAutoScale={0.38}
                arcLabel={(a: object) => originTip((a as Arc).row, ` → ${(a as Arc).site.name}`)}
                onArcClick={(a: object) => (a as Arc).row.country && onPickCountry((a as Arc).row.country!)}
                // origin dots + site markers
                pointsData={points}
                pointLat={(p: object) => ((p as Pt).kind === "site" ? (p as { s: Site }).s.lat! : (p as { r: GeoRow }).r.lat)}
                pointLng={(p: object) => ((p as Pt).kind === "site" ? (p as { s: Site }).s.lon! : (p as { r: GeoRow }).r.lon)}
                pointAltitude={(p: object) => ((p as Pt).kind === "site" ? 0.03 : 0.008 + 0.06 * Math.sqrt((p as { r: GeoRow }).r.count / maxCell))}
                pointRadius={(p: object) => ((p as Pt).kind === "site" ? 0.5 : 0.18 + 0.32 * Math.sqrt((p as { r: GeoRow }).r.count / maxCell))}
                pointColor={(p: object) => {
                    const x = p as Pt;
                    return x.kind === "site" ? C.site : isDenied(x.r) ? C.denied : C.allowed;
                }}
                pointResolution={16}
                pointsMerge={false}
                pointLabel={(p: object) => {
                    const x = p as Pt;
                    return x.kind === "site"
                        ? `<div class="globe-tip"><b>${x.s.name}</b><br/>${x.s.place_label ?? ""}${x.s.place_label ? " · " : ""}${x.s.online ? "online" : "offline"}</div>`
                        : originTip(x.r);
                }}
                onPointClick={(p: object) => {
                    const x = p as Pt;
                    if (x.kind === "site") onPickSite(x.s);
                    else if (x.r.country) onPickCountry(x.r.country);
                }}
                labelsData={placedSites}
                labelLat={(s: object) => (s as Site).lat!}
                labelLng={(s: object) => (s as Site).lon!}
                labelText={(s: object) => (s as Site).name}
                labelSize={0.85}
                labelDotRadius={0}
                labelAltitude={0.035}
                labelColor={() => C.label}
                labelResolution={2}
                // optional density heatmap, in the same orange ramp
                heatmapsData={layers.heatmap && geo.length ? [geo] : []}
                heatmapPointLat="lat"
                heatmapPointLng="lon"
                heatmapPointWeight={(p: object) => Math.log1p((p as GeoRow).count)}
                heatmapBandwidth={1.4}
                heatmapColorFn={(t: number) => hex(C.ramp[Math.min(C.ramp.length - 1, Math.floor(t * C.ramp.length))], Math.min(0.85, t * 3))}
                heatmapTopAltitude={0.05}
                heatmapsTransitionDuration={0}
                ringsData={rings}
                ringLat="lat"
                ringLng="lng"
                ringColor={(r: object) => (t: number) => hex((r as Ring).denied ? C.denied : C.allowed, Math.max(0, 1 - t))}
                ringMaxRadius={3}
                ringPropagationSpeed={2.5}
                ringRepeatPeriod={0}
                ringAltitude={0.008}
            />
        </div>
    );
}
