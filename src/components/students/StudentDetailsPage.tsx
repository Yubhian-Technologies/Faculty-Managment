"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, GraduationCap, Pencil, UserX, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/shared/Avatar";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StudentFormDialog } from "@/components/students/StudentFormDialog";
import { DETAIL_ROSTER_FIELDS, ROSTER_DETAIL_GROUPS, rosterFieldDisplay, type RosterField } from "@/lib/students/rosterFields";
import { formatDate } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import type { StudentRecord } from "@/types";

interface StudentDetailsPageProps {
  studentId: string;
  // Where "Back" returns to - the caller's own students list (e.g.
  // /hod/students, /principal/students). Kept as a prop rather than
  // hardcoded so this one component serves every role's route, same
  // pattern as TimetableGridEditor/StudentAttendanceHistoryReport.
  backHref: string;
  // Shows an Edit button that opens the shared Add/Edit dialog
  // (StudentFormDialog) - only the College Office route passes this. HOD and
  // Principal have no full roster-edit capability for a student (HOD edits
  // only roll number/status/lab batch via its own small dialog on the list
  // page; Principal's view is read-only throughout - see GraduatedStudentsView's
  // own doc-comment), so this defaults to false rather than every caller
  // having to say "no" explicitly.
  editable?: boolean;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  REGULAR: "default",
  DETAINED: "destructive",
  GRADUATED: "secondary",
};

const STATUS_LABEL: Record<string, string> = {
  REGULAR: "Regular",
  DETAINED: "Detained",
  GRADUATED: "Graduated",
};

// Student Type ("Regular"/"Lateral" admission category) and Status ("Regular"
// standing this year) are different fields that happen to share the word
// "Regular" - shown side by side as two badges, a bare "Regular" on both
// reads as a duplicate/bug rather than two distinct facts. Spelling the type
// out ("Regular Admission"/"Lateral Entry") disambiguates it without hiding
// either badge.
const STUDENT_TYPE_LABEL: Record<string, string> = { Regular: "Regular Admission", Lateral: "Lateral Entry" };

const HANDICAPPED_TYPE_LABEL: Record<string, string> = { H: "Hearing", V: "Visual", O: "Other" };

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// A single label/value pair - renders nothing when the value is empty, so a
// field the student never had entered simply never appears (no "-", no
// "N/A", no blank label). A real "No" (yesno fields already resolve to the
// string "No" via rosterFieldDisplay) or "0" is a non-empty string, so it's
// shown like any other real value.
function Fact({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium break-words">{value}</p>
    </div>
  );
}

const DETAIL_FIELD_BY_KEY = new Map(DETAIL_ROSTER_FIELDS.map((f) => [f.key, f]));

function facts(keys: string[], student: Partial<StudentRecord>): { key: string; label: string; value: string }[] {
  return keys
    .map((k) => DETAIL_FIELD_BY_KEY.get(k))
    .filter((f): f is RosterField => !!f)
    .map((f) => {
      const raw = rosterFieldDisplay(f, student);
      const value = f.key === "handicappedType" && raw ? (HANDICAPPED_TYPE_LABEL[raw] ?? raw) : raw;
      return { key: f.key, label: f.label, value };
    })
    .filter((f) => f.value !== "");
}

// A group of admission-detail fields, in its own card - entirely absent
// (rather than an empty card) when none of its fields were ever entered for
// this student. Reuses rosterFieldDisplay/DETAIL_ROSTER_FIELDS (the same
// source RosterFormFields/the CSV importer read from) so a field added there
// automatically finds its way into the right group here without a second
// definition to keep in sync.
function FactCard({ title, keys, student }: { title: string; keys: string[]; student: Partial<StudentRecord> }) {
  const rows = facts(keys, student);
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
          {rows.map((f) => <Fact key={f.key} label={f.label} value={f.value} />)}
        </div>
      </CardContent>
    </Card>
  );
}

function GraduationCard({ student }: { student: StudentRecord }) {
  const rows = [
    { key: "programme", label: "Programme", value: student.graduationCourseName ?? "" },
    { key: "batch", label: "Batch", value: student.graduationBatch ?? "" },
    { key: "graduatedAt", label: "Graduated On", value: student.graduatedAt ? formatDate(student.graduatedAt) : "" },
  ].filter((f) => f.value !== "");
  if (rows.length === 0) return null;
  return (
    <Card className="border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20">
      <CardContent className="p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <GraduationCap className="h-4 w-4" />Graduation
        </h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
          {rows.map((f) => <Fact key={f.key} label={f.label} value={f.value} />)}
        </div>
      </CardContent>
    </Card>
  );
}

