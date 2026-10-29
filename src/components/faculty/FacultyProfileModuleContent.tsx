"use client";

import type { ComponentProps } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PersonalDetailsView } from "@/components/shared/PersonalDetailsView";
import {
  QualificationModule, ExperienceModule,
  MentorshipModule, FinancialModule, OthersModule,
} from "@/components/faculty/ProfileFieldsView";
import { ResearchInnovationModule } from "@/components/faculty/ResearchInnovationModule";
import { TeachingLoadTable } from "@/components/faculty/TeachingLoadTable";
import { EmptyModuleState } from "@/components/faculty/EmptyModuleState";
import { isModuleEmpty } from "@/lib/faculty/moduleEmpty";
import { buildTeachingLoadRows } from "@/lib/teaching/buildTeachingLoadRows";
import { readPreviousTeachingAssignments } from "@/lib/faculty/previousTeaching";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { useFacultyDisplayNames } from "@/hooks/useFacultyDisplayNames";
import type { PersonalDetailsSource } from "@/components/shared/PersonalDetailsView";
import type { ProfileModuleKey } from "@/lib/faculty/profileModules";
import type { FacultyProfileFields, TeachingAssignment, CollegeType, ResearchPublication } from "@/types";

// Structurally covers both FacultyMember (HOD/Principal viewing someone else,
// or a self-profile backed by a real record - see MyProfileModulePage) and
// FMSUser (Principal/VP's own profile, which has no FacultyMember record - see
// principal/profile/[module]/page.tsx) - only the fields actually read below.
export interface FacultyProfileSource extends PersonalDetailsSource {
  academicProfile?: FacultyProfileFields;
  department?: string;
  joiningLetterUrl?: string;
  appointmentLetterUrl?: string;
  uid?: string;      // FMSUser (HOD/Principal self-profile) login uid
  userUid?: string;  // FacultyMember's linked login uid
  // For the "Total Years of Experience" fact on the Professional Experience
  // module (see ExperienceModule) - optional since it doesn't apply outside
  // a genuine Faculty record.
  joiningDate?: PersonalDetailsSource["dateOfBirth"];
}

interface Props {
  moduleKey: ProfileModuleKey;
  faculty: FacultyProfileSource;
  teachingAssignments?: TeachingAssignment[];
  // Module 2's "Current Teaching Assignment" sub-block - Principal/VP omit this
  // on their own view, same as AcademicProfileFields' includeTeachingAssignment.
  includeTeachingAssignment?: boolean;
  // School-type colleges show a different qualifications list instead of
  // UG/PG/PhD - see QualificationModule.
  collegeType?: CollegeType;
  // Only for callers that already fetched the publications list server-side
  // alongside `faculty` itself (e.g. Management's combined faculty-detail
  // endpoint) - skips the Research tile's own client-side fetch/route
  // (/api/college/publications), which only college-scoped roles can call.
  // Omitted entirely, every other caller keeps the self-fetching behavior.
  publications?: ResearchPublication[] | null;
  // True only for a genuine Faculty record view (HOD/Principal/Management
  // viewing a Faculty member) - their Add/Edit surfaces move Full Name (as
  // per SSC) up into the "core" identity step, shown on FacultyProfileHub's
  // own top summary instead, so it isn't shown a second time here. Every
  // other caller (self-profile pages for non-Faculty logins) leaves this
  // false/default, unchanged from before.
  hideLegalName?: boolean;
  // True only for a genuine FacultyMember record (Name (as per PAN) is a
  // Faculty personal detail; login-only FMSUser profiles don't have it).
  showNameAsPerPan?: boolean;
  // True only when the viewer IS this profile's owner (MyProfileModulePage,
  // principal/profile) - lets the Research tile offer "Add Publication" for
  // self-submission. Everyone viewing someone ELSE's profile (HOD/Principal/
  // Super Admin/Management drill-downs) leaves this unset.
  isOwnProfile?: boolean;
  // True only for a genuine FacultyMember record - see PersonalDetailsView's
  // own doc-comment on this same prop.
  ratificationHistory?: boolean;
  // Where the page's own Edit button goes (only when it shows one). With nothing entered in the tab, this adds an
  // Edit button to the "please enter the details here" message; without it the message has no button.
  editHref?: string;
}

