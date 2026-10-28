import type { GeoAttribution } from "../api";

/** License-required credit for the GeoIP database; shown on every page that displays lookup results. */
export function GeoCredit({ attribution, className }: { attribution: GeoAttribution | null | undefined; className?: string }) {
    if (!attribution) return null;
    return (
        <a className={`geo-credit ${className ?? ""}`} href={attribution.url} target="_blank" rel="noopener noreferrer">
            {attribution.text}
        </a>
    );
}
