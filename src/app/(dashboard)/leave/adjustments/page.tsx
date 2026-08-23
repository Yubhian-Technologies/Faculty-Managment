"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { Timestamp } from "firebase/firestore";
import type { AdjustmentKind } from "@/types/leave";

interface PeriodItem {
  date: string;
  timetableSlotId: string;
  day: string;
  periodNumber: number;
  subjectName: string;
  sectionName: string | null;
}
interface AdjustmentItem {
  requestId: string;
  kind: AdjustmentKind;
  employeeName: string;
  department: string | null;
  fromDate: Timestamp;
  toDate: Timestamp;
  totalDays: number;
  reason: string;
  periods?: PeriodItem[];
  handoverNote?: string | null;
}

// Accept/decline inbox for substitute and handover requests named on someone
// else's leave request - see types/leave.ts's AdjustmentRequest and
// PENDING_ACCEPTANCE. Reached from the "Adjustment Request" notification
// (any leave-applicant role can land here - see LEAVE_ADJUSTMENTS_PATH in
// proxy.ts). A substitute covering several periods can decline just some of
// them (check the ones they can't cover) and accept the rest in one submit -
// no need to reject the whole bundle over a single clash.
export default function LeaveAdjustmentsPage() {
  const [items, setItems] = useState<AdjustmentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [declinedKeys, setDeclinedKeys] = useState<Record<string, Set<string>>>({});
  const [reasonByRequest, setReasonByRequest] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setIsLoading(true);
    fetch("/api/leave/adjustment-requests")
      .then((r) => r.json() as Promise<{ items?: AdjustmentItem[] }>)
      .then((d) => setItems(d.items ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load adjustment requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  function toggleDeclined(requestId: string, key: string) {
    setDeclinedKeys((prev) => {
      const set = new Set(prev[requestId] ?? []);
      if (set.has(key)) set.delete(key); else set.add(key);
      return { ...prev, [requestId]: set };
    });
  }

  async function submitSubstitute(item: AdjustmentItem) {
    const declined = declinedKeys[item.requestId] ?? new Set<string>();
    setBusyId(item.requestId);
    try {
      const res = await fetch(`/api/leave/applications/${item.requestId}/adjustment-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response: "PARTIAL",
          declinedPeriods: Array.from(declined).map((key) => {
            const [date, timetableSlotId] = key.split("|");
            return { date, timetableSlotId };
          }),
          declineReason: reasonByRequest[item.requestId],
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to respond");
      toast({ variant: "success", title: declined.size === 0 ? "Accepted" : "Response sent" });
      load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to respond" });
    } finally {
      setBusyId(null);
    }
  }

  async function respondHandover(requestId: string, response: "ACCEPT" | "DECLINE") {
    setBusyId(requestId);
    try {
      const res = await fetch(`/api/leave/applications/${requestId}/adjustment-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response, declineReason: reasonByRequest[requestId] }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to respond");
      toast({ variant: "success", title: response === "ACCEPT" ? "Accepted" : "Declined" });
      load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to respond" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title="Adjustment Requests"
        description="Requests from colleagues asking you to cover a class or be their point of contact while they're on leave."
      />
      {isLoading ? (
        <div className="h-32 rounded-lg border bg-muted/30 animate-pulse" />
      ) : items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Nothing pending your response.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={`${item.requestId}-${item.kind}`}>
              <CardContent className="p-4 space-y-3">
                <div>
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    {item.employeeName}
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                      {item.kind === "SUBSTITUTE" ? "Substitute" : "Handover"}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(item.fromDate)} - {formatDate(item.toDate)} · {item.totalDays} day(s)
                    {item.department ? ` · ${item.department}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.reason}</p>
                  {item.kind === "HANDOVER" && item.handoverNote && (
                    <p className="text-xs text-muted-foreground mt-0.5">Handing over: {item.handoverNote}</p>
                  )}
                </div>

                {item.kind === "SUBSTITUTE" ? (
                  <>
                    <p className="text-xs text-muted-foreground">Uncheck any period you can&rsquo;t cover - the rest are accepted as-is.</p>
                    <div className="space-y-1.5 rounded-lg border p-3">
                      {(item.periods ?? []).map((p) => {
                        const key = `${p.date}|${p.timetableSlotId}`;
                        const isDeclined = declinedKeys[item.requestId]?.has(key) ?? false;
                        return (
                          <label key={key} className="flex items-center gap-2 text-sm">
                            <Checkbox checked={!isDeclined} onCheckedChange={() => toggleDeclined(item.requestId, key)} />
                            <span>
                              {p.subjectName}{p.sectionName ? ` · ${p.sectionName}` : ""} · {formatDate(new Date(p.date))} P{p.periodNumber}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {(declinedKeys[item.requestId]?.size ?? 0) > 0 && (
                      <Textarea
                        value={reasonByRequest[item.requestId] ?? ""}
                        onChange={(e) => setReasonByRequest((prev) => ({ ...prev, [item.requestId]: e.target.value }))}
                        placeholder="Reason for the declined period(s) (optional)"
                        rows={2}
                      />
                    )}
                    <div className="flex justify-end">
                      <Button size="sm" loading={busyId === item.requestId} onClick={() => void submitSubstitute(item)}>
                        {(declinedKeys[item.requestId]?.size ?? 0) === 0 ? "Accept All" : "Submit Response"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <Textarea
                      value={reasonByRequest[item.requestId] ?? ""}
                      onChange={(e) => setReasonByRequest((prev) => ({ ...prev, [item.requestId]: e.target.value }))}
                      placeholder="Reason if declining (optional)"
                      rows={2}
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" loading={busyId === item.requestId} onClick={() => void respondHandover(item.requestId, "DECLINE")}>Decline</Button>
                      <Button size="sm" loading={busyId === item.requestId} onClick={() => void respondHandover(item.requestId, "ACCEPT")}>Accept</Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
