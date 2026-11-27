"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { cn, dmy } from "@/lib/utils";
import { feeSend, rupee, selectClass, yearChoices, type FeeOptions } from "./feeApi";
import { readSheet } from "./scholarshipExcel";

// Accounts > Fees > Import Previous: fees the college already worked out in its previous accounting system.
// 1. Debit Notes - each student's fee for the year exactly as charged (category A / B / Spot, FR / NFR, government
//    part), for fees that differ by branch or student. 2. Receipts - payments already made, kept with their own
//    voucher numbers. Each file is checked first; nothing is saved until Import, and only when no row has a problem.
//    Rules: lib/fees/importPrevious.ts; routes api/college/fees/import/{debit-notes,receipts}.

const ROLL = ["Account Code", "Regd. No", "Regd No", "Roll No", "Hall Ticket No", "Student Registration No"];
const DN_COLUMNS = { roll: ROLL, category: ["CATEGORY", "Fee Category"], total: ["Debit Amount", "Total Fee", "TotalFee", "Fee"] };
const DN_OPTIONAL = {
  admissionType: ["Admission Type"], payment: ["Payment", "FR / NFR", "FR/NFR", "Funding"], tuition: ["TutionFee", "TuitionFee", "Tuition Fee", "Student Pays"],
  scholarship: ["FeeFromScholarship", "Scholarship Fee", "ScholarshipFee", "Government"], feeType: ["Fee Type"], voucherNo: ["Voucher No"], voucherDate: ["Voucher Date", "Voucher Dt"],
};
const RC_COLUMNS = { roll: ROLL, amount: ["Amount", "Amount Paid"], paidOn: ["Voucher Dt", "Voucher Date", "Date", "Paid On"], voucherNo: ["Voucher No", "Receipt No"] };
const RC_OPTIONAL = { mode: ["ChqOrDDOrChallan", "Mode", "Payment Mode"], bank: ["Bank Name", "Bank"], reference: ["ECapVoucherNo", "Reference", "UTR", "Transaction Ref"], feeType: ["Fee Type"] };

interface DnRow { row: number; roll: string; name: string; outcome: "NEW" | "UPDATED" | "KEPT" | "ERROR"; note?: string; category?: "A" | "B" | "SPOT"; funding?: "FR" | "NFR"; total?: number; studentShare?: number; department?: string }
interface RcRow { row: number; roll: string; name: string; receiptNo: string; amount?: number; paidOn?: string; outcome: "NEW" | "ALREADY" | "ERROR"; note?: string }

const TONE: Record<string, string> = { NEW: "text-emerald-700 dark:text-emerald-300", UPDATED: "text-blue-700 dark:text-blue-300", KEPT: "text-amber-700 dark:text-amber-300", ALREADY: "text-muted-foreground", ERROR: "text-destructive" };
const LABEL: Record<string, string> = { NEW: "New", UPDATED: "Replaces Fee", KEPT: "Kept (has payments)", ALREADY: "Already Imported", ERROR: "Problem" };
const catLabel = (r: DnRow) => (r.category === "A" ? `A · ${r.funding}` : r.category === "SPOT" ? "Spot" : r.category ?? "-");

