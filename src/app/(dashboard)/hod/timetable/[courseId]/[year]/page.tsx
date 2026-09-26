"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, ClipboardList, Layers, Users, UserCog, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import { findBranchManager } from "@/lib/departments/managedBranches";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { supportingStaffDisplayName } from "@/lib/supportingStaff/supportingStaffDisplayName";
import { isFacultyAvailable } from "@/types";
import type { Course, Department, FacultyMember, Section, SupportingStaffMember, TimetableIncharge } from "@/types";

// One combined dropdown option, whichever roster it actually came from - see
// TimetableIncharge's own doc-comment: either a teaching faculty member or a
// Technical supporting-staff member can be made Incharge.
interface InchargeCandidate {
  id: string; // FacultyMember or SupportingStaffMember doc id (personId)
  name: string;
  userUid?: string;
  personType: "FACULTY" | "SUPPORTING_STAFF";
}

// One assignable Timetable Incharge unit for this course-year: either the
// whole year (the common, non-shared case - exactly one unit, covering every
// section) or, for a shared first year, one sub-department (e.g. "BASIC
// SCIENCE ENGLISH") that manages several branches' own Year-1 sections (e.g.
// "data science", "machine learning" - see Department.managedDepartments/
// findBranchManager). `courseIds` spans every branch course doc the unit
// covers - a shared-first-year unit assigns ONE Timetable Incharge doc per
// courseId in one batch call (POST/DELETE .../timetable-incharges with
// `courseIds`), all pointing at the same person, so the HOD never repeats
// this per branch.
interface InchargeUnit {
  key: string;
  name: string; // owning department's name - shown in the UI and matched against candidates' own `department`
  // The owning department's OWN parent (e.g. "BASIC SCIENCE" for sub-department
  // "BASIC SCIENCE ENGLISH"), when it has one. A sub-department like this
  // rarely has much of a dedicated faculty roster of its own - in practice
  // most of its faculty sit at the PARENT department instead (see the Faculty
  // Register's own "SUB-DEPARTMENT HODS" grouping) - so an eligible Incharge
  // candidate may belong to the parent too, not only to this exact
  // sub-department or the branches it manages.
  parentName: string | null;
  courseIds: string[];
  sections: Section[];
}