// Settings > Website Display Name > "Teaching load": the load downloads print the Display Name. A component of its own
// so the names are only looked up while the Teaching Load tab is open.
function TeachingLoadWithDisplayName({ faculty, ...rest }: { faculty: FacultyProfileSource } & Omit<ComponentProps<typeof TeachingLoadTable>, "facultyName">) {
  const { nameFor } = useFacultyDisplayNames();
  return (
    <TeachingLoadTable
      {...rest}
      facultyName={nameFor("teachingLoad", { facultyId: (faculty as { id?: string }).id, uid: faculty.userUid }, facultyDisplayName(faculty))}
    />
  );
}

// Renders exactly one module's content for the per-module View pages - the
// hub (FacultyProfileHub) links here per tile. Reuses the same read-only
// pieces as the old single-scroll views (ProfileFieldsView's per-module
// exports, PersonalDetailsView, TeachingLoadTable) so nothing here
// duplicates field-rendering logic.
export function FacultyProfileModuleContent({ moduleKey, faculty, teachingAssignments = [], includeTeachingAssignment = true, collegeType, publications, hideLegalName, showNameAsPerPan, isOwnProfile, ratificationHistory, editHref }: Props) {
  // A tab with nothing entered in it shows an invitation to enter the details instead of an empty heading.
  const teachingRows = moduleKey === "teaching-load"
    ? buildTeachingLoadRows({ currentAssignments: teachingAssignments, staticCourses: faculty.academicProfile?.teachingAssignment?.courses, department: faculty.department })
    : null;
  const teachingEmpty = !!teachingRows && teachingRows.current.length === 0 && teachingRows.past.length === 0
    && readPreviousTeachingAssignments(faculty as { previousTeachingAssignments?: unknown }).length === 0;
  if (isModuleEmpty(moduleKey, faculty, { teachingEmpty })) {
    return (
      <Card>
        <CardContent className="pt-6"><EmptyModuleState moduleKey={moduleKey} editHref={editHref} /></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="pt-6">
        {moduleKey === "personal" && <PersonalDetailsView value={faculty} hideLegalName={hideLegalName} showNameAsPerPan={showNameAsPerPan} hiddenFields={["esiNumber"]} ratificationHistory={ratificationHistory} />}
        {moduleKey === "qualification" && <QualificationModule profile={faculty.academicProfile} collegeType={collegeType} hideHeader />}
        {moduleKey === "experience" && (
          <ExperienceModule profile={faculty.academicProfile} includeTeachingAssignment={includeTeachingAssignment} joiningDate={faculty.joiningDate} hideHeader />
        )}
        {moduleKey === "research" && (
          <ResearchInnovationModule uid={faculty.userUid ?? faculty.uid} academicProfile={faculty.academicProfile} publications={publications} isOwnProfile={isOwnProfile} />
        )}
        {moduleKey === "mentorship" && <MentorshipModule profile={faculty.academicProfile} ownerName={facultyDisplayName(faculty)} hideHeader />}
        {moduleKey === "financial" && <FinancialModule profile={faculty.academicProfile} hideHeader />}
        {moduleKey === "others" && <OthersModule profile={faculty.academicProfile} />}
        {moduleKey === "display-name" && (
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Surname (short form)</dt><dd className="text-sm font-medium">{(faculty as { displaySurname?: string }).displaySurname || "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Name</dt><dd className="text-sm font-medium">{(faculty as { displayName?: string }).displayName || "—"}</dd></div>
          </dl>
        )}
        {moduleKey === "teaching-load" && (
          <TeachingLoadWithDisplayName
            faculty={faculty}
            department={faculty.department}
            previous={readPreviousTeachingAssignments(faculty as { previousTeachingAssignments?: unknown })}
            groups={buildTeachingLoadRows({
              currentAssignments: teachingAssignments,
              staticCourses: faculty.academicProfile?.teachingAssignment?.courses,
              department: faculty.department,
            })}
          />
        )}
      </CardContent>
    </Card>
  );
}
