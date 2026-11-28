"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { feeGet, selectClass, type FeeOptions } from "./feeApi";
import { FeeCollect } from "./FeeCollect";
import { FeeDashboard } from "./FeeDashboard";
import { FeeDues } from "./FeeDues";
import { FeeDayBook } from "./FeeDayBook";
import { FeeStructures } from "./FeeStructures";
import { FeeSetup } from "./FeeSetup";
import { RaiseFees } from "./RaiseFees";
import { FeeImportPrevious } from "./FeeImportPrevious";

// Accounts (location) > Fees: student fee collection for each college of the location - fee structures, raising a
// class's fees, counter collection with receipts, concessions, dues and the day book (lib/fees, types/fees.ts).

const TABS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "collect", label: "Search by Student" },
  { key: "dues", label: "Dues" },
  { key: "daybook", label: "Day-wise Collection" },
  { key: "structures", label: "Fee Structures" },
  { key: "setup", label: "Setup" },
  { key: "raise", label: "Raise Fees" },
  { key: "import", label: "Import Previous" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export function AccountsFees() {
  const [colleges, setColleges] = useState<{ id: string; name: string }[] | null>(null);
  const [collegeId, setCollegeId] = useState("");
  const [options, setOptions] = useState<FeeOptions | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [academicYear, setAcademicYear] = useState("");

  useEffect(() => {
    fetch("/api/college/payments/colleges").then((r) => r.json() as Promise<{ colleges?: { id: string; name: string }[] }>)
      .then((d) => { const list = d.colleges ?? []; setColleges(list); if (list.length === 1) setCollegeId(list[0].id); }).catch(() => setColleges([]));
  }, []);

  useEffect(() => {
    if (!collegeId) return;
    let live = true;
    feeGet<FeeOptions>("/api/college/fees/options", collegeId)
      .then((d) => { if (live) { setOptions(d); setAcademicYear(d.academicYear); setError(""); } })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [collegeId]);

  const ready = collegeId && options && options.academicYear;
  return (
    <div className="space-y-6">
      <PageHeader title="College Fees" description="Overview of fees" />
      <div className="max-w-md space-y-1.5">
        <Label htmlFor="fee-college">Select Institute</Label>
        <select id="fee-college" className={selectClass} value={collegeId} onChange={(e) => { setOptions(null); setCollegeId(e.target.value); }}>
          <option value="">{colleges === null ? "Loading..." : colleges.length ? "Select a college" : "No colleges in your location"}</option>
          {(colleges ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {collegeId && !options && !error && <div className="h-24 animate-pulse rounded-lg bg-muted" />}
      {ready && (
        <>
          <div className="flex flex-wrap gap-1 border-b">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors", tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t.label}
              </button>
            ))}
          </div>
          {tab === "dashboard" && <FeeDashboard key={`h-${collegeId}`} collegeId={collegeId} options={options} academicYear={academicYear} setAcademicYear={setAcademicYear} />}
          {tab === "collect" &&<FeeCollect key={`c-${collegeId}`} collegeId={collegeId} options={options} academicYear={academicYear} setAcademicYear={setAcademicYear} />}
          {tab === "dues" && <FeeDues key={`d-${collegeId}`} collegeId={collegeId} options={options} academicYear={academicYear} setAcademicYear={setAcademicYear} />}
          {tab === "daybook" && <FeeDayBook key={`b-${collegeId}`} collegeId={collegeId} today={options.today} />}
          {tab === "structures" && <FeeStructures key={`s-${collegeId}`} collegeId={collegeId} options={options} academicYear={academicYear} setAcademicYear={setAcademicYear} />}
          {tab === "setup" && <FeeSetup key={`u-${collegeId}`} collegeId={collegeId} />}
          {tab === "import" && <FeeImportPrevious key={`i-${collegeId}`} collegeId={collegeId} options={options} academicYear={academicYear} setAcademicYear={setAcademicYear} />}
          {tab === "raise" && <RaiseFees key={`r-${collegeId}`} collegeId={collegeId} options={options} academicYear={academicYear} setAcademicYear={setAcademicYear} />}
        </>
      )}
    </div>
  );
}
