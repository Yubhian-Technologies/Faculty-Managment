"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  SectionTitle, NumInput, TextInput, RepeatingGroup, CheckboxGroup, StringListInput,
} from "@/components/shared/ProfileFieldPrimitives";
import { CertificateUploadField } from "@/components/shared/CertificateUploadField";
import {
  TECHNICAL_RESPONSIBILITY_LABELS, NON_TECHNICAL_RESPONSIBILITY_LABELS, COMPUTER_SKILL_LABELS,
  VENDOR_CERTIFICATION_LABELS, TRAINING_ENTRY_TYPE_LABELS, AWARD_CATEGORY_LABELS,
} from "@/types";
import type {
  SupportingStaffProfileFields as ProfileFieldsType,
  SupportingStaffCategory,
  StaffQualification,
  TechnicalProfile,
  NonTechnicalProfile,
  TechnicalResponsibility,
  NonTechnicalResponsibility,
  ComputerSkill,
  VendorCertification,
  VendorCertificationEntry,
  TrainingEntry,
  TrainingEntryType,
  AwardEntry,
  AwardCategory,
} from "@/types";

interface Props {
  value: Partial<ProfileFieldsType>;
  onChange: (next: Partial<ProfileFieldsType>) => void;
  staffCategory: SupportingStaffCategory;
}

const EMPTY_QUALIFICATION: StaffQualification = {
  level: "", degreeAndBranch: "", universityOrInstitute: "", percentageOrDivision: "",
  yearOfCompletion: new Date().getFullYear(), certificateUrl: "",
};
const EMPTY_VENDOR_CERT: VendorCertificationEntry = { vendor: "CISCO", certificationName: "" };
const EMPTY_TRAINING: TrainingEntry = { type: "WORKSHOP", title: "", organizer: "", year: new Date().getFullYear() };
const EMPTY_AWARD: AwardEntry = { category: "APPRECIATION_CERTIFICATE", title: "", awardingBody: "", year: new Date().getFullYear() };

const EMPTY_TECHNICAL_PROFILE: TechnicalProfile = {
  skills: { programmingLanguages: [], operatingSystems: [], networking: [], databases: [], cloud: [], hardware: [], softwareTools: [] },
  responsibilities: [],
  certifications: [],
  training: [],
  achievements: [],
};
const EMPTY_NON_TECHNICAL_PROFILE: NonTechnicalProfile = {
  responsibilities: [],
  computerSkills: [],
  training: [],
  achievements: [],
};

const TECHNICAL_RESPONSIBILITY_OPTIONS = Object.entries(TECHNICAL_RESPONSIBILITY_LABELS)
  .map(([v, label]) => ({ value: v as TechnicalResponsibility, label }));
const NON_TECHNICAL_RESPONSIBILITY_OPTIONS = Object.entries(NON_TECHNICAL_RESPONSIBILITY_LABELS)
  .map(([v, label]) => ({ value: v as NonTechnicalResponsibility, label }));
const COMPUTER_SKILL_OPTIONS = Object.entries(COMPUTER_SKILL_LABELS)
  .map(([v, label]) => ({ value: v as ComputerSkill, label }));

