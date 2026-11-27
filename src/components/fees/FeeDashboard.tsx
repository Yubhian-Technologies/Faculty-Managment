"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Banknote, CalendarClock, Download, Landmark, RefreshCw, Wallet, IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { cn, dmy, exportToCSV } from "@/lib/utils";
import { Bar, Kpi, Panel, SectionTitle, Tag, shortDay } from "@/components/dashboard/DashboardParts";
import type { FeeDashboard as Dash, FeeGroupRow } from "@/lib/fees/dashboard";
import { feeGet, rupee, selectClass, yearChoices, type FeeOptions } from "./feeApi";

// Accounts > Fees > Dashboard: the academic year's fee position for the college picked - raised / collected / balance,
// money in (today, this month, last 30 days, counter vs online, mode), where it sits (bank account, fee head), who
// owes (category, class, department, instalment, overdue ageing, defaulters) and the online payments. Read only;
// figures from api/college/fees/dashboard (lib/fees/dashboard.ts).

const MODE: Record<string, string> = { CASH: "Cash", UPI: "UPI", BANK: "Bank Transfer", DD: "Demand Draft", CHEQUE: "Cheque", ONLINE: "Online (CCAvenue)" };
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const lakh = (n: number) => (Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : rupee(n));

export function FeeDashboard({ collegeId, options, academicYear, setAcademicYear }: { collegeId: string; options: FeeOptions; academicYear: string; setAcademicYear: (y: string) => void }) {
  const [courseKey, setCourseKey] = useState("");
  const [batch, setBatch] = useState("");
  const [d, setD] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const url = `/api/college/fees/dashboard?${new URLSearchParams({ academicYear, ...(courseKey ? { courseKey } : {}), ...(batch ? { batch } : {}) })}`;

  useEffect(() => {
    let live = true;
    feeGet<Dash>(url, collegeId)
      .then((x) => { if (live) { setD(x); setError(false); } })
      .catch((e: Error) => { if (live) { setError(true); toast({ variant: "destructive", title: e.message }); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [url, collegeId, tick]);
  const reload = useCallback(() => { setLoading(true); setTick((n) => n + 1); }, []);

  const batches = courseKey ? options.batchesByCourse[courseKey] ?? [] : [];
  const t = d?.totals;
  const collectedPct = t ? pct(t.collected, t.payable) : 0;
  const empty = !!d && d.totals.students === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-32 space-y-1"><Label className="text-xs">Academic Year</Label>
          <select className={selectClass} value={academicYear} onChange={(e) => { setLoading(true); setAcademicYear(e.target.value); }}>{yearChoices(options.academicYear).map((y) => <option key={y} value={y}>{y}</option>)}</select>
        </div>
        <div className="min-w-[14rem] flex-1 space-y-1 sm:max-w-sm"><Label className="text-xs">Course</Label>
          <select className={selectClass} value={courseKey} onChange={(e) => { setLoading(true); setCourseKey(e.target.value); setBatch(""); }}>
            <option value="">All Courses</option>{options.courses.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        </div>
        <div className="w-40 space-y-1"><Label className="text-xs">Batch</Label>
          <select className={selectClass} value={batch} disabled={!courseKey} onChange={(e) => { setLoading(true); setBatch(e.target.value); }}>
            <option value="">All Batches</option>{batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <Button variant="outline" onClick={reload} loading={loading}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh</Button>
        {d && <span className="pb-2 text-xs text-muted-foreground">As of {dmy(d.today)}</span>}
      </div>

      {empty ? (
        <p className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">No fees are raised for {academicYear}{courseKey ? " in this course" : ""} yet. Raise them on the Raise Fees tab.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <Kpi icon={IndianRupee} label="Fee Raised" loading={loading && !d} error={error && !d} value={t ? lakh(t.raised) : "-"}
              sub={t && <>{t.students.toLocaleString("en-IN")} students{t.concession ? ` · concessions ${lakh(t.concession)}` : ""}</>} />
            <Kpi icon={Wallet} label="Collected" loading={loading && !d} error={error && !d} value={t ? lakh(t.collected) : "-"}
              meter={t ? [{ value: Math.min(100, collectedPct), color: "hsl(var(--primary))" }] : undefined}
              sub={t && <>{collectedPct}% of {lakh(t.payable)} payable by students</>} />
            <Kpi icon={Banknote} label="Balance to Collect" loading={loading && !d} error={error && !d} value={t ? lakh(t.balance) : "-"}
              sub={t && <>{(t.students - t.cleared).toLocaleString("en-IN")} students yet to clear · {t.notStarted.toLocaleString("en-IN")} paid nothing</>} />
            <Kpi icon={AlertTriangle} label="Overdue Now" tone={t && t.overdue > 0 ? "crit" : undefined} href="#fee-defaulters" loading={loading && !d} error={error && !d}
              value={t ? lakh(t.overdue) : "-"} sub={t && <>{t.overdueStudents.toLocaleString("en-IN")} students past a due date</>} />
            <Kpi icon={CalendarClock} label="Collected Today" loading={loading && !d} error={error && !d} value={d ? lakh(d.collections.today.amount) : "-"}
              sub={d && <>{d.collections.today.count} receipts · this month {lakh(d.collections.month.amount)}</>} />
            <Kpi icon={Landmark} label="Government Share (FR)" loading={loading && !d} error={error && !d} value={t ? lakh(t.govtShare) : "-"}
              sub={t && <>received {lakh(t.govtReceived)} · pending {lakh(Math.max(0, t.govtShare - t.govtReceived))}</>} />
          </div>

          {d && (
            <>
              <SectionTitle title="Money In" sub={`${d.collections.year.count.toLocaleString("en-IN")} receipts in ${academicYear}, ${lakh(d.collections.year.amount)}`} />
              <div className="grid gap-4 xl:grid-cols-3">
                <Panel title="Daily Collection" sub="Last 30 days, receipts not cancelled" className="xl:col-span-2">
                  <DailyBars days={d.collections.daily} />
                </Panel>
                <Panel title="How It Was Paid" sub={d.collections.cancelled.count ? `${d.collections.cancelled.count} cancelled receipts (${rupee(d.collections.cancelled.amount)}) not counted` : "Counter and online, by mode"}>
                  <div className="space-y-2">
                    <Bar wide label="At the Counter" value={d.collections.bySource.COUNTER} max={Math.max(1, d.collections.year.amount)} text={lakh(d.collections.bySource.COUNTER)} />
                    <Bar wide label="Online" value={d.collections.bySource.ONLINE} max={Math.max(1, d.collections.year.amount)} text={lakh(d.collections.bySource.ONLINE)} />
                  </div>
                  <div className="mt-4 divide-y rounded-md border text-sm">
                    {d.collections.byMode.length === 0 && <p className="px-3 py-3 text-center text-xs text-muted-foreground">No receipts yet.</p>}
                    {d.collections.byMode.map((m) => (
                      <div key={m.mode} className="flex items-center justify-between px-3 py-1.5">
                        <span>{MODE[m.mode] ?? m.mode} <span className="text-xs text-muted-foreground">({m.count})</span></span>
                        <span className="font-medium tabular-nums">{rupee(m.amount)}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>

              <SectionTitle title="Where the Money Goes" />
              <div className="grid gap-4 xl:grid-cols-2">
                <Panel title="By Bank Account" sub="Each fee head is credited to its bank account (Setup)">
                  <MoneyTable rows={d.byBank} first="Bank Account" />
                </Panel>
                <Panel title="By Fee Head" sub="What students pay of each head, after FR and concessions">
                  <MoneyTable rows={d.byHead} first="Fee Head" />
                </Panel>
              </div>

              <SectionTitle title="Who Owes" />
              <div className="grid gap-4 xl:grid-cols-2">
                <Panel title="By Category" sub="FR students pay only what the government does not cover">
                  <GroupTable rows={d.byCategory} first="Category" extra={(r) => {
                    const c = r as (typeof d.byCategory)[number];
                    return c.key === "A-FR" ? <span className="block text-[11px] text-muted-foreground">Government {rupee(c.govtShare)} · received {rupee(c.govtReceived)}</span> : null;
                  }} />
                </Panel>
                <Panel title="Instalments" sub="Per instalment, all students together">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-muted-foreground"><tr>{["Instalment", "Due By", "Payable", "Collected", "Overdue"].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
                      <tbody className="divide-y">
                        {d.instalments.map((i) => (
                          <tr key={i.no}>
                            <td className="px-2 py-1.5">{i.label}</td>
                            <td className="px-2 py-1.5 tabular-nums">{i.dueDate ? dmy(i.dueDate) : "-"}</td>
                            <td className="px-2 py-1.5 tabular-nums">{rupee(i.payable)}</td>
                            <td className="px-2 py-1.5 tabular-nums">{rupee(i.collected)} <span className="text-xs text-muted-foreground">({pct(i.collected, i.payable)}%)</span></td>
                            <td className="px-2 py-1.5 tabular-nums">{i.overdue ? <span className="text-destructive">{rupee(i.overdue)} <span className="text-xs">({i.overdueStudents})</span></span> : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                <Panel title="Overdue by Age" sub="Days past the oldest unpaid due date">
                  <div className="space-y-2">
                    {d.ageing.map((a) => (
                      <Bar key={a.key} wide label={a.label} value={a.amount} max={Math.max(1, ...d.ageing.map((x) => x.amount))} text={lakh(a.amount)} sub={`${a.students} students`} />
                    ))}
                  </div>
                </Panel>
                <Panel title="Online Payments" sub="CCAvenue payments for fees this year" className="xl:col-span-2">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Successful" value={d.online.success} sub={rupee(d.online.successAmount)} />
                    <Stat label="Failed / Cancelled" value={d.online.failed} />
                    <Stat label="Not Completed Yet" value={d.online.pending} sub="checked every 15 minutes" />
                    <Stat label="To Refund" value={d.online.needsRefund} tone={d.online.needsRefund ? "crit" : undefined} sub={d.online.refunded ? `${d.online.refunded} refunded` : undefined} />
                  </div>
                  {d.pendingConcessions > 0 && <p className="mt-3 text-xs text-muted-foreground"><Tag tone="warn">{d.pendingConcessions}</Tag> concession requests are waiting for the Management.</p>}
                </Panel>
              </div>

              <ClassAndDepartment d={d} academicYear={academicYear} />
              <Defaulters d={d} academicYear={academicYear} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "crit" }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-bold tabular-nums", tone === "crit" && "text-destructive")}>{value.toLocaleString("en-IN")}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function MoneyTable({ rows, first }: { rows: { key: string; label: string; payable: number; collected: number; balance: number }[]; first: string }) {
  if (rows.length === 0) return <p className="py-4 text-center text-xs text-muted-foreground">Nothing raised yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr>{[first, "Payable", "Collected", "Balance", ""].map((h, i) => <th key={i} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const p = pct(r.collected, r.payable);
            return (
              <tr key={r.key}>
                <td className="px-2 py-1.5">{r.label}</td>
                <td className="px-2 py-1.5 tabular-nums">{rupee(r.payable)}</td>
                <td className="px-2 py-1.5 tabular-nums">{rupee(r.collected)}</td>
                <td className="px-2 py-1.5 tabular-nums">{rupee(r.balance)}</td>
                <td className="w-28 px-2 py-1.5"><Meter value={p} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1.5" title={`${value}% collected`}>
      <div className="h-1.5 flex-1 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, value)}%` }} /></div>
      <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">{value}%</span>
    </div>
  );
}

function GroupTable({ rows, first, extra }: { rows: FeeGroupRow[]; first: string; extra?: (r: FeeGroupRow) => React.ReactNode }) {
  if (rows.length === 0) return <p className="py-4 text-center text-xs text-muted-foreground">Nothing raised yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr>{[first, "Students", "Payable", "Collected", "Balance", "Overdue", ""].map((h, i) => <th key={i} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="px-2 py-1.5">{r.label}{extra?.(r)}</td>
              <td className="px-2 py-1.5 tabular-nums">{r.students.toLocaleString("en-IN")}</td>
              <td className="px-2 py-1.5 tabular-nums">{rupee(r.payable)}</td>
              <td className="px-2 py-1.5 tabular-nums">{rupee(r.collected)}</td>
              <td className="px-2 py-1.5 tabular-nums">{rupee(r.balance)}</td>
              <td className="px-2 py-1.5 tabular-nums">{r.overdue ? <span className="text-destructive">{rupee(r.overdue)} <span className="text-xs">({r.overdueStudents})</span></span> : "-"}</td>
              <td className="w-28 px-2 py-1.5"><Meter value={pct(r.collected, r.payable)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const GROUP_COLUMNS = [
  { key: "label", header: "Name" }, { key: "students", header: "Students" }, { key: "raised", header: "Fee Raised" }, { key: "payable", header: "Payable by Students" },
  { key: "collected", header: "Collected" }, { key: "balance", header: "Balance" }, { key: "overdue", header: "Overdue" }, { key: "overdueStudents", header: "Students Overdue" },
];

function ClassAndDepartment({ d, academicYear }: { d: Dash; academicYear: string }) {
  const [view, setView] = useState<"class" | "department">("class");
  const rows = view === "class" ? d.byClass : d.byDepartment;
  return (
    <Panel title={view === "class" ? "Class-wise" : "Department-wise"} sub="Course and batch, or department">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {(["class", "department"] as const).map((v) => (
            <Button key={v} size="sm" variant={view === v ? "default" : "outline"} onClick={() => setView(v)}>{v === "class" ? "By Class" : "By Department"}</Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => exportToCSV(rows as unknown as Record<string, unknown>[], `fee-${view}-${academicYear}.csv`, GROUP_COLUMNS)}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
      </div>
      <GroupTable rows={rows} first={view === "class" ? "Class" : "Department"} />
    </Panel>
  );
}

function Defaulters({ d, academicYear }: { d: Dash; academicYear: string }) {
  const [all, setAll] = useState(false);
  const rows = all ? d.defaulters : d.defaulters.slice(0, 20);
  const csv = useMemo(() => d.defaulters.map((r) => ({ ...r, oldestDue: dmy(r.oldestDue), category: r.category === "A" ? `A - ${r.funding}` : r.category === "SPOT" ? "Spot" : r.category })), [d.defaulters]);
  return (
    <Panel id="fee-defaulters" title="Overdue Students" sub={`${d.defaulters.length.toLocaleString("en-IN")} students past a due date, most overdue first`}>
      {d.defaulters.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">No student is past a due date.</p> : (
        <>
          <div className="mb-2 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => exportToCSV(csv as unknown as Record<string, unknown>[], `fee-overdue-${academicYear}.csv`, [
              { key: "rollNumber", header: "Regd. No" }, { key: "name", header: "Name" }, { key: "department", header: "Department" }, { key: "section", header: "Section" },
              { key: "courseName", header: "Course" }, { key: "batch", header: "Batch" }, { key: "category", header: "Category" }, { key: "overdue", header: "Overdue" },
              { key: "balance", header: "Balance" }, { key: "oldestDue", header: "Oldest Due Date" }, { key: "days", header: "Days Overdue" },
            ])}><Download className="mr-1 h-3.5 w-3.5" />Download All (CSV)</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr>{["Regd. No", "Name", "Department", "Section", "Overdue", "Balance", "Due Since", "Days"].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.accountId}>
                    <td className="px-2 py-1.5 tabular-nums">{r.rollNumber || "-"}</td>
                    <td className="px-2 py-1.5">{r.name}</td>
                    <td className="px-2 py-1.5">{r.department}</td>
                    <td className="px-2 py-1.5">{r.section}</td>
                    <td className="px-2 py-1.5 tabular-nums text-destructive">{rupee(r.overdue)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{rupee(r.balance)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{dmy(r.oldestDue)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{r.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.defaulters.length > 20 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll((v) => !v)}>{all ? "Show Top 20" : `Show All ${d.defaulters.length.toLocaleString("en-IN")}`}</Button>}
        </>
      )}
    </Panel>
  );
}

/** Money in per day: one series (primary), hover shows the day's amount and receipts. */
function DailyBars({ days }: { days: { date: string; amount: number; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...days.map((x) => x.amount));
  if (max <= 0) return <p className="py-10 text-center text-sm text-muted-foreground">No money received in the last 30 days.</p>;
  const W = 640, H = 200, L = 8, R = 8, T = 10, B = 24;
  const slot = (W - L - R) / days.length;
  const bw = Math.max(2, slot - 2);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const h = hover != null ? days[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full" role="img" aria-label="Daily fee collection, last 30 days" onMouseLeave={() => setHover(null)}>
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="stroke-border" />
        {days.map((x, i) => {
          const top = y(x.amount);
          const bx = L + i * slot + (slot - bw) / 2;
          return (
            <g key={x.date} onMouseEnter={() => setHover(i)}>
              <rect x={L + i * slot} y={T} width={slot} height={H - T - B} fill="transparent" />
              {x.amount > 0 && <rect x={bx} y={top} width={bw} height={Math.max(1, H - B - top)} rx={Math.min(3, bw / 2)} fill="hsl(var(--primary))" opacity={hover == null || hover === i ? 1 : 0.45} />}
              {(i % 5 === 0 || i === days.length - 1) && <text x={L + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[10px]">{shortDay(x.date)}</text>}
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="pointer-events-none absolute right-2 top-0 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow">
          <p className="font-medium">{dmy(h.date)}</p>
          <p className="tabular-nums">{rupee(h.amount)} · {h.count} receipts</p>
        </div>
      )}
    </div>
  );
}
