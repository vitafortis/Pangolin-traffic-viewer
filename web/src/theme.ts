import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";
const EVENT = "ptv-theme";

const read = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

/** The theme the inline script in index.html picked, and a setter that saves it. */
export function useTheme() {
    const theme = useSyncExternalStore(
        (cb) => {
            window.addEventListener(EVENT, cb);
            return () => window.removeEventListener(EVENT, cb);
        },
        read,
        () => "dark" as const
    );
    const set = (t: Theme) => {
        document.documentElement.dataset.theme = t;
        try {
            localStorage.setItem("ptv-theme", t);
        } catch {}
        window.dispatchEvent(new Event(EVENT));
    };
    return [theme, set] as const;
}

/**
 * The globe sits on its own black stage in both themes: a neutral gray earth so the traffic colours
 * carry all the hue, with a soft white rim for contrast. three.js can't resolve oklch tokens, so these
 * are hex. allowed/denied are a validated pair on gray (orange vs magenta: ΔE 22, deutan 17); ramp
 * shades countries by traffic from land-gray toward orange, staying below `allowed` so arcs stay on top.
 */
export const GLOBE = {
    background: "#000000",
    ocean: "#181818",
    land: "#484848",
    border: "#696969",
    atmosphere: "#ffffff",
    allowed: "#f77f00",
    denied: "#ed3593",
    site: "#ffffff",
    label: "#e8e8e8",
    ramp: ["#604a3f", "#734e39", "#875132", "#9a5328", "#ad581f", "#bf5e1a"]
} as const;
