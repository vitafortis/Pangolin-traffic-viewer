import { useEffect, useState } from "react";

/** A size in px that persists per key and stays within [min, max()]. */
export function useStoredSize(key: string, initial: number, min: number, max: () => number) {
    const clamp = (v: number) => Math.round(Math.max(min, Math.min(max(), v)));
    const [size, setSize] = useState(() => {
        const v = Number(localStorage.getItem(key));
        return v > 0 ? v : initial;
    });
    useEffect(() => localStorage.setItem(key, String(size)), [key, size]);
    // Re-clamp when the window shrinks so a panel can't swallow the screen.
    useEffect(() => {
        const fit = () => setSize((s) => clamp(s));
        window.addEventListener("resize", fit);
        return () => window.removeEventListener("resize", fit);
    }); // eslint-disable-line react-hooks/exhaustive-deps
    return [size, (v: number) => setSize(clamp(v))] as const;
}

/**
 * A drag handle on a panel's edge. `axis="y"` sits on the top edge and grows the panel upward;
 * `axis="x"` sits on the left edge and grows it leftward. Double-click toggles between `size`'s
 * default and the largest allowed size; arrow keys nudge it.
 */
export function Splitter({ axis, size, setSize, initial, label }: { axis: "x" | "y"; size: number; setSize: (v: number) => void; initial: number; label: string }) {
    const [drag, setDrag] = useState(false);
    const start = (e: React.PointerEvent) => {
        e.preventDefault();
        const origin = axis === "y" ? e.clientY : e.clientX;
        const base = size;
        const move = (m: PointerEvent) => setSize(base + origin - (axis === "y" ? m.clientY : m.clientX));
        const up = () => {
            setDrag(false);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
        };
        setDrag(true);
        document.body.style.cursor = axis === "y" ? "row-resize" : "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    };
    const keys: Record<string, number> = axis === "y" ? { ArrowUp: 40, ArrowDown: -40 } : { ArrowLeft: 40, ArrowRight: -40 };
    return (
        <div
            role="separator"
            aria-orientation={axis === "y" ? "horizontal" : "vertical"}
            aria-label={label}
            aria-valuenow={size}
            tabIndex={0}
            title={`Drag to resize · double-click to ${size > initial ? "restore" : "maximise"}`}
            onPointerDown={start}
            onDoubleClick={() => setSize(size > initial ? initial : 100000)}
            onKeyDown={(e) => e.key in keys && (e.preventDefault(), setSize(size + keys[e.key]))}
            className={`group absolute z-20 hidden touch-none outline-none lg:block ${axis === "y" ? "inset-x-0 -top-1.5 h-3 cursor-row-resize" : "inset-y-0 -left-1.5 w-3 cursor-col-resize"}`}
        >
            <div
                className={`absolute bg-primary transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${drag ? "opacity-100" : "opacity-0"} ${axis === "y" ? "inset-x-0 top-1/2 h-0.5 -translate-y-1/2" : "inset-y-0 left-1/2 w-0.5 -translate-x-1/2"}`}
            />
            {axis === "y" && <div className="absolute top-1/2 left-1/2 h-1 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border group-hover:bg-primary" />}
        </div>
    );
}
