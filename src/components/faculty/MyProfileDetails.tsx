"use client";

import { useEffect, useState } from "react";
import { IdCard, GraduationCap, BookOpen } from "lucide-react";
import { SectionCard } from "@/components/shared/SectionCard";
import { PersonalDetailsView } from "@/components/shared/PersonalDetailsView";
import { ProfileFieldsView } from "@/components/faculty/ProfileFieldsView";
import { TeachingLoadTable } from "@/components/faculty/TeachingLoadTable";
import { Badge } from "@/components/ui/badge";
import { buildTeachingLoadRows } from "@/lib/teaching/buildTeachingLoadRows";
import { formatDate } from "@/lib/utils";
import { DESIGNATION_LABELS, FACULTY_STATUS_LABELS } from "@/types";
import type { FacultyMember, FacultyStatus, TeachingAssignment } from "@/types";

const STATUS_VARIANTS: Record<FacultyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  INTERVIEW_DONE: "outline",
  ACTIVE: "default",
  ON_LEAVE: "outline",
  RESIGNED: "secondary",
  RETIRED: "secondary",
};

// Two different shapes can come back from /api/college/faculty/me depending on how
// the account was provisioned: a full FacultyMember record (PANEL_MEMBER, hired
// through the Faculty Register) or the caller's own colleges/{id}/users/{uid} doc
// (HOD/PRINCIPAL/VICE_PRINCIPAL, who have no separate FacultyMember record) — the
// latter is missing employment fields like designation/qualification/status
// entirely, so every field below is optional and rendered only when present.
type MyProfile = Partial<FacultyMember> & { id: string; isActive?: boolean };

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

// Self-service counterpart to PrincipalFacultyProfilePage/StaffProfileView — shows
// the SAME academic profile + teaching load a manager sees when looking someone
// else up, but sourced from /api/college/faculty/me (the caller's own record).
// Renders nothing only if the account has no record of any kind (shouldn't
// normally happen once logged in), leaving the page's minimal account card as-is.
export function MyProfileDetails() {
  const [profile, setProfile] = useState<MyProfile | null | undefined>(undefined);
  const [teachingAssignments, setTeachingAssignments] = useState<TeachingAssignment[]>([]);

  useEffect(() => {
    fetch("/api/college/faculty/me")
      .then((r) => r.json() as Promise<{ faculty: MyProfile | null; teachingAssignments?: TeachingAssignment[] }>)
      .then((d) => {
        setProfile(d.faculty);
        setTeachingAssignments(d.teachingAssignments ?? []);
      })
      .catch(() => setProfile(null));
  }, []);

  if (!profile) return null;

  const statusLabel = profile.status
    ? (FACULTY_STATUS_LABELS[profile.status] ?? profile.status)
    : typeof profile.isActive === "boolean"
    ? (profile.isActive ? "Active" : "Inactive")
    : undefined;

  return (
    <>
      <SectionCard icon={IdCard} title="Faculty Details" accent="blue">
        {statusLabel && (
          <div className="flex items-center gap-3 mb-4">
            <Badge variant={(profile.status && STATUS_VARIANTS[profile.status]) || "secondary"}>{statusLabel}</Badge>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact label="Employee ID" value={profile.employeeId} />
          <Fact label="Phone" value={profile.phone} />
          <Fact label="Department" value={profile.department} />
          <Fact label="Designation" value={profile.designation ? DESIGNATION_LABELS[profile.designation] : undefined} />
          <Fact
            label={profile.status === "INTERVIEW_DONE" ? "Expected to Join" : "Date of Joining"}
            value={profile.joiningDate ? formatDate(profile.joiningDate) : undefined}
          />
          <Fact label="Qualification" value={profile.qualification} />
          <Fact label="Specialization" value={profile.specialization} />
          <Fact label="Experience (yrs)" value={profile.experienceYears} />
        </div>
      </SectionCard>

      <SectionCard icon={IdCard} title="Personal Details" accent="violet">
        <PersonalDetailsView value={profile} />
      </SectionCard>

      <SectionCard icon={GraduationCap} title="Academic Profile" accent="emerald">
        <ProfileFieldsView profile={profile.academicProfile} includeTeachingAssignment />
      </SectionCard>

      <SectionCard icon={BookOpen} title="Teaching Load" accent="amber">
        <TeachingLoadTable
          groups={buildTeachingLoadRows({
            currentAssignments: teachingAssignments,
            staticCourses: profile.academicProfile?.teachingAssignment?.courses,
            tenurePresentRecords: profile.academicProfile?.tenurePresentRecords,
            tenurePastRecords: profile.academicProfile?.tenurePastRecords,
          })}
        />
      </SectionCard>
    </>
  );
}
