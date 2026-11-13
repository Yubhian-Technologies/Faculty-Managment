"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ClipboardList } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { toast } from "@/hooks/useToast";
import { cn, toDate } from "@/lib/utils";
import type { CertificateRequest, CertificateSectionOverviewRow } from "@/types";
import { getDepartmentOverview } from "./api";
import { StatusBadge } from "./StatusBadge";
import { StepTimeline } from "./StepTimeline";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

const when = (ts: unknown) => {
  const d = toDate(ts as never);
  return d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
};

const OPEN = ["IN_PROGRESS", "PENDING_ISSUANCE", "RETURNED"];

/** Where a request stands right now, in one line ("Waiting: Principal approval"). */
export function currentStage(r: CertificateRequest): string {
  if (r.status === "ISSUED") return `Issued${r.certificateNumber ? ` · ${r.certificateNumber}` : ""}`;
  if (r.status === "REJECTED") return "Rejected";
  if (r.status === "PENDING_ISSUANCE") return "Approved - waiting to be issued";
  if (r.status === "RETURNED") return "Sent back to the student for a correction";
  const step = r.flow[r.currentStepIndex];
  if (!step) return "";
  if (step.type === "PARALLEL") {
    const st = r.steps[r.currentStepIndex];
    const pending = st?.type === "PARALLEL" ? st.branches.filter((b) => b.status === "PENDING").map((b) => b.branchLabel) : step.branches.map((b) => b.label);
    return `Waiting: ${pending.join(", ")}`;
  }
  return `Waiting: ${step.label}`;
}

function RequestRow({ request }: { request: CertificateRequest }) {
  const [open, setOpen] = useState(false);
  const total = request.flow.length;
  const done = request.status === "ISSUED" || request.status === "PENDING_ISSUANCE" ? total : request.currentStepIndex;
  return (
    <li className="border-b last:border-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 py-3 text-left">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{request.studentName} · <span className="text-muted-foreground">{request.studentRollNumber}</span></p>
          <p className="text-xs text-muted-foreground">{request.certificateTypeLabel} · {request.studentSection} · applied {when(request.createdAt)}</p>
          <p className="mt-1 text-xs font-medium text-foreground">{currentStage(request)}</p>
          {/* Steps done out of the flow, as a thin bar */}
          <div className="mt-1.5 flex max-w-xs gap-1" aria-label={`${done} of ${total} approvals done`}>
            {request.flow.map((s, i) => (
              <span key={s.id} className={cn("h-1.5 flex-1 rounded-full", i < done ? "bg-emerald-500" : i === request.currentStepIndex && OPEN.includes(request.status) ? "bg-amber-400" : "bg-muted")} />
            ))}
          </div>
        </div>
        <StatusBadge status={request.status} />
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="pb-4 pl-1"><StepTimeline request={request} /></div>}
    </li>
  );
}

// Every certificate request filed by a student in the HOD's own department: per section counts, and each
// request with where it stands now and every approval so far - distinct from the Inbox below it (which only
// shows what's waiting on THIS HOD's own decision right now).
export function DepartmentOverview() {
  const [rows, setRows] = useState<CertificateSectionOverviewRow[]>([]);
  const [requests, setRequests] = useState<CertificateRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<string | null>(null);
  const [tab, setTab] = useState("open");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getDepartmentOverview();
      setRows(data.rows);
      setRequests(data.requests ?? []);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to load the department overview" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const keyOf = (r: { department?: string; studentDepartment?: string; year?: number; studentYear?: number; section?: string; studentSection?: string }) =>
    `${r.department ?? r.studentDepartment}|${r.year ?? r.studentYear}|${r.section ?? r.studentSection}`;
  const shown = useMemo(() => requests.filter((r) =>
    (tab === "open" ? OPEN.includes(r.status) : tab === "issued" ? r.status === "ISSUED" : r.status === "REJECTED")
    && (!section || keyOf(r) === section)), [requests, tab, section]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<ClipboardList className="h-6 w-6" />}
          title="No certificate requests yet"
          description="Once students in your department request a certificate, their section-wise status will show up here."
        />
      </Card>
    );
  }

  const totalInProgress = rows.reduce((sum, r) => sum + r.inProgress, 0);
  const totalCompleted = rows.reduce((sum, r) => sum + r.completed, 0);
  const sectionLabel = section ? rows.find((r) => keyOf(r) === section) : undefined;

  return (
    <Card>
      <CardContent className="p-4 sm:p-5 space-y-5">
        <div>
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h3 className="text-sm font-semibold">Certificate Requests by Section</h3>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span><span className="font-semibold text-amber-600">{totalInProgress}</span> in progress</span>
              <span><span className="font-semibold text-emerald-600">{totalCompleted}</span> completed</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Year</th>
                  <th className="py-2 pr-4 font-medium">Section</th>
                  <th className="py-2 pr-4 font-medium text-right">In Progress</th>
                  <th className="py-2 font-medium text-right">Completed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const k = keyOf(r);
                  return (
                    <tr key={k} onClick={() => setSection(section === k ? null : k)}
                      className={cn("border-b last:border-0 cursor-pointer hover:bg-muted/50", section === k && "bg-muted")}>
                      <td className="py-2.5 pr-4">{ordinalYear(r.year)}</td>
                      <td className="py-2.5 pr-4">{r.section || "Unassigned"}</td>
                      <td className="py-2.5 pr-4 text-right font-medium text-amber-600">{r.inProgress}</td>
                      <td className="py-2.5 text-right font-medium text-emerald-600">{r.completed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedTabs value={tab} onChange={setTab} options={[{ key: "open", label: "In progress" }, { key: "issued", label: "Issued" }, { key: "rejected", label: "Rejected" }]} />
            {sectionLabel && (
              <button type="button" onClick={() => setSection(null)} className="text-xs text-primary underline">
                {ordinalYear(sectionLabel.year)} {sectionLabel.section} - show all sections
              </button>
            )}
          </div>
          {shown.length === 0
            ? <p className="py-3 text-sm text-muted-foreground">No requests here.</p>
            : <ul>{shown.map((r) => <RequestRow key={r.id} request={r} />)}</ul>}
        </div>
      </CardContent>
    </Card>
  );
}
