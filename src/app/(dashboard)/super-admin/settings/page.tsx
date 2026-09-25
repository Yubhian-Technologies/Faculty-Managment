"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import { Plus, Trash2, Info, KeyRound } from "lucide-react";
import { formatDate, stripLeadingZeros } from "@/lib/utils";
import { Skeleton } from "@/components/shared/SkeletonLoader";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import type { FacultyNorms, PositionNorm, RegulatoryBody, College, UserRole, NavVisibilitySettings } from "@/types";
import { ROLE_LABELS } from "@/types";
import { getNavItemsForRole, groupNavItemsByModule, getRolesWithNavModules, isPersonalNavItem } from "@/components/layout/navConfig";
import { isSeatRole } from "@/lib/roles/seatRoles";

const REGULATORY_BODIES: { value: RegulatoryBody; label: string }[] = [
  { value: "UGC", label: "UGC - University Grants Commission" },
  { value: "AICTE", label: "AICTE - All India Council for Technical Education" },
  { value: "NAAC", label: "NAAC - National Assessment and Accreditation Council" },
  { value: "STATE", label: "State Regulatory Body" },
];

// kept for potential future cadre/qualification lookups; not rendered after Jobs 3+4
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const QUALIFICATION_OPTIONS = [
  "B.E / B.Tech",
  "M.E / M.Tech",
  "M.Phil",
  "M.Phil / NET",
  "M.Phil / NET / Ph.D",
  "Ph.D",
  "Ph.D with NET",
  "Ph.D with 5 years experience",
  "Ph.D with 10 years experience",
];

const emptyPosition = (): PositionNorm => ({
  designation: "",
  requiredPerDept: 1,
});

