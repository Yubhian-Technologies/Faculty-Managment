"use client";

import { Section, SubLabel, Field, ChipList, DocLink } from "@/components/shared/ProfileFieldPrimitives";
import {
  TECHNICAL_RESPONSIBILITY_LABELS, NON_TECHNICAL_RESPONSIBILITY_LABELS, COMPUTER_SKILL_LABELS,
  VENDOR_CERTIFICATION_LABELS, TRAINING_ENTRY_TYPE_LABELS, AWARD_CATEGORY_LABELS,
} from "@/types";
import type { SupportingStaffProfileFields, SupportingStaffCategory } from "@/types";

interface Props {
  profile: Partial<SupportingStaffProfileFields> | undefined;
  staffCategory: SupportingStaffCategory;
}

export function SupportingStaffProfileView({ profile, staffCategory }: Props) {
  const p = profile ?? {};
  const technical = p.technicalProfile;
  const nonTechnical = p.nonTechnicalProfile;

  return (
    <div className="space-y-5">
      <Section number={1} title="Qualifications">
        {(p.qualifications ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
          <div className="space-y-2">
            {p.qualifications?.map((q, i) => (
              <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Field label="Level" value={q.level} />
                <Field label="Degree & Branch" value={q.degreeAndBranch} />
                <Field label="University / Institute" value={q.universityOrInstitute} />
                <Field label="Percentage / Division" value={q.percentageOrDivision} />
                <Field label="Year of Completion" value={q.yearOfCompletion} />
                {q.certificateUrl && (
                  <div className="col-span-2 sm:col-span-4"><DocLink url={q.certificateUrl} label="View Certificate" /></div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {staffCategory === "TECHNICAL" ? (
        <>
          <Section number={2} title="Technical Skills">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><SubLabel>Programming Languages</SubLabel><div className="mt-1"><ChipList values={technical?.skills.programmingLanguages} /></div></div>
              <div><SubLabel>Operating Systems</SubLabel><div className="mt-1"><ChipList values={technical?.skills.operatingSystems} /></div></div>
              <div><SubLabel>Networking</SubLabel><div className="mt-1"><ChipList values={technical?.skills.networking} /></div></div>
              <div><SubLabel>Database</SubLabel><div className="mt-1"><ChipList values={technical?.skills.databases} /></div></div>
              <div><SubLabel>Cloud</SubLabel><div className="mt-1"><ChipList values={technical?.skills.cloud} /></div></div>
              <div><SubLabel>Hardware</SubLabel><div className="mt-1"><ChipList values={technical?.skills.hardware} /></div></div>
              <div><SubLabel>Software Tools</SubLabel><div className="mt-1"><ChipList values={technical?.skills.softwareTools} /></div></div>
            </div>
          </Section>

          <Section number={3} title="Responsibilities">
            <ChipList values={technical?.responsibilities.map((r) => TECHNICAL_RESPONSIBILITY_LABELS[r])} />
            {technical?.otherResponsibility && <Field label="Other" value={technical.otherResponsibility} />}
          </Section>

          <Section number={4} title="Certifications">
            {(technical?.certifications ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
              technical?.certifications.map((c, i) => (
                <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Field label="Vendor" value={c.vendor === "OTHER" ? c.otherVendorName : VENDOR_CERTIFICATION_LABELS[c.vendor]} />
                  <Field label="Certification" value={c.certificationName} />
                  <Field label="Year" value={c.year} />
                  {c.certificateUrl && (
                    <div className="col-span-2 sm:col-span-4"><DocLink url={c.certificateUrl} label="View Certificate" /></div>
                  )}
                </div>
              ))
            )}
          </Section>

          <Section number={5} title="Training">
            {(technical?.training ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
              technical?.training.map((t, i) => (
                <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Field label="Type" value={TRAINING_ENTRY_TYPE_LABELS[t.type]} />
                  <Field label="Title" value={t.title} />
                  <Field label="Organizer" value={t.organizer} />
                  <Field label="Year" value={t.year} />
                  {t.certificateUrl && (
                    <div className="col-span-2 sm:col-span-4"><DocLink url={t.certificateUrl} label="View Certificate" /></div>
                  )}
                </div>
              ))
            )}
          </Section>

          <Section number={6} title="Achievements">
            <p className="text-sm whitespace-pre-wrap">{technical?.innovationsAndAutomation || "-"}</p>
            {(technical?.achievements ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
              technical?.achievements.map((a, i) => (
                <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Field label="Category" value={AWARD_CATEGORY_LABELS[a.category]} />
                  <Field label="Title" value={a.title} />
                  <Field label="Awarding Body" value={a.awardingBody} />
                  <Field label="Year" value={a.year} />
                  {a.certificateUrl && (
                    <div className="col-span-2 sm:col-span-4"><DocLink url={a.certificateUrl} label="View Certificate" /></div>
                  )}
                </div>
              ))
            )}
          </Section>
        </>
      ) : (
        <>
          <Section number={2} title="Job Responsibilities">
            <ChipList values={nonTechnical?.responsibilities.map((r) => NON_TECHNICAL_RESPONSIBILITY_LABELS[r])} />
            {nonTechnical?.otherResponsibility && <Field label="Other" value={nonTechnical.otherResponsibility} />}
          </Section>

          <Section number={3} title="Computer Skills">
            <ChipList values={nonTechnical?.computerSkills.map((s) => COMPUTER_SKILL_LABELS[s])} />
            {nonTechnical?.otherComputerSkill && <Field label="Other" value={nonTechnical.otherComputerSkill} />}
            <Field label="Typing Speed (WPM)" value={nonTechnical?.typingSpeedWpm} />
          </Section>

          <Section number={4} title="Training">
            {(nonTechnical?.training ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
              nonTechnical?.training.map((t, i) => (
                <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Field label="Type" value={TRAINING_ENTRY_TYPE_LABELS[t.type]} />
                  <Field label="Title" value={t.title} />
                  <Field label="Organizer" value={t.organizer} />
                  <Field label="Year" value={t.year} />
                  {t.certificateUrl && (
                    <div className="col-span-2 sm:col-span-4"><DocLink url={t.certificateUrl} label="View Certificate" /></div>
                  )}
                </div>
              ))
            )}
          </Section>

          <Section number={5} title="Awards & Recognition">
            {(nonTechnical?.achievements ?? []).length === 0 ? <p className="text-xs text-muted-foreground">None recorded.</p> : (
              nonTechnical?.achievements.map((a, i) => (
                <div key={i} className="rounded-md border bg-muted/20 shadow-sm p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Field label="Category" value={AWARD_CATEGORY_LABELS[a.category]} />
                  <Field label="Title" value={a.title} />
                  <Field label="Awarding Body" value={a.awardingBody} />
                  <Field label="Year" value={a.year} />
                  {a.certificateUrl && (
                    <div className="col-span-2 sm:col-span-4"><DocLink url={a.certificateUrl} label="View Certificate" /></div>
                  )}
                </div>
              ))
            )}
          </Section>
        </>
      )}

      <Section number={7} title="Others">
        <p className="text-sm whitespace-pre-wrap">{p.otherInformation || "-"}</p>
      </Section>
    </div>
  );
}
