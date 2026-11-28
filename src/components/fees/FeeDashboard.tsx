"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Banknote, CalendarClock, Download, Landmark, RefreshCw, Wallet, IndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { cn, dmy, exportToCSV } from "@/lib/utils";
import { Bar, Card, Kpi, Legend, Panel, SectionTitle, Tag, jumpTo, shortDay } from "@/components/dashboard/DashboardParts";
import { CATEGORY_GROUP, CATEGORY_KEYS, type BranchCell, type CategoryKey, type CategoryRow, type FeeDashboard as Dash, type FeeGroupRow } from "@/lib/fees/dashboard";
import { feeGet, rupee, selectClass, yearChoices, type FeeOptions } from "./feeApi";

// Accounts > Fees > Dashboard: the academic year's fee position for the college picked - raised / collected / balance,
// money in (today, this month, last 30 days, counter vs online, mode), where it sits (bank account, fee head), who
// owes (category, class, department, instalment, overdue ageing, defaulters) and the online payments. Read only;
// figures from api/college/fees/dashboard (lib/fees/dashboard.ts).

const MODE: Record<string, string> = { CASH: "Cash", UPI: "UPI", BANK: "Bank Transfer", DD: "Demand Draft", CHEQUE: "Cheque", ONLINE: "Online (CCAvenue)" };
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const lakh = (n: number) => (Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : Math.abs(n) >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : rupee(n));

type DashData = Dash & { options?: { departments: string[]; years: number[] }; deptCodes?: Record<string, string> };

// One colour per category, used for its card stripe, summary dot and matrix heading (identity, never status).
const CAT_COLOR: Record<CategoryKey, string> = { "A-FR": "#0f766e", "A-NFR": "#1d4ed8", SPOT: "#c2410c", B: "#6d28d9" };
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];

