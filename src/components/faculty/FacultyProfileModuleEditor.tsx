"use client";

import { PersonalDetailsFields, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import { TeachingAssignmentsEditor, type StagedTeachingRow } from "@/components/faculty/TeachingAssignmentsEditor";
import {
  QualificationFields, ExperienceFields, ResearchFields, GrantsFields,
  MentorshipFields, FinancialFields, OthersFields,
} from "@/components/faculty/AcademicProfileModuleFields";
import type { ProfileModuleKey } from "@/lib/faculty/profileModules";
import type { FacultyProfileFields, CollegeType } from "@/types";

// The record shape every per-module edit page holds in local state - name +
// PersonalDetailsFields' fields live at the top level (matching the host doc,
// FacultyMember or FMSUser), academicProfile is nested exactly as the PATCH
// routes expect it.
export interface FacultyEditRecord extends PersonalDetailsValue {
  name?: string;
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
}

// Edit-side sibling of FacultyProfileModuleContent.tsx - given one moduleKey,
// renders the matching field editor seeded from `record`, merging any change
// back into the complete `record` (never a bare slice) so the caller can
// always PATCH the whole academicProfile object back intact - those PATCH
// routes replace the field wholesale rather than deep-merging.
export function FacultyProfileModuleEditor({
  moduleKey, record, onChange, includeTeachingAssignment = true, teachingRows = [], onTeachingRowsChange, collegeType,
  requiredPersonalFields, department,
}: Props) {
  const academicProfile = record.academicProfile ?? {};

  switch (moduleKey) {
    case "personal":
      // Every caller of this editor is Faculty-shaped (see its own doc-comment)
      // - Supporting/Non-Technical Staff have their own SupportingStaffModuleEditor
      // - so ESI Number (statutory ID with no Faculty equivalent) never applies here.
      return <PersonalDetailsFields value={record} onChange={(v) => onChange(v)} requiredFields={requiredPersonalFields} hiddenFields={["esiNumber"]} />;
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
    case "grants":
      return <GrantsFields value={academicProfile} onChange={(ap) => onChange({ academicProfile: ap })} />;
    case "mentorship":
      return <MentorshipFields value={academicProfile} onChange={(ap) => onChange({ academicProfile: ap })} />;
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