type InchargeState =
  | { kind: "LOADING" }
  | { kind: "NONE" }
  | { kind: "ONE"; incharge: TimetableIncharge }
  // A partially/inconsistently assigned unit (some branch course-years have a
  // different Incharge than others, or only some are assigned at all) - can
  // only happen right after a shared-first-year unit's grouping first forms
  // (e.g. one branch was assigned the old, per-branch way before this unit
  // existed). Assigning here overwrites every branch with the same person,
  // resolving it back to ONE.
  | { kind: "MIXED" };

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function HODTimetableSectionsPage() {
  const router = useRouter();
  const { courseId, year } = useParams<{ courseId: string; year: string }>();
  const [course, setCourse] = useState<Course | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Timetable Incharge - the one faculty member (teaching or technical
  // designation, see TimetableIncharge's own doc-comment) this HOD may
  // delegate a unit's Timetable and Teaching Assignments to as a co-editor.
  // Assigning here is what unlocks the same pages for them under their own
  // dashboard - see panel/timetable-incharge/page.tsx.
  const [inchargeState, setInchargeState] = useState<InchargeState>({ kind: "LOADING" });
  const [candidates, setCandidates] = useState<InchargeCandidate[]>([]);
  const [showInchargeDialog, setShowInchargeDialog] = useState(false);
  // "FACULTY_<id>" or "SUPPORTING_STAFF_<id>" - a single Select value has to
  // disambiguate the two rosters, since a faculty doc and a supporting-staff
  // doc could coincidentally share an id.
  const [selectedCandidateKey, setSelectedCandidateKey] = useState("");
  const [isSavingIncharge, setIsSavingIncharge] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  // A shared first year's sections span several branches, each filed under
  // its OWN Course doc (see the effect below) - grouping them by whichever
  // sub-department actually MANAGES each branch (Department.managedDepartments/
  // findBranchManager) is what lets one Timetable Incharge be assigned per
  // sub-department instead of one for the whole year regardless of branch.
  // A branch nothing manages (the ordinary, non-shared case) is its own unit
  // of one - so a course-year with no sharing at all still resolves to
  // exactly one unit, and the picker step below never appears for it.
  const unitGroups = useMemo<InchargeUnit[]>(() => {
    const map = new Map<string, InchargeUnit>();
    for (const s of sections) {
      const manager = findBranchManager(departments, s.department, course?.catalogId);
      const ownerName = manager?.department.name ?? s.department;
      const ownerParentId = manager?.department.parentDepartmentId
        ?? departments.find((d) => d.name === s.department)?.parentDepartmentId;
      const parentName = ownerParentId ? (departments.find((d) => d.id === ownerParentId)?.name ?? null) : null;
      const existing = map.get(ownerName);
      if (existing) {
        existing.sections.push(s);
        if (!existing.courseIds.includes(s.courseId)) existing.courseIds.push(s.courseId);
      } else {
        map.set(ownerName, { key: ownerName, name: ownerName, parentName, courseIds: [s.courseId], sections: [s] });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [sections, departments, course]);

  const [pickedUnitKey, setPickedUnitKey] = useState<string | null>(null);
  // Auto-resolves once there's only one unit (the common case) - the picker
  // step only ever shows when a shared first year actually produced more than
  // one sub-department to choose between.
  const activeUnit = unitGroups.length === 1 ? unitGroups[0] : (unitGroups.find((u) => u.key === pickedUnitKey) ?? null);

  // A stale pick from a previous course-year (e.g. "BASIC SCIENCE ENGLISH")
  // must not silently carry over and auto-select a same-named unit after
  // navigating to a different year - back to the picker every time the route
  // itself changes.
  useEffect(() => {
    void (async () => { setPickedUnitKey(null); })();
  }, [courseId, year]);

  function loadIncharge(unit: InchargeUnit) {
    setInchargeState({ kind: "LOADING" });
    Promise.all(
      unit.courseIds.map((cid) =>
        fetch(`/api/college/timetable-incharges?courseId=${encodeURIComponent(cid)}&year=${encodeURIComponent(year)}`)
          .then((r) => r.json() as Promise<{ incharge: TimetableIncharge | null }>)
          .then((d) => d.incharge ?? null)
      )
    )
      .then((results) => {
        const present = results.filter((r): r is TimetableIncharge => !!r);
        const uids = new Set(present.map((r) => r.uid));
        if (present.length === 0) setInchargeState({ kind: "NONE" });
        else if (present.length === unit.courseIds.length && uids.size === 1) setInchargeState({ kind: "ONE", incharge: present[0] });
        else setInchargeState({ kind: "MIXED" });
      })
      .catch(() => {
        setInchargeState({ kind: "NONE" });
        toast({ variant: "destructive", title: "Failed to load Timetable Incharge" });
      });
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [coursesData, deptsData] = await Promise.all([
          fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
          fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        ]);
        if (cancelled) return;
        const allCourses = coursesData.courses ?? [];
        setCourse(allCourses.find((c) => c.id === courseId) ?? null);
        setDepartments(deptsData.departments ?? []);

        // Every Course doc for the SAME catalog programme, across departments
        // (buildCourseGroups - same grouping the Sections page uses to show one
        // "Bachelor of Technology" card instead of one per department). A
        // shared-first-year section (e.g. a managed branch's own Year-1
        // section, filed under that branch's OWN Course doc - see
        // hod/sections/new's viaManagedBranch flow) never carries THIS course's
        // id, so querying by courseId alone silently returns nothing for it
        // even though it's clearly the same programme/year.
        const group = buildCourseGroups(allCourses).find((g) => g.courseIds.includes(courseId));
        const courseIdsForQuery = group ? group.courseIds : [courseId];

        const sectionsData = await fetch(
          `/api/college/sections?courseId=${encodeURIComponent(courseIdsForQuery.join(","))}&year=${encodeURIComponent(year)}`
        ).then((r) => r.json() as Promise<{ sections: Section[] }>);
        if (cancelled) return;
        setSections((sectionsData.sections ?? []).sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [courseId, year]);

  useEffect(() => {
    if (!activeUnit) return;
    // Wrapped so loadIncharge()'s setState calls aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => { loadIncharge(activeUnit); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUnit?.key, activeUnit?.courseIds.join(","), year]);

  function openInchargeDialog() {
    setSelectedCandidateKey("");
    setShowInchargeDialog(true);
    if (!activeUnit) return;
    // Eligible candidates span the unit's OWNING department (for a
    // shared-first-year sub-department, that's the sub-department itself,
    // e.g. "BASIC SCIENCE ENGLISH"), every branch it actually manages (e.g.
    // "data science", "machine learning" - each section's own real
    // `department`), AND its own PARENT department (e.g. "BASIC SCIENCE") -
    // in practice a sub-department rarely has much of its own dedicated
    // roster; most of its faculty sit at the parent instead. Matches the
    // batch POST's own relaxed same-unit rule (api/college/timetable-incharges).
    const departmentNames = Array.from(new Set([
      activeUnit.name,
      ...(activeUnit.parentName ? [activeUnit.parentName] : []),
      ...activeUnit.sections.map((s) => s.department),
    ]));
    // Both rosters ignore/broaden past the `department`/`staffCategory`
    // filters for an HOD caller (they return the HOD's whole scope, which can
    // span sub-departments/managed branches) - so each exact department name
    // is re-applied client-side on both, same as the faculty-only version did
    // before.
    Promise.all(
      departmentNames.flatMap((departmentName) => [
        fetch(`/api/college/faculty?department=${encodeURIComponent(departmentName)}`)
          .then((r) => r.json() as Promise<{ faculty: FacultyMember[] }>)
          .then((d) => (d.faculty ?? [])
            .filter((f) => isFacultyAvailable(f.status) && f.department === departmentName)
            .map((f): InchargeCandidate => ({ id: f.id, name: facultyDisplayName(f), userUid: f.userUid, personType: "FACULTY" }))),
        fetch(`/api/college/supporting-staff?staffCategory=TECHNICAL&department=${encodeURIComponent(departmentName)}`)
          .then((r) => r.json() as Promise<{ staff: SupportingStaffMember[] }>)
          .then((d) => (d.staff ?? [])
            .filter((s) => isFacultyAvailable(s.status) && s.department === departmentName)
            .map((s): InchargeCandidate => ({ id: s.id, name: supportingStaffDisplayName(s), userUid: s.userUid, personType: "SUPPORTING_STAFF" }))),
      ])
    )
      .then((lists) => {
        const byKey = new Map<string, InchargeCandidate>();
        for (const list of lists) for (const c of list) byKey.set(`${c.personType}_${c.id}`, c);
        const combined = Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
        setCandidates(combined);
        // Pre-select whoever's currently Incharge - TimetableIncharge only
        // stores their login uid (see its own doc-comment), not either
        // roster's own doc id, so match it back through userUid. Left
        // unselected for a MIXED unit - there's no single current answer.
        if (inchargeState.kind === "ONE") {
          const current = combined.find((c) => c.userUid === inchargeState.incharge.uid);
          if (current) setSelectedCandidateKey(`${current.personType}_${current.id}`);
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty" }));
  }

  async function handleAssignIncharge() {
    const selected = candidates.find((c) => `${c.personType}_${c.id}` === selectedCandidateKey);
    if (!selected || !activeUnit) return;
    setIsSavingIncharge(true);
    try {
      const res = await fetch("/api/college/timetable-incharges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseIds: activeUnit.courseIds, year: Number(year), personId: selected.id, personType: selected.personType }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to assign Timetable Incharge", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Timetable Incharge assigned" });
      setShowInchargeDialog(false);
      loadIncharge(activeUnit);
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setIsSavingIncharge(false);
    }
  }

  async function handleRevokeIncharge() {
    if (!activeUnit) return;
    setIsRevoking(true);
    try {
      // Every branch course-year in this unit, not just whichever docs
      // loadIncharge actually found - a MIXED/partial assignment must clear
      // completely, not leave a stray doc on a branch that hadn't loaded yet.
      const allIds = activeUnit.courseIds.map((cid) => `${cid}_year${year}`);
      const res = await fetch(`/api/college/timetable-incharges?ids=${encodeURIComponent(allIds.join(","))}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Timetable Incharge removed" });
      loadIncharge(activeUnit);
    } catch {
      toast({ variant: "destructive", title: "Failed to remove Timetable Incharge" });
    } finally {
      setIsRevoking(false);
      setConfirmRevoke(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={course ? `${course.name} · ${ordinalYear(Number(year))}` : "Timetable"}
        description={
          !activeUnit && unitGroups.length > 1
            ? "Pick a sub-department"
            : activeUnit && unitGroups.length > 1
            ? `Pick a section · ${activeUnit.name}`
            : "Pick a section"
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.push(`/hod/timetable/${courseId}/${year}/teaching-assignments`)}>
              <ClipboardList className="h-4 w-4 mr-2" />Teaching Assignments
            </Button>
            <Button
              variant="outline"
              onClick={() => (activeUnit && unitGroups.length > 1 ? setPickedUnitKey(null) : router.push(`/hod/timetable/${courseId}`))}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />{activeUnit && unitGroups.length > 1 ? "Back to Sub-Departments" : "Back to Years"}
            </Button>
          </div>
        }
      />

      {!isLoading && !activeUnit && unitGroups.length > 1 ? (
        // Shared first year: more than one sub-department manages a branch
        // here (e.g. "BASIC SCIENCE ENGLISH" running "data science"/"machine
        // learning"'s Year 1) - each gets its OWN Timetable Incharge, so pick
        // which one before assigning or browsing its sections.
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {unitGroups.map((u) => (
            <Card key={u.key} className="cursor-pointer transition-colors hover:border-primary/50" onClick={() => setPickedUnitKey(u.key)}>
              <CardContent className="p-4 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />{u.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Users className="h-3 w-3" />{u.sections.length} section{u.sections.length === 1 ? "" : "s"}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
      {/* Timetable Incharge - a co-editor, not a handoff: assigning someone
          here doesn't take anything away from this HOD, it just lets that
          faculty member reach the same Timetable & Teaching Assignments
          pages for this unit from their own dashboard too. For a shared first
          year this covers every branch course-year the active sub-department
          manages in one go - see the batch POST/DELETE in
          api/college/timetable-incharges. */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <UserCog className="h-4 w-4 text-muted-foreground shrink-0" />
            {inchargeState.kind === "LOADING" ? (
              <div className="h-4 w-40 bg-muted animate-pulse rounded" />
            ) : inchargeState.kind === "ONE" ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Timetable Incharge:</span>{" "}
                <span className="font-medium">{inchargeState.incharge.facultyName}</span>
              </p>
            ) : inchargeState.kind === "MIXED" ? (
              <p className="text-sm text-amber-700">Different people cover different branches here - assign one to unify.</p>
            ) : (
              <p className="text-sm text-muted-foreground">No Timetable Incharge assigned for this year yet.</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={openInchargeDialog}>
              {inchargeState.kind === "NONE" ? "Assign Timetable Incharge" : "Change"}
            </Button>
            {(inchargeState.kind === "ONE" || inchargeState.kind === "MIXED") && (
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmRevoke(true)}>
                <X className="h-3.5 w-3.5 mr-1" />Revoke
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : !activeUnit || activeUnit.sections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No sections have been created for this year yet. Add sections under the Sections module first.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {activeUnit.sections.map((s) => (
            <Card
              key={s.id}
              className="cursor-pointer transition-colors hover:border-primary/50"
              // This section's OWN real courseId, not the (possibly sibling)
              // one in the URL - the list above now joins every Course doc for
              // this catalog programme, so a managed branch's section (e.g.
              // BSC-CSE-A, filed under CSE's own Course doc) must still open
              // under ITS OWN courseId, or its saved timetable would be keyed
              // to the wrong Course doc entirely.
              onClick={() => router.push(`/hod/timetable/${s.courseId}/${year}/${s.id}`)}
            >
              <CardContent className="p-4 flex items-center justify-between gap-2">
                <div>
                  {/* Department code included: a parent HOD sees their own "A"
                      alongside each sub-department's "A". */}
                  <p className="font-semibold text-sm">{sectionDisplayLabel(s, departments)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Users className="h-3 w-3" />{s.studentCount ?? 0} students
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      </>
      )}

      <Dialog open={showInchargeDialog} onOpenChange={setShowInchargeDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{inchargeState.kind === "NONE" ? "Assign" : "Change"} Timetable Incharge{activeUnit && unitGroups.length > 1 ? ` · ${activeUnit.name}` : ""}</DialogTitle>
            <DialogDescription>
              They&rsquo;ll be able to build/edit/publish {activeUnit && unitGroups.length > 1 ? `${activeUnit.name}’s` : "this year’s"} timetable and assign faculty to subjects
              from their own dashboard, same as you can - you keep full access too.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Faculty / Supporting Staff</Label>
            <Select value={selectedCandidateKey} onValueChange={setSelectedCandidateKey}>
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
            <Button variant="outline" onClick={() => setShowInchargeDialog(false)}>Cancel</Button>
            <Button onClick={() => void handleAssignIncharge()} loading={isSavingIncharge} disabled={!selectedCandidateKey}>
              {inchargeState.kind === "NONE" ? "Assign" : "Change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Revoke Timetable Incharge?"
        description={`${inchargeState.kind === "ONE" ? inchargeState.incharge.facultyName : "Whoever is currently assigned"} will lose access to ${activeUnit && unitGroups.length > 1 ? activeUnit.name : "this year"}’s Timetable and Teaching Assignments pages. Anything they already did stays as-is - this only removes their access going forward.`}
        confirmLabel="Revoke"
        variant="destructive"
        loading={isRevoking}
        onConfirm={() => void handleRevokeIncharge()}
      />
    </div>
  );
}