function TrainingGroup({ items, onChange }: { items: TrainingEntry[] | undefined; onChange: (v: TrainingEntry[]) => void }) {
  return (
    <RepeatingGroup
      title="Training"
      items={items}
      empty={EMPTY_TRAINING}
      onChange={onChange}
      renderRow={(item, update) => (
        <>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={item.type} onValueChange={(v) => update({ type: v as TrainingEntryType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TRAINING_ENTRY_TYPE_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TextInput label="Title" value={item.title} onChange={(v) => update({ title: v })} />
          <TextInput label="Organizer" value={item.organizer} onChange={(v) => update({ organizer: v })} />
          <NumInput label="Year" value={item.year} onChange={(v) => update({ year: v })} />
          <NumInput label="Duration (days)" value={item.durationDays} onChange={(v) => update({ durationDays: v })} />
          <div className="sm:col-span-2">
            <Label className="text-xs">Certificate</Label>
            <CertificateUploadField
              value={item.certificateUrl}
              onUploaded={(url) => update({ certificateUrl: url })}
              onRemoved={() => update({ certificateUrl: "" })}
            />
          </div>
        </>
      )}
    />
  );
}

function AchievementsGroup({ items, onChange }: { items: AwardEntry[] | undefined; onChange: (v: AwardEntry[]) => void }) {
  return (
    <RepeatingGroup
      title="Achievements / Awards"
      items={items}
      empty={EMPTY_AWARD}
      onChange={onChange}
      renderRow={(item, update) => (
        <>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={item.category} onValueChange={(v) => update({ category: v as AwardCategory })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(AWARD_CATEGORY_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TextInput label="Title" value={item.title} onChange={(v) => update({ title: v })} />
          <TextInput label="Awarding Body" value={item.awardingBody} onChange={(v) => update({ awardingBody: v })} />
          <NumInput label="Year" value={item.year} onChange={(v) => update({ year: v })} />
          <div className="sm:col-span-2">
            <Label className="text-xs">Certificate</Label>
            <CertificateUploadField
              value={item.certificateUrl}
              onUploaded={(url) => update({ certificateUrl: url })}
              onRemoved={() => update({ certificateUrl: "" })}
            />
          </div>
        </>
      )}
    />
  );
}

export function SupportingStaffProfileFields({ value, onChange, staffCategory }: Props) {
  function set<K extends keyof ProfileFieldsType>(key: K, v: ProfileFieldsType[K]) {
    onChange({ ...value, [key]: v });
  }

  const technical = value.technicalProfile ?? EMPTY_TECHNICAL_PROFILE;
  function setTechnical<K extends keyof TechnicalProfile>(key: K, v: TechnicalProfile[K]) {
    set("technicalProfile", { ...technical, [key]: v });
  }
  function setSkill<K extends keyof TechnicalProfile["skills"]>(key: K, v: TechnicalProfile["skills"][K]) {
    setTechnical("skills", { ...technical.skills, [key]: v });
  }

  const nonTechnical = value.nonTechnicalProfile ?? EMPTY_NON_TECHNICAL_PROFILE;
  function setNonTechnical<K extends keyof NonTechnicalProfile>(key: K, v: NonTechnicalProfile[K]) {
    set("nonTechnicalProfile", { ...nonTechnical, [key]: v });
  }

  return (
    <div className="space-y-5">
      <SectionTitle>Qualifications</SectionTitle>
      <RepeatingGroup
        title="Educational Qualifications"
        items={value.qualifications}
        empty={EMPTY_QUALIFICATION}
        onChange={(v) => set("qualifications", v)}
        renderRow={(item, update) => (
          <>
            <TextInput
              label="Level"
              value={item.level}
              onChange={(v) => update({ level: v })}
              placeholder={staffCategory === "TECHNICAL" ? "e.g. Diploma, B.Tech/B.Sc, M.Tech/MCA" : "e.g. SSC, Intermediate, Degree, PG"}
            />
            <TextInput label="Degree & Branch" value={item.degreeAndBranch} onChange={(v) => update({ degreeAndBranch: v })} />
            <TextInput label="University / Institute" value={item.universityOrInstitute} onChange={(v) => update({ universityOrInstitute: v })} />
            <TextInput label="Percentage / Division" value={item.percentageOrDivision} onChange={(v) => update({ percentageOrDivision: v })} />
            <NumInput label="Year of Completion" value={item.yearOfCompletion} onChange={(v) => update({ yearOfCompletion: v })} />
            <div className="sm:col-span-2">
              <Label className="text-xs">Certificate</Label>
              <CertificateUploadField
                value={item.certificateUrl}
                onUploaded={(url) => update({ certificateUrl: url })}
                onRemoved={() => update({ certificateUrl: "" })}
              />
            </div>
          </>
        )}
      />

      {staffCategory === "TECHNICAL" ? (
        <>
          <SectionTitle>Technical Skills</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StringListInput label="Programming Languages" values={technical.skills.programmingLanguages} onChange={(v) => setSkill("programmingLanguages", v)} placeholder="e.g. Python" />
            <StringListInput label="Operating Systems" values={technical.skills.operatingSystems} onChange={(v) => setSkill("operatingSystems", v)} placeholder="e.g. Linux" />
            <StringListInput label="Networking" values={technical.skills.networking} onChange={(v) => setSkill("networking", v)} placeholder="e.g. TCP/IP" />
            <StringListInput label="Database" values={technical.skills.databases} onChange={(v) => setSkill("databases", v)} placeholder="e.g. MySQL" />
            <StringListInput label="Cloud" values={technical.skills.cloud} onChange={(v) => setSkill("cloud", v)} placeholder="e.g. AWS" />
            <StringListInput label="Hardware" values={technical.skills.hardware} onChange={(v) => setSkill("hardware", v)} placeholder="e.g. Networking hardware" />
            <StringListInput label="Software Tools" values={technical.skills.softwareTools} onChange={(v) => setSkill("softwareTools", v)} placeholder="e.g. Wireshark" />
          </div>

          <SectionTitle>Responsibilities</SectionTitle>
          <CheckboxGroup title="Responsibilities" options={TECHNICAL_RESPONSIBILITY_OPTIONS} selected={technical.responsibilities} onChange={(v) => setTechnical("responsibilities", v)} />
          {technical.responsibilities?.includes("OTHER") && (
            <TextInput label="Other Responsibility" value={technical.otherResponsibility} onChange={(v) => setTechnical("otherResponsibility", v)} />
          )}

          <SectionTitle>Certifications</SectionTitle>
          <RepeatingGroup
            title="Vendor Certifications"
            items={technical.certifications}
            empty={EMPTY_VENDOR_CERT}
            onChange={(v) => setTechnical("certifications", v)}
            renderRow={(item, update) => (
              <>
                <div className="space-y-2">
                  <Label>Vendor</Label>
                  <Select value={item.vendor} onValueChange={(v) => update({ vendor: v as VendorCertification })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(VENDOR_CERTIFICATION_LABELS).map(([k, label]) => (
                        <SelectItem key={k} value={k}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {item.vendor === "OTHER" && (
                  <TextInput label="Vendor Name" value={item.otherVendorName} onChange={(v) => update({ otherVendorName: v })} />
                )}
                <TextInput label="Certification Name" value={item.certificationName} onChange={(v) => update({ certificationName: v })} />
                <NumInput label="Year" value={item.year} onChange={(v) => update({ year: v })} />
                <div className="sm:col-span-2">
                  <Label className="text-xs">Certificate</Label>
                  <CertificateUploadField
                    value={item.certificateUrl}
                    onUploaded={(url) => update({ certificateUrl: url })}
                    onRemoved={() => update({ certificateUrl: "" })}
                  />
                </div>
              </>
            )}
          />

          <SectionTitle>Training</SectionTitle>
          <TrainingGroup items={technical.training} onChange={(v) => setTechnical("training", v)} />

          <SectionTitle>Achievements</SectionTitle>
          <div className="space-y-2">
            <Label>Innovations / Automation Developed</Label>
            <Textarea value={technical.innovationsAndAutomation ?? ""} onChange={(e) => setTechnical("innovationsAndAutomation", e.target.value)} rows={3} />
          </div>
          <AchievementsGroup items={technical.achievements} onChange={(v) => setTechnical("achievements", v)} />
        </>
      ) : (
        <>
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
        </>
      )}

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
