"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { UserPlus, UserCog, ChevronDown, ChevronUp, Plus, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { COLLEGE_TYPE_LABELS } from "@/types";
import type { College } from "@/types";

type PrincipalRow = { uid: string; name: string; email: string; phone?: string; roles: string[] };
const ROLE_NAMES: Record<string, string> = { COLLEGE_ADMIN: "College Admin", PRINCIPAL: "Principal", VICE_PRINCIPAL: "Vice Principal" };

export default function AdministrationCollegesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [colleges, setColleges] = useState<College[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Seeded from the dashboard's college picker (?collegeId=) so arriving here
  // via "Colleges" with one already selected lands pre-expanded on it,
  // instead of a flat unexpanded list.
  const [expandedId, setExpandedId] = useState<string | null>(() => searchParams.get("collegeId"));
  // Read-only: who currently holds the Principal/VP seat, shown in each row's
  // expanded detail. There's no "Add Principal" action on this page any more
  // - Principal (and every other seat) is appointed from within the college,
  // by its College Admin, via Role Assignments - never handed out directly by
  // Location Admin (see api/administration/college-people's comment).
  const [principalMap, setPrincipalMap] = useState<Record<string, PrincipalRow[]>>({});
  const [principalsLoaded, setPrincipalsLoaded] = useState(false);
  const [editing, setEditing] = useState<{ collegeId: string; person: PrincipalRow } | null>(null);
  const [deleting, setDeleting] = useState<{ collegeId: string; person: PrincipalRow } | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);

  function openEdit(collegeId: string, person: PrincipalRow) {
    setForm({ name: person.name, phone: person.phone ?? "", email: person.email, password: "" });
    setEditing({ collegeId, person });
  }

  async function saveEdit() {
    if (!editing) return;
    if (!form.email.trim()) { toast({ variant: "destructive", title: "Email can't be empty" }); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/administration/college-people/${editing.person.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collegeId: editing.collegeId,
          name: form.name,
          phone: form.phone,
          collegeEmail: form.email,
          ...(form.password ? { newPassword: form.password } : {}),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: "Couldn't save", description: json.error }); return; }
      toast({ variant: "success", title: "Saved" });
      setEditing(null);
      loadAll();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/administration/college-people/${deleting.person.uid}?collegeId=${deleting.collegeId}`, { method: "DELETE" });
      const json = (await res.json()) as { error?: string; mode?: string };
      if (!res.ok) { toast({ variant: "destructive", title: "Couldn't remove", description: json.error }); return; }
      toast({
        variant: "success",
        title: json.mode === "deactivated" ? "Access removed" : "Deleted",
        description: json.mode === "deactivated" ? "They are also on the college roster, so their account was switched off rather than deleted." : undefined,
      });
      setDeleting(null);
      loadAll();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setBusy(false);
    }
  }

  function loadAll() {
    setIsLoading(true);
    setPrincipalsLoaded(false);
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((d) => setColleges(d.colleges ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load colleges" }))
      .finally(() => setIsLoading(false));

    fetch("/api/administration/principals")
      .then((r) => r.json() as Promise<{ principalsByCollege: Record<string, PrincipalRow[]> }>)
      .then((d) => setPrincipalMap(d.principalsByCollege ?? {}))
      .catch(() => toast({ variant: "destructive", title: "Failed to load principals" }))
      .finally(() => setPrincipalsLoaded(true));
  }

  useEffect(() => {
    // Runs once, after the picked college's row exists in the DOM - scrolls
    // it into view so arriving from the dashboard doesn't leave it hidden
    // below the fold in a long college list.
    if (!isLoading && expandedId) {
      document.getElementById(`college-${expandedId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  useEffect(() => {
    loadAll();
    // Re-fetch whenever the tab regains focus (e.g. coming back from the "Add
    // College Admin" page via the browser's back button, which can restore
    // this page's previous in-memory state via Next's router cache instead
    // of remounting it) so a newly-added person is reflected without
    // needing a manual hard reload.
    function onFocus() { loadAll(); }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  function toggleExpand(college: College) {
    setExpandedId((prev) => (prev === college.id ? null : college.id));
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
          <Button onClick={() => router.push("/administration/colleges/new")}>
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
          const principalList = principalMap[college.id];
          // A college only ever has one College Admin (enforced server-side
          // by api/administration/college-people's singleton check) - the
          // button offering to add one is hidden once that seat is already
          // held, instead of staying clickable and only failing with a 409
          // after the fact.
          const hasCollegeAdmin = (principalList ?? []).some((p) => p.roles.includes("COLLEGE_ADMIN"));

          return (
            <div
              key={college.id}
              id={`college-${college.id}`}
              className={`rounded-lg border bg-card overflow-hidden ${college.id === searchParams.get("collegeId") ? "ring-2 ring-primary/40" : ""}`}
            >
              {/* College row */}
              <div className="flex items-center justify-between p-4">
                <div
                  className="flex items-center gap-3 min-w-0 cursor-pointer"
                  title="View departments"
                  onClick={() => router.push(`/administration/colleges/${college.id}/departments`)}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate hover:underline">{college.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{college.contactEmail ?? college.address ?? "-"}</p>
                  </div>
                  {college.type && (
                    <Badge variant="outline" className="shrink-0 text-xs font-normal">
                      {COLLEGE_TYPE_LABELS[college.type]}
                    </Badge>
                  )}
                  <Badge variant={college.isActive ? "default" : "secondary"} className="shrink-0">
                    {college.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => router.push(`/administration/colleges/${college.id}/edit`)}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Edit
                  </Button>
                  {/* A college starts with no people at all: add the first one
                      here, then appoint them to seats (College Admin, Principal,
                      ...) in Role Assignments - the seat holders take it from
                      there. Once the College Admin seat is held, this action is
                      replaced by a status badge - there's only ever one, and a
                      different person takes over via that seat's own Edit/Delete
                      below (or Role Assignments), never by adding a second one. */}
                  {!principalsLoaded ? (
                    <Button size="sm" variant="outline" disabled>
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                      Add College Admin
                    </Button>
                  ) : hasCollegeAdmin ? (
                    <Badge variant="secondary" className="shrink-0">College Admin assigned</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push(`/administration/colleges/${college.id}/people/new`)}
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                      Add College Admin
                    </Button>
                  )}
                  {/* Hands the College Admin seat to a DIFFERENT existing person
                      (or back to a previous one) - the singleton check above
                      only ever offers "Add College Admin" for creating a brand-new
                      login, which correctly refuses an email that already has an
                      account. Reassigning without creating anything new happens
                      here instead. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => router.push(`/administration/role-assignments?collegeId=${college.id}`)}
                  >
                    <UserCog className="h-3.5 w-3.5 mr-1.5" />
                    Role Assignments
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggleExpand(college)}
                  >
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Expanded panel - College Admin only. Principal/Vice Principal
                  are appointed from inside the college (via its own Role
                  Assignments), never by Location Admin, so they're left out
                  here rather than shown alongside a seat this page doesn't
                  manage. */}
              {isExpanded && (
                <div className="border-t px-4 pb-4 pt-3 bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">College Admin</p>
                  {!principalsLoaded ? (
                    <div className="h-8 w-32 bg-muted animate-pulse rounded" />
                  ) : !hasCollegeAdmin ? (
                    <p className="text-sm text-muted-foreground">No College Admin yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {(principalList ?? []).filter((p) => p.roles.includes("COLLEGE_ADMIN")).map((p) => (
                        <div key={p.uid} className="flex items-center justify-between rounded-lg border bg-card p-3">
                          <div>
                            <p className="text-sm font-medium">{p.name}</p>
                            <p className="text-xs text-muted-foreground">{p.email}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline" className="text-xs">{ROLE_NAMES.COLLEGE_ADMIN}</Badge>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(college.id, p)}>
                              <Pencil className="h-3.5 w-3.5 mr-1.5" />Edit
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting({ collegeId: college.id, person: p })}>
                              <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete
                            </Button>
                          </div>
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
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editing?.person.roles.map((r) => ROLE_NAMES[r] ?? r).join(" / ")}</DialogTitle>
            <DialogDescription>Update the login details. Leave the password blank to keep it as it is.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Login email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Phone</Label><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>New password</Label><Input type="password" autoComplete="new-password" placeholder="Leave blank to keep current" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={saveEdit} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.person.name || deleting?.person.email}?</DialogTitle>
            <DialogDescription>
              They lose access straight away and any seat they hold ({deleting?.person.roles.map((r) => ROLE_NAMES[r] ?? r).join(", ")}) becomes empty, ready for a new appointment. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>{busy ? "Deleting..." : "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
