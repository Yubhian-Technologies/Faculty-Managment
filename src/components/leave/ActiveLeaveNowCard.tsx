"use client";

import { useEffect, useState } from "react";
import { CalendarClock, ChevronDown, ChevronUp, UserRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { LEAVE_TYPE_LABELS } from "@/types/leave";
import type { LeaveTypeCode } from "@/types/leave";

type DateLike = Parameters<typeof formatDate>[0];

interface ActiveLeaveEntry {
  id: string;
  uid: string;
  employeeName: string;
  department?: string;
  leaveTypeCode?: LeaveTypeCode;
  isOtherRequest?: boolean;
  fromDate: DateLike;
  toDate: DateLike;
}

// "Active Now" - everyone on APPROVED leave that covers today, HOD's own
// department or Principal/VP's whole college. Sits above the department/
// role list on the Leave History landing page, so "who's out right now" is
// answered at a glance instead of being buried as one more row inside a
// specific person's history once you've already drilled into it.
export function ActiveLeaveNowCard() {
  const [entries, setEntries] = useState<ActiveLeaveEntry[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/api/college/leave-history-report/active-now")
      .then((r) => r.json() as Promise<{ entries?: ActiveLeaveEntry[] }>)
      .then((d) => setEntries(d.entries ?? []))
      .catch(() => setEntries([]));
  }, []);

  const count = entries?.length ?? 0;

  return (
    <Card className={count > 0 ? "border-amber-300" : undefined}>
      <button
        type="button"
        onClick={() => count > 0 && setExpanded((v) => !v)}
        disabled={count === 0}
        className="w-full text-left disabled:cursor-default"
      >
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${count > 0 ? "bg-amber-100" : "bg-muted"}`}>
              <CalendarClock className={`h-5 w-5 ${count > 0 ? "text-amber-700" : "text-muted-foreground"}`} />
            </div>
            <div>
              <p className="font-medium">On Leave Right Now</p>
              <p className="text-xs text-muted-foreground">
                {entries === null ? "Loading…" : count === 0 ? "Nobody is on leave today" : `${count} ${count === 1 ? "person" : "people"} currently out`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {count > 0 && <Badge variant="modified">{count}</Badge>}
            {count > 0 && (expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />)}
          </div>
        </CardContent>
      </button>

      {expanded && count > 0 && (
        <CardContent className="pt-0 pb-4 px-4 space-y-2 border-t">
          <div className="pt-3 space-y-2">
            {entries!.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 p-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <UserRound className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{e.employeeName}</p>
                    {e.department && <p className="text-xs text-muted-foreground truncate">{e.department}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary">
                    {e.isOtherRequest && !e.leaveTypeCode ? "Other" : LEAVE_TYPE_LABELS[e.leaveTypeCode!] ?? e.leaveTypeCode}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(e.fromDate)} - {formatDate(e.toDate)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
