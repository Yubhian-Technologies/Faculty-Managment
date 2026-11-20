"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { RefreshCw, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Building blocks shared by the HOD and Principal dashboards (components/hod/HodDashboardHome.tsx,
// components/college/PrincipalDashboardHome.tsx): cards with their own loading / error / Retry, number tiles,
// labelled bars, a legend and the one-series trend chart. Status colours are fixed and always come with a label.

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Unable to load");
  return json;
}

export const SHORT = 75;
export const fmtPct = (p: number | null | undefined, digits = 1) => (p == null ? "-" : `${p.toFixed(digits)}%`);
export const initials = (name: string) => name.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
export const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const hhmm12 = (t: string) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

// Status colours (fixed): always beside a label or icon, never colour alone.
export const GOOD = "#0ca30c", WARN = "#fab219", CRIT = "#d03b3b";

// ── Small building blocks ───────────────────────────────────────────────────

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border bg-card shadow-sm", className)}>{children}</div>;
}

export function Panel({ title, sub, href, linkLabel, loading, error, onRetry, children, className }: {
  title: string; sub?: ReactNode; href?: string; linkLabel?: string; loading?: boolean; error?: boolean; onRetry?: () => void; children: ReactNode; className?: string;
}) {
  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-tight">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        {href && <Link href={href} className="shrink-0 text-xs font-medium text-primary hover:underline">{linkLabel ?? "Open"} →</Link>}
      </div>
      {error ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          Unable to load this card.
          {onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 text-xs font-medium hover:underline"><RefreshCw className="h-3.5 w-3.5" />Retry</button>}
        </div>
      ) : loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-6 animate-pulse rounded-md bg-muted" />)}</div>
      ) : children}
    </Card>
  );
}

export function Kpi({ icon: Icon, label, href, value, unit, sub, meter, loading, error, tone }: {
  icon: LucideIcon; label: string; href: string; value: ReactNode; unit?: string; sub?: ReactNode;
  meter?: { value: number; color: string }[]; loading?: boolean; error?: boolean; tone?: "crit";
}) {
  return (
    <Link href={href} className="group block rounded-2xl border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <div className="flex items-start justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span className="leading-snug">{label}</span>
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", tone === "crit" ? "bg-red-50 text-red-600" : "bg-primary/10 text-primary")}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {error ? <p className="mt-3 text-sm text-destructive">Unable to load</p> : loading ? (
        <div className="mt-3 space-y-2"><div className="h-7 w-20 animate-pulse rounded bg-muted" /><div className="h-3 w-28 animate-pulse rounded bg-muted" /></div>
      ) : (
        <>
          <p className="mt-1.5 text-[26px] font-bold leading-tight tracking-tight tabular-nums">{value}{unit && <span className="ml-0.5 text-sm font-medium text-muted-foreground">{unit}</span>}</p>
          {meter && (
            <div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted">
              {meter.filter((m) => m.value > 0).map((m, i) => <i key={i} className="block h-full rounded-full" style={{ width: `${m.value}%`, background: m.color }} />)}
            </div>
          )}
          {sub && <div className="mt-2 text-xs text-muted-foreground">{sub}</div>}
        </>
      )}
    </Link>
  );
}

export function Tag({ tone, children }: { tone: "good" | "warn" | "crit" | "info"; children: ReactNode }) {
  const cls = {
    good: "bg-emerald-50 text-emerald-700",
    warn: "bg-amber-50 text-amber-800",
    crit: "bg-red-50 text-red-700",
    info: "bg-primary/10 text-primary",
  }[tone];
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", cls)}>{children}</span>;
}

export function SectionTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-0.5 pt-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

