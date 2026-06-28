"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { LeaveApplication, LeaveBalance, LeaveTypeCode, LeaveStatus } from "@/types";
import { LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS, DEFAULT_LEAVE_ENTITLEMENTS } from "@/types";

const BALANCE_CARDS: { type: LeaveTypeCode; colorClass: string }[] = [
  { type: "CASUAL", colorClass: "text-blue-700" },
  { type: "SICK", colorClass: "text-red-700" },
  { type: "EARNED", colorClass: "text-green-700" },
  { type: "COMPENSATORY", colorClass: "text-amber-700" },
];

const STATUS_STYLES: Record<LeaveStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 border-yellow-200",
  HOD_APPROVED: "bg-blue-100 text-blue-800 border-blue-200",
  PRINCIPAL_APPROVED: "bg-green-100 text-green-800 border-green-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  CANCELLED: "bg-gray-100 text-gray-600 border-gray-200",
};

interface FormState {
  leaveType: LeaveTypeCode | "";
  fromDate: string;
  toDate: string;
  isHalfDay: boolean;
  halfDaySession: "MORNING" | "AFTERNOON" | "";
  reason: string;
  substituteArrangement: string;
}

const INITIAL_FORM: FormState = {
  leaveType: "",
  fromDate: "",
  toDate: "",
  isHalfDay: false,
  halfDaySession: "",
  reason: "",
  substituteArrangement: "",
};

export default function HODLeavePage() {
  const [leaves, setLeaves] = useState<LeaveApplication[]>([]);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setIsLoading(true);
    fetch("/api/college/leave-applications?myLeave=true")
      .then((r) => r.json() as Promise<{ leaves: LeaveApplication[]; balance: LeaveBalance | null }>)
      .then((d) => {
        setLeaves(d.leaves ?? []);
        setBalance(d.balance ?? null);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load leave data" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  function openDialog() {
    setForm(INITIAL_FORM);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.leaveType) {
      toast({ variant: "destructive", title: "Please select a leave type" });
      return;
    }
    if (!form.fromDate) {
      toast({ variant: "destructive", title: "Please select a from date" });
      return;
    }
    if (!form.toDate) {
      toast({ variant: "destructive", title: "Please select a to date" });
      return;
    }
    if (form.toDate < form.fromDate) {
      toast({ variant: "destructive", title: "To date must be on or after from date" });
      return;
    }
    if (!form.reason.trim()) {
      toast({ variant: "destructive", title: "Please provide a reason" });
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        leaveType: form.leaveType,
        fromDate: form.fromDate,
        toDate: form.toDate,
        reason: form.reason.trim(),
      };
      if (form.isHalfDay) {
        body.isHalfDay = true;
        if (form.halfDaySession) body.halfDaySession = form.halfDaySession;
      }
      if (form.substituteArrangement.trim()) {
        body.substituteArrangement = form.substituteArrangement.trim();
      }

      const res = await fetch("/api/college/leave-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Failed to submit");
      }

      toast({ title: "Leave application submitted" });
      closeDialog();
      load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to submit leave application",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Leave"
        description="Apply and track your leave applications"
        actions={
          <Button onClick={openDialog}>
            Apply Leave
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {BALANCE_CARDS.map(({ type, colorClass }) => (
          <Card key={type}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{LEAVE_TYPE_LABELS[type]}</p>
              <p className={`text-2xl font-bold mt-1 ${colorClass}`}>
                {balance ? (balance.balances[type]?.balance ?? DEFAULT_LEAVE_ENTITLEMENTS[type]) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">days remaining</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leave History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : leaves.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No leave applications found.</p>
          ) : (
            <div className="divide-y">
              {leaves.map((leave) => (
                <div key={leave.id} className="flex items-start justify-between py-4 gap-4">
                  <div className="space-y-1 min-w-0">
                    <p className="text-sm font-medium">{LEAVE_TYPE_LABELS[leave.leaveType]}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(leave.fromDate)} – {formatDate(leave.toDate)}
                      {leave.isHalfDay && leave.halfDaySession
                        ? ` · Half Day (${leave.halfDaySession === "MORNING" ? "Morning" : "Afternoon"})`
                        : ` · ${leave.totalDays} day${leave.totalDays !== 1 ? "s" : ""}`}
                    </p>
                    {leave.reason && (
                      <p className="text-xs text-muted-foreground truncate max-w-xs">{leave.reason}</p>
                    )}
                  </div>
                  <Badge className={`shrink-0 border text-xs ${STATUS_STYLES[leave.status]}`} variant="outline">
                    {LEAVE_STATUS_LABELS[leave.status]}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply for Leave</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="leaveType">Leave Type</Label>
              <Select
                value={form.leaveType}
                onValueChange={(v) => setField("leaveType", v as LeaveTypeCode)}
              >
                <SelectTrigger id="leaveType">
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(LEAVE_TYPE_LABELS) as LeaveTypeCode[]).map((code) => (
                    <SelectItem key={code} value={code}>
                      {LEAVE_TYPE_LABELS[code]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fromDate">From Date</Label>
                <Input
                  id="fromDate"
                  type="date"
                  value={form.fromDate}
                  onChange={(e) => setField("fromDate", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="toDate">To Date</Label>
                <Input
                  id="toDate"
                  type="date"
                  value={form.toDate}
                  min={form.fromDate || undefined}
                  onChange={(e) => setField("toDate", e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="isHalfDay"
                type="checkbox"
                className="h-4 w-4 rounded border-input accent-primary"
                checked={form.isHalfDay}
                onChange={(e) => {
                  setField("isHalfDay", e.target.checked);
                  if (!e.target.checked) setField("halfDaySession", "");
                }}
              />
              <Label htmlFor="isHalfDay" className="cursor-pointer">Half Day</Label>
            </div>

            {form.isHalfDay && (
              <div className="space-y-1.5">
                <Label htmlFor="halfDaySession">Session</Label>
                <Select
                  value={form.halfDaySession}
                  onValueChange={(v) => setField("halfDaySession", v as "MORNING" | "AFTERNOON")}
                >
                  <SelectTrigger id="halfDaySession">
                    <SelectValue placeholder="Select session" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MORNING">Morning</SelectItem>
                    <SelectItem value="AFTERNOON">Afternoon</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason <span className="text-destructive">*</span></Label>
              <Textarea
                id="reason"
                value={form.reason}
                onChange={(e) => setField("reason", e.target.value)}
                placeholder="Enter reason for leave"
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="substituteArrangement">Substitute Arrangement</Label>
              <Input
                id="substituteArrangement"
                value={form.substituteArrangement}
                onChange={(e) => setField("substituteArrangement", e.target.value)}
                placeholder="Who will cover your classes?"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
