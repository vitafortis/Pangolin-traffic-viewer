import { useEffect, useRef, useState } from "react";

export type Option = { value: string; label: string; hint?: string };

export function MultiSelect({ label, options, value, onChange }: { label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void }) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
        document.addEventListener("mousedown", h);
        return () => document.removeEventListener("mousedown", h);
    }, []);
    const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()) || o.value.toLowerCase().includes(q.toLowerCase()));
    const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    return (
        <div className="ms" ref={ref}>
            <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
                {label}
                {value.length ? <span className="badge" style={{ background: "var(--accent)" }}>{value.length}</span> : null} ▾
            </button>
            {open && (
                <div className="ms-pop">
                    {options.length > 8 && <input className="input" style={{ width: "100%", marginBottom: 6 }} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}
                    {value.length > 0 && (
                        <button className="btn ghost" style={{ width: "100%", textAlign: "left" }} onClick={() => onChange([])}>
                            Clear selection
                        </button>
                    )}
                    {shown.length === 0 && <div className="muted" style={{ padding: 6 }}>Nothing to choose yet</div>}
                    {shown.map((o) => (
                        <label key={o.value}>
                            <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
                            <span>{o.label}</span>
                            {o.hint && <span className="muted">{o.hint}</span>}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
}
