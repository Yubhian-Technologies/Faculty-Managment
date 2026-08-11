"use client";

import { Card, CardContent } from "@/components/ui/card";
import { PersonalDetailsView } from "@/components/shared/PersonalDetailsView";
import { Section, SubLabel, Field, DocLink, QualificationsView, ChipList } from "@/components/shared/ProfileFieldPrimitives";
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
  const profile = staff.supportingStaffProfile ?? {};
  const nonTechnical = profile.nonTechnicalProfile;
  const responsibilityLabels = (nonTechnical?.responsibilities ?? []).map((r) => NON_TECHNICAL_RESPONSIBILITY_LABELS[r] ?? r);
  const computerSkillLabels = (nonTechnical?.computerSkills ?? []).map((s) => COMPUTER_SKILL_LABELS[s] ?? s);

  return (
    <Card>
      <CardContent className="pt-6">
        {moduleKey === "personal" && <PersonalDetailsView value={staff} />}

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
                    <Field label="Title" value={t.title} />
                    <Field label="Organizer" value={t.organizer} />
                    <Field label="Year" value={t.year} />
                    {t.certificateUrl && (
                      <div className="col-span-2 sm:col-span-4"><DocLink url={t.certificateUrl} label="View Certificate" /></div>
                    )}
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
                    <Field label="Title" value={a.title} />
                    <Field label="Awarding Body" value={a.awardingBody} />
                    <Field label="Year" value={a.year} />
                    {a.certificateUrl && (
                      <div className="col-span-2 sm:col-span-4"><DocLink url={a.certificateUrl} label="View Certificate" /></div>
                    )}
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
