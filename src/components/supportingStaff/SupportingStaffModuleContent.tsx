"use client";

import { Card, CardContent } from "@/components/ui/card";
import { PersonalDetailsView } from "@/components/shared/PersonalDetailsView";
import { Section, SubLabel, Field, DocField, QualificationsView, ChipList } from "@/components/shared/ProfileFieldPrimitives";
import { normalizeSupportingStaffProfile } from "@/lib/faculty/academicProfileCompat";
import { awardYear } from "@/lib/faculty/awardYear";
import { TRAINING_ENTRY_TYPE_LABELS, AWARD_CATEGORY_LABELS, NON_TECHNICAL_RESPONSIBILITY_LABELS, COMPUTER_SKILL_LABELS } from "@/types";
import type { PersonalDetailsSource } from "@/components/shared/PersonalDetailsView";
import type { SupportingStaffModuleKey } from "@/lib/supportingStaff/profileModules";
import type { SupportingStaffProfileFields } from "@/types";

export interface SupportingStaffProfileSource extends PersonalDetailsSource {
  supportingStaffProfile?: Partial<SupportingStaffProfileFields>;
}

interface Props {
  moduleKey: SupportingStaffModuleKey;
  staff: SupportingStaffProfileSource;
}

// Renders exactly one module's content for the per-module View pages - the
// hub (SupportingStaffProfileHub) links here per tile, mirroring
// FacultyProfileModuleContent for the SupportingStaffProfileFields shape.
export function SupportingStaffModuleContent({ moduleKey, staff }: Props) {
  // Lift legacy key names on un-migrated docs (training / achievements / qualifications).
  const profile = normalizeSupportingStaffProfile(staff.supportingStaffProfile) ?? {};
  const nonTechnical = profile.nonTechnicalProfile;
  const responsibilityLabels = (nonTechnical?.responsibilities ?? []).map((r) => NON_TECHNICAL_RESPONSIBILITY_LABELS[r] ?? r);
  const computerSkillLabels = (nonTechnical?.computerSkills ?? []).map((s) => COMPUTER_SKILL_LABELS[s] ?? s);
  const hardwareSkillLabels = nonTechnical?.hardwareSkills ?? [];

  return (
    <Card>
      <CardContent className="pt-6">
        {/* Full Name (as per SSC) is shown on Identity & Employment instead
            (hideLegalName); Name (as per PAN) shows here, mirroring Faculty's
            own PersonalDetailsView usage (FacultyProfileModuleContent.tsx). */}
        {moduleKey === "personal" && <PersonalDetailsView value={staff} hideLegalName showNameAsPerPan />}

        {moduleKey === "qualifications" && <QualificationsView items={profile.qualifications} />}

        {moduleKey === "responsibilities" && (
          <Section number={1} title="Job Responsibilities & Skills">
            <div className="space-y-2">
              <SubLabel>Responsibilities</SubLabel>
              <ChipList values={responsibilityLabels} />
              {nonTechnical?.otherResponsibility && <Field label="Other Responsibility" value={nonTechnical.otherResponsibility} />}
            </div>
            <div className="space-y-2">
              <SubLabel>Computer Skills</SubLabel>
              <ChipList values={computerSkillLabels} />
              {nonTechnical?.otherComputerSkill && <Field label="Other Computer Skill" value={nonTechnical.otherComputerSkill} />}
            </div>
            {hardwareSkillLabels.length > 0 && (
              <div className="space-y-2">
                <SubLabel>Hardware Skills</SubLabel>
                <ChipList values={hardwareSkillLabels} />
              </div>
            )}
            <Field label="Typing Speed (WPM)" value={nonTechnical?.typingSpeedWpm} />
          </Section>
        )}

        {moduleKey === "training" && (
          <Section number={1} title="Training">
            {(nonTechnical?.training ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
              <div className="space-y-2">
                {nonTechnical?.training.map((t, i) => (
                  <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Field label="Type" value={TRAINING_ENTRY_TYPE_LABELS[t.type]} />
                    <Field label="Title of the Program" value={t.titleOfTheProgram} />
                    <Field label="Name of the Faculty / Coordinator" value={t.nameOfTheFacultyCoordinator} />
                    <Field label="Year" value={t.year} />
                    <Field label="Duration" value={t.duration ? `${t.duration} day${t.duration === 1 ? "" : "s"}` : undefined} />
                    <DocField label="Certificate" url={t.certificateUrl} />
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {moduleKey === "achievements" && (
          <Section number={1} title="Awards & Recognition">
            {(nonTechnical?.achievements ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
              <div className="space-y-2">
                {nonTechnical?.achievements.map((a, i) => (
                  <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Field label="Category" value={AWARD_CATEGORY_LABELS[a.category]} />
                    <Field label="Title of Award" value={a.titleOfAward} />
                    <Field label="Awarding Agency/Body" value={a.awardingAgencyBody} />
                    <Field label="Date of Award" value={a.dateOfAward ?? awardYear(a)} />
                    <DocField label="Certificate" url={a.certificateUrl} />
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {moduleKey === "others" && (
          <Section number={1} title="Others">
            <p className="text-sm whitespace-pre-wrap">{profile.otherInformation || "-"}</p>
          </Section>
        )}
      </CardContent>
    </Card>
  );
}
