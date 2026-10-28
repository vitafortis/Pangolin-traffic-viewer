/** The Pangolin Traffic mark: a globe crossed by two traffic arcs, in shades of orange, dark to light. */
export function Logo({ size = 26 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
            <circle cx="32" cy="32" r="25" fill="none" strokeWidth="5" className="stroke-[#c94f00] dark:stroke-[#d05c00]" />
            <path d="M8 34c12-7 36-7 48 0" fill="none" strokeWidth="4.5" strokeLinecap="round" className="stroke-[#e56900] dark:stroke-[#ef7926]" />
            <path d="M18 18c4 10 22 14 30 4" fill="none" strokeWidth="4.5" strokeLinecap="round" className="stroke-[#f2ab83] dark:stroke-[#ffa167]" />
            <circle cx="18" cy="18" r="5" className="fill-[#f2ab83] dark:fill-[#ffa167]" />
            <circle cx="48" cy="22" r="5" className="fill-[#e56900] dark:fill-[#ef7926]" />
        </svg>
    );
}