export default function SuperAdminSettingsPage() {
  const [norms, setNorms] = useState<FacultyNorms | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Faculty Norms are per-college (colleges/{id}/settings/general) - pick a
  // college to view/edit, same pattern as the Navigation Visibility section below.
  const [normsColleges, setNormsColleges] = useState<College[]>([]);
  const [normsCollegeId, setNormsCollegeId] = useState<string>("");

  // Form state
  const [regulatoryBody, setRegulatoryBody] = useState<RegulatoryBody>("UGC");
  const [studentFacultyRatio, setStudentFacultyRatio] = useState("15");
  const [teachingHoursPerWeek, setTeachingHoursPerWeek] = useState("16");
  const [defaultMinFacultyPerDept, setDefaultMinFacultyPerDept] = useState("3");
  const [positionNorms, setPositionNorms] = useState<PositionNorm[]>([]);

  // Batch 2: AbortControllers for settings fetches — abort previous before new, cleanup on unmount
  const normsCollegesAbortRef = useRef<AbortController | null>(null);
  const normsFetchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { normsCollegesAbortRef.current?.abort(); normsFetchAbortRef.current?.abort(); }, []);

  useEffect(() => {
    normsCollegesAbortRef.current?.abort();
    const ctrl = new AbortController();
    normsCollegesAbortRef.current = ctrl;
    fetch("/api/admin/colleges", { signal: ctrl.signal })
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then(({ colleges: c }) => {
        setNormsColleges(c);
        if (c.length > 0) setNormsCollegeId((prev) => prev || c[0].id);
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        toast({ variant: "destructive", title: "Failed to load colleges" });
      });
  }, []);

  useEffect(() => {
    if (!normsCollegeId) return;
    normsFetchAbortRef.current?.abort();
    const ctrl = new AbortController();
    normsFetchAbortRef.current = ctrl;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    fetch(`/api/college/settings/general?collegeId=${normsCollegeId}`, { signal: ctrl.signal })
      .then((r) => r.json() as Promise<{ settings: FacultyNorms }>)
      .then(({ settings: n }) => {
        setNorms(n);
        setRegulatoryBody(n.regulatoryBody);
        setStudentFacultyRatio(String(n.studentFacultyRatio));
        setTeachingHoursPerWeek(String(n.teachingHoursPerWeek));
        setDefaultMinFacultyPerDept(String(n.defaultMinFacultyPerDept));
        setPositionNorms(n.positionNorms ?? []);
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        toast({ variant: "destructive", title: "Failed to load settings" });
      })
      .finally(() => setIsLoading(false));
  }, [normsCollegeId]);

  function updatePosition(index: number, field: keyof PositionNorm, value: string | number) {
    setPositionNorms((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  }

  function removePosition(index: number) {
    setPositionNorms((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    const sfr = Number(studentFacultyRatio);
    const thw = Number(teachingHoursPerWeek);
    const dmf = Number(defaultMinFacultyPerDept);

    if (!sfr || sfr < 1 || !thw || thw < 1 || !dmf || dmf < 1) {
      toast({ variant: "destructive", title: "All numeric fields must be positive numbers" });
      return;
    }
    if (positionNorms.some((p) => !p.designation.trim())) {
      toast({ variant: "destructive", title: "All position designations must be filled" });
      return;
    }

    if (!normsCollegeId) {
      toast({ variant: "destructive", title: "Select a college first" });
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch("/api/college/settings/general", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collegeId: normsCollegeId,
          regulatoryBody,
          studentFacultyRatio: sfr,
          teachingHoursPerWeek: thw,
          defaultMinFacultyPerDept: dmf,
          positionNorms,
        } satisfies Partial<FacultyNorms> & { collegeId: string }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Faculty norms saved", description: "Changes will be reflected across all vacancy requests." });
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Faculty Norms Configuration"
        description="Set government-mandated faculty requirements used to validate vacancy requests - configured per college"
      />

      <div className="max-w-sm space-y-2">
        <Label>College</Label>
        <Select value={normsCollegeId} onValueChange={setNormsCollegeId}>
          <SelectTrigger>
            <SelectValue placeholder="Select a college" />
          </SelectTrigger>
          <SelectContent>
            {normsColleges.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          {/* Last updated banner */}
          {norms?.updatedAt && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border bg-muted/40 px-3 py-2">
              <Info className="h-3.5 w-3.5 shrink-0" />
              Last updated {formatDate(norms.updatedAt)} by {norms.updatedByName ?? "Super Admin"}
            </div>
          )}

          {/* Regulatory Body */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Regulatory Authority</CardTitle>
              <CardDescription>The body whose norms govern faculty requirements for your institutions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-w-sm space-y-2">
                <Label htmlFor="reg-body">Regulatory Body</Label>
                <Select value={regulatoryBody} onValueChange={(v) => setRegulatoryBody(v as RegulatoryBody)}>
                  <SelectTrigger id="reg-body">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGULATORY_BODIES.map((b) => (
                      <SelectItem key={b.value} value={b.value}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Core Ratios */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fundamental Ratios</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-5 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="sfr">Student : Faculty Ratio</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="sfr"
                      type="number"
                      min={1}
                      max={100}
                      value={studentFacultyRatio}
                      onChange={(e) => setStudentFacultyRatio(stripLeadingZeros(e.target.value))}
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">: 1</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Students per faculty member</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="thw">Teaching Hours / Week</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="thw"
                      type="number"
                      min={1}
                      max={40}
                      value={teachingHoursPerWeek}
                      onChange={(e) => setTeachingHoursPerWeek(stripLeadingZeros(e.target.value))}
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">hrs</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Required contact hours per week</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dmf">Min. Faculty per Department</Label>
                  <Input
                    id="dmf"
                    type="number"
                    min={1}
                    max={50}
                    value={defaultMinFacultyPerDept}
                    onChange={(e) => setDefaultMinFacultyPerDept(stripLeadingZeros(e.target.value))}
                    className="w-24"
                  />
                  <p className="text-xs text-muted-foreground">Default minimum headcount</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cadre-wise Ratio */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Cadre-wise Ratio</CardTitle>
                  <CardDescription className="mt-1">Required count per designation per department</CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPositionNorms((prev) => [...prev, emptyPosition()])}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Position
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {positionNorms.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No positions configured. Click "Add Position" to define position norms.
                </p>
              ) : (
                positionNorms.map((pos, i) => (
                  <div key={i} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary">Position {i + 1}</Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => removePosition(i)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Designation *</Label>
                        <Input
                          value={pos.designation}
                          onChange={(e) => updatePosition(i, "designation", e.target.value)}
                          placeholder="e.g. Assistant Professor"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Required per Department</Label>
                        <Input
                          type="number"
                          min={1}
                          max={20}
                          value={pos.requiredPerDept}
                          onChange={(e) => updatePosition(i, "requiredPerDept", Number(e.target.value))}
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Save */}
          <div className="flex justify-end">
            <Button size="lg" onClick={handleSave} loading={isSaving}>
              Save Faculty Norms
            </Button>
          </div>
        </>
      )}

      <SuperAdminChangePasswordCard />

      <NavVisibilitySection />
    </div>
  );
}

// ─── Change Password (Super Admin self-service, moved from /super-admin/profile) ─

const FIREBASE_CHANGE_PW_ERRORS: Record<string, string> = {
  "auth/wrong-password": "Current password is incorrect.",
  "auth/invalid-credential": "Current password is incorrect.",
  "auth/weak-password": "New password is too weak - use at least 8 characters.",
  "auth/requires-recent-login": "Please log out and log back in, then try again.",
  "auth/too-many-requests": "Too many attempts. Please try again later.",
  "auth/network-request-failed": "Network error. Please check your connection.",
};

function SuperAdminChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChanging, setIsChanging] = useState(false);

  async function handleChangePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ variant: "destructive", title: "All fields are required" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ variant: "destructive", title: "New password must be at least 8 characters" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ variant: "destructive", title: "Passwords do not match" });
      return;
    }
    if (newPassword === currentPassword) {
      toast({ variant: "destructive", title: "New password must be different from current password" });
      return;
    }
    const currentUser = auth.currentUser;
    if (!currentUser?.email) {
      toast({ variant: "destructive", title: "No active session", description: "Please log in again." });
      return;
    }
    setIsChanging(true);
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPassword);
      toast({ variant: "success", title: "Password changed" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      toast({
        variant: "destructive",
        title: "Failed to change password",
        description: FIREBASE_CHANGE_PW_ERRORS[code] ?? "Please try again.",
      });
    } finally {
      setIsChanging(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          Change Password
        </CardTitle>
        <CardDescription>Update your Super Admin login password</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="sa-current-password">Current Password *</Label>
          <Input
            id="sa-current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Enter current password"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sa-new-password">New Password *</Label>
          <Input
            id="sa-new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Min 8 characters"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sa-confirm-password">Confirm New Password *</Label>
          <Input
            id="sa-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={handleChangePassword} loading={isChanging}>
            Change Password
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Navigation Visibility ──────────────────────────────────────────────────
// Per-college, per-role control over which sidebar modules (and individual
// items within a module, e.g. HOD's "My Work") are visible. Backed by
// colleges/{collegeId}/settings/navVisibility - see
// src/app/api/admin/settings/nav-visibility/route.ts.

// Computed once from NAV_ITEMS - any role with at least one `section`-grouped
// item shows up here automatically, no manual list to keep in sync.
const NAV_VISIBILITY_ROLES: UserRole[] = getRolesWithNavModules();

function NavVisibilitySection() {
  const [colleges, setColleges] = useState<College[]>([]);
  const [collegeId, setCollegeId] = useState<string>("");
  const [role, setRole] = useState<UserRole>("HOD");
  const [hiddenModules, setHiddenModules] = useState<string[]>([]);
  const [hiddenItems, setHiddenItems] = useState<string[]>([]);
  const [updatedMeta, setUpdatedMeta] = useState<Pick<NavVisibilitySettings, "updatedAt" | "updatedByName"> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Batch 2: AbortControllers for nav-visibility fetches
  const navCollegesAbortRef = useRef<AbortController | null>(null);
  const navSettingsAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { navCollegesAbortRef.current?.abort(); navSettingsAbortRef.current?.abort(); }, []);

  useEffect(() => {
    navCollegesAbortRef.current?.abort();
    const ctrl = new AbortController();
    navCollegesAbortRef.current = ctrl;
    fetch("/api/admin/colleges", { signal: ctrl.signal })
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then(({ colleges: c }) => {
        setColleges(c);
        if (c.length > 0) setCollegeId((prev) => prev || c[0].id);
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        toast({ variant: "destructive", title: "Failed to load colleges" });
      });
  }, []);

  useEffect(() => {
    if (!collegeId) return;
    navSettingsAbortRef.current?.abort();
    const ctrl = new AbortController();
    navSettingsAbortRef.current = ctrl;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    fetch(`/api/admin/settings/nav-visibility?collegeId=${collegeId}`, { signal: ctrl.signal })
      .then((r) => r.json() as Promise<{ settings: NavVisibilitySettings }>)
      .then(({ settings }) => {
        setHiddenModules(settings.hiddenModules?.[role] ?? []);
        setHiddenItems(settings.hiddenItems?.[role] ?? []);
        setUpdatedMeta({ updatedAt: settings.updatedAt, updatedByName: settings.updatedByName });
      })
      .catch((err) => {
        if ((err as Error)?.name === "AbortError") return;
        toast({ variant: "destructive", title: "Failed to load navigation visibility" });
      })
      .finally(() => setIsLoading(false));
  }, [collegeId, role]);

  // A seat (Principal, HOD, ...) is a position held by someone whose own login
  // carries their profile / leave / attendance - those come from that person's
  // primary role, not the seat. So a seat's modules are its position items only;
  // the personal ones are split into their own group below, shown for the rare
  // login whose primary role IS this seat. Primary roles (Faculty, Office, ...)
  // have no seats to separate, so everything stays in one list.
  const roleItems = getNavItemsForRole(role);
  const splitPersonal = isSeatRole(role);
  const modules = groupNavItemsByModule(splitPersonal ? roleItems.filter((i) => !isPersonalNavItem(i)) : roleItems);
  const personalItems = splitPersonal ? roleItems.filter((i) => isPersonalNavItem(i)) : [];

  function toggleModule(moduleName: string, hide: boolean) {
    setHiddenModules((prev) => (hide ? [...prev, moduleName] : prev.filter((m) => m !== moduleName)));
  }

  function toggleItem(href: string, hide: boolean) {
    setHiddenItems((prev) => (hide ? [...prev, href] : prev.filter((h) => h !== href)));
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/admin/settings/nav-visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeId, role, hiddenModules, hiddenItems }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Navigation visibility saved", description: `Applied to ${ROLE_LABELS[role]} at the selected college.` });
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Navigation Visibility</CardTitle>
        <CardDescription>
          Hide unfinished modules (or individual items within a module) from a role&apos;s sidebar - per college, without a code change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>College</Label>
            <Select value={collegeId} onValueChange={setCollegeId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a college" />
              </SelectTrigger>
              <SelectContent>
                {colleges.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NAV_VISIBILITY_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {updatedMeta?.updatedAt && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border bg-muted/40 px-3 py-2">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Last updated {formatDate(updatedMeta.updatedAt)} by {updatedMeta.updatedByName ?? "Super Admin"}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : modules.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {ROLE_LABELS[role]} has no grouped modules to configure.
          </p>
        ) : (
          <div className="space-y-4">
            {modules.map((mod) => {
              const moduleHidden = hiddenModules.includes(mod.name);
              return (
                <div key={mod.name} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">{mod.name}</span>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <Checkbox
                        checked={moduleHidden}
                        onCheckedChange={(checked) => toggleModule(mod.name, checked === true)}
                      />
                      Hide entire module
                    </label>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {mod.items.map((item) => (
                      <label
                        key={item.href}
                        className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded-md ${moduleHidden ? "opacity-50" : "cursor-pointer hover:bg-muted/50"}`}
                      >
                        <Checkbox
                          disabled={moduleHidden}
                          checked={moduleHidden || hiddenItems.includes(item.href)}
                          onCheckedChange={(checked) => toggleItem(item.href, checked === true)}
                        />
                        {item.label}
                        <code className="text-[10px] text-muted-foreground ml-auto">{item.href}</code>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
            {personalItems.length > 0 && (
              <div className="rounded-lg border border-dashed p-4 space-y-3">
                <div>
                  <span className="text-sm font-semibold">Personal items</span>
                  <p className="text-xs text-muted-foreground">
                    Profile, leave and attendance belong to the person&apos;s own login (Faculty, Office, ...), not to the {ROLE_LABELS[role]} seat.
                    These apply only to an account whose own role is {ROLE_LABELS[role]}.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {personalItems.map((item) => (
                    <label key={item.href} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-md cursor-pointer hover:bg-muted/50">
                      <Checkbox
                        checked={hiddenItems.includes(item.href)}
                        onCheckedChange={(checked) => toggleItem(item.href, checked === true)}
                      />
                      {item.label}
                      <code className="text-[10px] text-muted-foreground ml-auto">{item.href}</code>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} loading={isSaving} disabled={!collegeId || isLoading}>
            Save Navigation Visibility
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
