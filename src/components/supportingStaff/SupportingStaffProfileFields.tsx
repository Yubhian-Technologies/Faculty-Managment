"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  SectionTitle, NumInput, TextInput, QualificationsFields, CheckboxGroup,
} from "@/components/shared/ProfileFieldPrimitives";
import { TrainingGroup, AchievementsGroup } from "@/components/shared/TrainingAchievementsFields";
import { getSupportingQualificationLevels } from "@/lib/designations/config";
import {
  NON_TECHNICAL_RESPONSIBILITY_LABELS, COMPUTER_SKILL_LABELS,
} from "@/types";
import type {
  SupportingStaffProfileFields as ProfileFieldsType,
  NonTechnicalProfile,
  NonTechnicalResponsibility,
  ComputerSkill,
  CollegeType,
} from "@/types";

interface Props {
  value: Partial<ProfileFieldsType>;
  onChange: (next: Partial<ProfileFieldsType>) => void;
  collegeType?: CollegeType;
}

const EMPTY_NON_TECHNICAL_PROFILE: NonTechnicalProfile = {
  responsibilities: [],
  computerSkills: [],
  training: [],
  achievements: [],
};

const NON_TECHNICAL_RESPONSIBILITY_OPTIONS = Object.entries(NON_TECHNICAL_RESPONSIBILITY_LABELS)
  .map(([v, label]) => ({ value: v as NonTechnicalResponsibility, label }));
const COMPUTER_SKILL_OPTIONS = Object.entries(COMPUTER_SKILL_LABELS)
  .map(([v, label]) => ({ value: v as ComputerSkill, label }));

export function SupportingStaffProfileFields({ value, onChange, collegeType }: Props) {
  function set<K extends keyof ProfileFieldsType>(key: K, v: ProfileFieldsType[K]) {
    onChange({ ...value, [key]: v });
  }

  const nonTechnical = value.nonTechnicalProfile ?? EMPTY_NON_TECHNICAL_PROFILE;
  function setNonTechnical<K extends keyof NonTechnicalProfile>(key: K, v: NonTechnicalProfile[K]) {
    set("nonTechnicalProfile", { ...nonTechnical, [key]: v });
  }

  return (
    <div className="space-y-5">
      <SectionTitle>Qualifications</SectionTitle>
      <QualificationsFields
        items={value.qualifications}
        levelOptions={getSupportingQualificationLevels(collegeType)}
        onChange={(v) => set("qualifications", v)}
      />

      <SectionTitle>Job Responsibilities</SectionTitle>
      <CheckboxGroup title="Responsibilities" options={NON_TECHNICAL_RESPONSIBILITY_OPTIONS} selected={nonTechnical.responsibilities} onChange={(v) => setNonTechnical("responsibilities", v)} />
      {nonTechnical.responsibilities?.includes("OTHER") && (
        <TextInput label="Other Responsibility" value={nonTechnical.otherResponsibility} onChange={(v) => setNonTechnical("otherResponsibility", v)} />
      )}

      <SectionTitle>Computer Skills</SectionTitle>
      <CheckboxGroup title="Computer Skills" options={COMPUTER_SKILL_OPTIONS} selected={nonTechnical.computerSkills} onChange={(v) => setNonTechnical("computerSkills", v)} />
      {nonTechnical.computerSkills?.includes("OTHER") && (
        <TextInput label="Other Computer Skill" value={nonTechnical.otherComputerSkill} onChange={(v) => setNonTechnical("otherComputerSkill", v)} />
      )}
      <NumInput label="Typing Speed (WPM)" value={nonTechnical.typingSpeedWpm} onChange={(v) => setNonTechnical("typingSpeedWpm", v)} />

      <SectionTitle>Training</SectionTitle>
      <TrainingGroup items={nonTechnical.training} onChange={(v) => setNonTechnical("training", v)} />

      <SectionTitle>Awards &amp; Recognition</SectionTitle>
      <AchievementsGroup items={nonTechnical.achievements} onChange={(v) => setNonTechnical("achievements", v)} />

      <SectionTitle>Others</SectionTitle>
      <div className="space-y-2">
        <Label>Other Information</Label>
        <Textarea
          value={value.otherInformation ?? ""}
          onChange={(e) => set("otherInformation", e.target.value)}
          placeholder="Anything not covered above - add it here"
          rows={4}
        />
      </div>
    </div>
  );
}
