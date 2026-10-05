"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { UserCog, X } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { findBranchManager, managerTeachingYears } from "@/lib/departments/managedBranches";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { supportingStaffDisplayName } from "@/lib/supportingStaff/supportingStaffDisplayName";
import { ordinalYear } from "@/lib/timetable/gridModel";
import { isFacultyAvailable } from "@/types";
import type {
  Course, Department, FacultyMember, Section, SupportingStaffMember, TimetableIncharge,
} from "@/types";

// Timetable Incharge for the course-year picked on the HOD Timetable page, laid
// out like Role Assignments: one card per assignable unit with who holds it and
// Assign / Change / Revoke beside it. A unit is the whole year - or, for a
// shared first year, one managing sub-department's share of it. The assignment
// is per course-YEAR (TimetableIncharge has no semester), so the Semester picked
// above does not change it.

interface Unit {
  key: string;
  courseName: string;
  year: number;
  ownerName: string; // owning department - shown, and matched against candidates' department
  parentName: string | null;
  shared: boolean; // the year is split between several managing sub-departments
  courseIds: string[];
  sections: Section[];
}

interface Candidate {
  id: string;
  name: string;
  userUid?: string;
  personType: "FACULTY" | "SUPPORTING_STAFF";
}

type Holder = { kind: "NONE" } | { kind: "ONE"; incharge: TimetableIncharge } | { kind: "MIXED" };

