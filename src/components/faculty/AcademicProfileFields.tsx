"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import type {
  FacultyProfileFields,
  DegreeDetail,
  FundedProject,
  ConsultancyProject,
  LabEstablished,
  AuthoredBook,
} from "@/types";

interface Props {
  value: Partial<FacultyProfileFields>;
  onChange: (next: Partial<FacultyProfileFields>) => void;
  includeTeachingAssignment?: boolean;
}

const EMPTY_DEGREE: DegreeDetail = { degreeAndBranch: "", universityOrInstitute: "", percentageOrDivision: "", yearOfCompletion: new Date().getFullYear() };
const EMPTY_FUNDED_PROJECT: FundedProject = { title: "", fundingAgency: "", grantAmountLakhs: 0, year: new Date().getFullYear(), status: "" };
const EMPTY_CONSULTANCY: ConsultancyProject = { title: "", clientOrAgency: "", revenueLakhs: 0, year: new Date().getFullYear(), status: "" };
const EMPTY_LAB: LabEstablished = { facilityDetails: "", outcomes: "" };
const EMPTY_BOOK: AuthoredBook = { title: "", publisher: "", year: new Date().getFullYear() };

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="pt-2 pb-1 border-t"><p className="text-sm font-medium text-muted-foreground">{children}</p></div>;
}

