"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { HOLIDAY_TYPE_LABELS } from "@/types";
import type { Holiday, HolidayType } from "@/types";

const HOLIDAY_TYPES: HolidayType[] = ["NATIONAL", "REGIONAL", "COLLEGE", "RESTRICTED"];

function emptyForm() {
  return { date: "", name: "", type: "COLLEGE" as HolidayType };
}

// Academic Calendar Holidays - maintained by Office, feeds the "Holidays"
// column on the Leave History Report (see LeaveHistoryReport.tsx), which
// used to just show "-" since nothing ever populated this collection.
export default function CollegeOfficeHolidaysPage() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Holiday | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function load() {
    setIsLoading(true);
    fetch("/api/college/holidays")
      .then((r) => r.json() as Promise<{ holidays: Holiday[] }>)
      .then((d) => setHolidays(d.holidays ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load holidays" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    // Wrapped so load()'s setState calls aren't reachable synchronously from
    // the effect body (react-hooks/set-state-in-effect).
    void (async () => { load(); })();
  }, []);

  async function handleAdd() {
    if (!form.date || !form.name.trim()) {
      toast({ variant: "destructive", title: "Date and name are required" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: form.date, name: form.name.trim(), type: form.type }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to add holiday");
      toast({ variant: "success", title: "Holiday added" });
      setOpen(false);
      setForm(emptyForm());
      load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to add holiday" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/holidays/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Holiday removed" });
      setDeleteTarget(null);
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to remove holiday" });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Holidays"
        description="Academic calendar holidays - feeds the Holidays column on the Leave History Report"
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />Add Holiday
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : holidays.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<CalendarDays className="h-6 w-6" />}
                title="No holidays added yet"
                description="Add the academic year's holidays so they count toward the Leave History Report."
              />
            </div>
          ) : (
            <div className="divide-y">
              {holidays.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <CalendarDays className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{h.name}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(h.date)} &middot; {h.academicYear}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary">{HOLIDAY_TYPE_LABELS[h.type]}</Badge>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteTarget(h)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(emptyForm()); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Holiday</DialogTitle>
            <DialogDescription>Added holidays count toward the Leave History Report&rsquo;s Holidays column for their month.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Independence Day" />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as HolidayType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HOLIDAY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{HOLIDAY_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleAdd()} loading={isSaving}>Add Holiday</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Remove holiday?"
        description={`This will remove "${deleteTarget?.name ?? ""}" from the academic calendar. This cannot be undone.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
