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
 * Globe colours per theme. three.js can't resolve the oklch tokens, so these are the same values as
 * styles.css converted to hex. allowed/denied are the validated pair; ramp is the sequential orange
 * used to shade countries by traffic (low → high), kept quieter than `allowed` so arcs and dots stay on top.
 */
export const GLOBE = {
    light: {
        ocean: "#f7f2f0",
        land: "#e5deda",
        border: "#d1c8c4",
        atmosphere: "#e9af90",
        allowed: "#e56900",
        denied: "#b7005e",
        site: "#2f241e",
        label: "#413834",
        ramp: ["#e5d6ce", "#e7cdbf", "#e6c2ae", "#e9b69a", "#e8a885", "#e89a6f"]
    },
    dark: {
        ocean: "#130d0a",
        land: "#261f1b",
        border: "#3c332e",
        atmosphere: "#b0540e",
        allowed: "#e06d00",
        denied: "#db2c87",
        site: "#eee6e2",
        label: "#d3ccc8",
        ramp: ["#38271e", "#492c1c", "#5a3118", "#6d3714", "#813c0b", "#974300"]
    }
} as const;
