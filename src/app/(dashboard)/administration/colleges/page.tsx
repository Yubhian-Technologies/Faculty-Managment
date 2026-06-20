"use client";

import { useEffect, useState } from "react";
import { UserPlus, ChevronDown, ChevronUp, Plus } from "lucide-react";
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
import type { College } from "@/types";

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
                  ) : principals.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No principals assigned yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {principals.map((p) => (
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
    </div>
  );
}
