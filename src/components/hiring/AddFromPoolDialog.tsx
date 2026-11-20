"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { Candidate, CandidateApplication } from "@/types";

// "Add From Pool" on an approved hiring request (HOD Hiring Pipeline): candidates added to the pool before the
// request existed are picked here and attached to it, several at once. Only candidates with no open application
// are offered (a candidate is attached to one open hiring request at a time - the server checks this again).
export function AddFromPoolDialog({ vacancyId, position, open, onOpenChange, onAttached }: {
  vacancyId: string;
  position: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttached: () => void;
}) {
  const [pool, setPool] = useState<Candidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setIsLoading(true);
      setPicked(new Set());
      setSearch("");
      try {
        const [candidates, applications] = await Promise.all([
          fetch("/api/college/candidates").then((r) => r.json() as Promise<{ candidates?: Candidate[] }>).then((d) => d.candidates ?? []),
          fetch("/api/college/candidate-applications").then((r) => r.json() as Promise<{ applications?: CandidateApplication[] }>).then((d) => d.applications ?? []),
        ]);
        if (cancelled) return;
        const busy = new Set(applications.filter((a) => a.status !== "REJECTED").map((a) => a.candidateId));
        setPool(candidates.filter((c) => !busy.has(c.id)));
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Unable to load the candidate pool" });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const q = search.trim().toLowerCase();
  const shown = useMemo(
    () => pool.filter((c) => !q || [c.name, c.email, c.phone].some((v) => (v ?? "").toLowerCase().includes(q))),
    [pool, q],
  );

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function attach() {
    if (picked.size === 0) return;
    setIsSubmitting(true);
    const failed: string[] = [];
    let done = 0;
    for (const id of picked) {
      try {
        const res = await fetch("/api/college/candidate-applications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId: id, vacancyRequestId: vacancyId }),
        });
        if (res.ok) done += 1;
        else {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          failed.push(`${pool.find((c) => c.id === id)?.name ?? "A candidate"}: ${json.error ?? "not attached"}`);
        }
      } catch {
        failed.push(`${pool.find((c) => c.id === id)?.name ?? "A candidate"}: network error`);
      }
    }
    setIsSubmitting(false);
    if (done > 0) toast({ variant: "success", title: `${done} candidate${done === 1 ? "" : "s"} attached to ${position}.` });
    if (failed.length) toast({ variant: "destructive", title: `Unable to attach ${failed.length} candidate${failed.length === 1 ? "" : "s"}.`, description: failed.join(" · ") });
    if (done > 0) {
      onOpenChange(false);
      onAttached();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add From Pool</DialogTitle>
          <DialogDescription>Pick candidates already in your pool to attach to {position}.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, phone..." className="h-9 pl-8" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading candidates...</p>
          ) : shown.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {pool.length === 0 ? "No candidates in your pool are free to attach. Add a candidate first." : "No candidate matches the search."}
            </p>
          ) : (
            <ul className="divide-y">
              {shown.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/40">
                    <Checkbox checked={picked.has(c.id)} onCheckedChange={() => toggle(c.id)} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[c.email, c.phone].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">Added {formatDate(c.createdAt)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={() => void attach()} disabled={picked.size === 0} loading={isSubmitting}>
            Attach {picked.size > 0 ? picked.size : ""} Candidate{picked.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
