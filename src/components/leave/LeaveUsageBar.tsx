// Shared "part-to-whole by leave type" chart - used on both the requester's
// own Leave page (this year's own usage) and the HOD dashboard (department
// usage this month). A horizontal stacked bar, not a pie/donut: per the
// data-viz skill's own form table, part-to-whole with a categorical color job
// is a stacked bar, and a pie of more than a couple of slices is explicitly
// the "not this" column. Colors are the skill's validated default categorical
// palette (references/palette.md), light mode only - this app has no dark
// mode anywhere else yet, so a dark variant here would be unmatched
// elsewhere and untestable.
//
// Segment order is FIXED (never re-sorted by value) - color-by-identity means
// a given leave type always gets the same slot, so a returning viewer doesn't
// have to re-read the legend every time the mix changes.

const CATEGORICAL_SLOTS = [
  "#2a78d6", // 1 blue
  "#eb6834", // 2 orange
  "#1baf7a", // 3 aqua
  "#eda100", // 4 yellow
  "#e87ba4", // 5 magenta
  "#008300", // 6 green
  "#4a3aa7", // 7 violet
  "#e34948", // 8 red
] as const;

export interface LeaveUsageSegment {
  /** Stable key (e.g. leave type code) - decides this segment's color slot by
   *  its position in `order`, not by sorting on value. */
  key: string;
  label: string;
  value: number;
}

interface LeaveUsageBarProps {
  /** Fixed display/color order - every segment's key must appear here. */
  order: string[];
  segments: LeaveUsageSegment[];
  /** Shown above the bar, e.g. "18 days" - the hero figure for this chart. */
  totalLabel: string;
  emptyLabel?: string;
}

export function LeaveUsageBar({ order, segments, totalLabel, emptyLabel = "No leave taken yet" }: LeaveUsageBarProps) {
  const byKey = new Map(segments.map((s) => [s.key, s]));
  const ordered = order.map((k) => byKey.get(k)).filter((s): s is LeaveUsageSegment => !!s && s.value > 0);
  const total = ordered.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className="space-y-2.5">
      <p className="text-2xl font-semibold" style={{ fontVariantNumeric: "proportional-nums" }}>{totalLabel}</p>
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <>
          <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
            {ordered.map((s) => {
              const colorIndex = order.indexOf(s.key) % CATEGORICAL_SLOTS.length;
              const pct = (s.value / total) * 100;
              return (
                <div
                  key={s.key}
                  title={`${s.label}: ${s.value}`}
                  style={{ width: `${pct}%`, backgroundColor: CATEGORICAL_SLOTS[colorIndex] }}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {ordered.map((s) => {
              const colorIndex = order.indexOf(s.key) % CATEGORICAL_SLOTS.length;
              return (
                <div key={s.key} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: CATEGORICAL_SLOTS[colorIndex] }}
                    aria-hidden
                  />
                  <span className="text-foreground/80">{s.label}</span>
                  <span className="text-muted-foreground">{s.value}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Same-ramp meter (skill spec: fill carries the value, unfilled track is a
 *  lighter step of the same ramp) - used for a single ratio against a limit,
 *  e.g. attendance %. Not a categorical chart, so it doesn't share the
 *  palette above - blue throughout, lighter for the track. */
export function RatioMeter({ label, percent }: { label: string; percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{clamped.toFixed(0)}%</p>
      </div>
      <div className="h-2.5 w-full rounded-full" style={{ backgroundColor: "#cde2fb" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${clamped}%`, backgroundColor: "#2a78d6" }}
        />
      </div>
    </div>
  );
}