export function FeeDashboard({ collegeId, options, academicYear, setAcademicYear }: { collegeId: string; options: FeeOptions; academicYear: string; setAcademicYear: (y: string) => void }) {
  const [courseKey, setCourseKey] = useState("");
  const [batch, setBatch] = useState("");
  const [department, setDepartment] = useState("");
  const [year, setYear] = useState("");
  const [d, setD] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  // The Students With a Balance list's filter (a category chip, or a Branch x Category cell).
  const [pick, setPick] = useState<{ cat: CategoryKey | ""; branch: string }>({ cat: "", branch: "" });
  const url = `/api/college/fees/dashboard?${new URLSearchParams({ academicYear, ...(courseKey ? { courseKey } : {}), ...(batch ? { batch } : {}), ...(department ? { department } : {}), ...(year ? { year } : {}) })}`;

  useEffect(() => {
    let live = true;
    feeGet<DashData>(url, collegeId)
      .then((x) => { if (live) { setD(x); setError(false); } })
      .catch((e: Error) => { if (live) { setError(true); toast({ variant: "destructive", title: e.message }); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [url, collegeId, tick]);
  const reload = useCallback(() => { setLoading(true); setTick((n) => n + 1); }, []);
  const change = (f: () => void) => { setLoading(true); setPick({ cat: "", branch: "" }); f(); };

  const batches = courseKey ? options.batchesByCourse[courseKey] ?? [] : [];
  const t = d?.totals;
  const collectedPct = t ? pct(t.collected, t.payable) : 0;
  const empty = !!d && d.totals.students === 0;
  const code = (dept: string) => d?.deptCodes?.[dept] || dept;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-32 space-y-1"><Label className="text-xs">Academic Year</Label>
          <select className={selectClass} value={academicYear} onChange={(e) => change(() => setAcademicYear(e.target.value))}>{yearChoices(options.academicYear).map((y) => <option key={y} value={y}>{y}</option>)}</select>
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1 sm:max-w-xs"><Label className="text-xs">Course</Label>
          <select className={selectClass} value={courseKey} onChange={(e) => change(() => { setCourseKey(e.target.value); setBatch(""); })}>
            <option value="">All Courses</option>{options.courses.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        </div>
        <div className="w-36 space-y-1"><Label className="text-xs">Batch</Label>
          <select className={selectClass} value={batch} disabled={!courseKey} onChange={(e) => change(() => setBatch(e.target.value))}>
            <option value="">All Batches</option>{batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="min-w-[12rem] flex-1 space-y-1 sm:max-w-xs"><Label className="text-xs">Branch</Label>
          <select className={selectClass} value={department} onChange={(e) => change(() => setDepartment(e.target.value))}>
            <option value="">All Branches</option>{(d?.options?.departments ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div className="w-32 space-y-1"><Label className="text-xs">Year of Study</Label>
          <select className={selectClass} value={year} onChange={(e) => change(() => setYear(e.target.value))}>
            <option value="">All Years</option>{(d?.options?.years ?? []).map((y) => <option key={y} value={String(y)}>{ROMAN[y] ?? y} Year</option>)}
          </select>
        </div>
        <Button variant="outline" onClick={reload} loading={loading}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh</Button>
        <Button variant="outline" disabled={!d || empty} onClick={() => d && void downloadExcel(d, academicYear, code).catch((e: Error) => toast({ variant: "destructive", title: e.message }))}><Download className="mr-1.5 h-4 w-4" />Download Excel</Button>
        {d && <span className="pb-2 text-xs text-muted-foreground">As of {dmy(d.today)}</span>}
      </div>

      {empty ? (
        <p className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">No fees are raised for {academicYear} with these filters yet. Raise or import them on the Raise Fees or Import Previous tab.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <Kpi icon={IndianRupee} label="Total Fee" loading={loading && !d} error={error && !d} value={t ? lakh(t.raised) : "-"}
              sub={t && <>{t.students.toLocaleString("en-IN")} students · Government (FR) {lakh(t.govtShare)} · Students {lakh(t.payable)}</>} />
            <Kpi icon={Wallet} label="Fee Paid (Collected)" loading={loading && !d} error={error && !d} value={t ? lakh(t.collected) : "-"}
              meter={t ? [{ value: Math.min(100, collectedPct), color: "var(--primary)" }] : undefined}
              sub={t && d && <>{collectedPct}% of {lakh(t.payable)} payable by students · {d.collections.year.count.toLocaleString("en-IN")} receipts</>} />
            <Kpi icon={Banknote} label="Balance" loading={loading && !d} error={error && !d} value={t ? lakh(t.balance) : "-"}
              sub={t && <>{t.yetToClear.toLocaleString("en-IN")} students yet to clear · {t.notStarted.toLocaleString("en-IN")} paid nothing</>} />
            <Kpi icon={AlertTriangle} label="Overdue" tone={t && t.overdue > 0 ? "crit" : undefined} href="#fee-overdue-cat" loading={loading && !d} error={error && !d}
              value={t ? lakh(t.overdue) : "-"} sub={t && (d?.instalments.some((i) => !i.dueDate) && t.overdue === 0 ? <span className="text-amber-700">Due dates not set yet</span> : <>{t.overdueStudents.toLocaleString("en-IN")} students past a due date</>)} />
            <Kpi icon={Landmark} label="Government Share (FR)" loading={loading && !d} error={error && !d} value={t ? lakh(t.govtShare) : "-"}
              sub={t && <>Received {lakh(t.govtReceived)} · Pending {lakh(Math.max(0, t.govtShare - t.govtReceived))}</>} />
            <Kpi icon={CalendarClock} label="Collected Today" loading={loading && !d} error={error && !d} value={d ? lakh(d.collections.today.amount) : "-"}
              sub={d && <>{d.collections.today.count} receipts · this month {lakh(d.collections.month.amount)}</>} />
          </div>

          {d && (
            <>
              <SectionTitle title="By Category" sub="CAT-A (FR) · CAT-A (NFR) · CAT-A (SPOT) · CAT-B (MGT)" />
              <CategoryCards rows={d.byCategory} />
              <CategorySummary d={d} />
              <BranchMatrix d={d} code={code} onPick={(branch, cat) => { setPick({ cat, branch }); jumpTo("fee-balances"); }} />
              <div className="grid gap-4 xl:grid-cols-2">
                <WhoHasPaid rows={d.byCategory} />
                <OverdueByCategory d={d} />
              </div>
              <BalanceList d={d} pick={pick} setPick={setPick} code={code} academicYear={academicYear} />

              <SectionTitle title="Fee Collected Details" sub={`${d.collections.year.count.toLocaleString("en-IN")} receipts in ${academicYear}, ${lakh(d.collections.year.amount)}`} />
              <div className="grid gap-4 xl:grid-cols-3">
                <Panel title="Daily Fee Collection" sub="Last 30 Days (Excluding Cancelled Receipts)" className="xl:col-span-2">
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

              <SectionTitle title="Expenditure Breakdown" sub="Allocation and Utilisation of Funds" />
              <div className="grid gap-4 xl:grid-cols-2">
                <Panel title="Bank Account-wise Fee Collection" sub="Each Fee Head is Mapped to Its Designated Bank Account (As Configured in Setup).">
                  <MoneyTable rows={d.byBank} first="Bank Account" />
                </Panel>
                <Panel title="By Fee Head" sub="Actual Amount Payable by Students under Each Fee Head, After Adjusting Fee Reimbursements (FR) and Concessions.">
                  <MoneyTable rows={d.byHead} first="Fee Head" />
                </Panel>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <Panel title="Instalments" sub="Per instalment, all students together">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-muted-foreground"><tr>{["Instalment", "Due By", "Payable", "Collected", "Overdue"].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
                      <tbody className="divide-y">
                        {d.instalments.map((i) => (
                          <tr key={i.no}>
                            <td className="px-2 py-1.5">{i.label}</td>
                            <td className="px-2 py-1.5 tabular-nums">{i.dueDate ? dmy(i.dueDate) : "Not set yet"}</td>
                            <td className="px-2 py-1.5 tabular-nums">{rupee(i.payable)}</td>
                            <td className="px-2 py-1.5 tabular-nums">{rupee(i.collected)} <span className="text-xs text-muted-foreground">({pct(i.collected, i.payable)}%)</span></td>
                            <td className="px-2 py-1.5 tabular-nums">{i.overdue ? <span className="text-destructive">{rupee(i.overdue)} <span className="text-xs">({i.overdueStudents})</span></span> : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
                <Panel title="Online Payments" sub="CCAvenue payments for fees this year">
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

function CategoryCards({ rows }: { rows: CategoryRow[] }) {
  const of = (k: CategoryKey) => rows.find((r) => r.key === k);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {CATEGORY_KEYS.map((k) => {
        const r = of(k);
        const line = (label: string, value: React.ReactNode, tone?: string) => (
          <><span className="text-muted-foreground">{label}</span><span className={cn("text-right font-semibold tabular-nums", tone)}>{value}</span></>
        );
        const fr = k === "A-FR";
        const p = r ? (fr ? pct(r.govtReceived, r.govtShare) : pct(r.collected, r.payable)) : 0;
        return (
          <Card key={k} className="flex flex-col gap-2.5 p-4" >
            <div className="h-1 -mx-4 -mt-4 mb-1 rounded-t-2xl" style={{ background: CAT_COLOR[k] }} />
            <div className="flex items-baseline justify-between"><p className="text-[15px] font-semibold">{CATEGORY_GROUP[k]}</p><p className="text-xs text-muted-foreground">{r ? `${r.students.toLocaleString("en-IN")} students` : "No students"}</p></div>
            {r ? (
              <>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
                  {line(fr ? "Total Fee to be Received from Govt." : "Total Fee to be Collected", lakh(fr ? r.govtShare : r.raised))}
                  {fr ? (
                    <>
                      {line("Reimbursement Received", lakh(r.govtReceived))}
                      {line("Reimbursement to be Received", lakh(Math.max(0, r.govtShare - r.govtReceived)))}
                      {line("Paid by Students", lakh(r.collected))}
                      {line("Refundable to Students", r.paidExtra ? `${lakh(r.paidExtra)} · ${r.paidExtraStudents}` : "-", r.paidExtra ? "text-amber-700" : undefined)}
                    </>
                  ) : (
                    <>
                      {line("Collected as of Now", lakh(r.collected))}
                      {line("Outstanding Fee", lakh(r.balance))}
                      {line("Overdue Fee", lakh(r.overdue), r.overdue ? "text-destructive" : undefined)}
                      {line("Refundable to Students", r.paidExtra ? `${lakh(r.paidExtra)} · ${r.paidExtraStudents}` : "-", r.paidExtra ? "text-amber-700" : undefined)}
                      {line("Fully · Partly · Not Paid", `${r.full} · ${r.part} · ${r.none}`)}
                    </>
                  )}
                </div>
                <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.min(100, p)}%`, background: CAT_COLOR[k] }} /></div>
                <p className="text-xs text-muted-foreground">{fr ? `Government ${p}% received · ${lakh(Math.max(0, r.govtShare - r.govtReceived))} pending` : `${p}% collected`}</p>
              </>
            ) : <p className="py-4 text-center text-xs text-muted-foreground">No fees in this category.</p>}
          </Card>
        );
      })}
    </div>
  );
}

function CategorySummary({ d }: { d: DashData }) {
  const t = d.totals;
  const sum = (f: (r: CategoryRow) => number) => d.byCategory.reduce((n, r) => n + f(r), 0);
  const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
  return (
    <Panel title="Category Summary">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr>{["Category", "Students", "Total Fee", "Government (FR)", "To be Paid by Student", "Fee Paid", "Balance", "Overdue", "Collected %", "Fully Paid", "Partly Paid", "Not Paid"].map((h, i) => <th key={h} className={cn("px-3 py-2 font-medium whitespace-nowrap", i ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
          <tbody className="divide-y">
            {d.byCategory.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2 whitespace-nowrap"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: CAT_COLOR[r.key] }} />{r.label}</td>
                <td className={cell}>{r.students.toLocaleString("en-IN")}</td>
                <td className={cell}>{rupee(r.raised)}</td>
                <td className={cell}>{rupee(r.govtShare)}</td>
                <td className={cell}>{rupee(r.payable)}</td>
                <td className={cell}>{rupee(r.collected)}</td>
                <td className={cell}>{rupee(r.balance)}</td>
                <td className={cn(cell, r.overdue && "text-destructive")}>{rupee(r.overdue)}</td>
                <td className={cell}>{r.payable ? `${pct(r.collected, r.payable)}%` : "-"}</td>
                <td className={cell}>{r.payable ? r.full : "-"}</td>
                <td className={cell}>{r.payable ? r.part : "-"}</td>
                <td className={cell}>{r.payable ? r.none : "-"}</td>
              </tr>
            ))}
            <tr className="bg-muted/50 font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className={cell}>{t.students.toLocaleString("en-IN")}</td>
              <td className={cell}>{rupee(t.raised)}</td>
              <td className={cell}>{rupee(t.govtShare)}</td>
              <td className={cell}>{rupee(t.payable)}</td>
              <td className={cell}>{rupee(t.collected)}</td>
              <td className={cell}>{rupee(t.balance)}</td>
              <td className={cell}>{rupee(t.overdue)}</td>
              <td className={cell}>{t.payable ? `${pct(t.collected, t.payable)}%` : "-"}</td>
              <td className={cell}>{sum((r) => r.full)}</td>
              <td className={cell}>{sum((r) => r.part)}</td>
              <td className={cell}>{sum((r) => r.none)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function BranchMatrix({ d, code, onPick }: { d: DashData; code: (dept: string) => string; onPick: (branch: string, cat: CategoryKey | "") => void }) {
  const [view, setView] = useState<"money" | "students" | "pct">("money");
  const cats = CATEGORY_KEYS.filter((k) => d.byCategory.some((r) => r.key === k));
  const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
  const click = "rounded px-1 hover:bg-primary/10 hover:text-primary";
  const show = (c: BranchCell | undefined, k: CategoryKey | "total", branch: string) => {
    const fr = k === "A-FR";
    if (!c) return view === "money" ? [<td key="a" className={cell}>-</td>, <td key="b" className={cell}>-</td>] : [<td key="a" className={cell}>-</td>];
    if (view === "students") return [<td key="a" className={cell}>{c.students.toLocaleString("en-IN")}</td>];
    if (view === "pct") return [<td key="a" className={cell}>{fr ? "-" : c.payable ? `${pct(c.collected, c.payable)}%` : "-"}</td>];
    const pickCat = k === "total" ? "" : k;
    return fr
      ? [<td key="a" className={cell}>{c.students.toLocaleString("en-IN")}</td>, <td key="b" className={cell}>{lakh(c.govt)}</td>]
      : [<td key="a" className={cell}>{lakh(c.collected)}</td>,
         <td key="b" className={cell}>{c.balance ? <button type="button" className={click} title="Show these students" onClick={() => onPick(branch, pickCat)}>{lakh(c.balance)}</button> : lakh(0)}</td>];
  };
  const sub = (k: CategoryKey | "total") => view !== "money" ? [""] : k === "A-FR" ? ["Students", "Govt Due"] : ["Collected", "Balance"];
  const totals = { cats: Object.fromEntries(cats.map((k) => [k, d.byBranch.reduce<BranchCell>((n, b) => { const c = b.cats[k]; if (c) { n.students += c.students; n.payable += c.payable; n.collected += c.collected; n.balance += c.balance; n.govt += c.govt; } return n; }, { students: 0, payable: 0, collected: 0, balance: 0, govt: 0 })])) as Record<CategoryKey, BranchCell>,
    total: d.byBranch.reduce<BranchCell>((n, b) => ({ students: n.students + b.total.students, payable: n.payable + b.total.payable, collected: n.collected + b.total.collected, balance: n.balance + b.total.balance, govt: n.govt + b.total.govt }), { students: 0, payable: 0, collected: 0, balance: 0, govt: 0 }) };
  return (
    <Panel title="Branch × Category" sub="Branch-wise fee collected and balance fee details of each category. Click BALANCE to get the list.">
      <div className="mb-3 flex flex-wrap gap-1">
        {([["money", "Collected / Balance"], ["students", "Students"], ["pct", "Collected %"]] as const).map(([v, l]) => (
          <Button key={v} size="sm" variant={view === v ? "default" : "outline"} onClick={() => setView(v)}>{l}</Button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th />
              {cats.map((k) => <th key={k} colSpan={sub(k).length} className="px-3 py-1.5 text-center font-semibold whitespace-nowrap" style={{ color: CAT_COLOR[k] }}>{CATEGORY_GROUP[k]}</th>)}
              <th colSpan={sub("total").length} className="px-3 py-1.5 text-center font-semibold">Total</th>
            </tr>
            {view === "money" && (
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Branch</th>
                {cats.flatMap((k) => sub(k).map((h) => <th key={`${k}${h}`} className="px-3 py-1.5 text-right font-medium whitespace-nowrap">{h}</th>))}
                {sub("total").map((h) => <th key={`t${h}`} className="px-3 py-1.5 text-right font-medium">{h}</th>)}
              </tr>
            )}
          </thead>
          <tbody className="divide-y">
            {d.byBranch.map((b) => (
              <tr key={b.key}>
                <td className="px-3 py-2 whitespace-nowrap" title={b.label}>{code(b.label)}</td>
                {cats.flatMap((k) => show(b.cats[k], k, b.key))}
                {show(b.total, "total", b.key).map((x, i) => <Fragment key={`tt${i}`}>{x}</Fragment>)}
              </tr>
            ))}
            <tr className="bg-muted/50 font-semibold">
              <td className="px-3 py-2">Total</td>
              {cats.flatMap((k) => show(totals.cats[k], k, ""))}
              {show(totals.total, "total", "")}
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function WhoHasPaid({ rows }: { rows: CategoryRow[] }) {
  const shown = rows.filter((r) => r.payable > 0);
  return (
    <Panel title="Who Has Paid" sub="How much student share has been paid as of now.">
      <div className="space-y-3">
        {shown.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">No student has a share to pay.</p>}
        {shown.map((r) => {
          const n = r.full + r.part + r.none || 1;
          return (
            <div key={r.key} className="grid grid-cols-[110px_1fr_110px] items-center gap-2.5 text-[13px]" title={`${r.label}: ${r.full} paid in full, ${r.part} paid part, ${r.none} paid nothing`}>
              <span>{r.label}</span>
              <div className="flex h-3.5 gap-0.5 overflow-hidden rounded">
                {r.full > 0 && <i className="block h-full" style={{ width: `${(r.full / n) * 100}%`, background: "#15803d" }} />}
                {r.part > 0 && <i className="block h-full" style={{ width: `${(r.part / n) * 100}%`, background: "#d97706" }} />}
                {r.none > 0 && <i className="block h-full" style={{ width: `${(r.none / n) * 100}%`, background: "#cbd5e1" }} />}
              </div>
              <span className="text-right tabular-nums text-muted-foreground">{r.full} · {r.part} · {r.none}</span>
            </div>
          );
        })}
      </div>
      <Legend items={[{ color: "#15803d", label: "Fully Paid" }, { color: "#d97706", label: "Partly Paid" }, { color: "#cbd5e1", label: "Not Paid" }]} />
    </Panel>
  );
}

function OverdueByCategory({ d }: { d: DashData }) {
  const rows = d.byCategory.filter((r) => r.payable > 0);
  const noDates = d.instalments.some((i) => !i.dueDate) && d.totals.overdue === 0;
  const cell = "px-3 py-2 text-right tabular-nums";
  return (
    <Panel id="fee-overdue-cat" title="Overdue by Category" sub="Number of Days Past the Oldest Outstanding Due Date">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr>{["Category", "Up to 30 days", "31-60", "61-90", "Over 90", "Students"].map((h, i) => <th key={h} className={cn("px-3 py-2 font-medium whitespace-nowrap", i ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2 whitespace-nowrap">{r.label}</td>
                {r.ageing.map((a) => <td key={a.key} className={cn(cell, a.amount && "text-destructive")}>{a.amount ? lakh(a.amount) : "-"}</td>)}
                <td className={cell}>{r.overdueStudents || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {noDates && <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Due dates are not set yet, so nothing is overdue. Once instalments have dates this fills in.</p>}
    </Panel>
  );
}

function BalanceList({ d, pick, setPick, code, academicYear }: { d: DashData; pick: { cat: CategoryKey | ""; branch: string }; setPick: (p: { cat: CategoryKey | ""; branch: string }) => void; code: (dept: string) => string; academicYear: string }) {
  const [all, setAll] = useState(false);
  const inBranch = d.balances.filter((r) => !pick.branch || r.department === pick.branch);
  const rows = inBranch.filter((r) => !pick.cat || r.category === pick.cat);
  const shown = all ? rows : rows.slice(0, 50);
  const count = (k: CategoryKey) => inBranch.filter((r) => r.category === k).length;
  const cats = CATEGORY_KEYS.filter((k) => count(k) > 0);
  const chip = (on: boolean) => cn("h-8 rounded-full border px-3 text-xs", on ? "border-primary bg-primary/10 font-medium text-primary" : "bg-background hover:bg-muted");
  const csv = () => exportToCSV(rows.map((r) => ({ ...r, category: CATEGORY_GROUP[r.category], department: code(r.department), lastPaid: r.lastPaid ? dmy(r.lastPaid) : "" })) as unknown as Record<string, unknown>[], `fee-balances-${academicYear}.csv`, [
    { key: "rollNumber", header: "Regd. No" }, { key: "name", header: "Name" }, { key: "department", header: "Branch" }, { key: "section", header: "Section" }, { key: "category", header: "Category" },
    { key: "fee", header: "Fee" }, { key: "payable", header: "Student Pays" }, { key: "paid", header: "Paid" }, { key: "balance", header: "Balance" }, { key: "lastPaid", header: "Last Paid" },
  ]);
  return (
    <Panel id="fee-balances" title="Students with Outstanding Balances" sub="Sorted by Highest Outstanding Balance">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button type="button" className={chip(!pick.cat)} onClick={() => setPick({ ...pick, cat: "" })}>All ({inBranch.length.toLocaleString("en-IN")})</button>
        {cats.map((k) => <button key={k} type="button" className={chip(pick.cat === k)} onClick={() => setPick({ ...pick, cat: k })}>{CATEGORY_GROUP[k]} ({count(k).toLocaleString("en-IN")})</button>)}
        {pick.branch && <button type="button" className={chip(true)} onClick={() => setPick({ ...pick, branch: "" })} title="Show every branch">Branch: {code(pick.branch)} ×</button>}
        <Button size="sm" variant="outline" className="ml-auto" disabled={!rows.length} onClick={csv}><Download className="mr-1 h-3.5 w-3.5" />Download CSV</Button>
      </div>
      {rows.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">No student has a balance here.</p> : (
        <>
          <div className="max-h-[32rem] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground"><tr>{["Regd. No", "Name", "Branch", "Section", "Category", "Fee", "Paid", "Balance", "Last Paid"].map((h, i) => <th key={h} className={cn("px-3 py-2 font-medium whitespace-nowrap", i >= 5 ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {shown.map((r) => (
                  <tr key={r.accountId}>
                    <td className="px-3 py-1.5 tabular-nums">{r.rollNumber || "-"}</td>
                    <td className="px-3 py-1.5">{r.name}</td>
                    <td className="px-3 py-1.5" title={r.department}>{code(r.department)}</td>
                    <td className="px-3 py-1.5">{r.section}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap"><span className="mr-1.5 inline-block h-2 w-2 rounded-[2px]" style={{ background: CAT_COLOR[r.category] }} />{CATEGORY_GROUP[r.category]}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{rupee(r.payable)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{rupee(r.paid)}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{rupee(r.balance)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.lastPaid ? dmy(r.lastPaid) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 50 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAll((v) => !v)}>{all ? "Show First 50" : `Show All ${rows.length.toLocaleString("en-IN")}`}</Button>}
        </>
      )}
    </Panel>
  );
}

/** The category view as an Excel workbook: Category Summary, Branch x Category, Students With a Balance. */
async function downloadExcel(d: DashData, academicYear: string, code: (dept: string) => string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const bold = (ws: import("exceljs").Worksheet) => { ws.getRow(1).font = { bold: true }; ws.columns.forEach((c) => { c.width = Math.max(12, String(c.header ?? "").length + 2); }); };
  const s1 = wb.addWorksheet("Category Summary");
  s1.columns = ["Category", "Students", "Total Fee", "Government (FR)", "To be Paid by Student", "Fee Paid", "Balance", "Overdue", "Collected %", "Fully Paid", "Partly Paid", "Not Paid"].map((h) => ({ header: h }));
  for (const r of d.byCategory) s1.addRow([r.label, r.students, r.raised, r.govtShare, r.payable, r.collected, r.balance, r.overdue, r.payable ? pct(r.collected, r.payable) : null, r.full, r.part, r.none]);
  const t = d.totals;
  s1.addRow(["Total", t.students, t.raised, t.govtShare, t.payable, t.collected, t.balance, t.overdue, t.payable ? pct(t.collected, t.payable) : null]).font = { bold: true };
  bold(s1);
  const s2 = wb.addWorksheet("Branch x Category");
  const cats = CATEGORY_KEYS.filter((k) => d.byCategory.some((r) => r.key === k));
  s2.columns = ["Branch", ...cats.flatMap((k) => (k === "A-FR" ? [`${CATEGORY_GROUP[k]} Students`, `${CATEGORY_GROUP[k]} Govt Due`] : [`${CATEGORY_GROUP[k]} Collected`, `${CATEGORY_GROUP[k]} Balance`])), "Total Collected", "Total Balance"].map((h) => ({ header: h }));
  for (const b of d.byBranch) s2.addRow([code(b.label), ...cats.flatMap((k) => { const c = b.cats[k]; return k === "A-FR" ? [c?.students ?? 0, c?.govt ?? 0] : [c?.collected ?? 0, c?.balance ?? 0]; }), b.total.collected, b.total.balance]);
  bold(s2);
  const s3 = wb.addWorksheet("Outstanding Balances");
  s3.columns = ["Regd. No", "Name", "Branch", "Section", "Category", "Fee", "Student Pays", "Paid", "Balance", "Last Paid"].map((h) => ({ header: h }));
  for (const r of d.balances) s3.addRow([r.rollNumber, r.name, code(r.department), r.section, CATEGORY_GROUP[r.category], r.fee, r.payable, r.paid, r.balance, r.lastPaid ? dmy(r.lastPaid) : ""]);
  bold(s3);
  const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `Fees_Dashboard_${academicYear}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
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
            <Button key={v} size="sm" variant={view === v ? "default" : "outline"} onClick={() => setView(v)}>{v === "class" ? "By Academic Year" : "By Department"}</Button>
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
              {x.amount > 0 && <rect x={bx} y={top} width={bw} height={Math.max(1, H - B - top)} rx={Math.min(3, bw / 2)} fill="var(--primary)" opacity={hover == null || hover === i ? 1 : 0.45} />}
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
