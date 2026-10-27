"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OnDutyDetail } from "@/lib/studentPermissions/onDutyDetail";

// Read-only "why is this student On Duty" popup. Opening it only fetches; it never touches the attendance mark.

const tag = "inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800 hover:bg-blue-100";

export function OnDutyTag({ studentId, studentName, date, periodNumber }: { studentId: string; studentName: string; date: string; periodNumber?: number }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<OnDutyDetail[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setDetails(null); setError(false);
    const qs = new URLSearchParams({ studentId, date, ...(periodNumber ? { periodNumber: String(periodNumber) } : {}) });
    fetch(`/api/college/student-attendance/on-duty-detail?${qs}`)
      .then(async (r) => { if (!r.ok) throw new Error(); return (await r.json()) as { details: OnDutyDetail[] }; })
      .then((j) => { if (live) setDetails(j.details); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [open, studentId, date, periodNumber]);

  return (
    <>
      <button type="button" className={tag} title="Approved permission - locked. Click for details" onClick={() => setOpen(true)}>On Duty</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>On Duty - {studentName}</DialogTitle>
            <DialogDescription>This mark comes from an approved permission and can&apos;t be changed here.</DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">Couldn&apos;t load the permission details. Try again.</p>}
          {!error && !details && <p className="text-sm text-muted-foreground">Loading…</p>}
          {details?.length === 0 && <p className="text-sm text-muted-foreground">No permission details are available for this period.</p>}
          {details?.map((d, i) => (
            <dl key={i} className="space-y-2 rounded-md border p-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Permission</dt><dd className="font-medium">{d.title ?? "Details unavailable"}{d.category && d.category !== d.title ? ` (${d.category})` : ""}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Permission granted by</dt><dd className="font-medium">{d.grantedBy ? `${d.grantedBy.name}${d.grantedBy.role ? ` (${d.grantedBy.role})` : ""}` : "Not available"}</dd></div>
              {d.fromDate && <div><dt className="text-xs text-muted-foreground">Dates</dt><dd>{d.fromDate === d.toDate ? d.fromDate : `${d.fromDate} to ${d.toDate}`}</dd></div>}
            </dl>
          ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