// Loads fresh on every visit (bookmark/refresh-safe) via GET
// /api/college/students/[id] - deliberately not fed from a list page's
// already-loaded row, since a direct URL visit has none. The single
// canonical read-only student profile: every role's students list, section
// roster, and graduated-students view routes here instead of its own dialog,
// so there's exactly one place this layout is defined.
export function StudentDetailsPage({ studentId, backHref, editable = false }: StudentDetailsPageProps) {
  const router = useRouter();
  const [student, setStudent] = useState<StudentRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const loadStudent = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/college/students/${studentId}`);
      const json = await res.json() as { student?: StudentRecord; error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to load student");
        return;
      }
      setStudent(json.student ?? null);
    } catch {
      setError("Network error");
    } finally {
      setIsLoading(false);
    }
  }, [studentId]);

  // Wrapped so the loader's setState calls aren't reachable synchronously from
  // the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void (async () => { await loadStudent(); })();
  }, [loadStudent]);

  // AvatarUploadField only uploads to Storage - this persists the resulting
  // URL onto the student record itself via students/[id] PATCH's own small
  // profilePhotoUrl branch, same pattern as FacultyProfileHub's own
  // handlePhotoUploaded. Updates the already-loaded student optimistically so
  // the new photo shows immediately rather than waiting on a full reload.
  async function savePhoto(url: string) {
    setStudent((prev) => (prev ? { ...prev, profilePhotoUrl: url } : prev));
    try {
      const res = await fetch(`/api/college/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profilePhotoUrl: url }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast({ variant: "destructive", title: "Photo uploaded but failed to save - try again" });
    }
  }

  const backButton = (
    <Button variant="outline" onClick={() => router.push(backHref)}>
      <ArrowLeft className="h-4 w-4 mr-2" />Back
    </Button>
  );

  if (isLoading) {
    return (
      <div className="max-w-5xl space-y-6">
        <PageHeader title="Student Profile" actions={backButton} />
        <CardSkeleton />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  if (error || !student) {
    return (
      <div className="max-w-5xl space-y-6">
        <PageHeader title="Student Profile" actions={backButton} />
        <Card>
          <EmptyState
            icon={error ? <AlertCircle className="h-8 w-8" /> : <UserX className="h-8 w-8" />}
            title={error ? "Couldn't load this student" : "Student not found"}
            description={error ?? "This student may have been removed."}
            action={backButton}
          />
        </Card>
      </div>
    );
  }

  const headerDescription = [student.course, student.department, student.year ? ordinalYear(student.year) : undefined]
    .filter(Boolean).join(" · ") || undefined;

  const headerActions = (
    <div className="flex items-center gap-2">
      {backButton}
      {editable && (
        <Button onClick={() => setEditOpen(true)}>
          <Pencil className="h-4 w-4 mr-2" />Edit
        </Button>
      )}
    </div>
  );

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title={student.name || "Student Profile"} description={headerDescription} actions={headerActions} />

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            {editable ? (
              <AvatarUploadField
                name={student.name}
                photoUrl={student.profilePhotoUrl}
                targetId={student.id}
                onUploaded={(url) => void savePhoto(url)}
                onDeleted={() => void savePhoto("")}
              />
            ) : (
              <Avatar name={student.name} photoUrl={student.profilePhotoUrl} size="lg" />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[student.status] ?? "secondary"}>{STATUS_LABEL[student.status] ?? student.status}</Badge>
              {student.studentType && <Badge variant="outline">{STUDENT_TYPE_LABEL[student.studentType] ?? student.studentType}</Badge>}
              {student.section
                ? <Badge variant="secondary">Section {student.section}</Badge>
                : <Badge variant="outline" className="text-amber-600 border-amber-300">Unassigned</Badge>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
            <Fact label="Roll No" value={student.rollNumber} />
            <Fact label="Course" value={student.course} />
            <Fact label="Department" value={student.department} />
            <Fact label="Core Department" value={student.secondaryDepartment} />
            <Fact label="Academic Year" value={student.year ? ordinalYear(student.year) : undefined} />
            <Fact label="Section" value={student.section} />
            <Fact label="Batch" value={student.batch} />
            <Fact label="Regulation" value={student.regulation} />
            <Fact label="Lab Batch" value={student.labBatch} />
          </div>
        </CardContent>
      </Card>

      <GraduationCard student={student} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {ROSTER_DETAIL_GROUPS.map((group) => (
          <FactCard key={group.title} title={group.title} keys={group.keys} student={student} />
        ))}
      </div>

      {editable && (
        <StudentFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          student={student}
          // `editable` is only ever passed by the College Office route, whose Edit
          // form may also change the Roll No (the server enforces it by role).
          rollEditable
          onSaved={() => { setEditOpen(false); void loadStudent(); }}
        />
      )}
    </div>
  );
}
