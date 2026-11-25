"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { cn, dmy, exportToCSV } from "@/lib/utils";
import type { FeeReceipt } from "@/types/fees";
import { feeGet, rupee } from "./feeApi";

// Accounts > Fees > Day Book: every fee receipt by the date paid - totals per college bank account (each fee head's
// account) and by mode (cash / UPI / bank ...) for the cash book and bank reconciliation; cancelled receipts listed
// but not counted. CSV.

const MODE: Record<string, string> = { CASH: "Cash", UPI: "UPI", BANK: "Bank Transfer", DD: "Demand Draft", CHEQUE: "Cheque", ONLINE: "Online" };

export function FeeDayBook({ collegeId, today }: { collegeId: string; today: string }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<FeeReceipt[] | null>(null);

  useEffect(() => {
    if (!from || !to || from > to) return;
    let live = true;
    feeGet<{ receipts: FeeReceipt[] }>(`/api/college/fees/receipts?from=${from}&to=${to}`, collegeId)
      .then((d) => { if (live) setRows(d.receipts); })
      .catch((e: Error) => { if (live) toast({ variant: "destructive", title: e.message }); });
    return () => { live = false; };
  }, [collegeId, from, to]);

  const live = (rows ?? []).filter((r) => !r.cancelled);
  const byAccount = [...live.flatMap((r) => r.allocation).reduce((m, x) => m.set(x.bankAccountName || "Not set", (m.get(x.bankAccountName || "Not set") ?? 0) + x.amount), new Map<string, number>())];
  const byMode = Object.entries(live.reduce<Record<string, number>>((m, r) => ({ ...m, [r.mode]: (m[r.mode] ?? 0) + r.amount }), {}));
  const csv = () => exportToCSV((rows ?? []).map((r) => ({ ...r, mode: MODE[r.mode] ?? r.mode, accounts: r.allocation.map((x) => `${x.headName} ${x.amount} -> ${x.bankAccountName || "Not set"}`).join("; "), status: r.cancelled ? `Cancelled: ${r.cancelled.reason}` : "" })), `Fee_Day_Book_${from}_${to}`, [
    { key: "paidOn", header: "Date" }, { key: "receiptNo", header: "Receipt No" }, { key: "rollNumber", header: "Regd. No" }, { key: "name", header: "Name" },
    { key: "department", header: "Department" }, { key: "academicYear", header: "Academic Year" }, { key: "amount", header: "Amount" }, { key: "accounts", header: "Credited To" }, { key: "mode", header: "Mode" },
    { key: "reference", header: "Reference" }, { key: "bank", header: "Bank" }, { key: "byName", header: "Received By" }, { key: "status", header: "Status" },
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40 space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-40 space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button variant="outline" className="ml-auto" disabled={!rows?.length} onClick={csv}><Download className="mr-1 h-4 w-4" />CSV</Button>
      </div>
      {rows === null ? <div className="h-32 animate-pulse rounded-lg bg-muted" /> : (
        <>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-lg border px-3 py-2 text-sm"><span className="text-muted-foreground">Total</span> <b className="tabular-nums">{rupee(live.reduce((n, r) => n + r.amount, 0))}</b> <span className="text-xs text-muted-foreground">({live.length} receipts)</span></span>
            {byMode.map(([m, v]) => <span key={m} className="rounded-lg border px-3 py-2 text-sm"><span className="text-muted-foreground">{MODE[m] ?? m}</span> <b className="tabular-nums">{rupee(v)}</b></span>)}
          </div>
          {byAccount.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {byAccount.map(([a, v]) => <span key={a} className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm"><span className="text-muted-foreground">{a}</span> <b className="tabular-nums">{rupee(v)}</b></span>)}
            </div>
          )}
          <Card><CardContent className="max-h-[32rem] overflow-auto p-0">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground"><tr>{["Date", "Receipt No", "Student", "Amount", "Accounts", "Mode", "Reference", "Received By"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y">{rows.map((r) => (
                <tr key={r.id} className={cn(r.cancelled && "text-muted-foreground line-through")}>
                  <td className="px-3 py-1.5">{dmy(r.paidOn)}</td>
                  <td className="px-3 py-1.5 font-medium">{r.receiptNo}</td>
                  <td className="px-3 py-1.5"><span className="tabular-nums">{r.rollNumber}</span> {r.name}</td>
                  <td className="px-3 py-1.5 tabular-nums">{rupee(r.amount)}</td>
                  <td className="px-3 py-1.5 text-xs">{[...r.allocation.reduce((m, x) => m.set(x.bankAccountName || "Not set", (m.get(x.bankAccountName || "Not set") ?? 0) + x.amount), new Map<string, number>())].map(([a, v]) => `${a} ${rupee(v)}`).join(" · ")}</td>
                  <td className="px-3 py-1.5">{MODE[r.mode] ?? r.mode}</td>
                  <td className="px-3 py-1.5 text-xs">{r.reference || "-"}</td>
                  <td className="px-3 py-1.5 text-xs">{r.byName}</td>
                </tr>
              ))}</tbody>
            </table>
            {rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No receipts on these dates.</p>}
          </CardContent></Card>
        </>
      )}
    </div>
  );
}
