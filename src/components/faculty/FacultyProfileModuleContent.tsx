"use client";

import { Card, CardContent } from "@/components/ui/card";
import { PersonalDetailsView } from "@/components/shared/PersonalDetailsView";
import { DocLink } from "@/components/shared/ProfileFieldPrimitives";
import {
  QualificationModule, ExperienceModule, ResearchModule, GrantsModule,
  MentorshipModule, FinancialModule, OthersModule, TeachingDocsModule,
} from "@/components/faculty/ProfileFieldsView";
import { TechnicalProfileView } from "@/components/faculty/TechnicalProfileView";
import { TeachingLoadTable } from "@/components/faculty/TeachingLoadTable";
import { buildTeachingLoadRows } from "@/lib/teaching/buildTeachingLoadRows";
import type { PersonalDetailsSource } from "@/components/shared/PersonalDetailsView";
import type { ProfileModuleKey } from "@/lib/faculty/profileModules";
import type { FacultyProfileFields, TechnicalProfile, TeachingAssignment } from "@/types";

// Structurally covers both FacultyMember (HOD/Principal viewing someone else,
// or a self-profile backed by a real record - see MyProfileModulePage) and
// FMSUser (Principal/VP's own profile, which has no FacultyMember record - see
// principal/profile/[module]/page.tsx) - only the fields actually read below.
export interface FacultyProfileSource extends PersonalDetailsSource {
  academicProfile?: FacultyProfileFields;
  technicalProfile?: TechnicalProfile;
  department?: string;
  joiningLetterUrl?: string;
  appointmentLetterUrl?: string;
}

interface Props {
  moduleKey: ProfileModuleKey;
  faculty: FacultyProfileSource;
  teachingAssignments?: TeachingAssignment[];
  // Module 2's "Current Teaching Assignment" sub-block - Principal/VP omit this
  // on their own view, same as AcademicProfileFields' includeTeachingAssignment.
  includeTeachingAssignment?: boolean;
}

// Renders exactly one module's content for the per-module View pages - the
// hub (FacultyProfileHub) links here per tile. Reuses the same read-only
// pieces as the old single-scroll views (ProfileFieldsView's per-module
// exports, TechnicalProfileView, PersonalDetailsView, TeachingLoadTable) so
// nothing here duplicates field-rendering logic.
export function FacultyProfileModuleContent({ moduleKey, faculty, teachingAssignments = [], includeTeachingAssignment = true }: Props) {
  return (
    <Card>
      <CardContent className="pt-6">
        {moduleKey === "personal" && <PersonalDetailsView value={faculty} />}
        {moduleKey === "qualification" && <QualificationModule profile={faculty.academicProfile} />}
        {moduleKey === "experience" && <ExperienceModule profile={faculty.academicProfile} includeTeachingAssignment={includeTeachingAssignment} />}
        {moduleKey === "research" && <ResearchModule profile={faculty.academicProfile} />}
        {moduleKey === "grants" && <GrantsModule profile={faculty.academicProfile} />}
        {moduleKey === "mentorship" && <MentorshipModule profile={faculty.academicProfile} />}
        {moduleKey === "financial" && <FinancialModule profile={faculty.academicProfile} />}
        {moduleKey === "others" && <OthersModule profile={faculty.academicProfile} />}
        {moduleKey === "teaching-docs" && <TeachingDocsModule profile={faculty.academicProfile} />}
        {moduleKey === "technical" && <TechnicalProfileView profile={faculty.technicalProfile} />}
        {moduleKey === "teaching-load" && (
          <TeachingLoadTable
            groups={buildTeachingLoadRows({
              currentAssignments: teachingAssignments,
              staticCourses: faculty.academicProfile?.teachingAssignment?.courses,
              department: faculty.department,
            })}
          />
        )}
        {moduleKey === "documents" && (
          <div className="flex flex-wrap gap-4">
            {!faculty.joiningLetterUrl && !faculty.appointmentLetterUrl && (
              <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
            )}
            <DocLink url={faculty.joiningLetterUrl} label="Joining Letter" />
            <DocLink url={faculty.appointmentLetterUrl} label="Appointment Letter" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
