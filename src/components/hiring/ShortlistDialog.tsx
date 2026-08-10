"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";

export interface ShortlistCandidate {
  applicationId: string;
  name: string;
  email: string;
  isShortlisted: boolean;
}

interface ShortlistDialogProps {
  vacancyPosition: string;
  candidates: ShortlistCandidate[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function ShortlistDialog({ vacancyPosition, candidates, open, onOpenChange, onSaved }: ShortlistDialogProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChecked(Object.fromEntries(candidates.map((c) => [c.applicationId, c.isShortlisted])));
  }, [open, candidates]);

  function toggle(id: string) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleSave() {
    const changed = candidates.filter((c) => checked[c.applicationId] !== c.isShortlisted);
    if (changed.length === 0) {
      onOpenChange(false);
      return;
    }
    setIsSubmitting(true);
    try {
      const results = await Promise.all(
        changed.map((c) =>
          fetch(`/api/college/candidate-applications/${c.applicationId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isShortlisted: checked[c.applicationId] }),
          })
        )
      );
      if (results.some((r) => !r.ok)) {
        toast({ variant: "destructive", title: "Some candidates could not be updated" });
      } else {
        toast({ variant: "success", title: "Shortlist updated" });
      }
      onOpenChange(false);
      onSaved();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Shortlist Candidates</DialogTitle>
          <DialogDescription>
            Tick the candidates to shortlist for {vacancyPosition}.
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No candidates added to this hiring request yet.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {candidates.map((c) => (
              <label
                key={c.applicationId}
                htmlFor={`sl-${c.applicationId}`}
                className="flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer hover:bg-muted/40"
              >
                <Checkbox
                  id={`sl-${c.applicationId}`}
                  checked={!!checked[c.applicationId]}
                  onCheckedChange={() => toggle(c.applicationId)}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                </div>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={() => void handleSave()} loading={isSubmitting} disabled={candidates.length === 0}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
