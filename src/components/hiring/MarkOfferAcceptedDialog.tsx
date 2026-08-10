"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { toDateInputValue } from "@/lib/utils";

interface MarkOfferAcceptedDialogProps {
  offerId: string;
  candidateName: string;
  defaultJoiningDate?: Parameters<typeof toDateInputValue>[0];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccepted: () => void;
}

// A staff override for phone/paper confirmations, standing in for the
// candidate's own submission on /offer-acceptance - without collecting the
// date here too, a phone-accepted candidate would never satisfy the
// faculty-account-request gate that requires candidateConfirmedJoiningDate.
export function MarkOfferAcceptedDialog({
  offerId,
  candidateName,
  defaultJoiningDate,
  open,
  onOpenChange,
  onAccepted,
}: MarkOfferAcceptedDialogProps) {
  const [date, setDate] = useState(() => toDateInputValue(defaultJoiningDate));
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleConfirm() {
    if (!date) {
      toast({ variant: "destructive", title: "Enter the confirmed date of joining" });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/college/offer-letters/${offerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACCEPTED", confirmedDateOfJoining: date }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      toast({ variant: "success", title: "Offer marked accepted" });
      onOpenChange(false);
      onAccepted();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to mark accepted", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark Offer Accepted</DialogTitle>
          <DialogDescription>
            Confirm {candidateName}&rsquo;s date of joining (e.g. confirmed by phone). This stands in for the candidate&rsquo;s own confirmation via the acceptance link.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="confirmedDate">Confirmed Date of Joining *</Label>
          <Input id="confirmedDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
          <Button className="bg-green-600 hover:bg-green-700" onClick={() => void handleConfirm()} loading={isSubmitting}>
            Mark Accepted
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
