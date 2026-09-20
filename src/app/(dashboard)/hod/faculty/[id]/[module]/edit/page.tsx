"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FacultyProfileModuleEditor, type FacultyEditRecord } from "@/components/faculty/FacultyProfileModuleEditor";
import { getMissingRequiredPersonalFields, FACULTY_REQUIRED_PERSONAL_FIELDS } from "@/components/shared/PersonalDetailsFields";
import { PROFILE_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import { syncTeachingAssignments } from "@/lib/teaching/syncTeachingAssignments";
import type { StagedTeachingRow } from "@/components/faculty/TeachingAssignmentsEditor";
import { useCollegeType } from "@/hooks/useCollegeType";
import { toast } from "@/hooks/useToast";
import { migrateFacultyDoc } from "@/lib/faculty/fieldRenames";
import { personalRecordFromDoc, personalPatchBody } from "@/lib/faculty/personalRecord";
import { diffAcademicProfile, isEmptyChanges } from "@/lib/faculty/academicProfileChanges";

export default function HodFacultyModuleEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string; module: string }>();
  const facultyId = params.id;
  const moduleKey = params.module as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];
  const { collegeType } = useCollegeType();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [record, setRecord] = useState<FacultyEditRecord>({});
  // The academicProfile as loaded - a save sends only what differs from it, so
  // editing one tab can never overwrite another tab with this (possibly stale) copy.
  const [originalAcademicProfile, setOriginalAcademicProfile] = useState<FacultyEditRecord["academicProfile"]>({});
  const [teachingRows, setTeachingRows] = useState<StagedTeachingRow[]>([]);
  const [originalTeachingRows, setOriginalTeachingRows] = useState<StagedTeachingRow[]>([]);

  useEffect(() => {
    fetch(`/api/college/faculty/${facultyId}`)
      .then((r) => r.json() as Promise<{ faculty?: Record<string, unknown>; error?: string }>)
      .then((data) => {
        if (!data.faculty) {
          toast({ variant: "destructive", title: "Faculty record not found" });
          router.push("/hod/faculty");
          return;
        }
        const m = migrateFacultyDoc(data.faculty);
        setName((m.name as string) ?? "");
        setDepartment((m.department as string) ?? "");
        const academicProfile = (m.academicProfile as FacultyEditRecord["academicProfile"]) ?? {};
        setOriginalAcademicProfile(academicProfile);
        setRecord({
          ...personalRecordFromDoc(m),
          academicProfile,
          joiningLetterUrl: (m.joiningLetterUrl as string) ?? "",
          appointmentLetterUrl: (m.appointmentLetterUrl as string) ?? "",
          resumeUrl: (m.resumeUrl as string) ?? "",
        });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty record" }))
      .finally(() => setLoading(false));
  }, [facultyId, router]);

  useEffect(() => {
    if (moduleKey !== "teaching-load") return;
    fetch(`/api/college/teaching-assignments?facultyId=${encodeURIComponent(facultyId)}`)
      .then((r) => r.json() as Promise<{
        assignments: Array<{ id: string; courseId: string; courseName: string; year: number; sectionId: string; sectionName: string; subjectId: string; subjectName: string; subjectCode: string; hoursPerWeek: number; isPast?: boolean; assignmentAcademicYear?: string; assignmentSemester?: string; passPercentage?: number; studentFeedback?: number }>;
        timetableSlots: Array<{ id: string; assignmentId: string; day: StagedTeachingRow["slots"][number]["day"]; periodNumber: number }>;
      }>)
      .then((d) => {
        const rows: StagedTeachingRow[] = (d.assignments ?? []).map((a) => ({
          localId: a.id, id: a.id, courseId: a.courseId, courseName: a.courseName, year: a.year,
          sectionId: a.sectionId, sectionName: a.sectionName, subjectId: a.subjectId, subjectName: a.subjectName,
          subjectCode: a.subjectCode, hoursPerWeek: a.hoursPerWeek, subjectHoursPerWeek: a.hoursPerWeek,
          isPast: a.isPast, assignmentAcademicYear: a.assignmentAcademicYear, assignmentSemester: a.assignmentSemester,
          passPercentage: a.passPercentage, studentFeedback: a.studentFeedback,
          slots: (d.timetableSlots ?? []).filter((s) => s.assignmentId === a.id).map((s) => ({ localId: s.id, id: s.id, day: s.day, periodNumber: s.periodNumber })),
        }));
        setTeachingRows(rows);
        setOriginalTeachingRows(rows);
      })
      .catch(() => { /* non-critical */ });
  }, [facultyId, moduleKey]);

  function patch(next: Partial<FacultyEditRecord>) {
    setRecord((r) => ({ ...r, ...next }));
  }

  async function handleSave() {
    if (moduleKey === "personal") {
      const missing = getMissingRequiredPersonalFields(record, FACULTY_REQUIRED_PERSONAL_FIELDS);
      if (missing.length > 0) {
        toast({ variant: "destructive", title: "Some required fields are missing", description: missing.join(", ") });
        return;
      }
    }
    setSaving(true);
    try {
      if (moduleKey === "teaching-load") {
        const errors = await syncTeachingAssignments(facultyId, name, originalTeachingRows, teachingRows);
        if (errors.length > 0) {
          toast({ variant: "destructive", title: "Some teaching assignments failed to save", description: errors.join("; ") });
          setSaving(false);
          return;
        }
      } else {
        // A tab's save sends ONLY the academicProfile keys it changed (not the whole
        // object), so it can't overwrite another tab - or another editor's save -
        // with the copy loaded here. totalYearsOfExperience is recomputed
        // server-side from the resulting profile + joiningDate (see
        // /api/college/faculty/[id]/route.ts), never sent from here.
        const academicProfileChanges = diffAcademicProfile(originalAcademicProfile, record.academicProfile);
        if (moduleKey !== "personal" && isEmptyChanges(academicProfileChanges)) {
          toast({ variant: "success", title: "No changes to save" });
          router.push(`/hod/faculty/${facultyId}/${moduleKey}`);
          return;
        }
        const body: Record<string, unknown> =
          moduleKey === "personal" ? personalPatchBody(record) : { academicProfileChanges };

        const res = await fetch(`/api/college/faculty/${facultyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error();
      }

      toast({ variant: "success", title: "Saved" });
      router.push(`/hod/faculty/${facultyId}/${moduleKey}`);
    } catch {
      toast({ variant: "destructive", title: "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  if (!moduleDef) return <p className="text-sm text-muted-foreground">Unknown section.</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${moduleDef.label}`}
        description={name}
        actions={
          <Button variant="outline" asChild>
            <Link href={`/hod/faculty/${facultyId}/${moduleKey}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
          </Button>
        }
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <FacultyProfileModuleEditor
              moduleKey={moduleKey}
              record={record}
              onChange={patch}
              facultyId={facultyId}
              teachingRows={teachingRows}
              onTeachingRowsChange={setTeachingRows}
              department={department}
              collegeType={collegeType}
              requiredPersonalFields={FACULTY_REQUIRED_PERSONAL_FIELDS}
              hideLegalName
            />
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => router.push(`/hod/faculty/${facultyId}/${moduleKey}`)}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>Save Changes</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
