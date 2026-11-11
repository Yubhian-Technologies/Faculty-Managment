"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PayStructures } from "./PayStructures";
import { PayRules } from "./PayRules";
import { MonthlyRuns } from "./MonthlyRuns";
import { SalaryAdvances } from "./SalaryAdvances";
import { IncomeTax } from "./IncomeTax";
import { selectClass } from "./payrollClient";

// Payroll home. Accounts (location) pick a college: monthly salaries (review, approve, release), pay
// structures and rules. The College Office prepares and submits its own college's months and reads pay
// structures / rules. The Principal / VP read the months only (`viewOnly`).

const TABS = [{ id: "runs", label: "Monthly salaries" }, { id: "pay", label: "Pay structures" }, { id: "advances", label: "Salary advances" }, { id: "tax", label: "Income tax" }, { id: "rules", label: "Pay parts & rules" }] as const;
type Tab = (typeof TABS)[number]["id"];

export function PayrollHome({ pickCollege, viewOnly = false }: { pickCollege: boolean; viewOnly?: boolean }) {
  const [colleges, setColleges] = useState<{ id: string; name: string }[] | null>(null);
  const [collegeId, setCollegeId] = useState("");
  const [tab, setTab] = useState<Tab>("runs");
  useEffect(() => {
    if (!pickCollege) return;
    fetch("/api/college/payments/colleges").then((r) => r.json() as Promise<{ colleges?: { id: string; name: string }[] }>)
      .then((d) => { const list = d.colleges ?? []; setColleges(list); if (list.length === 1) setCollegeId(list[0].id); }).catch(() => setColleges([]));
  }, [pickCollege]);
  const ready = !pickCollege || !!collegeId;

  return (
    <div className="max-w-7xl space-y-6">
      <PageHeader title="Payroll" description={viewOnly ? "Monthly salaries of the college, as prepared by the College Office and released by Accounts." : pickCollege ? "Monthly salaries, pay structures and salary rules of each college in your location." : "Prepare each month's salaries for Accounts. Pay structures and rules are set by Accounts."} />
      {pickCollege && (
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="pr-college">College</Label>
          <select id="pr-college" className={`${selectClass} w-full`} value={collegeId} onChange={(e) => setCollegeId(e.target.value)}>
            <option value="">{colleges === null ? "Loading..." : colleges.length ? "Select a college" : "No colleges in your location"}</option>
            {(colleges ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      {ready && viewOnly && <MonthlyRuns />}
      {ready && !viewOnly && (
        <>
          <div role="tablist" className="flex flex-wrap gap-2 border-b">
            {TABS.filter((t) => t.id !== "tax" || pickCollege).map((t) => (
              <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{t.label}</button>
            ))}
          </div>
          {tab === "runs" ? <MonthlyRuns key={`m-${collegeId}`} collegeId={collegeId || undefined} />
            : tab === "pay" ? <PayStructures key={`p-${collegeId}`} collegeId={collegeId || undefined} />
            : tab === "advances" ? <SalaryAdvances key={`a-${collegeId}`} collegeId={collegeId || undefined} />
            : tab === "tax" ? <IncomeTax key={`t-${collegeId}`} collegeId={collegeId || undefined} />
            : <PayRules key={`r-${collegeId}`} collegeId={collegeId || undefined} />}
        </>
      )}
    </div>
  );
}
