import { useEffect } from "react";
import { X } from "lucide-react";

/** Right-hand panel over a dimmed page; Escape or the backdrop closes it. */
export function Drawer({ title, subtitle, width = 560, onClose, actions, children }: { title: React.ReactNode; subtitle?: React.ReactNode; width?: number; onClose: () => void; actions?: React.ReactNode; children: React.ReactNode }) {
    useEffect(() => {
        const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        window.addEventListener("keydown", k);
        return () => window.removeEventListener("keydown", k);
    }, [onClose]);
    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
            <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-card shadow-surface-lg" style={{ maxWidth: width }} role="dialog" aria-label={typeof title === "string" ? title : undefined}>
                <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border px-4 py-2">
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-[0.9375rem] font-semibold">{title}</div>
                        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
                    </div>
                    {actions}
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
                        <X />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto">{children}</div>
            </aside>
        </>
    );
}

/** Click-away popover anchored under its trigger. */
export function Popover({ open, onClose, align = "left", className = "", children }: { open: boolean; onClose: () => void; align?: "left" | "right"; className?: string; children: React.ReactNode }) {
    useEffect(() => {
        if (!open) return;
        const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        const t = setTimeout(() => document.addEventListener("click", onClose), 0);
        window.addEventListener("keydown", k);
        return () => {
            clearTimeout(t);
            document.removeEventListener("click", onClose);
            window.removeEventListener("keydown", k);
        };
    }, [open, onClose]);
    if (!open) return null;
    return (
        <div className={`card absolute top-[calc(100%+6px)] z-50 p-1.5 shadow-surface-lg ${align === "right" ? "right-0" : "left-0"} ${className}`} onClick={(e) => e.stopPropagation()}>
            {children}
        </div>
    );
}

export const menuItem = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.8125rem] hover:bg-accent [&_svg]:size-3.5 [&_svg]:text-muted-foreground";