export function TimetableInchargePanel({
  courses, departments, sections, catalogId, year,
}: { courses: Course[]; departments: Department[]; sections: Section[]; catalogId?: string; year?: number }) {
  const [holders, setHolders] = useState<Record<string, Holder>>({});

  const [assignUnit, setAssignUnit] = useState<Unit | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [revokeUnit, setRevokeUnit] = useState<Unit | null>(null);
  const [revoking, setRevoking] = useState(false);

  const units = useMemo<Unit[]>(() => {
    // Resolve each course exactly as the assign route does: by the COURSE's own
    // department and catalog. The courses list is scoped to the viewer, so a
    // branch course can be missing from it - fall back to the section's own
    // department and the picked programme's catalog (one catalog per group).
    const catalogByCourse = new Map(courses.map((c) => [c.id, c.catalogId]));
    const deptNameByCourse = new Map(courses.map((c) => [c.id, departments.find((d) => d.id === c.departmentId)?.name]));
    const map = new Map<string, Unit>();
    for (const s of sections) {
      const branchName = deptNameByCourse.get(s.courseId) ?? s.department;
      const manager = findBranchManager(departments, branchName, catalogByCourse.get(s.courseId) ?? catalogId);
      const ownerName = manager?.department.name ?? branchName;
      const ownerParentId = manager?.department.parentDepartmentId
        ?? departments.find((d) => d.name === branchName)?.parentDepartmentId;
      const parentName = ownerParentId ? (departments.find((d) => d.id === ownerParentId)?.name ?? null) : null;
      const courseName = courses.find((c) => c.id === s.courseId)?.name ?? s.courseName ?? "";
      const key = `${courseName}|${s.year}|${ownerName}`;
      const existing = map.get(key);
      if (existing) {
        existing.sections.push(s);
        if (!existing.courseIds.includes(s.courseId)) existing.courseIds.push(s.courseId);
      } else {
        map.set(key, {
          key, courseName, year: Number(s.year), ownerName, parentName, shared: false,
          courseIds: [s.courseId], sections: [s],
        });
      }
    }
    // A managing sub-department with no sections of its own yet still gets a row,
    // so the main department sees every sub-department sharing this year and can
    // appoint its Incharge up front. Its branches' Course docs come from the
    // courses list (same programme, branch named in managedDepartments).
    if (year != null && catalogId) {
      for (const m of departments) {
        const managed = m.managedDepartments ?? [];
        if (managed.length === 0 || Array.from(map.values()).some((u) => u.ownerName === m.name)) continue;
        if (!managerTeachingYears(departments, m, catalogId).includes(year)) continue;
        const branchCourses = courses.filter(
          (c) => c.catalogId === catalogId && managed.includes(departments.find((d) => d.id === c.departmentId)?.name ?? "")
        );
        if (branchCourses.length === 0) continue;
        const parentName = m.parentDepartmentId ? (departments.find((d) => d.id === m.parentDepartmentId)?.name ?? null) : null;
        map.set(`${branchCourses[0].name}|${year}|${m.name}`, {
          key: `${branchCourses[0].name}|${year}|${m.name}`, courseName: branchCourses[0].name, year, ownerName: m.name,
          parentName, shared: false, courseIds: branchCourses.map((c) => c.id), sections: [],
        });
      }
    }
    const list = Array.from(map.values());
    const shared = list.length > 1;
    return list.map((u) => ({ ...u, shared })).sort((a, b) => a.ownerName.localeCompare(b.ownerName));
  }, [sections, departments, courses, catalogId, year]);

  const loadHolder = useCallback(async (unit: Unit) => {
    try {
      const results = await Promise.all(unit.courseIds.map((cid) =>
        fetch(`/api/college/timetable-incharges?courseId=${encodeURIComponent(cid)}&year=${unit.year}`)
          .then((r) => r.json() as Promise<{ incharge: TimetableIncharge | null }>)
          .then((d) => d.incharge ?? null)));
      const present = results.filter((r): r is TimetableIncharge => !!r);
      const uids = new Set(present.map((r) => r.uid));
      const holder: Holder = present.length === 0 ? { kind: "NONE" }
        : present.length === unit.courseIds.length && uids.size === 1 ? { kind: "ONE", incharge: present[0] }
        : { kind: "MIXED" };
      setHolders((h) => ({ ...h, [unit.key]: holder }));
    } catch {
      toast({ variant: "destructive", title: "Failed to load Timetable Incharge" });
    }
  }, []);

  useEffect(() => {
    void (async () => { for (const u of units) await loadHolder(u); })();
  }, [units, loadHolder]);

  function openAssign(unit: Unit) {
    setAssignUnit(unit);
    setSelectedKey("");
    setCandidates([]);
    // The unit's owning department, its parent (a sub-department's faculty
    // mostly sit there) and every branch it manages - same eligibility as the
    // per-year page and the batch POST's relaxed same-unit rule.
    const names = Array.from(new Set([unit.ownerName, ...(unit.parentName ? [unit.parentName] : []), ...unit.sections.map((s) => s.department)]));
    Promise.all(names.flatMap((name) => [
      fetch(`/api/college/faculty?department=${encodeURIComponent(name)}`)
        .then((r) => r.json() as Promise<{ faculty?: FacultyMember[] }>)
        .then((d) => (d.faculty ?? [])
          .filter((f) => isFacultyAvailable(f.status) && f.department === name)
          .map((f): Candidate => ({ id: f.id, name: facultyDisplayName(f), userUid: f.userUid, personType: "FACULTY" }))),
      fetch(`/api/college/supporting-staff?staffCategory=TECHNICAL&department=${encodeURIComponent(name)}`)
        .then((r) => r.json() as Promise<{ staff?: SupportingStaffMember[] }>)
        .then((d) => (d.staff ?? [])
          .filter((s) => isFacultyAvailable(s.status) && s.department === name)
          .map((s): Candidate => ({ id: s.id, name: supportingStaffDisplayName(s), userUid: s.userUid, personType: "SUPPORTING_STAFF" }))),
    ]))
      .then((lists) => {
        const byKey = new Map<string, Candidate>();
        for (const list of lists) for (const c of list) byKey.set(`${c.personType}_${c.id}`, c);
        const combined = Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
        setCandidates(combined);
        const holder = holders[unit.key];
        if (holder?.kind === "ONE") {
          const current = combined.find((c) => c.userUid === holder.incharge.uid);
          if (current) setSelectedKey(`${current.personType}_${current.id}`);
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty" }));
  }

  async function submitAssign() {
    const selected = candidates.find((c) => `${c.personType}_${c.id}` === selectedKey);
    if (!selected || !assignUnit) return;
    setSaving(true);
    try {
      const res = await fetch("/api/college/timetable-incharges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseIds: assignUnit.courseIds, year: assignUnit.year, personId: selected.id, personType: selected.personType }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to assign Timetable Incharge", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Timetable Incharge assigned" });
      const unit = assignUnit;
      setAssignUnit(null);
      await loadHolder(unit);
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  async function submitRevoke() {
    if (!revokeUnit) return;
    setRevoking(true);
    try {
      // Every branch course-year in the unit, so a MIXED assignment clears completely.
      const ids = revokeUnit.courseIds.map((cid) => `${cid}_year${revokeUnit.year}`);
      const res = await fetch(`/api/college/timetable-incharges?ids=${encodeURIComponent(ids.join(","))}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Timetable Incharge removed" });
      await loadHolder(revokeUnit);
    } catch {
      toast({ variant: "destructive", title: "Failed to remove Timetable Incharge" });
    } finally {
      setRevoking(false);
      setRevokeUnit(null);
    }
  }

  if (units.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Timetable Incharge</CardTitle>
        <CardDescription>
          Who builds and publishes this year&rsquo;s timetable and teaching assignments. They get the same pages from their own dashboard; you keep full access too.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {units.map((u) => {
          const holder = holders[u.key];
          return (
            <div key={u.key} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                {u.shared && <p className="text-sm font-semibold">{u.ownerName}</p>}
                <p className="text-sm">
                  {!holder ? <span className="text-muted-foreground">Loading…</span>
                    : holder.kind === "ONE" ? holder.incharge.facultyName
                    : holder.kind === "MIXED" ? <span className="text-amber-600">Different people per branch - assign one to unify</span>
                    : <span className="text-amber-600">Not assigned</span>}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" onClick={() => openAssign(u)} disabled={!holder}>
                  <UserCog className="h-3.5 w-3.5 mr-1" />{holder?.kind === "NONE" || !holder ? "Assign" : "Change"}
                </Button>
                {(holder?.kind === "ONE" || holder?.kind === "MIXED") && (
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRevokeUnit(u)}>
                    <X className="h-3.5 w-3.5 mr-1" />Revoke
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>

      <Dialog open={!!assignUnit} onOpenChange={(o) => { if (!o) setAssignUnit(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {assignUnit && holders[assignUnit.key]?.kind === "NONE" ? "Assign" : "Change"} Timetable Incharge
              {assignUnit ? ` · ${ordinalYear(assignUnit.year)}${assignUnit.shared ? ` · ${assignUnit.ownerName}` : ""}` : ""}
            </DialogTitle>
            <DialogDescription>
              They&rsquo;ll be able to build, edit and publish this timetable and assign faculty to subjects from their own dashboard. You keep full access too.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Faculty / Supporting Staff</Label>
            <Select value={selectedKey} onValueChange={setSelectedKey}>
              <SelectTrigger><SelectValue placeholder={candidates.length ? "Select a person" : "No one eligible here yet"} /></SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={`${c.personType}_${c.id}`} value={`${c.personType}_${c.id}`} disabled={!c.userUid}>
                    {c.name}{c.personType === "SUPPORTING_STAFF" ? " (Supporting Staff)" : ""}{!c.userUid ? " (no login yet)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignUnit(null)}>Cancel</Button>
            <Button onClick={() => void submitAssign()} loading={saving} disabled={!selectedKey}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!revokeUnit}
        onOpenChange={(o) => { if (!o) setRevokeUnit(null); }}
        title="Revoke Timetable Incharge?"
        description="They will lose access to this year’s Timetable and Teaching Assignments pages. Anything they already did stays as-is - this only removes their access going forward."
        confirmLabel="Revoke"
        variant="destructive"
        loading={revoking}
        onConfirm={() => void submitRevoke()}
      />
    </Card>
  );
}