function NumInput({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="number" value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string | undefined; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function DegreeFields({ label, value, onChange }: { label: string; value: DegreeDetail | undefined; onChange: (v: DegreeDetail) => void }) {
  const v = value ?? EMPTY_DEGREE;
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextInput label="Degree & Branch" value={v.degreeAndBranch} onChange={(x) => onChange({ ...v, degreeAndBranch: x })} />
        <TextInput label="University / Institute" value={v.universityOrInstitute} onChange={(x) => onChange({ ...v, universityOrInstitute: x })} />
        <TextInput label="Percentage / Division" value={v.percentageOrDivision} onChange={(x) => onChange({ ...v, percentageOrDivision: x })} />
        <NumInput label="Year of Completion" value={v.yearOfCompletion} onChange={(x) => onChange({ ...v, yearOfCompletion: x })} />
      </div>
    </div>
  );
}

function RepeatingGroup<T>({
  title, items, empty, onChange, renderRow,
}: {
  title: string;
  items: T[] | undefined;
  empty: T;
  onChange: (next: T[]) => void;
  renderRow: (item: T, update: (patch: Partial<T>) => void) => React.ReactNode;
}) {
  const list = items ?? [];
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...list, empty])}>
          <Plus className="h-3.5 w-3.5 mr-1" />Add
        </Button>
      </div>
      {list.length === 0 && <p className="text-xs text-muted-foreground">None added yet.</p>}
      {list.map((item, i) => (
        <div key={i} className="flex items-start gap-2 rounded-md bg-muted/30 p-3">
          <div className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {renderRow(item, (patch) => {
              const next = [...list];
              next[i] = { ...next[i], ...patch };
              onChange(next);
            })}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(list.filter((_, idx) => idx !== i))}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function AcademicProfileFields({ value, onChange, includeTeachingAssignment = true }: Props) {
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }

  const teaching = value.teachingAssignment;
  const patents = value.patents;
  const phdPursuing = value.phdScholarsPursuing;
  const phdAwarded = value.phdScholarsAwarded;

  return (
    <div className="space-y-5">
      {/* Module 1 */}
      <SectionTitle>Module 1 — General &amp; Academic Profile</SectionTitle>
      <TextInput label="Highest Qualification Earned" value={value.highestQualification} onChange={(v) => set("highestQualification", v)} placeholder="e.g. Ph.D" />
      <DegreeFields label="UG Details" value={value.ugDetails} onChange={(v) => set("ugDetails", v)} />
      <DegreeFields label="PG Details" value={value.pgDetails} onChange={(v) => set("pgDetails", v)} />
      <DegreeFields label="PhD Details" value={value.phdDetails} onChange={(v) => set("phdDetails", v)} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Ph.D. Status</Label>
          <Select value={value.phdStatus ?? ""} onValueChange={(v) => set("phdStatus", v as FacultyProfileFields["phdStatus"])}>
            <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="AWARDED">Awarded</SelectItem>
              <SelectItem value="PURSUING">Pursuing</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Ph.D. Mode</Label>
          <Select value={value.phdMode ?? ""} onValueChange={(v) => set("phdMode", v as FacultyProfileFields["phdMode"])}>
            <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="FULL_TIME">Full-Time</SelectItem>
              <SelectItem value="PART_TIME">Part-Time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput label="Project Supervisor Name" value={value.phdSupervisorName} onChange={(v) => set("phdSupervisorName", v)} />
        <TextInput label="Fellowships Received" value={value.fellowshipsReceived} onChange={(v) => set("fellowshipsReceived", v)} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <NumInput label="GATE Qualified Year" value={value.gateQualifiedYear} onChange={(v) => set("gateQualifiedYear", v)} />
        <NumInput label="GATE Score" value={value.gateScore} onChange={(v) => set("gateScore", v)} />
        <NumInput label="NET/SLET Qualification Year" value={value.netSletQualificationYear} onChange={(v) => set("netSletQualificationYear", v)} />
      </div>

      {/* Module 2 */}
      <SectionTitle>Module 2 — Tenure &amp; Load</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <NumInput label="Teaching Experience Before Joining (yrs)" value={value.teachingExperienceBeforeJoiningYears} onChange={(v) => set("teachingExperienceBeforeJoiningYears", v)} />
        <NumInput label="Teaching Experience Since Joining (yrs)" value={value.teachingExperienceSinceJoiningYears} onChange={(v) => set("teachingExperienceSinceJoiningYears", v)} />
        <NumInput label="Research/Industry Experience (yrs)" value={value.researchOrIndustryExperienceYears} onChange={(v) => set("researchOrIndustryExperienceYears", v)} />
        <NumInput label="Total Professional Experience (yrs)" value={value.totalProfessionalExperienceYears} onChange={(v) => set("totalProfessionalExperienceYears", v)} />
        <NumInput label="Total Weekly Teaching Load (Hours)" value={value.totalWeeklyTeachingLoadHours} onChange={(v) => set("totalWeeklyTeachingLoadHours", v)} />
        <NumInput label="Average Student Feedback Score" value={value.averageStudentFeedbackScore} onChange={(v) => set("averageStudentFeedbackScore", v)} />
      </div>

      {includeTeachingAssignment && (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Teaching Role</p>
          <TextInput
            label="Primary Teaching Role / Specialization"
            value={teaching?.primaryTeachingRole}
            onChange={(v) => set("teachingAssignment", { primaryTeachingRole: v, courses: teaching?.courses ?? [] })}
          />
          <p className="text-xs text-muted-foreground">
            Subject-level teaching assignments (course, section, subject, weekly schedule) are managed below in &ldquo;Current Teaching Assignments&rdquo;.
          </p>
        </div>
      )}

      {/* Module 3 */}
      <SectionTitle>Module 3 — Research Publications</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <NumInput label="First/Corresponding Author Pubs" value={value.publicationsFirstOrCorrespondingAuthor} onChange={(v) => set("publicationsFirstOrCorrespondingAuthor", v)} />
        <NumInput label="Q1 / IF > 4.0 Pubs" value={value.publicationsQ1OrHighImpact} onChange={(v) => set("publicationsQ1OrHighImpact", v)} />
        <NumInput label="SCI/Scopus Count" value={value.sciScopusCount} onChange={(v) => set("sciScopusCount", v)} />
        <NumInput label="WoS (SCIE/ESCI) Count" value={value.wosCount} onChange={(v) => set("wosCount", v)} />
        <NumInput label="Conference Papers" value={value.conferencePapersCount} onChange={(v) => set("conferencePapersCount", v)} />
        <NumInput label="Book Chapters" value={value.bookChaptersCount} onChange={(v) => set("bookChaptersCount", v)} />
        <NumInput label="Review Publications" value={value.reviewPublicationsCount} onChange={(v) => set("reviewPublicationsCount", v)} />
        <NumInput label="Total Publications" value={value.totalPublications} onChange={(v) => set("totalPublications", v)} />
        <NumInput label="Total Citations" value={value.totalCitations} onChange={(v) => set("totalCitations", v)} />
        <NumInput label="H-Index" value={value.hIndex} onChange={(v) => set("hIndex", v)} />
        <NumInput label="i10-Index" value={value.i10Index} onChange={(v) => set("i10Index", v)} />
      </div>

      {/* Module 4 */}
      <SectionTitle>Module 4 — Grants, Consultancy &amp; IP</SectionTitle>
      <RepeatingGroup
        title="Funded Projects"
        items={value.fundedProjects}
        empty={EMPTY_FUNDED_PROJECT}
        onChange={(v) => set("fundedProjects", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="Title" value={item.title} onChange={(v) => update({ title: v })} />
            <TextInput label="Funding Agency" value={item.fundingAgency} onChange={(v) => update({ fundingAgency: v })} />
            <NumInput label="Grant Amount (₹L)" value={item.grantAmountLakhs} onChange={(v) => update({ grantAmountLakhs: v })} />
            <NumInput label="Year" value={item.year} onChange={(v) => update({ year: v })} />
            <TextInput label="Status" value={item.status} onChange={(v) => update({ status: v })} />
          </>
        )}
      />
      <RepeatingGroup
        title="Industry Consultancy"
        items={value.consultancyProjects}
        empty={EMPTY_CONSULTANCY}
        onChange={(v) => set("consultancyProjects", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="Title" value={item.title} onChange={(v) => update({ title: v })} />
            <TextInput label="Client / Agency" value={item.clientOrAgency} onChange={(v) => update({ clientOrAgency: v })} />
            <NumInput label="Revenue (₹L)" value={item.revenueLakhs} onChange={(v) => update({ revenueLakhs: v })} />
            <NumInput label="Year" value={item.year} onChange={(v) => update({ year: v })} />
            <TextInput label="Status" value={item.status} onChange={(v) => update({ status: v })} />
          </>
        )}
      />
      <div className="space-y-3 rounded-lg border p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Patents</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumInput label="Indian — Filed" value={patents?.indianFiled} onChange={(v) => set("patents", { ...patents, indianFiled: v } as FacultyProfileFields["patents"])} />
          <NumInput label="Indian — Published" value={patents?.indianPublished} onChange={(v) => set("patents", { ...patents, indianPublished: v } as FacultyProfileFields["patents"])} />
          <NumInput label="Indian — Granted" value={patents?.indianGranted} onChange={(v) => set("patents", { ...patents, indianGranted: v } as FacultyProfileFields["patents"])} />
          <NumInput label="International — Filed" value={patents?.internationalFiled} onChange={(v) => set("patents", { ...patents, internationalFiled: v } as FacultyProfileFields["patents"])} />
          <NumInput label="International — Published" value={patents?.internationalPublished} onChange={(v) => set("patents", { ...patents, internationalPublished: v } as FacultyProfileFields["patents"])} />
          <NumInput label="International — Granted" value={patents?.internationalGranted} onChange={(v) => set("patents", { ...patents, internationalGranted: v } as FacultyProfileFields["patents"])} />
        </div>
        <div className="space-y-2">
          <Label>Details</Label>
          <Textarea value={patents?.details ?? ""} onChange={(e) => set("patents", { ...patents, details: e.target.value } as FacultyProfileFields["patents"])} />
        </div>
      </div>

      {/* Module 5 */}
      <SectionTitle>Module 5 — Mentorship &amp; Institutional Value</SectionTitle>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ph.D. Scholars Pursuing</p>
          <NumInput label="Count" value={phdPursuing?.count} onChange={(v) => set("phdScholarsPursuing", { count: v, universities: phdPursuing?.universities ?? "" })} />
          <TextInput label="University Names" value={phdPursuing?.universities} onChange={(v) => set("phdScholarsPursuing", { count: phdPursuing?.count ?? 0, universities: v })} />
        </div>
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ph.D. Scholars Awarded</p>
          <NumInput label="Count" value={phdAwarded?.count} onChange={(v) => set("phdScholarsAwarded", { count: v, universities: phdAwarded?.universities ?? "" })} />
          <TextInput label="University Names" value={phdAwarded?.universities} onChange={(v) => set("phdScholarsAwarded", { count: phdAwarded?.count ?? 0, universities: v })} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>National Exposure (joint pubs w/ IITs/NITs/IIITs/CSIR)</Label>
        <Textarea value={value.nationalExposure ?? ""} onChange={(e) => set("nationalExposure", e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>International Exposure (joint pubs w/ foreign universities)</Label>
        <Textarea value={value.internationalExposure ?? ""} onChange={(e) => set("internationalExposure", e.target.value)} />
      </div>
      <RepeatingGroup
        title="New Labs Established"
        items={value.labsEstablished}
        empty={EMPTY_LAB}
        onChange={(v) => set("labsEstablished", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="Facility Details" value={item.facilityDetails} onChange={(v) => update({ facilityDetails: v })} />
            <TextInput label="Outcomes" value={item.outcomes} onChange={(v) => update({ outcomes: v })} />
          </>
        )}
      />
      <div className="space-y-2">
        <Label>Administrative Responsibilities Held (+ notable achievements)</Label>
        <Textarea value={value.administrativeResponsibilities ?? ""} onChange={(e) => set("administrativeResponsibilities", e.target.value)} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Certifications / FDPs (NPTEL/Coursera/AICTE)</Label>
          <Textarea value={value.certificationsAndFdps ?? ""} onChange={(e) => set("certificationsAndFdps", e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Professional Body Memberships (IEEE/ACM/CSI)</Label>
          <Textarea value={value.professionalBodyMemberships ?? ""} onChange={(e) => set("professionalBodyMemberships", e.target.value)} />
        </div>
      </div>
      <RepeatingGroup
        title="Authored Books"
        items={value.authoredBooks}
        empty={EMPTY_BOOK}
        onChange={(v) => set("authoredBooks", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="Title" value={item.title} onChange={(v) => update({ title: v })} />
            <TextInput label="Publisher" value={item.publisher} onChange={(v) => update({ publisher: v })} />
            <NumInput label="Year" value={item.year} onChange={(v) => update({ year: v })} />
          </>
        )}
      />
      <div className="space-y-2">
        <Label>Notable Awards</Label>
        <Textarea value={value.notableAwards ?? ""} onChange={(e) => set("notableAwards", e.target.value)} />
      </div>

      {/* Module 6 */}
      <SectionTitle>Module 6 — Financial Standing &amp; Budgetary Impact</SectionTitle>
      <div className="space-y-3 rounded-lg border p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current Financial Standing</p>
        <NumInput label="Present Salary (₹)" value={value.presentSalary} onChange={(v) => set("presentSalary", v)} />
      </div>
      <div className="space-y-3 rounded-lg border p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Budgetary Impact</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumInput label="Gross Annual CTC (₹)" value={value.grossAnnualCTC} onChange={(v) => set("grossAnnualCTC", v)} />
          <NumInput label="Increments Awarded" value={value.incrementsAwarded} onChange={(v) => set("incrementsAwarded", v)} />
          <NumInput label="Funding/Consultancy Revenue Generation (₹)" value={value.fundingConsultancyRevenue} onChange={(v) => set("fundingConsultancyRevenue", v)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Revenue brought in through research/consultancy grants, offsetting this faculty member&rsquo;s salary cost to the institution.
        </p>
      </div>

      {/* Module 7 */}
      <SectionTitle>Module 7 — Others</SectionTitle>
      <div className="space-y-2">
        <Label>Other Information</Label>
        <Textarea
          value={value.otherInformation ?? ""}
          onChange={(e) => set("otherInformation", e.target.value)}
          placeholder="Anything not covered above — add it here"
          rows={4}
        />
      </div>
    </div>
  );
}
