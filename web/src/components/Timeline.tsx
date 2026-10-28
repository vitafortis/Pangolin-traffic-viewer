import { useMemo, useRef, useState } from "react";
import { fmtNum } from "../api";

type Pt = { t: number; count: number; denied: number };

/** Stacked bars: allowed (blue) under denied (red), one per time bucket. Drag to zoom. */
export function Timeline({ rows, step, from, to, onRange }: { rows: Pt[]; step: number; from: number; to: number; onRange: (from: number, to: number) => void }) {
    const ref = useRef<SVGSVGElement>(null);
    const [hover, setHover] = useState<{ x: number; p: Pt } | null>(null);
    const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
    const W = 1000;
    const H = 70;

    const { buckets, max } = useMemo(() => {
        const byT = new Map(rows.map((r) => [r.t, r]));
        const start = Math.floor(from / step) * step;
        const out: Pt[] = [];
        for (let t = start; t <= to; t += step) out.push(byT.get(t) ?? { t, count: 0, denied: 0 });
        return { buckets: out, max: Math.max(1, ...out.map((b) => b.count)) };
    }, [rows, step, from, to]);

    const bw = W / Math.max(1, buckets.length);
    const xToIdx = (clientX: number) => {
        const r = ref.current!.getBoundingClientRect();
        return Math.max(0, Math.min(buckets.length - 1, Math.floor(((clientX - r.left) / r.width) * buckets.length)));
    };
    const fmt = (t: number) =>
        new Date(t * 1000).toLocaleString(undefined, step >= 86400 ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

    return (
        <div className="timeline" onMouseLeave={() => (setHover(null), setDrag(null))}>
            <svg
                ref={ref}
                viewBox={`0 0 ${W} ${H + 14}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`Events over time, ${buckets.length} buckets of ${step / 60} minutes`}
                onMouseMove={(e) => {
                    const i = xToIdx(e.clientX);
                    const r = ref.current!.getBoundingClientRect();
                    setHover({ x: e.clientX - r.left, p: buckets[i] });
                    if (drag) setDrag({ ...drag, b: i });
                }}
                onMouseDown={(e) => setDrag({ a: xToIdx(e.clientX), b: xToIdx(e.clientX) })}
                onMouseUp={() => {
                    if (drag && Math.abs(drag.b - drag.a) >= 1) {
                        const [a, b] = [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)];
                        onRange(buckets[a].t, buckets[b].t + step);
                    }
                    setDrag(null);
                }}
                style={{ cursor: "crosshair" }}
            >
                <line x1={0} x2={W} y1={H} y2={H} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                {buckets.map((b, i) => {
                    const h = (b.count / max) * (H - 4);
                    const hd = (b.denied / max) * (H - 4);
                    const x = i * bw + Math.min(1, bw * 0.15);
                    const w = Math.max(0.5, bw - Math.min(2, bw * 0.3));
                    return (
                        <g key={b.t} opacity={hover && hover.p.t !== b.t ? 0.55 : 1}>
                            <rect x={x} y={H - h} width={w} height={Math.max(0, h - hd - (hd > 0 ? 1 : 0))} fill="var(--allowed)" rx={1} />
                            {hd > 0 && <rect x={x} y={H - hd} width={w} height={hd} fill="var(--denied)" />}
                        </g>
                    );
                })}
                {drag && (
                    <rect x={Math.min(drag.a, drag.b) * bw} y={0} width={(Math.abs(drag.b - drag.a) + 1) * bw} height={H} fill="var(--accent-soft)" stroke="var(--accent)" vectorEffect="non-scaling-stroke" />
                )}
            </svg>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: -14 }} className="muted">
                <span style={{ fontSize: 11 }}>{fmt(from)}</span>
                <span style={{ fontSize: 11 }}>
                    <span style={{ color: "var(--allowed)" }}>■</span> allowed&nbsp;&nbsp;<span style={{ color: "var(--denied)" }}>■</span> denied · drag to zoom
                </span>
                <span style={{ fontSize: 11 }}>{fmt(to)}</span>
            </div>
            {hover && (
                <div className="tl-tip" style={{ left: Math.min(hover.x + 14, (ref.current?.clientWidth ?? 600) - 160), top: 4 }}>
                    <div className="muted">{fmt(hover.p.t)}</div>
                    <div>{fmtNum(hover.p.count)} events</div>
                    {hover.p.denied > 0 && <div style={{ color: "var(--denied)" }}>{fmtNum(hover.p.denied)} denied</div>}
                </div>
            )}
        </div>
    );
}
