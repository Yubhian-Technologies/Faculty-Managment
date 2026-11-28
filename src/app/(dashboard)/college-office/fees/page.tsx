"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { FeeCollect } from "@/components/fees/FeeCollect";
import { feeGet, type FeeOptions } from "@/components/fees/feeApi";

// College Office > Fees: take students' fees at the counter for this college - the same Collect screen Accounts use
// (CCAvenue QR, cash, cheque, DD, bank transfer; receipt printed). The college is the Office's own (no ?collegeId:
// the server uses the session's - requireFeesCollector). Cancelling a receipt and the Day Book stay with Accounts.
export default function CollegeOfficeFeesPage() {
  const [options, setOptions] = useState<FeeOptions | null>(null);
  const [error, setError] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  useEffect(() => {
    feeGet<FeeOptions>("/api/college/fees/options", "")
      .then((d) => { setOptions(d); setAcademicYear(d.academicYear); })
      .catch((e: Error) => setError(e.message));
  }, []);
  return (
    <div className="space-y-6">
      <PageHeader title="Fees" description="Take students' fees at the counter: online through CCAvenue (the student scans a QR and pays by UPI, card or net banking) or cash, cheque, DD and bank transfer. The receipt prints at once." />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!options && !error && <div className="h-24 animate-pulse rounded-lg bg-muted" />}
      {options && academicYear && <FeeCollect collegeId="" options={options} academicYear={academicYear} setAcademicYear={setAcademicYear} />}
    </div>
  );
}