/** A labelled horizontal bar; red only for the labelled "below 75%" status. */
export function Bar({ label, value, max = 100, text, sub, low, refLine, wide, title }: { label: string; value: number; max?: number; text: string; sub?: string; low?: boolean; refLine?: number; wide?: boolean; title?: string }) {
  return (
    <div className={cn("grid items-center gap-2.5 text-xs", wide ? "grid-cols-[minmax(0,130px)_1fr_64px]" : "grid-cols-[64px_1fr_76px]")} title={title ?? `${label}: ${text}`}>
      <span className="truncate font-medium text-muted-foreground">{label}</span>
      <div className="relative h-3.5 rounded bg-muted/70">
        <div className="h-full rounded-r" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: low ? CRIT : "hsl(var(--primary))" }} />
        {refLine != null && <div className="absolute -bottom-1 -top-1 border-l-[1.5px] border-dashed border-muted-foreground/70" style={{ left: `${refLine}%` }} />}
      </div>
      <span className="text-right font-semibold tabular-nums">{text}{sub && <span className="block text-[11px] font-normal text-muted-foreground">{sub}</span>}</span>
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: string; ring?: boolean }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color, boxShadow: i.ring ? `inset 0 0 0 1.5px ${i.color}` : undefined }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ── Trend chart (one series, 75% line, hover crosshair + tooltip) ───────────

export function TrendChart({ points }: { points: { date: string; pct: number }[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="py-10 text-center text-sm text-muted-foreground">Not enough days of attendance yet.</p>;
  const W = 640, H = 210, L = 36, R = 12, T = 12, B = 26;
  const lo = Math.max(0, Math.floor(Math.min(SHORT, ...points.map((p) => p.pct)) / 5) * 5 - 5);
  const hi = Math.min(100, Math.ceil(Math.max(...points.map((p) => p.pct)) / 5) * 5 + 5);
  const x = (i: number) => L + ((W - L - R) * i) / (points.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += hi - lo > 30 ? 10 : 5) ticks.push(t);
  const line = points.map((p, i) => `${x(i)},${y(p.pct)}`).join(" ");
  const last = points[points.length - 1];
  const onMove = (e: React.MouseEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - L) / (W - L - R)) * (points.length - 1)))));
  };
  return (
    <div ref={box} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img"
        aria-label={`Department student attendance over the last ${points.length} class days, from ${Math.min(...points.map((p) => p.pct))}% to ${Math.max(...points.map((p) => p.pct))}%`}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === SHORT ? "hsl(var(--muted-foreground))" : "hsl(var(--border))"} strokeDasharray={t === SHORT ? "4 4" : undefined} />
            <text x={L - 6} y={y(t) + 3.5} fontSize="10" textAnchor="end" fill="hsl(var(--muted-foreground))">{t}%</text>
          </g>
        ))}
        {!ticks.includes(SHORT) && SHORT > lo && SHORT < hi && <line x1={L} x2={W - R} y1={y(SHORT)} y2={y(SHORT)} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
        {SHORT > lo && SHORT < hi && <text x={W - R} y={y(SHORT) - 5} fontSize="10" textAnchor="end" fill="hsl(var(--muted-foreground))">75% line</text>}
        <polygon points={`${L},${y(lo)} ${line} ${x(points.length - 1)},${y(lo)}`} fill="hsl(var(--primary))" opacity="0.08" />
        <polyline points={line} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (i % 2 === 0 || i === points.length - 1) && (
          <text key={p.date} x={x(i)} y={H - 6} fontSize="10" textAnchor="middle" fill="hsl(var(--muted-foreground))">{shortDay(p.date)}</text>
        ))}
        <circle cx={x(points.length - 1)} cy={y(last.pct)} r="4" fill="hsl(var(--primary))" stroke="hsl(var(--card))" strokeWidth="2" />
        <text x={x(points.length - 1) - 8} y={y(last.pct) - 10} fontSize="11" fontWeight="600" textAnchor="end" fill="hsl(var(--foreground))">{last.pct}%</text>
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="hsl(var(--muted-foreground))" opacity="0.5" />
            <circle cx={x(hover)} cy={y(points[hover].pct)} r="4" fill="hsl(var(--primary))" stroke="hsl(var(--card))" strokeWidth="2" />
          </>
        )}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${Math.min((x(hover) / W) * 100, 80)}%`, top: `${Math.max(0, (y(points[hover].pct) / H) * 100 - 28)}%` }}>
          <b className="block text-sm">{points[hover].pct}%</b>{shortDay(points[hover].date)}
        </div>
      )}
    </div>
  );
}

