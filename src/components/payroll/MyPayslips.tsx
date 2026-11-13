"use client";

import { useEffect, useState } from "react";
import { Download, FileText } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type { PayslipData } from "@/lib/payroll/payslip";
import { downloadPayslip } from "./payslipDownload";
import { monthLabel, payrollFetch, rupees, selectClass, thisMonth } from "./payrollClient";

// A faculty / staff member's own payslips (released months) and their income-tax statement for the year.

type Slip = { month: string; gross: number; totalDeductions: number; net: number; paidOn: string | null; notCredited: boolean; onHold: boolean };
const fyOf = (m: string) => { const y = Number(m.slice(0, 4)), mo = Number(m.slice(5)); const s = mo >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };

export function MyPayslips() {
  const [d, setD] = useState<{ employee: { name: string; employeeCode: string } | null; payslips: Slip[] } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [tax, setTax] = useState(false);
  useEffect(() => {
    payrollFetch<{ employee: { name: string; employeeCode: string } | null; payslips: Slip[] }>("/api/college/payroll/my").then(setD).catch((e: Error) => setError(e.message));
  }, []);

  async function download(month: string) {
    setBusy(month);
    try {
      const { payslip } = await payrollFetch<{ payslip: PayslipData }>(`/api/college/payroll/my/${month}`);
      await downloadPayslip(payslip);
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to download" }); }
    finally { setBusy(""); }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="My Payslips" description="Your salary for each month once released by Accounts, and your income tax for the year." />
      {error ? <p className="text-sm text-destructive">{error}</p> : !d ? <div className="h-40 animate-pulse rounded-2xl bg-muted/40" /> : !d.employee ? (
        <p className="text-sm text-muted-foreground">Your login is not linked to a faculty or staff record, so there are no payslips to show. Contact the College Office.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">{d.employee.name} · {d.employee.employeeCode}</p>
            <span className="flex-1" />
            <Button variant="outline" onClick={() => setTax(true)}><FileText className="mr-1.5 h-4 w-4" />Income tax statement</Button>
          </div>
          {d.payslips.length === 0 ? <p className="text-sm text-muted-foreground">No released months yet.</p> : (
            <Card className="rounded-2xl"><CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-3 py-2">Month</th><th className="px-3 py-2 text-right">Gross</th><th className="px-3 py-2 text-right">Deductions</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2">Paid on</th><th className="px-3 py-2" /></tr>
                </thead>
                <tbody>{d.payslips.map((p) => (
                  <tr key={p.month} className="border-t">
                    <td className="px-3 py-2 font-medium">{monthLabel(p.month)}{p.notCredited && <div className="text-xs text-muted-foreground">not credited</div>}{p.onHold && <div className="text-xs text-amber-700 dark:text-amber-300">on hold</div>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{rupees(p.gross)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{rupees(p.totalDeductions)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{rupees(p.net)}</td>
                    <td className="px-3 py-2">{p.paidOn ?? "-"}</td>
                    <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" disabled={busy === p.month} onClick={() => download(p.month)}><Download className="mr-1 h-3.5 w-3.5" />{busy === p.month ? "Preparing..." : "Payslip"}</Button></td>
                  </tr>
                ))}</tbody>
              </table>
            </CardContent></Card>
          )}
        </>
      )}
      {tax && <MyTaxStatement onClose={() => setTax(false)} />}
    </div>
  );
}

type Statement = {
  fy: string; month: string; rulesConfirmed: boolean; profile: { regime: "NEW" | "OLD"; opening?: { upToMonth: string; gross: number; tds: number } };
  estimate: null | { tdsNow: number; otherRegimeTax: number | null; calc: { annualTax: number; deductedBefore: number; monthsLeft: number }; breakdown: null | { salary: number; hraExemption: number; standardDeduction: number; ptDeduction: number; otherIncome: number; houseLoss: number; chapterVIA: number; taxableIncome: number; tax: { slabTax: number; rebate: number; surcharge: number; cess: number; total: number } } };
  released: { month: string; gross: number; tds: number; beforeOpening: boolean }[];
  projectedMonths: string[];
};

function Row({ k, v, strong }: { k: string; v: number; strong?: boolean }) {
  return <div className={`flex justify-between ${strong ? "border-t pt-1 font-semibold" : ""}`}><span className="text-muted-foreground">{k}</span><span className="tabular-nums">{rupees(Math.round(v))}</span></div>;
}

function MyTaxStatement({ onClose }: { onClose: () => void }) {
  const now = fyOf(thisMonth());
  const [fy, setFy] = useState(now);
  const [s, setS] = useState<Statement | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let off = false;
    payrollFetch<Statement>(`/api/college/payroll/my/tax?fy=${fy}`).then((x) => { if (!off) { setS(x); setError(""); } }).catch((e: Error) => { if (!off) setError(e.message); });
    return () => { off = true; };
  }, [fy]);
  const b = s?.estimate?.breakdown;
  const prev = fyOf(`${Number(now.slice(0, 4)) - 1}-06`);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Income tax statement</DialogTitle>
          <DialogDescription>Calculated by Accounts from your salary and your declarations on record. Projected months assume your current pay.</DialogDescription>
        </DialogHeader>
        <select aria-label="Financial year" className={`${selectClass} w-40`} value={fy} onChange={(e) => { setS(null); setFy(e.target.value); }}>
          {[now, prev].map((f) => <option key={f} value={f}>FY {f}</option>)}
        </select>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {s && !s.rulesConfirmed && <p className="text-sm text-muted-foreground">Tax for FY {s.fy} isn&apos;t worked out yet.</p>}
        {s && b && s.estimate && (
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div className="space-y-1">
              <p className="font-medium">{s.profile.regime === "NEW" ? "New" : "Old"} regime · as of {monthLabel(s.month)}</p>
              <Row k="Salary for the year" v={b.salary} />
              {b.hraExemption > 0 && <Row k="Less HRA exemption" v={b.hraExemption} />}
              <Row k="Less standard deduction" v={b.standardDeduction} />
              {b.ptDeduction > 0 && <Row k="Less professional tax" v={b.ptDeduction} />}
              {b.otherIncome > 0 && <Row k="Add other income" v={b.otherIncome} />}
              {b.houseLoss > 0 && <Row k="Less housing loan interest" v={b.houseLoss} />}
              {b.chapterVIA > 0 && <Row k="Less Chapter VI-A" v={b.chapterVIA} />}
              <Row k="Taxable income" v={b.taxableIncome} strong />
            </div>
            <div className="space-y-1">
              <Row k="Tax on slabs" v={b.tax.slabTax} />
              {b.tax.rebate > 0 && <Row k="Less rebate 87A" v={b.tax.rebate} />}
              {b.tax.surcharge > 0 && <Row k="Surcharge" v={b.tax.surcharge} />}
              <Row k="Cess" v={b.tax.cess} />
              <Row k="Tax for the year" v={b.tax.total} strong />
              <Row k="Deducted so far" v={s.estimate.calc.deductedBefore} />
              <Row k={`This month (${s.estimate.calc.monthsLeft} month(s) left)`} v={s.estimate.tdsNow} strong />
            </div>
          </div>
        )}
        {s && (s.released.length > 0 || s.profile.opening) && (
          <ul className="space-y-0.5 border-t pt-3 text-xs">
            {s.profile.opening && <li>Apr - {monthLabel(s.profile.opening.upToMonth)}: gross ₹{rupees(s.profile.opening.gross)}, TDS ₹{rupees(s.profile.opening.tds)}</li>}
            {s.released.filter((m) => !m.beforeOpening).map((m) => <li key={m.month}>{monthLabel(m.month)}: gross ₹{rupees(m.gross)}, TDS ₹{rupees(m.tds)}</li>)}
          </ul>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
