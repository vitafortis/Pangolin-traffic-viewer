import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type Option = { value: string; label: string; hint?: string };

export function MultiSelect({ label, options, value, onChange }: { label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void }) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
        const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
        document.addEventListener("mousedown", h);
        document.addEventListener("keydown", k);
        return () => {
            document.removeEventListener("mousedown", h);
            document.removeEventListener("keydown", k);
        };
    }, []);
    const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()) || o.value.toLowerCase().includes(q.toLowerCase()));
    const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    return (
        <div className="relative" ref={ref}>
            <button className={`btn btn-sm ${value.length ? "btn-primary" : "btn-secondary"}`} onClick={() => setOpen(!open)} aria-expanded={open}>
                {label}
                {value.length > 0 && <span className="font-mono tabular-nums">{value.length}</span>}
                <ChevronDown className="opacity-60" />
            </button>
            {open && (
                <div className="card absolute top-[calc(100%+6px)] left-0 z-50 max-h-80 w-72 overflow-auto p-1.5 shadow-surface-lg">
                    {options.length > 8 && <input className="input mb-1.5 w-full" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}
                    {value.length > 0 && (
                        <button className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => onChange([])}>
                            Clear selection
                        </button>
                    )}
                    {shown.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Nothing to choose yet</div>}
                    {shown.map((o) => {
                        const sel = value.includes(o.value);
                        return (
                            <button key={o.value} onClick={() => toggle(o.value)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.8125rem] hover:bg-accent">
                                <span className={`grid size-4 shrink-0 place-items-center rounded border ${sel ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}>
                                    {sel && <Check className="size-3" strokeWidth={3} />}
                                </span>
                                <span className="truncate">{o.label}</span>
                                {o.hint && <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{o.hint}</span>}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
