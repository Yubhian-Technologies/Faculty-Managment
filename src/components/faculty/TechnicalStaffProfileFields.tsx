"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionTitle, NumInput, TextInput, RepeatingGroup, CheckboxGroup, StringListInput } from "@/components/shared/ProfileFieldPrimitives";
import { CertificateUploadField } from "@/components/shared/CertificateUploadField";
import { TrainingGroup, AchievementsGroup } from "@/components/shared/TrainingAchievementsFields";
import { TECHNICAL_RESPONSIBILITY_LABELS, VENDOR_CERTIFICATION_LABELS } from "@/types";
import type { TechnicalProfile, TechnicalResponsibility, VendorCertification, VendorCertificationEntry } from "@/types";

interface Props {
  value: Partial<TechnicalProfile>;
  onChange: (next: Partial<TechnicalProfile>) => void;
}

const EMPTY_TECHNICAL_PROFILE: TechnicalProfile = {
  skills: { programmingLanguages: [], operatingSystems: [], networking: [], databases: [], cloud: [], hardware: [], softwareTools: [] },
  responsibilities: [],
  certifications: [],
  training: [],
  achievements: [],
};
const EMPTY_VENDOR_CERT: VendorCertificationEntry = { vendor: "CISCO", certificationName: "" };

const TECHNICAL_RESPONSIBILITY_OPTIONS = Object.entries(TECHNICAL_RESPONSIBILITY_LABELS)
  .map(([v, label]) => ({ value: v as TechnicalResponsibility, label }));

// Faculty designations in TECHNICAL_STAFF_DESIGNATIONS (Lab Assistant/
// Programmer/System Administrator/Network Engineer) use this instead of
// AcademicProfileFields/TeachingAssignmentsEditor - relocated from the old
// Supporting Staff "Technical" category (see core.ts TechnicalProfile).
export function TechnicalStaffProfileFields({ value, onChange }: Props) {
  const profile = { ...EMPTY_TECHNICAL_PROFILE, ...value };
  function set<K extends keyof TechnicalProfile>(key: K, v: TechnicalProfile[K]) {
    onChange({ ...profile, [key]: v });
  }
  function setSkill<K extends keyof TechnicalProfile["skills"]>(key: K, v: TechnicalProfile["skills"][K]) {
    set("skills", { ...profile.skills, [key]: v });
  }

  return (
    <div className="space-y-5">
      <SectionTitle>Technical Skills</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StringListInput label="Programming Languages" values={profile.skills.programmingLanguages} onChange={(v) => setSkill("programmingLanguages", v)} placeholder="e.g. Python" />
        <StringListInput label="Operating Systems" values={profile.skills.operatingSystems} onChange={(v) => setSkill("operatingSystems", v)} placeholder="e.g. Linux" />
        <StringListInput label="Networking" values={profile.skills.networking} onChange={(v) => setSkill("networking", v)} placeholder="e.g. TCP/IP" />
        <StringListInput label="Database" values={profile.skills.databases} onChange={(v) => setSkill("databases", v)} placeholder="e.g. MySQL" />
        <StringListInput label="Cloud" values={profile.skills.cloud} onChange={(v) => setSkill("cloud", v)} placeholder="e.g. AWS" />
        <StringListInput label="Hardware" values={profile.skills.hardware} onChange={(v) => setSkill("hardware", v)} placeholder="e.g. Networking hardware" />
        <StringListInput label="Software Tools" values={profile.skills.softwareTools} onChange={(v) => setSkill("softwareTools", v)} placeholder="e.g. Wireshark" />
      </div>

      <SectionTitle>Responsibilities</SectionTitle>
      <CheckboxGroup title="Responsibilities" options={TECHNICAL_RESPONSIBILITY_OPTIONS} selected={profile.responsibilities} onChange={(v) => set("responsibilities", v)} />
      {profile.responsibilities?.includes("OTHER") && (
        <TextInput label="Other Responsibility" value={profile.otherResponsibility} onChange={(v) => set("otherResponsibility", v)} />
      )}

      <SectionTitle>Certifications</SectionTitle>
      <RepeatingGroup
        title="Vendor Certifications"
        items={profile.certifications}
        empty={EMPTY_VENDOR_CERT}
        onChange={(v) => set("certifications", v)}
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
      <TrainingGroup items={profile.training} onChange={(v) => set("training", v)} />

      <SectionTitle>Achievements</SectionTitle>
      <div className="space-y-2">
        <Label>Innovations / Automation Developed</Label>
        <Textarea value={profile.innovationsAndAutomation ?? ""} onChange={(e) => set("innovationsAndAutomation", e.target.value)} rows={3} />
      </div>
      <AchievementsGroup items={profile.achievements} onChange={(v) => set("achievements", v)} />
    </div>
  );
}
