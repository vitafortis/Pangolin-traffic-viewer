import type { GeoAttribution } from "../api";

/** License-required credit for the GeoIP database; shown on every page that displays lookup results. */
export function GeoCredit({ attribution, className, style }: { attribution: GeoAttribution | null | undefined; className?: string; style?: React.CSSProperties }) {
    if (!attribution) return null;
    return (
        <a className={`geo-credit ${className ?? ""}`} style={style} href={attribution.url} target="_blank" rel="noopener noreferrer">
            {attribution.text}
        </a>
    );
}
