"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AcademicProfileFields } from "@/components/faculty/AcademicProfileFields";
import { TeachingAssignmentsEditor, type StagedTeachingRow } from "@/components/faculty/TeachingAssignmentsEditor";
import { PersonalDetailsFields, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import { syncTeachingAssignments } from "@/lib/teaching/syncTeachingAssignments";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { toast } from "@/hooks/useToast";
import { toDateInputValue } from "@/lib/utils";
import {
  DESIGNATION_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  FACULTY_STATUS_LABELS,
} from "@/types";
import type { Designation, EmploymentType, FacultyStatus, FacultyProfileFields, Subject } from "@/types";

interface PendingTeachingPreference {
  courseId: string;
  courseName: string;
  year: number;
  subjectIds: string[];
  subjectNames: string[];
}

interface EmploymentForm {
  name: string;
  phone: string;
  collegeEmail: string;
  designation: Designation;
  qualification: string;
  specialization: string;
  experienceYears: number;
  internalExperience: number;
  externalExperience: number;
  inCampusExperience: number;
  industryExperience: number;
  researchExperience: number;
  hasPHD: boolean;
  employmentType: EmploymentType;
  status: FacultyStatus;
  joiningDate: string;
}

const EMPTY_FORM: EmploymentForm = {
  name: "", phone: "", collegeEmail: "", designation: "ASSISTANT_PROFESSOR", qualification: "",
  specialization: "", experienceYears: 0, internalExperience: 0, externalExperience: 0,
  inCampusExperience: 0, industryExperience: 0, researchExperience: 0, hasPHD: false,
  employmentType: "PERMANENT", status: "ACTIVE", joiningDate: "",
};

const EXPERIENCE_FIELDS: [keyof EmploymentForm, string][] = [
  ["experienceYears", "Total Experience"],
  ["internalExperience", "Internal"],
  ["externalExperience", "External"],
  ["inCampusExperience", "In Campus"],
  ["industryExperience", "Industry"],
  ["researchExperience", "Research"],
];

export default function EditFacultyPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const facultyId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [email, setEmail] = useState("");
  const [form, setForm] = useState<EmploymentForm>(EMPTY_FORM);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [academicProfile, setAcademicProfile] = useState<Partial<FacultyProfileFields>>({});
  const [personalDetails, setPersonalDetails] = useState<PersonalDetailsValue>({});
  const [teachingRows, setTeachingRows] = useState<StagedTeachingRow[]>([]);
  const [originalTeachingRows, setOriginalTeachingRows] = useState<StagedTeachingRow[]>([]);
  const [teachingLoaded, setTeachingLoaded] = useState(false);
  const [pendingPreference, setPendingPreference] = useState<PendingTeachingPreference | null>(null);

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
        setEmployeeId((m.employeeId as string) ?? "");
        setEmail((m.email as string) ?? "");
        setForm({
          name: (m.name as string) ?? "",
          phone: (m.phone as string) ?? "",
          collegeEmail: (m.collegeEmail as string) ?? "",
          designation: (m.designation as Designation) ?? "ASSISTANT_PROFESSOR",
          qualification: (m.qualification as string) ?? "",
          specialization: (m.specialization as string) ?? "",
          experienceYears: (m.experienceYears as number) ?? 0,
          internalExperience: (m.internalExperience as number) ?? 0,
          externalExperience: (m.externalExperience as number) ?? 0,
          inCampusExperience: (m.inCampusExperience as number) ?? 0,
          industryExperience: (m.industryExperience as number) ?? 0,
          researchExperience: (m.researchExperience as number) ?? 0,
          hasPHD: (m.hasPHD as boolean) ?? false,
          employmentType: (m.employmentType as EmploymentType) ?? "PERMANENT",
          status: (m.status as FacultyStatus) ?? "ACTIVE",
          joiningDate: toDateInputValue(m.joiningDate as never),
        });
        setPersonalDetails({
          gender: (m.gender as string) ?? "",
          dateOfBirth: toDateInputValue(m.dateOfBirth as never),
          legalName: (m.legalName as string) ?? "",
          fatherName: (m.fatherName as string) ?? "",
          motherName: (m.motherName as string) ?? "",
          religion: (m.religion as string) ?? "",
          caste: (m.caste as string) ?? "",
          aadharNo: (m.aadharNo as string) ?? "",
          panNo: (m.panNo as string) ?? "",
          passportNumber: (m.passportNumber as string) ?? "",
          emergencyContactName: (m.emergencyContactName as string) ?? "",
          emergencyContactPhone: (m.emergencyContactPhone as string) ?? "",
          ratificationStatus: (m.ratificationStatus as string) ?? "",
          ratificationDate: toDateInputValue(m.ratificationDate as never),
          maritalStatus: (m.maritalStatus as string) ?? "",
          spouseName: (m.spouseName as string) ?? "",
          numberOfChildren: m.numberOfChildren as number | undefined,
          referral: (m.referral as string) ?? "",
          nativePlace: (m.nativePlace as string) ?? "",
          temporaryAddress: (m.temporaryAddress as string) ?? "",
          permanentSameAsTemporary: (m.permanentSameAsTemporary as boolean) ?? false,
          permanentAddress: (m.permanentAddress as string) ?? "",
          bloodGroup: (m.bloodGroup as string) ?? "",
        });
        setAcademicProfile((m.academicProfile as Partial<FacultyProfileFields>) ?? {});
        setPendingPreference((m.pendingTeachingPreference as PendingTeachingPreference | undefined) ?? null);
        setPhotoUrl((m.profilePhotoUrl as string) || undefined);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty record" }))
      .finally(() => setLoading(false));
  }, [facultyId, router]);

  useEffect(() => {
    fetch(`/api/college/teaching-assignments?facultyId=${encodeURIComponent(facultyId)}`)
      .then((r) => r.json() as Promise<{
        assignments: Array<{ id: string; courseId: string; courseName: string; year: number; sectionId: string; sectionName: string; subjectId: string; subjectName: string; subjectCode: string; hoursPerWeek: number }>;
        timetableSlots: Array<{ id: string; assignmentId: string; day: StagedTeachingRow["slots"][number]["day"]; periodNumber: number }>;
      }>)
      .then((d) => {
        const rows: StagedTeachingRow[] = (d.assignments ?? []).map((a) => ({
          localId: a.id,
          id: a.id,
          courseId: a.courseId,
          courseName: a.courseName,
          year: a.year,
          sectionId: a.sectionId,
          sectionName: a.sectionName,
          subjectId: a.subjectId,
          subjectName: a.subjectName,
          subjectCode: a.subjectCode,
          hoursPerWeek: a.hoursPerWeek,
          subjectHoursPerWeek: a.hoursPerWeek,
          slots: (d.timetableSlots ?? [])
            .filter((s) => s.assignmentId === a.id)
            .map((s) => ({ localId: s.id, id: s.id, day: s.day, periodNumber: s.periodNumber })),
        }));
        setTeachingRows(rows);
        setOriginalTeachingRows(rows);
      })
      .catch(() => { /* non-critical — teaching assignments can be added fresh */ })
      .finally(() => setTeachingLoaded(true));
  }, [facultyId]);

  // One-time: if this faculty was hired with a course/subject preference and has no
  // teaching assignments yet, pre-fill stub rows (course/year/subject known, section left
  // for the HOD to pick) so the hiring-time intent isn't lost.
  useEffect(() => {
    if (!teachingLoaded || !pendingPreference || teachingRows.length > 0) return;
    fetch(`/api/college/subjects?courseId=${encodeURIComponent(pendingPreference.courseId)}&year=${pendingPreference.year}`)
      .then((r) => r.json() as Promise<{ subjects: Subject[] }>)
      .then((d) => {
        const subjects = d.subjects ?? [];
        const stubRows: StagedTeachingRow[] = pendingPreference.subjectIds.map((subjectId) => {
          const subject = subjects.find((s) => s.id === subjectId);
          return {
            localId: subjectId,
            courseId: pendingPreference.courseId,
            courseName: pendingPreference.courseName,
            year: pendingPreference.year,
            sectionId: "",
            sectionName: "",
            subjectId,
            subjectName: subject?.name ?? pendingPreference.subjectNames[pendingPreference.subjectIds.indexOf(subjectId)] ?? "",
            subjectCode: subject?.code ?? "",
            hoursPerWeek: subject?.hoursPerWeek ?? 0,
            subjectHoursPerWeek: subject?.hoursPerWeek ?? 0,
            slots: [],
          };
        });
        if (stubRows.length > 0) setTeachingRows(stubRows);
      })
      .catch(() => { /* non-critical */ });
  }, [teachingLoaded, pendingPreference, teachingRows.length]);

  function set(patch: Partial<EmploymentForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId.trim()) {
      toast({ variant: "destructive", title: "Employee ID is required" });
      return;
    }
    if (!form.collegeEmail.trim()) {
      toast({ variant: "destructive", title: "College email is required" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/college/faculty/${facultyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          email,
          employeeId,
          ...personalDetails,
          academicProfile,
          ...(photoUrl !== undefined ? { profilePhotoUrl: photoUrl } : {}),
        }),
      });
      if (res.status === 409) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: json.error ?? "Employee ID already exists" });
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error();

      const errors = await syncTeachingAssignments(facultyId, form.name, originalTeachingRows, teachingRows);
      if (errors.length > 0) {
        toast({ variant: "destructive", title: "Some teaching assignments failed to save", description: errors.join("; ") });
      }

      toast({ variant: "success", title: "Faculty record updated" });
      router.push("/hod/faculty");
    } catch {
      toast({ variant: "destructive", title: "Failed to update" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Edit Faculty Member" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Edit Faculty Member" description={`Employee ID: ${employeeId} · ${email}`} />

      <Card>
        <CardHeader><CardTitle className="text-base">Faculty Details</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex flex-col gap-5 pb-5 border-b sm:flex-row sm:items-start">
              <div className="flex shrink-0 flex-col items-center gap-2 sm:pt-6">
                <Label>Profile Photo</Label>
                <AvatarUploadField name={form.name || "?"} photoUrl={photoUrl} targetId={facultyId} onUploaded={setPhotoUrl} onDeleted={() => setPhotoUrl("")} />
              </div>
              <div className="grid flex-1 grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label>Employee ID *</Label>
                  <Input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="EMP-001" />
                </div>
                <div className="space-y-2">
                  <Label>Full Name *</Label>
                  <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+91 98765 43210" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>College Email *</Label>
                <Input type="email" value={form.collegeEmail} onChange={(e) => set({ collegeEmail: e.target.value })} placeholder="name@vishnu.edu.in" />
                <p className="text-xs text-muted-foreground">This is their login username.</p>
              </div>
              <div className="space-y-2">
                <Label>Personal Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="faculty@example.com" />
              </div>
            </div>

            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Academic Profile</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Designation *</Label>
                <Select value={form.designation} onValueChange={(v) => set({ designation: v as Designation })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(DESIGNATION_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Highest Qualification *</Label>
                <Input value={form.qualification} onChange={(e) => set({ qualification: e.target.value })} placeholder="e.g. Ph.D, M.Tech, M.Sc" />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Specialization</Label>
                <Input value={form.specialization} onChange={(e) => set({ specialization: e.target.value })} placeholder="e.g. Machine Learning, VLSI" />
              </div>
              <div className="space-y-2">
                <Label>Status *</Label>
                <Select value={form.status} onValueChange={(v) => set({ status: v as FacultyStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(FACULTY_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Experience (Years)</p>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {EXPERIENCE_FIELDS.map(([key, label]) => (
                <div key={key} className="space-y-2">
                  <Label>{label}</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    value={form[key] as number}
                    onChange={(e) => set({ [key]: e.target.value === "" ? 0 : parseFloat(e.target.value) } as Partial<EmploymentForm>)}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="hasPHD" checked={form.hasPHD} onChange={(e) => set({ hasPHD: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
              <Label htmlFor="hasPHD" className="cursor-pointer">Has Ph.D</Label>
            </div>

            <div className="pt-2 pb-1 border-t">
              <p className="text-sm font-medium text-muted-foreground">Employment Details</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Employment Type *</Label>
                <Select value={form.employmentType} onValueChange={(v) => set({ employmentType: v as EmploymentType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Joining Date *</Label>
                <Input type="date" value={form.joiningDate} onChange={(e) => set({ joiningDate: e.target.value })} />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Save Changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Personal Details</CardTitle></CardHeader>
        <CardContent>
          <PersonalDetailsFields value={personalDetails} onChange={setPersonalDetails} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Academic Profile</CardTitle></CardHeader>
        <CardContent>
          <AcademicProfileFields value={academicProfile} onChange={setAcademicProfile} includeTeachingAssignment />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Current Teaching Assignments</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {pendingPreference && originalTeachingRows.length === 0 && teachingRows.length > 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-2">
              Pre-filled from the course/subjects set during hiring — pick a section for each row below to activate it.
            </p>
          )}
          <TeachingAssignmentsEditor value={teachingRows} onChange={setTeachingRows} />
        </CardContent>
      </Card>
    </div>
  );
}
