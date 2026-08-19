"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, CalendarDays, Pencil, Sun } from "lucide-react";
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
import { formatDate, toDate, toDateInputValue } from "@/lib/utils";
import { academicSessionLabel, currentAcademicStartYear, recentAcademicSessions } from "@/lib/college/academicSession";
import { HOLIDAY_TYPE_LABELS, HOLIDAY_AUDIENCE_LABELS } from "@/types";
import type { Holiday, HolidayAudience, HolidayType, SummerHoliday } from "@/types";

const HOLIDAY_TYPES: HolidayType[] = ["NATIONAL", "REGIONAL", "COLLEGE", "RESTRICTED"];
const HOLIDAY_AUDIENCES: HolidayAudience[] = ["BOTH", "STUDENTS"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const ALL_SENTINEL = "__all__"; // sentinel: Radix Select items can't use an empty string value

function emptyForm() {
  return { date: "", name: "", type: "COLLEGE" as HolidayType, appliesTo: "BOTH" as HolidayAudience };
}

function emptySummerForm(academicYear: string) {
  return { academicYear, fromDate: "", toDate: "" };
}

// Session start year out of a "YYYY-YY" label, for sorting newest-first -
// plain string sort would put "2029-30" before "2024-25" but also before
// "2030-31" wrongly once double-digit-suffix years show up.
function sessionStartYear(label: string): number {
  return Number(label.slice(0, 4)) || 0;
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
  // Defaults to the current session so Office lands on "this year" - the
  // year picker below still reaches back to any earlier session that has
  // holidays, and "All Years" shows the full history at once.
  const [selectedAcademicYear, setSelectedAcademicYear] = useState(academicSessionLabel(currentAcademicStartYear()));
  const [selectedMonth, setSelectedMonth] = useState(""); // "" = all months

  // Summer Holidays - one continuous from/to break period per academic year,
  // distinct from the single-date holidays above (see SummerHoliday in
  // src/types). Shown as a banner across every role's own Leave module
  // starting the day before it begins (see SummerHolidayBanner.tsx) - not
  // filtered by the Month picker above since it's a range, not a single date.
  const [summerHolidays, setSummerHolidays] = useState<SummerHoliday[]>([]);
  const [isSummerLoading, setIsSummerLoading] = useState(true);
  const [summerOpen, setSummerOpen] = useState(false);
  const [summerForm, setSummerForm] = useState(emptySummerForm(academicSessionLabel(currentAcademicStartYear())));
  const [isSummerSaving, setIsSummerSaving] = useState(false);
  const [summerDeleteTarget, setSummerDeleteTarget] = useState<SummerHoliday | null>(null);
  const [isSummerDeleting, setIsSummerDeleting] = useState(false);

  // recentAcademicSessions() only covers ~4 sessions around now - merge in
  // whatever years actually show up in the data (older imported holidays,
  // say) so the picker never hides real history.
  const academicYearOptions = useMemo(() => {
    const years = new Set([...recentAcademicSessions(), ...holidays.map((h) => h.academicYear)]);
    return Array.from(years).sort((a, b) => sessionStartYear(b) - sessionStartYear(a));
  }, [holidays]);

  const filteredHolidays = useMemo(
    () => holidays.filter((h) => {
      if (selectedAcademicYear !== ALL_SENTINEL && h.academicYear !== selectedAcademicYear) return false;
      if (selectedMonth) {
        const d = toDate(h.date);
        if (!d || d.getMonth() + 1 !== Number(selectedMonth)) return false;
      }
      return true;
    }),
    [holidays, selectedAcademicYear, selectedMonth]
  );

  function load() {
    setIsLoading(true);
    fetch("/api/college/holidays")
      .then((r) => r.json() as Promise<{ holidays: Holiday[] }>)
      .then((d) => setHolidays(d.holidays ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load holidays" }))
      .finally(() => setIsLoading(false));
  }

  function loadSummerHolidays() {
    setIsSummerLoading(true);
    fetch("/api/college/summer-holidays")
      .then((r) => r.json() as Promise<{ summerHolidays: SummerHoliday[] }>)
      .then((d) => setSummerHolidays(d.summerHolidays ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load summer holidays" }))
      .finally(() => setIsSummerLoading(false));
  }

  useEffect(() => {
    // Wrapped so load()'s setState calls aren't reachable synchronously from
    // the effect body (react-hooks/set-state-in-effect).
    void (async () => { load(); loadSummerHolidays(); })();
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
        body: JSON.stringify({ date: form.date, name: form.name.trim(), type: form.type, appliesTo: form.appliesTo }),
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

  function openSummerDialog(existing?: SummerHoliday) {
    setSummerForm(
      existing
        ? { academicYear: existing.academicYear, fromDate: toDateInputValue(existing.fromDate), toDate: toDateInputValue(existing.toDate) }
        : emptySummerForm(academicSessionLabel(currentAcademicStartYear()))
    );
    setSummerOpen(true);
  }

  async function handleSaveSummerHoliday() {
    if (!summerForm.academicYear || !summerForm.fromDate || !summerForm.toDate) {
      toast({ variant: "destructive", title: "Academic year, from date and to date are all required" });
      return;
    }
    if (summerForm.toDate < summerForm.fromDate) {
      toast({ variant: "destructive", title: "To date cannot be before from date" });
      return;
    }
    setIsSummerSaving(true);
    try {
      const res = await fetch("/api/college/summer-holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(summerForm),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save summer holidays");
      toast({ variant: "success", title: "Summer holidays saved" });
      setSummerOpen(false);
      loadSummerHolidays();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save summer holidays" });
    } finally {
      setIsSummerSaving(false);
    }
  }

  async function handleDeleteSummerHoliday() {
    if (!summerDeleteTarget) return;
    setIsSummerDeleting(true);
    try {
      const res = await fetch(`/api/college/summer-holidays/${summerDeleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Summer holidays removed" });
      setSummerDeleteTarget(null);
      loadSummerHolidays();
    } catch {
      toast({ variant: "destructive", title: "Failed to remove summer holidays" });
    } finally {
      setIsSummerDeleting(false);
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
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Sun className="h-4 w-4 text-muted-foreground" />
                Summer Holidays
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                One break period per academic year - shown as a banner across every role&rsquo;s Leave module starting the day before it begins.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => openSummerDialog()}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />Set Summer Holidays
            </Button>
          </div>
          {isSummerLoading ? (
            <div className="h-10 bg-muted animate-pulse rounded-lg" />
          ) : summerHolidays.length === 0 ? (
            <p className="text-xs text-muted-foreground">No summer holidays set yet for any academic year.</p>
          ) : (
            <div className="space-y-2">
              {summerHolidays.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 flex-wrap">
                  <div className="text-sm">
                    <span className="font-medium">{s.academicYear}</span>
                    <span className="text-muted-foreground"> &middot; {formatDate(s.fromDate)} &ndash; {formatDate(s.toDate)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openSummerDialog(s)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setSummerDeleteTarget(s)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Academic Year</Label>
            <Select value={selectedAcademicYear} onValueChange={setSelectedAcademicYear}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SENTINEL}>All Years</SelectItem>
                {academicYearOptions.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Month</Label>
            <Select value={selectedMonth || ALL_SENTINEL} onValueChange={(v) => setSelectedMonth(v === ALL_SENTINEL ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SENTINEL}>All Months</SelectItem>
                {MONTH_NAMES.map((name, idx) => (
                  <SelectItem key={idx + 1} value={String(idx + 1)}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : filteredHolidays.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<CalendarDays className="h-6 w-6" />}
                title={holidays.length === 0 ? "No holidays added yet" : "No holidays for this filter"}
                description={
                  holidays.length === 0
                    ? "Add the academic year's holidays so they count toward the Leave History Report."
                    : "Try a different academic year or month."
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Academic Year</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Applies To</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredHolidays.map((h) => (
                    <tr key={h.id}>
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(h.date)}</td>
                      <td className="px-4 py-2.5 font-medium text-foreground">{h.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{h.academicYear}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant="secondary" className="text-xs">{HOLIDAY_TYPE_LABELS[h.type]}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="text-xs">{HOLIDAY_AUDIENCE_LABELS[h.appliesTo ?? "BOTH"]}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteTarget(h)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            <div className="space-y-2">
              <Label>Applies To</Label>
              <Select value={form.appliesTo} onValueChange={(v) => setForm((f) => ({ ...f, appliesTo: v as HolidayAudience }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HOLIDAY_AUDIENCES.map((a) => (
                    <SelectItem key={a} value={a}>{HOLIDAY_AUDIENCE_LABELS[a]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.appliesTo === "STUDENTS" && (
                <p className="text-xs text-muted-foreground">Faculty leave-day counting will not exclude this date.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleAdd()} loading={isSaving}>Add Holiday</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={summerOpen} onOpenChange={setSummerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set Summer Holidays</DialogTitle>
            <DialogDescription>One range per academic year - setting it again for the same year overwrites the existing one.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Academic Year</Label>
              <Select value={summerForm.academicYear} onValueChange={(v) => setSummerForm((f) => ({ ...f, academicYear: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {recentAcademicSessions().map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>From</Label>
                <Input type="date" value={summerForm.fromDate} onChange={(e) => setSummerForm((f) => ({ ...f, fromDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>To</Label>
                <Input type="date" value={summerForm.toDate} min={summerForm.fromDate || undefined} onChange={(e) => setSummerForm((f) => ({ ...f, toDate: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSummerOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleSaveSummerHoliday()} loading={isSummerSaving}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!summerDeleteTarget}
        onOpenChange={(open) => { if (!open) setSummerDeleteTarget(null); }}
        title="Remove summer holidays?"
        description={`This will remove the ${summerDeleteTarget?.academicYear ?? ""} summer holidays range and its Leave-module banner. This cannot be undone.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void handleDeleteSummerHoliday()}
        loading={isSummerDeleting}
      />

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
