"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { cn, dmy } from "@/lib/utils";
import { printStudentFeeReceipt, type StudentFeeReceiptData } from "@/lib/pdf/studentFeeReceiptTemplate";
import type { InstalmentState } from "@/lib/fees/rules";

// Student > Fees: my fee for each academic year - by fee head, the part the government pays the college (FR -
// fee reimbursement), concessions, what I pay, instalments with due dates (paid / due / overdue + late fine) - and my receipts to print.

interface Account {
  id: string; academicYear: string; courseName: string; batch: string; category: "A" | "B" | "SPOT"; funding: "FR" | "NFR";
  heads: { headId: string; name: string; amount: number; govt: number; concession: number; student: number }[]; gross: number;
  concessions: { amount: number; reason: string; headName: string | null }[]; concessionTotal: number; govtShare: number;
  studentShare: number; paid: number; balance: number; status: string; instalments: InstalmentState[];
}
type Receipt = StudentFeeReceiptData["receipt"] & { id: string; source: string; cancelled: boolean };
const rupee = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export default function StudentFeesPage() {
  const [d, setD] = useState<{ accounts: Account[]; receipts: Receipt[]; college: StudentFeeReceiptData["college"] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/college/student/me/fees")
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Unable to load your fees."); setD(j); })
      .catch((e: Error) => setError(e.message));
  }, []);
  const print = (r: Receipt) => d && printStudentFeeReceipt({ receipt: r, college: d.college }).catch((e: Error) => toast({ variant: "destructive", title: e.message }));

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Fees" description="Your fee for each academic year, the due dates and your receipts. Pay at the college accounts counter; keep the receipt." />
      {error ? <p className="text-sm text-destructive">{error}</p> : !d ? <div className="h-40 animate-pulse rounded-2xl bg-muted/40" /> : d.accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No fees are listed for you yet.</p>
      ) : d.accounts.map((a) => {
        const fine = a.instalments.reduce((n, x) => n + x.fine, 0);
        return (
          <Card key={a.id} className="rounded-2xl"><CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">{a.academicYear} <span className="text-sm font-normal text-muted-foreground">· {a.courseName} · Batch {a.batch}</span></p>
              <p className="text-sm">{a.balance > 0 ? <>Balance <span className="text-lg font-semibold tabular-nums">{rupee(a.balance)}</span>{fine ? <span className="text-destructive"> + late fine {rupee(fine)}</span> : null}</> : <span className="font-semibold text-emerald-700 dark:text-emerald-300">Fully paid</span>}</p>
            </div>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="space-y-1 rounded-lg border p-3">
                {a.heads.map((l) => <p key={l.headId} className="flex justify-between"><span>{l.name}</span><span className="tabular-nums">{rupee(l.amount)}</span></p>)}
                <p className="flex justify-between border-t pt-1 font-medium"><span>Fee</span><span className="tabular-nums">{rupee(a.gross)}</span></p>
                {a.govtShare > 0 && <p className="flex justify-between text-muted-foreground"><span>Paid by the government (FR)</span><span className="tabular-nums">− {rupee(a.govtShare)}</span></p>}
                {a.concessions.map((c, i) => <p key={i} className="flex justify-between text-muted-foreground"><span>Concession{c.headName ? ` (${c.headName})` : ""}</span><span className="tabular-nums">− {rupee(c.amount)}</span></p>)}
                <p className="flex justify-between border-t pt-1 font-semibold"><span>You Pay</span><span className="tabular-nums">{rupee(a.studentShare)}</span></p>
                <p className="flex justify-between text-emerald-700 dark:text-emerald-300"><span>Paid</span><span className="tabular-nums">{rupee(a.paid)}</span></p>
              </div>
              <div className="space-y-2">
                {a.category === "A" && (
                  <div className="rounded-lg border p-3 text-xs">
                    <p className="font-medium">{a.funding === "FR" ? "Fee reimbursement (FR)" : "Not under fee reimbursement (NFR)"}</p>
                    <p className="text-muted-foreground">{a.funding === "FR" ? "The government pays part of your fee to the college; you pay the rest shown here." : "You pay the full fee. The Scholarship Cell updates this if you come under fee reimbursement."}</p>
                  </div>
                )}
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1">Instalment</th><th className="py-1">Due By</th><th className="py-1 text-right">Due</th></tr></thead>
                  <tbody className="divide-y">{a.instalments.map((x) => (
                    <tr key={x.no}>
                      <td className="py-1.5">{x.label} <span className="text-xs text-muted-foreground">{rupee(x.amount)}</span></td>
                      <td className={cn("py-1.5", x.overdue && "font-medium text-destructive")}>{dmy(x.dueDate)}{x.overdue && <span className="block text-[11px]">Overdue{x.fine ? ` · fine ${rupee(x.fine)}` : ""}</span>}</td>
                      <td className="py-1.5 text-right tabular-nums">{x.due ? rupee(x.due) : <span className="text-emerald-700 dark:text-emerald-300">Paid</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          </CardContent></Card>
        );
      })}
      {d && d.receipts.length > 0 && (
        <Card className="rounded-2xl"><CardContent className="space-y-2 p-5">
          <p className="font-semibold">Receipts</p>
          <ul className="divide-y">{d.receipts.map((r) => (
            <li key={r.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-2 text-sm", r.cancelled && "opacity-60")}>
              <span><span className="font-medium">{r.receiptNo}</span> · {rupee(r.amount)} · {dmy(r.paidOn)} · {r.academicYear}{r.cancelled ? " · cancelled" : ""}</span>
              <Button size="sm" variant="ghost" onClick={() => void print(r)}><Printer className="mr-1 h-4 w-4" />Print</Button>
            </li>
          ))}</ul>
        </CardContent></Card>
      )}
    </div>
  );
}
