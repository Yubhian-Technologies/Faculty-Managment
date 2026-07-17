"use client";

import { useEffect, useState } from "react";
import { UserPlus, ChevronDown, ChevronUp, Plus, CalendarRange, CalendarDays, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import type { College, AcademicYear, AcademicSession } from "@/types";

type PrincipalRow = { uid: string; name: string; email: string; role: string; isActive: boolean };

export default function AdministrationCollegesPage() {
  const [colleges, setColleges] = useState<College[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [principalMap, setPrincipalMap] = useState<Record<string, PrincipalRow[]>>({});
  const [loadingPrincipals, setLoadingPrincipals] = useState<string | null>(null);

  // New college dialog
  const [newCollegeOpen, setNewCollegeOpen] = useState(false);
  const [collegeForm, setCollegeForm] = useState({ name: "", address: "", contactEmail: "", contactPhone: "" });
  const [savingCollege, setSavingCollege] = useState(false);

  // Add principal dialog
  const [dialogCollege, setDialogCollege] = useState<College | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "12345678", role: "PRINCIPAL" });
  const [saving, setSaving] = useState(false);

  // Academic years dialog
  const [yearsCollege, setYearsCollege] = useState<College | null>(null);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [loadingYears, setLoadingYears] = useState(false);
  const [savingYear, setSavingYear] = useState(false);

  // Academic sessions dialog (calendar sessions, e.g. "2025-26")
  const [sessionsCollege, setSessionsCollege] = useState<College | null>(null);
  const [academicSessions, setAcademicSessions] = useState<AcademicSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [newSessionLabel, setNewSessionLabel] = useState("");
  const [savingSession, setSavingSession] = useState(false);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((d) => setColleges(d.colleges ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load colleges" }))
      .finally(() => setIsLoading(false));
  }, []);

  async function handleCreateCollege(e: React.FormEvent) {
    e.preventDefault();
    if (!collegeForm.name.trim()) return;
    setSavingCollege(true);
    try {
      const res = await fetch("/api/admin/colleges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collegeForm),
      });
      const json = await res.json() as { collegeId?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to create college", description: json.error });
        return;
      }
      toast({ variant: "success", title: "College created" });
      setNewCollegeOpen(false);
      setCollegeForm({ name: "", address: "", contactEmail: "", contactPhone: "" });
      // Refresh list
      const updated = await fetch("/api/admin/colleges")
        .then((r) => r.json() as Promise<{ colleges: College[] }>)
        .then((d) => d.colleges ?? []);
      setColleges(updated);
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSavingCollege(false);
    }
  }

  async function toggleExpand(college: College) {
    if (expandedId === college.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(college.id);
    if (!principalMap[college.id]) {
      setLoadingPrincipals(college.id);
      try {
        const res = await fetch(`/api/administration/principals?collegeId=${college.id}`);
        const data = await res.json() as { principals: PrincipalRow[] };
        setPrincipalMap((prev) => ({ ...prev, [college.id]: data.principals ?? [] }));
      } catch {
        toast({ variant: "destructive", title: "Failed to load principals" });
      } finally {
        setLoadingPrincipals(null);
      }
    }
  }

  function openDialog(college: College) {
    setDialogCollege(college);
    setForm((f) => ({ ...f, name: "", email: "", password: "12345678" }));
  }

  async function openYearsDialog(college: College) {
    setYearsCollege(college);
    setLoadingYears(true);
    try {
      const res = await fetch(`/api/college/academic-years?collegeId=${college.id}`);
      const data = await res.json() as { academicYears: AcademicYear[] };
      setAcademicYears(data.academicYears ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load academic years" });
    } finally {
      setLoadingYears(false);
    }
  }

  async function addNextYear() {
    if (!yearsCollege) return;
    setSavingYear(true);
    try {
      const res = await fetch(`/api/college/academic-years?collegeId=${yearsCollege.id}`, {
        method: "POST",
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed to add year");
      }
      const refreshed = await fetch(`/api/college/academic-years?collegeId=${yearsCollege.id}`)
        .then((r) => r.json() as Promise<{ academicYears: AcademicYear[] }>)
        .then((d) => d.academicYears ?? []);
      setAcademicYears(refreshed);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to add year" });
    } finally {
      setSavingYear(false);
    }
  }

  async function removeLastYear() {
    if (!yearsCollege) return;
    setSavingYear(true);
    try {
      const res = await fetch(`/api/college/academic-years?collegeId=${yearsCollege.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed to remove year");
      }
      const refreshed = await fetch(`/api/college/academic-years?collegeId=${yearsCollege.id}`)
        .then((r) => r.json() as Promise<{ academicYears: AcademicYear[] }>)
        .then((d) => d.academicYears ?? []);
      setAcademicYears(refreshed);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to remove year" });
    } finally {
      setSavingYear(false);
    }
  }

  async function refreshSessions(collegeId: string) {
    const data = await fetch(`/api/college/academic-sessions?collegeId=${collegeId}`)
      .then((r) => r.json() as Promise<{ academicSessions: AcademicSession[] }>);
    setAcademicSessions(data.academicSessions ?? []);
  }

  async function openSessionsDialog(college: College) {
    setSessionsCollege(college);
    setNewSessionLabel("");
    setLoadingSessions(true);
    try {
      await refreshSessions(college.id);
    } catch {
      toast({ variant: "destructive", title: "Failed to load academic sessions" });
    } finally {
      setLoadingSessions(false);
    }
  }

  async function handleAddSession(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionsCollege || !newSessionLabel.trim()) return;
    setSavingSession(true);
    try {
      const res = await fetch(`/api/college/academic-sessions?collegeId=${sessionsCollege.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newSessionLabel.trim() }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to add session", description: json.error });
        return;
      }
      setNewSessionLabel("");
      await refreshSessions(sessionsCollege.id);
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSavingSession(false);
    }
  }

  async function setCurrentSession(id: string) {
    if (!sessionsCollege) return;
    setSessionActionId(id);
    try {
      const res = await fetch(`/api/college/academic-sessions?collegeId=${sessionsCollege.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isCurrent: true }),
      });
      if (!res.ok) throw new Error();
      await refreshSessions(sessionsCollege.id);
    } catch {
      toast({ variant: "destructive", title: "Failed to update session" });
    } finally {
      setSessionActionId(null);
    }
  }

  async function deleteSession(id: string) {
    if (!sessionsCollege) return;
    setSessionActionId(id);
    try {
      const res = await fetch(`/api/college/academic-sessions?collegeId=${sessionsCollege.id}&id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      await refreshSessions(sessionsCollege.id);
    } catch {
      toast({ variant: "destructive", title: "Failed to delete session" });
    } finally {
      setSessionActionId(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!dialogCollege || !form.name || !form.email || !form.password) return;
    setSaving(true);
    try {
      const res = await fetch("/api/administration/principals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, collegeId: dialogCollege.id }),
      });
      const json = await res.json() as { uid?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to create", description: json.error });
        return;
      }
      toast({ variant: "success", title: `${form.role === "PRINCIPAL" ? "Principal" : "Vice Principal"} account created`, description: `Default password: ${form.password}` });
      // Refresh principals for this college
      setPrincipalMap((prev) => ({ ...prev, [dialogCollege.id]: [] }));
      const refreshed = await fetch(`/api/administration/principals?collegeId=${dialogCollege.id}`)
        .then((r) => r.json() as Promise<{ principals: PrincipalRow[] }>)
        .then((d) => d.principals ?? []);
      setPrincipalMap((prev) => ({ ...prev, [dialogCollege.id]: refreshed }));
      setDialogCollege(null);
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Colleges" description="Colleges under this location" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Colleges"
        description="Manage colleges and their principals in this location"
        actions={
          <Button onClick={() => setNewCollegeOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New College
          </Button>
        }
      />

      <div className="space-y-3">
        {colleges.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No colleges found in this location.</p>
        )}
        {colleges.map((college) => {
          const isExpanded = expandedId === college.id;
          const principalList = principalMap[college.id]; // undefined = not loaded yet
          const hasPrincipal = principalList?.some((p) => p.role === "PRINCIPAL") ?? false;
          const hasVP = principalList?.some((p) => p.role === "VICE_PRINCIPAL") ?? false;
          // After loading: hide button if both slots filled; before loading: always show
          const showAddBtn = principalList === undefined || !hasPrincipal || !hasVP;
          const addBtnLabel = hasPrincipal && !hasVP ? "Add Vice Principal" : "Add Principal";
          const addBtnDefaultRole = hasPrincipal && !hasVP ? "VICE_PRINCIPAL" : "PRINCIPAL";

          return (
            <div key={college.id} className="rounded-lg border bg-card overflow-hidden">
              {/* College row */}
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{college.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{college.contactEmail ?? college.address ?? "—"}</p>
                  </div>
                  <Badge variant={college.isActive ? "default" : "secondary"} className="shrink-0">
                    {college.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void openYearsDialog(college)}
                  >
                    <CalendarRange className="h-3.5 w-3.5 mr-1.5" />
                    Academic Years
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void openSessionsDialog(college)}
                  >
                    <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
                    Academic Sessions
                  </Button>
                  {showAddBtn && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setForm((f) => ({ ...f, role: addBtnDefaultRole })); openDialog(college); }}
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                      {addBtnLabel}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void toggleExpand(college)}
                  >
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Expanded principals list */}
              {isExpanded && (
                <div className="border-t px-4 pb-4 pt-3 bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Principals & Vice Principals</p>
                  {loadingPrincipals === college.id ? (
                    <div className="h-8 w-32 bg-muted animate-pulse rounded" />
                  ) : (principalList ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No principals assigned yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {(principalList ?? []).map((p) => (
                        <div key={p.uid} className="flex items-center justify-between rounded-lg border bg-card p-3">
                          <div>
                            <p className="text-sm font-medium">{p.name}</p>
                            <p className="text-xs text-muted-foreground">{p.email}</p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {p.role === "PRINCIPAL" ? "Principal" : "Vice Principal"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* New College Dialog */}
      <Dialog open={newCollegeOpen} onOpenChange={setNewCollegeOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Add New College</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateCollege} className="space-y-4 py-1">
            <div className="space-y-2">
              <Label>College Name <span className="text-destructive">*</span></Label>
              <Input
                value={collegeForm.name}
                onChange={(e) => setCollegeForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Vishnu Institute of Technology"
              />
            </div>
            <div className="space-y-2">
              <Label>Address</Label>
              <Input
                value={collegeForm.address}
                onChange={(e) => setCollegeForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Street, City, State"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Contact Email</Label>
                <Input
                  type="email"
                  value={collegeForm.contactEmail}
                  onChange={(e) => setCollegeForm((f) => ({ ...f, contactEmail: e.target.value }))}
                  placeholder="admin@college.edu"
                />
              </div>
              <div className="space-y-2">
                <Label>Contact Phone</Label>
                <Input
                  value={collegeForm.contactPhone}
                  onChange={(e) => setCollegeForm((f) => ({ ...f, contactPhone: e.target.value }))}
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewCollegeOpen(false)} disabled={savingCollege}>
                Cancel
              </Button>
              <Button type="submit" loading={savingCollege} disabled={!collegeForm.name.trim()}>
                Create College
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Principal Dialog */}
      <Dialog open={!!dialogCollege} onOpenChange={(open) => !open && setDialogCollege(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Add Principal — {dialogCollege?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 py-1">
            <div className="space-y-2">
              <Label>Role <span className="text-destructive">*</span></Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRINCIPAL">Principal</SelectItem>
                  <SelectItem value="VICE_PRINCIPAL">Vice Principal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Full Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Dr. Full Name"
              />
            </div>
            <div className="space-y-2">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="principal@vishnu.edu.in"
              />
            </div>
            <div className="space-y-2">
              <Label>Default Password</Label>
              <Input
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogCollege(null)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" loading={saving} disabled={!form.name || !form.email || !form.password}>
                Create Account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Academic Years Dialog */}
      <Dialog open={!!yearsCollege} onOpenChange={(open) => !open && setYearsCollege(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Academic Years — {yearsCollege?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              Add years of study for this college, one at a time — sections can only be created for a year that&apos;s been added here.
            </p>
            {loadingYears ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {academicYears.length === 0 && (
                  <p className="text-sm text-muted-foreground border rounded-lg p-3">No years added yet.</p>
                )}
                {academicYears
                  .slice()
                  .sort((a, b) => a.yearNumber - b.yearNumber)
                  .map((ay, i, arr) => {
                    const isLast = i === arr.length - 1;
                    return (
                      <div key={ay.id} className="flex items-center justify-between rounded-lg border p-3">
                        <span className="text-sm font-medium">{ay.label ?? yearOrdinalLabel(ay.yearNumber)}</span>
                        {isLast && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            loading={savingYear}
                            onClick={() => void removeLastYear()}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
            <Button type="button" variant="outline" className="w-full" loading={savingYear} onClick={() => void addNextYear()}>
              <Plus className="h-4 w-4 mr-2" />
              Add {yearOrdinalLabel(Math.max(0, ...academicYears.map((ay) => ay.yearNumber)) + 1)}
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setYearsCollege(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Academic Sessions Dialog */}
      <Dialog open={!!sessionsCollege} onOpenChange={(open) => !open && setSessionsCollege(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Academic Sessions — {sessionsCollege?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              Add calendar academic sessions for this college (e.g. &quot;2025-26&quot;) and mark the one currently in effect.
            </p>
            <form onSubmit={handleAddSession} className="flex items-center gap-2">
              <Input
                value={newSessionLabel}
                onChange={(e) => setNewSessionLabel(e.target.value)}
                placeholder="e.g. 2025-26"
                className="flex-1"
              />
              <Button type="submit" size="sm" loading={savingSession} disabled={!newSessionLabel.trim()}>
                Add
              </Button>
            </form>
            {loadingSessions ? (
              <div className="space-y-2">
                {[1, 2].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}
              </div>
            ) : academicSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No academic sessions added yet.</p>
            ) : (
              <div className="space-y-2">
                {academicSessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{s.label}</span>
                      {s.isCurrent && <Badge className="text-xs">Current</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      {!s.isCurrent && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={sessionActionId === s.id}
                          onClick={() => void setCurrentSession(s.id)}
                        >
                          Set Current
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={sessionActionId === s.id}
                        onClick={() => void deleteSession(s.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSessionsCollege(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
