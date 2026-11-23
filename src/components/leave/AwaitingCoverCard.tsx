"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, dmy } from "@/lib/utils";
import { LEAVE_TYPE_LABELS, type LeaveTypeCode } from "@/types/leave";
import { Hourglass } from "lucide-react";

// HOD > Leave Approvals: the department's leaves still waiting on substitutes / handovers to accept. They reach the
// approval queue only once everyone has accepted, so this shows whose answer is holding each one up. Read only.

interface CoverLine { kind: string; assigneeName: string; status: string; periods: number; dates: string[] }
interface AwaitingRow {
  id: string; employeeName: string; department: string; leaveTypeCode: string;
  fromDate: string | null; toDate: string | null; totalDays?: number; cover: CoverLine[];
}

const STATUS_LABEL: Record<string, string> = { PENDING: "Waiting", ACCEPTED: "Accepted", DECLINED: "Declined", REJECTED: "Declined" };

export function AwaitingCoverCard() {
  const [rows, setRows] = useState<AwaitingRow[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/leave/applications?scope=awaiting-cover")
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d) => { if (live) setRows(d.requests ?? []); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, []);

  if (!rows || rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Hourglass className="h-4 w-4 text-amber-600" />
          <h3 className="font-semibold">Waiting for Substitutes ({rows.length})</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          These leaves come to you for approval once every substitute has accepted.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => {
          const from = formatDate(r.fromDate);
          const to = formatDate(r.toDate);
          const waiting = r.cover.filter((c) => c.status === "PENDING").length;
          return (
            <div key={r.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="font-medium">{r.employeeName}</span>
                  <span className="text-sm text-muted-foreground"> · {r.department}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {LEAVE_TYPE_LABELS[r.leaveTypeCode as LeaveTypeCode] ?? r.leaveTypeCode} · {from === to ? from : `${from} to ${to}`}
                  {r.totalDays ? ` · ${r.totalDays} day${r.totalDays === 1 ? "" : "s"}` : ""}
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{waiting} of {r.cover.length} still to answer</div>
              <ul className="mt-2 space-y-1">
                {r.cover.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={c.status === "PENDING" ? "outline" : c.status === "ACCEPTED" ? "secondary" : "destructive"}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </Badge>
                    <span>{c.assigneeName || "Not named"}</span>
                    <span className="text-muted-foreground">
                      {c.kind}{c.periods ? ` · ${c.periods} period${c.periods === 1 ? "" : "s"}` : ""}
                      {c.dates.length ? ` · ${c.dates.map(dmy).join(", ")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
