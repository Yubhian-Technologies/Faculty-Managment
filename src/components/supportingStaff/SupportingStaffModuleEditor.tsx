"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NumInput, TextInput, QualificationsFields, CheckboxGroup, StringListInput } from "@/components/shared/ProfileFieldPrimitives";
import { PersonalDetailsFields, type PersonalDetailsValue } from "@/components/shared/PersonalDetailsFields";
import { TrainingGroup, AchievementsGroup } from "@/components/shared/TrainingAchievementsFields";
import { getSupportingQualificationLevels } from "@/lib/designations/config";
import { NON_TECHNICAL_RESPONSIBILITY_LABELS, COMPUTER_SKILL_LABELS } from "@/types";
import type { SupportingStaffModuleKey } from "@/lib/supportingStaff/profileModules";
import type { SupportingStaffProfileFields, NonTechnicalProfile, NonTechnicalResponsibility, ComputerSkill, CollegeType } from "@/types";

// The record shape every per-module edit page holds in local state - name +
// PersonalDetailsFields' fields live at the top level (matching the host doc),
// supportingStaffProfile is nested exactly as the PATCH route expects it.
export interface SupportingStaffEditRecord extends PersonalDetailsValue {
  name?: string;
  supportingStaffProfile?: Partial<SupportingStaffProfileFields>;
}

interface Props {
  moduleKey: SupportingStaffModuleKey;
  record: SupportingStaffEditRecord;
  onChange: (patch: Partial<SupportingStaffEditRecord>) => void;
  collegeType?: CollegeType;
}

const EMPTY_NON_TECHNICAL: NonTechnicalProfile = { responsibilities: [], computerSkills: [], training: [], achievements: [] };

const RESPONSIBILITY_OPTIONS = Object.entries(NON_TECHNICAL_RESPONSIBILITY_LABELS)
  .map(([v, label]) => ({ value: v as NonTechnicalResponsibility, label }));
const COMPUTER_SKILL_OPTIONS = Object.entries(COMPUTER_SKILL_LABELS)
  .map(([v, label]) => ({ value: v as ComputerSkill, label }));

// Edit-side sibling of SupportingStaffModuleContent.tsx - given one
// moduleKey, renders the matching field editor seeded from `record`, merging
// any change back into the complete `record` so the caller always PATCHes
// the whole supportingStaffProfile object back intact (the PATCH route
// replaces it wholesale, not a deep merge).
export function SupportingStaffModuleEditor({ moduleKey, record, onChange, collegeType }: Props) {
  const profile = record.supportingStaffProfile ?? {};
  function setProfile(patch: Partial<SupportingStaffProfileFields>) {
    onChange({ supportingStaffProfile: { ...profile, ...patch } });
  }
  const nonTechnical = profile.nonTechnicalProfile ?? EMPTY_NON_TECHNICAL;
  function setNonTechnical<K extends keyof NonTechnicalProfile>(key: K, v: NonTechnicalProfile[K]) {
    setProfile({ nonTechnicalProfile: { ...nonTechnical, [key]: v } });
  }

  switch (moduleKey) {
    case "personal":
      return <PersonalDetailsFields value={record} onChange={(v) => onChange(v)} />;

    case "qualifications":
      return (
        <QualificationsFields
          items={profile.qualifications}
          levelOptions={getSupportingQualificationLevels(collegeType)}
          onChange={(v) => setProfile({ qualifications: v })}
        />
      );

    case "responsibilities":
      return (
        <div className="space-y-5">
          <CheckboxGroup title="Responsibilities" options={RESPONSIBILITY_OPTIONS} selected={nonTechnical.responsibilities} onChange={(v) => setNonTechnical("responsibilities", v)} />
          {nonTechnical.responsibilities?.includes("OTHER") && (
            <TextInput label="Other Responsibility" value={nonTechnical.otherResponsibility} onChange={(v) => setNonTechnical("otherResponsibility", v)} />
          )}
          <CheckboxGroup title="Computer Skills" options={COMPUTER_SKILL_OPTIONS} selected={nonTechnical.computerSkills} onChange={(v) => setNonTechnical("computerSkills", v)} />
          {nonTechnical.computerSkills?.includes("OTHER") && (
            <TextInput label="Other Computer Skill" value={nonTechnical.otherComputerSkill} onChange={(v) => setNonTechnical("otherComputerSkill", v)} />
          )}
          <StringListInput
            label="Hardware Skills"
            values={nonTechnical.hardwareSkills}
            onChange={(v) => setNonTechnical("hardwareSkills", v)}
            placeholder="e.g. PC Assembly, Networking, CCTV — type and press Add"
          />
          <NumInput label="Typing Speed (WPM)" value={nonTechnical.typingSpeedWpm} onChange={(v) => setNonTechnical("typingSpeedWpm", v)} />
        </div>
      );

    case "training":
      return <TrainingGroup items={nonTechnical.training} onChange={(v) => setNonTechnical("training", v)} />;

    case "achievements":
      return <AchievementsGroup items={nonTechnical.achievements} onChange={(v) => setNonTechnical("achievements", v)} />;

    case "others":
      return (
        <div className="space-y-2">
          <Label>Other Information</Label>
          <Textarea
            value={profile.otherInformation ?? ""}
            onChange={(e) => setProfile({ otherInformation: e.target.value })}
            placeholder="Anything not covered above - add it here"
            rows={4}
          />
        </div>
      );

    default:
      return <p className="text-sm text-muted-foreground">Unknown section.</p>;
  }
}
