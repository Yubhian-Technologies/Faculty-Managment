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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { EMPLOYMENT_TYPE_LABELS } from "@/types";
import type { EmploymentType } from "@/types";

interface RequestFacultyAccountDialogProps {
  offerId: string;
  candidateName: string;
  candidateEmail?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => void;
}

export function RequestFacultyAccountDialog({
  offerId,
  candidateName,
  candidateEmail,
  open,
  onOpenChange,
  onSubmitted,
}: RequestFacultyAccountDialogProps) {
  const [officialEmail, setOfficialEmail] = useState(candidateEmail ?? "");
  const [employmentType, setEmploymentType] = useState<EmploymentType | "">("");
  const [specialization, setSpecialization] = useState("");
  const [qualification, setQualification] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    if (!officialEmail.trim() || !employmentType) {
      toast({ variant: "destructive", title: "Official email and employment type are required" });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/college/faculty-account-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offerId,
          officialEmail: officialEmail.trim(),
          employmentType,
          specialization: specialization.trim() || undefined,
          qualification: qualification.trim() || undefined,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to submit request");
      toast({ variant: "success", title: "Faculty account requested", description: "The Webmaster has been notified." });
      onOpenChange(false);
      onSubmitted();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to submit request", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Faculty Account</DialogTitle>
          <DialogDescription>
            Send {candidateName}&rsquo;s details to the Webmaster to create their login.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Official / Recommended Email *</Label>
            <Input value={officialEmail} onChange={(e) => setOfficialEmail(e.target.value)} placeholder="name@college.edu" />
          </div>
          <div className="space-y-2">
            <Label>Employment Type *</Label>
            <Select value={employmentType} onValueChange={(v) => setEmploymentType(v as EmploymentType)}>
              <SelectTrigger>
                <SelectValue placeholder="Select employment type..." />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[]).map((t) => (
                  <SelectItem key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Specialization</Label>
            <Input value={specialization} onChange={(e) => setSpecialization(e.target.value)} placeholder="e.g. Machine Learning" />
          </div>
          <div className="space-y-2">
            <Label>Qualification</Label>
            <Input value={qualification} onChange={(e) => setQualification(e.target.value)} placeholder="e.g. Ph.D in Computer Science" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={() => void handleSubmit()} loading={isSubmitting}>Submit Request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