export function FeeImportPrevious({ collegeId, options, academicYear, setAcademicYear }: { collegeId: string; options: FeeOptions; academicYear: string; setAcademicYear: (y: string) => void }) {
  const [dn, setDn] = useState<{ file: string; sent: Record<string, string | number>[]; rows: DnRow[]; saved?: number } | null>(null);
  const [rc, setRc] = useState<{ file: string; sent: Record<string, string | number>[]; rows: RcRow[]; saved?: number } | null>(null);
  const [busy, setBusy] = useState<null | "dn" | "rc">(null);

  async function load(kind: "dn" | "rc", f: File) {
    setBusy(kind);
    try {
      const r = kind === "dn" ? await readSheet(f, DN_COLUMNS, DN_OPTIONAL) : await readSheet(f, RC_COLUMNS, RC_OPTIONAL);
      if ("error" in r) { toast({ variant: "destructive", title: r.error }); return; }
      // Rows without a Regd. No (a REPORT TOTAL line, blank rows) are not students.
      const sent = r.rows.filter((x) => /^[A-Z0-9]{6,}$/i.test(x.roll.trim())).map(({ _row, ...x }) => ({ ...x, row: Number(_row) }));
      if (!sent.length) { toast({ variant: "destructive", title: "The file has no student rows." }); return; }
      const out = await feeSend<{ rows: (DnRow | RcRow)[] }>(`/api/college/fees/import/${kind === "dn" ? "debit-notes" : "receipts"}`, collegeId, "POST", { academicYear, rows: sent, apply: false });
      if (kind === "dn") setDn({ file: f.name, sent, rows: out.rows as DnRow[] }); else setRc({ file: f.name, sent, rows: out.rows as RcRow[] });
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    finally { setBusy(null); }
  }

  async function apply(kind: "dn" | "rc") {
    const cur = kind === "dn" ? dn : rc;
    if (!cur) return;
    setBusy(kind);
    try {
      const out = await feeSend<{ rows: (DnRow | RcRow)[]; saved: number }>(`/api/college/fees/import/${kind === "dn" ? "debit-notes" : "receipts"}`, collegeId, "POST", { academicYear, rows: cur.sent, apply: true });
      if (kind === "dn") setDn({ ...cur, rows: out.rows as DnRow[], saved: out.saved }); else setRc({ ...cur, rows: out.rows as RcRow[], saved: out.saved });
      toast({ variant: "success", title: kind === "dn" ? `Fees imported for ${out.saved} students.` : `${out.saved} receipts imported.` });
    } catch (e) { toast({ variant: "destructive", title: (e as Error).message }); }
    finally { setBusy(null); }
  }

  const pick = (kind: "dn" | "rc") => (
    <label className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted", busy && "pointer-events-none opacity-60")}>
      <Upload className="h-4 w-4" />{busy === kind ? "Checking..." : "Upload .xlsx"}
      <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void load(kind, f); }} />
    </label>
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import Previous Fees</CardTitle>
          <CardDescription>Fees and payments already worked out in the college&apos;s previous accounting system. Import the debit notes first, then the receipts. Each file is checked first; nothing is saved until you import, and only when no row has a problem. Students are not notified.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="w-36 space-y-1"><Label className="text-xs">Academic Year</Label>
            <select className={selectClass} value={academicYear} onChange={(e) => { setAcademicYear(e.target.value); setDn(null); setRc(null); }}>{yearChoices(options.academicYear).map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">1. Debit Notes (Fee Charged)</CardTitle>
            <CardDescription>One row per student: Account Code (Regd. No), CATEGORY (A / B), Admission Type (Spot), Payment (FR / NFR), Debit Amount, TutionFee (student&apos;s part), FeeFromScholarship (government&apos;s part), Fee Type (a fee head name). The fee is taken exactly as charged, with no due date until one is set. A fee that already has payments is never replaced.</CardDescription>
          </div>
          {pick("dn")}
        </CardHeader>
        {dn && (
          <CardContent className="space-y-3">
            <Summary file={dn.file} rows={dn.rows} saved={dn.saved} order={["NEW", "UPDATED", "KEPT", "ERROR"]} />
            <DnTotals rows={dn.rows} />
            <ResultTable heads={["Row", "Regd. No", "Name", "Category", "Fee", "Student Pays", "Result"]}
              rows={dn.rows.map((r) => ({ key: `${r.row}`, outcome: r.outcome, note: r.note, cells: [r.row, r.roll, r.name, catLabel(r), r.total != null ? rupee(r.total) : "-", r.studentShare != null ? rupee(r.studentShare) : "-"] }))} />
            {dn.saved === undefined && (
              <Button disabled={!!busy || dn.rows.some((r) => r.outcome === "ERROR") || !dn.rows.some((r) => r.outcome === "NEW" || r.outcome === "UPDATED")} loading={busy === "dn"} onClick={() => void apply("dn")}>
                Import Fees for {dn.rows.filter((r) => r.outcome === "NEW" || r.outcome === "UPDATED").length} Students
              </Button>
            )}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">2. Receipts (Payments Made)</CardTitle>
            <CardDescription>One row per receipt: Account Code (Regd. No), Voucher No, Voucher Dt, Amount, ChqOrDDOrChallan (mode), Bank Name, ECapVoucherNo (reference). Kept with their own voucher numbers; a receipt already imported is skipped, so the same file can be uploaded again with new rows.</CardDescription>
          </div>
          {pick("rc")}
        </CardHeader>
        {rc && (
          <CardContent className="space-y-3">
            <Summary file={rc.file} rows={rc.rows} saved={rc.saved} order={["NEW", "ALREADY", "ERROR"]} />
            <p className="text-sm">New receipts: <b className="tabular-nums">{rupee(rc.rows.filter((r) => r.outcome === "NEW").reduce((n, r) => n + (r.amount ?? 0), 0))}</b></p>
            <ResultTable heads={["Row", "Regd. No", "Name", "Receipt No", "Date", "Amount", "Result"]}
              rows={rc.rows.map((r) => ({ key: `${r.row}`, outcome: r.outcome, note: r.note, cells: [r.row, r.roll, r.name, r.receiptNo, r.paidOn ? dmy(r.paidOn) : "-", r.amount != null ? rupee(r.amount) : "-"] }))} />
            {rc.saved === undefined && (
              <Button disabled={!!busy || rc.rows.some((r) => r.outcome === "ERROR") || !rc.rows.some((r) => r.outcome === "NEW")} loading={busy === "rc"} onClick={() => void apply("rc")}>
                Import {rc.rows.filter((r) => r.outcome === "NEW").length} Receipts
              </Button>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function Summary({ file, rows, saved, order }: { file: string; rows: { outcome: string }[]; saved?: number; order: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">{file} · {rows.length} rows</span>
      {order.map((o) => <span key={o} className={cn("rounded-full border px-2.5 py-1", TONE[o])}><b>{rows.filter((r) => r.outcome === o).length}</b> {LABEL[o]}</span>)}
      {saved !== undefined && <span className="rounded-full border border-emerald-400 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">Saved {saved}</span>}
    </div>
  );
}

function DnTotals({ rows }: { rows: DnRow[] }) {
  const ok = rows.filter((r) => r.outcome !== "ERROR" && r.total != null);
  const groups = new Map<string, { n: number; fee: number; pays: number }>();
  for (const r of ok) {
    const g = groups.get(catLabel(r)) ?? { n: 0, fee: 0, pays: 0 };
    g.n++; g.fee += r.total ?? 0; g.pays += r.studentShare ?? 0; groups.set(catLabel(r), g);
  }
  if (!groups.size) return null;
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {[...groups.entries()].sort().map(([k, g]) => (
        <span key={k} className="rounded-md border px-2.5 py-1.5"><b>{k}</b>: {g.n} students · fee {rupee(g.fee)} · students pay {rupee(g.pays)}</span>
      ))}
    </div>
  );
}

function ResultTable({ heads, rows }: { heads: string[]; rows: { key: string; outcome: string; note?: string; cells: (string | number)[] }[] }) {
  const [all, setAll] = useState(false);
  // Problems and notes first, then the rest.
  const sorted = [...rows].sort((a, b) => Number(b.outcome === "ERROR") - Number(a.outcome === "ERROR") || Number(!!b.note) - Number(!!a.note));
  const shown = all ? sorted : sorted.slice(0, 100);
  return (
    <>
      <div className="max-h-[28rem] overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground"><tr>{heads.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y">
            {shown.map((r) => (
              <tr key={r.key}>
                {r.cells.map((c, i) => <td key={i} className="px-3 py-1.5 tabular-nums">{c}</td>)}
                <td className={cn("px-3 py-1.5 text-xs font-medium", TONE[r.outcome])}>{LABEL[r.outcome]}{r.note && <span className="block font-normal text-muted-foreground">{r.note}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 100 && <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>{all ? "Show First 100" : `Show All ${rows.length}`}</Button>}
    </>
  );
}
