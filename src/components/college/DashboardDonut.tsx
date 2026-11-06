"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// A donut for part-to-whole (a handful of parts). Plain SVG, no chart library.
// - 2px surface gap between slices, the total / headline in the middle;
// - a legend that always names each part with its number and share (colour is never the only cue);
// - hover / focus on a slice or its legend row shows that part in the middle.
// Slice colours are passed as Tailwind stroke/bg classes with their dark-mode steps (validated sets).

export interface DonutSlice {
  label: string;
  value: number;
  /** e.g. "stroke-[#0ca30c]" - written out in full (Tailwind only generates classes it can see in the source) */
  stroke: string;
  /** the same colour as a background, for the legend swatch, e.g. "bg-[#0ca30c]" */
  swatch: string;
}

const R = 42;
const STROKE = 14;
const C = 2 * Math.PI * R;
const GAP = 2; // px of surface between slices

export function DashboardDonut({ slices, centerValue, centerLabel, ariaLabel }: { slices: DonutSlice[]; centerValue: string; centerLabel: string; ariaLabel: string }) {
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((n, s) => n + s.value, 0);
  const shown = slices.map((s, i) => ({ ...s, i })).filter((s) => s.value > 0);
  const many = shown.length > 1;
  // Each arc starts where the previous ones end (a running sum, built without mutation).
  const lens = shown.map((sl) => (total ? (sl.value / total) * C : 0));
  const arcs = shown.map((sl, k) => ({ ...sl, dash: Math.max(0, lens[k] - (many ? GAP : 0)), offset: lens.slice(0, k).reduce((n, x) => n + x, 0) }));
  const pick = active !== null ? slices[active] : null;
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={`${ariaLabel}: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
          <circle cx="50" cy="50" r={R} fill="none" strokeWidth={STROKE} className="stroke-muted" />
          {arcs.map((a) => (
            <circle key={a.label} cx="50" cy="50" r={R} fill="none" strokeWidth={active === a.i ? STROKE + 3 : STROKE}
              strokeDasharray={`${a.dash} ${C - a.dash}`} strokeDashoffset={-a.offset}
              className={cn("cursor-pointer transition-[stroke-width,opacity]", a.stroke, active !== null && active !== a.i && "opacity-40")}
              onMouseEnter={() => setActive(a.i)} onMouseLeave={() => setActive(null)}>
              <title>{`${a.label}: ${a.value} (${pct(a.value)}%)`}</title>
            </circle>
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-bold tabular-nums leading-none">{pick ? pick.value.toLocaleString("en-IN") : centerValue}</span>
          <span className="mt-1 max-w-[5.5rem] text-[11px] leading-tight text-muted-foreground">{pick ? `${pick.label} · ${pct(pick.value)}%` : centerLabel}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-1 text-sm">
        {slices.map((s, i) => (
          <li key={s.label}>
            <button type="button" className={cn("flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none", active === i && "bg-muted/60")}
              onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", s.swatch)} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.label}</span>
              <span className="font-semibold tabular-nums">{s.value.toLocaleString("en-IN")}</span>
              <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{pct(s.value)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Validated colour sets (dataviz validator, adjacent pairs, light + dark). The status steps are the
// fixed status palette - "late" yellow is below 3:1 on light by design, so every slice also has a
// legend label and number.
export const SLICE = {
  good: { stroke: "stroke-[#0ca30c]", swatch: "bg-[#0ca30c]" },
  warning: { stroke: "stroke-[#fab219]", swatch: "bg-[#fab219]" },
  critical: { stroke: "stroke-[#d03b3b]", swatch: "bg-[#d03b3b]" },
  magenta: { stroke: "stroke-[#e87ba4] dark:stroke-[#d55181]", swatch: "bg-[#e87ba4] dark:bg-[#d55181]" },
  blue: { stroke: "stroke-[#2a78d6] dark:stroke-[#3987e5]", swatch: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  neutral: { stroke: "stroke-[#b9b8b3] dark:stroke-[#6b6a65]", swatch: "bg-[#b9b8b3] dark:bg-[#6b6a65]" },
} as const;

/** Ordinal blue ramp (years of study), light -> dark; the dark-mode steps stay clear of the dark surface. */
export const YEAR_RAMP = [
  { stroke: "stroke-[#86b6ef] dark:stroke-[#86b6ef]", swatch: "bg-[#86b6ef]" },
  { stroke: "stroke-[#5598e7] dark:stroke-[#6da7ec]", swatch: "bg-[#5598e7] dark:bg-[#6da7ec]" },
  { stroke: "stroke-[#2a78d6] dark:stroke-[#3987e5]", swatch: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  { stroke: "stroke-[#1c5cab] dark:stroke-[#256abf]", swatch: "bg-[#1c5cab] dark:bg-[#256abf]" },
  { stroke: "stroke-[#104281] dark:stroke-[#184f95]", swatch: "bg-[#104281] dark:bg-[#184f95]" },
  { stroke: "stroke-[#0d366b] dark:stroke-[#1c5cab]", swatch: "bg-[#0d366b] dark:bg-[#1c5cab]" },
] as const;
