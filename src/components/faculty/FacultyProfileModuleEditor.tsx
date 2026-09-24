"use client";

import { PersonalDetailsFields, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import { TeachingAssignmentsEditor, type StagedTeachingRow } from "@/components/faculty/TeachingAssignmentsEditor";
import {
  QualificationFields, ExperienceFields, ResearchFields,
  MentorshipFields, FinancialFields, OthersFields,
} from "@/components/faculty/AcademicProfileModuleFields";
import type { ProfileModuleKey } from "@/lib/faculty/profileModules";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import type { FacultyProfileFields, CollegeType } from "@/types";

// The record shape every per-module edit page holds in local state -
// PersonalDetailsFields' fields live at the top level (matching the host doc,
// FacultyMember or FMSUser), academicProfile is nested exactly as the PATCH
// routes expect it.
export interface FacultyEditRecord extends PersonalDetailsValue {
  academicProfile?: Partial<FacultyProfileFields>;
  joiningLetterUrl?: string;
  appointmentLetterUrl?: string;
  resumeUrl?: string;
}

interface Props {
  moduleKey: ProfileModuleKey;
  record: FacultyEditRecord;
  onChange: (patch: Partial<FacultyEditRecord>) => void;
  facultyId: string;
  includeTeachingAssignment?: boolean;
  teachingRows?: StagedTeachingRow[];
  onTeachingRowsChange?: (rows: StagedTeachingRow[]) => void;
  // School-type colleges show a different qualifications list instead of
  // UG/PG/PhD - see QualificationFields.
  collegeType?: CollegeType;
  // This faculty member's own department - forwarded to TeachingAssignmentsEditor
  // so its Year options are scoped to THIS department's own Course Year Timings
  // rather than unioned across every department sharing the same catalog
  // programme (see TeachingAssignmentsEditor's own doc-comment on `department`).
  department?: string;
  // Passed straight through to PersonalDetailsFields - this component is
  // reused by both genuinely-Faculty edit pages AND, via MyProfileModuleEditPage,
  // several non-Faculty roles' self-profile pages (including College Staff),
  // so it can't hardcode Faculty's relaxed requirement itself; the default
  // (undefined -> PersonalDetailsFields' own STAFF_REQUIRED_PERSONAL_FIELDS)
  // preserves every existing caller's behavior unless they opt in.
  requiredPersonalFields?: (keyof PersonalDetailsValue)[];
  // Full Name (as per SSC) lives only under Identity & Employment, right after
  // Employee ID - passed by the two callers that have a dedicated Identity &
  // Employment editor of their own (hod/faculty/[id]/edit and panel/profile/edit)
  // so it isn't shown a second time on this Personal Details tab. Every other
  // caller of this editor (Principal/VP and the ~12 non-Faculty self-profile
  // roles sharing MyProfileModuleEditPage) has no such separate page, so this
  // Personal Details tab stays their only place to set it - default false
  // preserves that.
  hideLegalName?: boolean;
  // Passed straight through to PersonalDetailsFields - true only for a
  // genuine facultyMembers record (HOD's Faculty edit pages, and Panel's own
  // self-edit page). Every other role sharing this editor via
  // MyProfileModuleEditPage edits a plain FMSUser doc instead, so this
  // defaults to false there.
  ratificationHistory?: boolean;
}

// Edit-side sibling of FacultyProfileModuleContent.tsx - given one moduleKey,
// renders the matching field editor seeded from `record`, merging any change
// back into the complete `record` (never a bare slice) so the caller can
// always PATCH the whole academicProfile object back intact - those PATCH
// routes replace the field wholesale rather than deep-merging.
export function FacultyProfileModuleEditor({
  moduleKey, record, onChange, facultyId, includeTeachingAssignment = true, teachingRows = [], onTeachingRowsChange, collegeType,
  requiredPersonalFields, department, hideLegalName = false, ratificationHistory = false,
}: Props) {
  const academicProfile = record.academicProfile ?? {};

  switch (moduleKey) {
    case "personal":
      // Every caller of this editor is Faculty-shaped (see its own doc-comment)
      // - Supporting/Non-Technical Staff have their own SupportingStaffModuleEditor
      // - so ESI Number (statutory ID with no Faculty equivalent) never applies here.
      return (
        <PersonalDetailsFields
          value={record}
          onChange={(v) => onChange(v)}
          requiredFields={requiredPersonalFields}
          hiddenFields={hideLegalName ? ["legalName", "esiNumber"] : ["esiNumber"]}
          showNameAsPerPan
          ratificationHistory={ratificationHistory}
        />
      );
    case "qualification":
      return <QualificationFields value={academicProfile} onChange={(ap) => onChange({ academicProfile: ap })} collegeType={collegeType} />;
    case "experience":
      return (
        <ExperienceFields
          value={academicProfile}
          onChange={(ap) => onChange({ academicProfile: ap })}
          includeTeachingAssignment={includeTeachingAssignment}
        />
      );
    case "research":
      return <ResearchFields value={academicProfile} onChange={(ap) => onChange({ academicProfile: ap })} />;
    case "mentorship":
      return (
        <MentorshipFields
          value={academicProfile}
          onChange={(ap) => onChange({ academicProfile: ap })}
          ownerFacultyId={facultyId}
          ownerFacultyName={facultyDisplayName(record)}
        />
      );
    case "financial":
      return <FinancialFields value={academicProfile} onChange={(ap) => onChange({ academicProfile: ap })} />;
    case "others":
      return <OthersFields value={academicProfile} onChange={(ap) => onChange({ academicProfile: ap })} />;
    case "teaching-load":
      return onTeachingRowsChange ? (
        <TeachingAssignmentsEditor value={teachingRows} onChange={onTeachingRowsChange} department={department} />
      ) : (
        <p className="text-sm text-muted-foreground">Teaching assignments aren&apos;t editable here.</p>
      );
    default:
      return <p className="text-sm text-muted-foreground">Unknown section.</p>;
  }
}
