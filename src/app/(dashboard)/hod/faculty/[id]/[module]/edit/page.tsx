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
import { totalPreviousExperienceYears } from "@/lib/faculty/experienceCalc";
import { toDateInputValue } from "@/lib/utils";
import type { StagedTeachingRow } from "@/components/faculty/TeachingAssignmentsEditor";
import { useCollegeType } from "@/hooks/useCollegeType";
import { toast } from "@/hooks/useToast";

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
        const m = data.faculty;
        setName((m.name as string) ?? "");
        setDepartment((m.department as string) ?? "");
        setRecord({
          gender: (m.gender as string) ?? "",
          dateOfBirth: toDateInputValue(m.dateOfBirth as never) || undefined,
          legalName: (m.legalName as string) ?? "",
          nameAsPerAadhar: (m.nameAsPerAadhar as string) ?? "",
          fatherName: (m.fatherName as string) ?? "",
          motherName: (m.motherName as string) ?? "",
          religion: m.religion as never,
          caste: m.caste as never,
          subCaste: (m.subCaste as string) ?? "",
          aadharNo: (m.aadharNo as string) ?? "",
          panNo: (m.panNo as string) ?? "",
          passportNumber: (m.passportNumber as string) ?? "",
          differentlyAbled: (m.differentlyAbled as boolean) ?? undefined,
          differentlyAbledDetails: (m.differentlyAbledDetails as string) ?? "",
          bankAccountNo: (m.bankAccountNo as string) ?? "",
          ifscCode: (m.ifscCode as string) ?? "",
          bankName: (m.bankName as string) ?? "",
          bankBranch: (m.bankBranch as string) ?? "",
          bankOtherDetails: (m.bankOtherDetails as string) ?? "",
          emergencyContactName: (m.emergencyContactName as string) ?? "",
          emergencyContactRelation: (m.emergencyContactRelation as string) ?? "",
          emergencyContactPhone: (m.emergencyContactPhone as string) ?? "",
          ratificationStatus: (m.ratificationStatus as string) ?? "",
          ratificationProceedingsNumber: (m.ratificationProceedingsNumber as string) ?? "",
          ratificationDate: toDateInputValue(m.ratificationDate as never) || undefined,
          maritalStatus: (m.maritalStatus as string) ?? "",
          spouseName: (m.spouseName as string) ?? "",
          numberOfChildren: m.numberOfChildren as number | undefined,
          temporaryAddress: (m.temporaryAddress as string) ?? "",
          permanentSameAsTemporary: (m.permanentSameAsTemporary as boolean) ?? false,
          permanentAddress: (m.permanentAddress as string) ?? "",
          bloodGroup: (m.bloodGroup as string) ?? "",
          motherTongue: (m.motherTongue as string) ?? "",
          languagesKnown: (m.languagesKnown as string[]) ?? [],
          heightFeet: m.heightFeet as number | undefined,
          heightInches: m.heightInches as number | undefined,
          weightKg: m.weightKg as number | undefined,
          pfNumber: (m.pfNumber as string) ?? "",
          academicProfile: (m.academicProfile as FacultyEditRecord["academicProfile"]) ?? {},
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
        const body: Record<string, unknown> =
          moduleKey === "personal"
            ? {
                gender: record.gender, dateOfBirth: record.dateOfBirth, legalName: record.legalName,
                nameAsPerAadhar: record.nameAsPerAadhar,
                fatherName: record.fatherName, motherName: record.motherName, religion: record.religion,
                caste: record.caste, subCaste: record.subCaste, aadharNo: record.aadharNo, panNo: record.panNo,
                passportNumber: record.passportNumber,
                differentlyAbled: record.differentlyAbled, differentlyAbledDetails: record.differentlyAbledDetails,
                bankAccountNo: record.bankAccountNo, ifscCode: record.ifscCode,
                bankName: record.bankName, bankBranch: record.bankBranch, bankOtherDetails: record.bankOtherDetails,
                emergencyContactName: record.emergencyContactName, emergencyContactRelation: record.emergencyContactRelation,
                emergencyContactPhone: record.emergencyContactPhone, ratificationStatus: record.ratificationStatus,
                ratificationProceedingsNumber: record.ratificationProceedingsNumber,
                ratificationDate: record.ratificationDate, maritalStatus: record.maritalStatus, spouseName: record.spouseName,
                numberOfChildren: record.numberOfChildren,
                temporaryAddress: record.temporaryAddress, permanentSameAsTemporary: record.permanentSameAsTemporary,
                permanentAddress: record.permanentAddress, bloodGroup: record.bloodGroup,
                motherTongue: record.motherTongue, languagesKnown: record.languagesKnown,
                heightFeet: record.heightFeet, heightInches: record.heightInches, weightKg: record.weightKg,
                pfNumber: record.pfNumber,
              }
            : moduleKey === "experience"
              // Total Experience is calculated from Previous Experience's From/To
              // dates, not typed manually - see experienceCalc.ts. Kept in sync
              // with the top-level FacultyMember.experienceYears field (shown on
              // the list/PDF/profile) every time this module is saved.
              ? { academicProfile: record.academicProfile, experienceYears: totalPreviousExperienceYears(record.academicProfile?.previousInstitutions) }
              : { academicProfile: record.academicProfile };

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
