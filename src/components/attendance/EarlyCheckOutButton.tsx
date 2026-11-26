"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, LogOut, RefreshCw, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PermissionRequestDialog } from "@/components/leave/PermissionRequestDialog";
import { toast } from "@/hooks/useToast";
import { nowInIndia } from "@/lib/leave/dayCounter";
import type { EarlyCheckOutState, RemainingPeriod } from "@/lib/attendance/earlyCheckOut";

const COVERED_LABEL: Record<NonNullable<RemainingPeriod["coveredBy"]>, string> = {
  ADJUSTMENT: "Adjustment asked",
  PERMISSION: "Permission applied",
  LEAVE: "On leave",
};

// The self-attendance pages' Check Out button. Before the college's End Time (Settings > Attendance Timings) a
// check-out is early: classes still left today must each be adjusted (Work Adjustments) or covered by a permission,
// then a reason is asked; only then does the face / phone check open (`onProceed(reason)`). The server
// (api/college/attendance/check-out) re-checks all of it.
export function EarlyCheckOutButton({ onProceed }: { onProceed: (earlyReason?: string) => void }) {
  const [checking, setChecking] = useState(false);
  const [state, setState] = useState<EarlyCheckOutState | null>(null);
  const [reason, setReason] = useState("");

  async function check(): Promise<EarlyCheckOutState | null> {
    setChecking(true);
    try {
      const res = await fetch("/api/college/attendance/check-out", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as EarlyCheckOutState & { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Unable to check today's classes. Try again." }); return null; }
      return json;
    } catch {
      toast({ variant: "destructive", title: "Unable to check today's classes. Check the connection and try again." });
      return null;
    } finally { setChecking(false); }
  }

  async function start() {
    const s = await check();
    if (!s) return;
    if (!s.early) { onProceed(undefined); return; }
    setReason("");
    setState(s);
  }

  async function recheck() {
    const s = await check();
    if (!s) return;
    if (!s.early) { setState(null); onProceed(undefined); return; }
    setState(s);
  }

  const uncovered = state?.uncovered ?? [];
  const now = nowInIndia().timeHHMM;
  const lastEnd = uncovered.reduce((m, p) => (p.endTime > m ? p.endTime : m), state?.closingTime ?? "");

  return (
    <>
      <Button onClick={() => void start()} loading={checking && !state}>
        <LogOut className="h-4 w-4 mr-1.5" /> Check Out
      </Button>

      <Dialog open={!!state} onOpenChange={(o) => { if (!o) setState(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{uncovered.length ? "You Still Have Classes Today" : "Early Check-Out"}</DialogTitle>
            <DialogDescription>
              {state?.closingTime ? <>College hours end at <strong>{state.closingTime}</strong>. </> : null}
              {uncovered.length
                ? "Adjust each class with a colleague, or apply for a permission for the time you are away, before you check out."
                : "You are checking out before the college's closing time. Enter a reason."}
            </DialogDescription>
          </DialogHeader>

          {state && state.periods.length > 0 && (
            <ul className="divide-y rounded-md border text-sm">
              {state.periods.map((p) => (
                <li key={p.slotId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">Period {p.periodNumber} · {p.startTime}–{p.endTime}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.subjectName}{p.department || p.sectionName ? ` · ${[p.department, p.sectionName].filter(Boolean).join(" ")}` : ""}
                    </p>
                  </div>
                  {p.coveredBy ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />{COVERED_LABEL[p.coveredBy]}
                    </span>
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/leave/adjustments?adjust=${encodeURIComponent(p.slotId)}`}>
                        <Shuffle className="h-3.5 w-3.5 mr-1" />Adjust Class
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {uncovered.length > 0 ? (
            <DialogFooter className="gap-2 sm:justify-between">
              <PermissionRequestDialog
                preset={{ fromTime: now, toTime: lastEnd || uncovered[uncovered.length - 1].endTime }}
                onSubmitted={() => void recheck()}
              />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setState(null)}>Cancel</Button>
                <Button variant="outline" onClick={() => void recheck()} loading={checking}>
                  <RefreshCw className="h-4 w-4 mr-1" />Check Again
                </Button>
              </div>
            </DialogFooter>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="early-reason">Reason</Label>
                <Textarea id="early-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="Why you are leaving early" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setState(null)}>Cancel</Button>
                <Button disabled={!reason.trim()} onClick={() => { const r = reason.trim(); setState(null); onProceed(r); }}>
                  <LogOut className="h-4 w-4 mr-1.5" />Continue to Check Out
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
