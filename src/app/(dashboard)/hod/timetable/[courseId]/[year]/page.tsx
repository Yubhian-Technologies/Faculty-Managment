"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, ClipboardList, Users, UserCog, X } from "lucide-react";
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
  // delegate THIS course-year's Timetable and Teaching Assignments to as a
  // co-editor. Assigning here is what unlocks the same pages for them under
  // their own dashboard - see panel/timetable-incharge/page.tsx.
  const [incharge, setIncharge] = useState<TimetableIncharge | null>(null);
  const [isLoadingIncharge, setIsLoadingIncharge] = useState(true);
  const [candidates, setCandidates] = useState<InchargeCandidate[]>([]);
  const [showInchargeDialog, setShowInchargeDialog] = useState(false);
  // "FACULTY_<id>" or "SUPPORTING_STAFF_<id>" - a single Select value has to
  // disambiguate the two rosters, since a faculty doc and a supporting-staff
  // doc could coincidentally share an id.
  const [selectedCandidateKey, setSelectedCandidateKey] = useState("");
  const [isSavingIncharge, setIsSavingIncharge] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  function loadIncharge() {
    setIsLoadingIncharge(true);
    fetch(`/api/college/timetable-incharges?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`)
      .then((r) => r.json() as Promise<{ incharge: TimetableIncharge | null }>)
      .then((d) => setIncharge(d.incharge ?? null))
      .catch(() => toast({ variant: "destructive", title: "Failed to load Timetable Incharge" }))
      .finally(() => setIsLoadingIncharge(false));
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [coursesData, sectionsData, deptsData] = await Promise.all([
          fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
          fetch(`/api/college/sections?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`)
            .then((r) => r.json() as Promise<{ sections: Section[] }>),
          fetch("/api/college/departments")
            .then((r) => r.json() as Promise<{ departments: Department[] }>),
        ]);
        if (cancelled) return;
        setCourse((coursesData.courses ?? []).find((c) => c.id === courseId) ?? null);
        setSections((sectionsData.sections ?? []).sort((a, b) => a.name.localeCompare(b.name)));
        setDepartments(deptsData.departments ?? []);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [courseId, year]);

  useEffect(() => {
    // Wrapped so loadIncharge()'s setState calls aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => { loadIncharge(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, year]);

  function openInchargeDialog() {
    setSelectedCandidateKey("");
    setShowInchargeDialog(true);
    const departmentName = course ? departments.find((d) => d.id === course.departmentId)?.name : undefined;
    if (!departmentName) return;
    // Both rosters ignore/broaden past the `department`/`staffCategory`
    // filters for an HOD caller (they return the HOD's whole scope, which can
    // span sub-departments/managed branches) - so this exact course's
    // department is re-applied client-side on both, same as the faculty-only
    // version did before.
    Promise.all([
      fetch(`/api/college/faculty?department=${encodeURIComponent(departmentName)}`)
        .then((r) => r.json() as Promise<{ faculty: FacultyMember[] }>)
        .then((d) => (d.faculty ?? [])
          .filter((f) => f.status === "ACTIVE" && f.department === departmentName)
          .map((f): InchargeCandidate => ({ id: f.id, name: f.name, userUid: f.userUid, personType: "FACULTY" }))),
      fetch("/api/college/supporting-staff?staffCategory=TECHNICAL")
        .then((r) => r.json() as Promise<{ staff: SupportingStaffMember[] }>)
        .then((d) => (d.staff ?? [])
          .filter((s) => s.status === "ACTIVE" && s.department === departmentName)
          .map((s): InchargeCandidate => ({ id: s.id, name: s.name, userUid: s.userUid, personType: "SUPPORTING_STAFF" }))),
    ])
      .then(([faculty, staff]) => {
        const combined = [...faculty, ...staff];
        setCandidates(combined);
        // Pre-select whoever's currently Incharge - TimetableIncharge only
        // stores their login uid (see its own doc-comment), not either
        // roster's own doc id, so match it back through userUid.
        if (incharge) {
          const current = combined.find((c) => c.userUid === incharge.uid);
          if (current) setSelectedCandidateKey(`${current.personType}_${current.id}`);
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty" }));
  }

  async function handleAssignIncharge() {
    const selected = candidates.find((c) => `${c.personType}_${c.id}` === selectedCandidateKey);
    if (!selected) return;
    setIsSavingIncharge(true);
    try {
      const res = await fetch("/api/college/timetable-incharges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, year: Number(year), personId: selected.id, personType: selected.personType }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to assign Timetable Incharge", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Timetable Incharge assigned" });
      setShowInchargeDialog(false);
      loadIncharge();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setIsSavingIncharge(false);
    }
  }

  async function handleRevokeIncharge() {
    if (!incharge) return;
    setIsRevoking(true);
    try {
      const res = await fetch(`/api/college/timetable-incharges?id=${encodeURIComponent(incharge.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Timetable Incharge removed" });
      loadIncharge();
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
        description="Pick a section"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.push(`/hod/timetable/${courseId}/${year}/teaching-assignments`)}>
              <ClipboardList className="h-4 w-4 mr-2" />Teaching Assignments
            </Button>
            <Button variant="outline" onClick={() => router.push(`/hod/timetable/${courseId}`)}>
              <ArrowLeft className="h-4 w-4 mr-2" />Back to Years
            </Button>
          </div>
        }
      />

      {/* Timetable Incharge - a co-editor, not a handoff: assigning someone
          here doesn't take anything away from this HOD, it just lets that
          faculty member reach the same Timetable & Teaching Assignments
          pages for this course-year from their own dashboard too. */}
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <UserCog className="h-4 w-4 text-muted-foreground shrink-0" />
            {isLoadingIncharge ? (
              <div className="h-4 w-40 bg-muted animate-pulse rounded" />
            ) : incharge ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Timetable Incharge:</span>{" "}
                <span className="font-medium">{incharge.facultyName}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No Timetable Incharge assigned for this year yet.</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={openInchargeDialog}>
              {incharge ? "Change" : "Assign Timetable Incharge"}
            </Button>
            {incharge && (
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
      ) : sections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No sections have been created for this year yet. Add sections under the Sections module first.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <Card
              key={s.id}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => router.push(`/hod/timetable/${courseId}/${year}/${s.id}`)}
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

      <Dialog open={showInchargeDialog} onOpenChange={setShowInchargeDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{incharge ? "Change" : "Assign"} Timetable Incharge</DialogTitle>
            <DialogDescription>
              They&rsquo;ll be able to build/edit/publish this year&rsquo;s timetable and assign faculty to subjects
              from their own dashboard, same as you can - you keep full access too.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Faculty / Supporting Staff</Label>
            <Select value={selectedCandidateKey} onValueChange={setSelectedCandidateKey}>
              <SelectTrigger><SelectValue placeholder={candidates.length ? "Select a person" : "No one eligible in this department"} /></SelectTrigger>
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
              {incharge ? "Change" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmRevoke}
        onOpenChange={setConfirmRevoke}
        title="Revoke Timetable Incharge?"
        description={`${incharge?.facultyName ?? "This faculty member"} will lose access to this year's Timetable and Teaching Assignments pages. Anything they already did stays as-is - this only removes their access going forward.`}
        confirmLabel="Revoke"
        variant="destructive"
        loading={isRevoking}
        onConfirm={() => void handleRevokeIncharge()}
      />
    </div>
  );
}
