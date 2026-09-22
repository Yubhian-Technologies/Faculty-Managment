"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Asks for permission for a late arrival (or a short absence within a day)
// and sends it up for approval. Where it goes is decided server-side by the
// college's own leave routing, so a faculty member's reaches their HOD and an
// HOD's reaches the Principal without this form having to know the hierarchy.
export function PermissionRequestDialog({ onSubmitted }: { onSubmitted?: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next) {
      setDate(todayISO());
      setFromTime("");
      setToTime("");
      setReason("");
    }
    setOpen(next);
  }

  // Mirrors the server's own checks so the common mistakes are caught before
  // a round trip; the route re-validates regardless.
  const timesOrdered = !!fromTime && !!toTime && toTime > fromTime;
  const canSubmit = !!date && timesOrdered && reason.trim().length > 0;

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch("/api/leave/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, fromTime, toTime, reason: reason.trim() }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Couldn't send the request" });
        return;
      }
      toast({ variant: "success", title: "Permission requested", description: "Sent to your approver." });
      setOpen(false);
      onSubmitted?.();
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => handleOpenChange(true)}>
        <Clock className="h-4 w-4 mr-1" />
        Apply Permission
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply for Permission</DialogTitle>
            <DialogDescription>
              For arriving late or being away for part of a day. This goes to your approver for a decision.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="perm-date">Date *</Label>
              <Input id="perm-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="perm-from">From Time *</Label>
                <Input id="perm-from" type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="perm-to">To Time *</Label>
                <Input id="perm-to" type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
              </div>
            </div>
            {!!fromTime && !!toTime && !timesOrdered && (
              <p className="text-sm text-destructive">To time must be after From time.</p>
            )}

            <div className="space-y-2">
              <Label htmlFor="perm-reason">Reason *</Label>
              <Textarea
                id="perm-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why you need this permission"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button onClick={() => void submit()} loading={saving} disabled={!canSubmit}>
              Send Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
