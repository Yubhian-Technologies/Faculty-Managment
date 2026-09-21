"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CertificateUploadField } from "@/components/shared/CertificateUploadField";
import { DesignationSelect } from "@/components/faculty/DesignationOptions";
import { TrainingEntryFields } from "@/components/faculty/TrainingEntryFields";
import {
  SectionTitle, NumInput, TextInput, DateInput, DegreeFields, DegreeFieldsList, RepeatingGroup, QualificationsFields, StringListInput,
} from "@/components/shared/ProfileFieldPrimitives";
import { SCHOOL_TEACHING_QUALIFICATION_LEVELS } from "@/lib/designations/config";
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { durationBetween, formatDuration } from "@/lib/faculty/experienceCalc";
import type {
  FacultyProfileFields,
  CollegeType,
  LabEstablished,
  PreviousInstitution,
  PromotionRecord,
  TrainingEntry,
  ProfessionalMembership,
  ProfessionalBody,
  MembershipValidity,
  AdminResponsibilityEntry,
  AdminResponsibilityCategory,
  AwardEntry,
  AwardCategory,
  AwardLevel,
} from "@/types";
import {
  PROFESSIONAL_BODY_LABELS, MEMBERSHIP_VALIDITY_LABELS,
  ADMIN_RESPONSIBILITY_CATEGORY_LABELS, AWARD_CATEGORY_LABELS, QUALIFYING_EXAM_LABELS,
  AWARD_LEVEL_LABELS,
} from "@/types";

interface Props {
  value: Partial<FacultyProfileFields>;
  onChange: (next: Partial<FacultyProfileFields>) => void;
  includeTeachingAssignment?: boolean;
  hideFinancialModule?: boolean;
  hideResearchModule?: boolean;
  hidePromotionHistory?: boolean;
  collegeType?: CollegeType;
}

const EMPTY_LAB: LabEstablished = { facilityDetails: "", outcomes: "" };
const EMPTY_PREVIOUS_INSTITUTION: PreviousInstitution = { institutionName: "", designation: "" };
const EMPTY_PROMOTION: PromotionRecord = { designation: "" };
const EMPTY_TRAINING: TrainingEntry = { type: "FDP", titleOfTheProgram: "", nameOfTheFacultyCoordinator: "" };
const EMPTY_MEMBERSHIP: ProfessionalMembership = { body: "IEEE" };
const EMPTY_ADMIN_RESPONSIBILITY: AdminResponsibilityEntry = { category: "COMMITTEE_MEMBER", description: "" };
const EMPTY_AWARD: AwardEntry = { category: "BEST_TEACHER", titleOfAward: "", awardingAgencyBody: "" };

export function AcademicProfileFields({ value: rawValue, onChange, includeTeachingAssignment = true, hideFinancialModule = false, hideResearchModule = false, hidePromotionHistory = false, collegeType }: Props) {
  // Un-migrated Firestore docs still carry legacy key names - lift them so the
  // form shows that data and onChange emits the new shape.
  const value = normalizeAcademicProfile(rawValue);
  function set<K extends keyof FacultyProfileFields>(key: K, v: FacultyProfileFields[K]) {
    onChange({ ...value, [key]: v });
  }

  const isSchool = collegeType === "SCHOOL";

  return (
    <div className="space-y-5">
      {/* Module 1 */}
      <SectionTitle>Module 1 - General &amp; Academic Profile</SectionTitle>
      {isSchool ? (
        <>
          <TextInput label="Highest Qualification" value={value.highestQualification} onChange={(v) => set("highestQualification", v)} placeholder="e.g. B.Ed, M.A." />
          <StringListInput label="Research Areas/Interests *" values={value.researchAreasInterests} onChange={(v) => set("researchAreasInterests", v)} placeholder="e.g. Machine Learning - press Enter or Add" />
          <QualificationsFields
            items={value.educationalQualifications}
            levelOptions={SCHOOL_TEACHING_QUALIFICATION_LEVELS}
            onChange={(v) => set("educationalQualifications", v)}
          />
        </>
      ) : (
        <>
          <TextInput label="Highest Qualification" value={value.highestQualification} onChange={(v) => set("highestQualification", v)} placeholder="e.g. Ph.D" />
          <StringListInput label="Research Areas/Interests *" values={value.researchAreasInterests} onChange={(v) => set("researchAreasInterests", v)} placeholder="e.g. Machine Learning - press Enter or Add" />
          <div className="space-y-3 rounded-lg border p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>NET/SLET/SET/GATE/Others</Label>
                <Select value={value.netSletSetGateOthers ?? ""} onValueChange={(v) => set("netSletSetGateOthers", v as FacultyProfileFields["netSletSetGateOthers"])}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="YES">Yes</SelectItem>
                    <SelectItem value="NO">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {value.netSletSetGateOthers === "YES" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Qualified Exam</Label>
                  <Select value={value.qualifiedExam ?? ""} onValueChange={(v) => set("qualifiedExam", v as FacultyProfileFields["qualifiedExam"])}>
                    <SelectTrigger><SelectValue placeholder="Select exam" /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(QUALIFYING_EXAM_LABELS).map(([k, lbl]) => <SelectItem key={k} value={k}>{lbl}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {value.qualifiedExam === "OTHER" && (
                  <TextInput label="Please specify exam" value={value.pleaseSpecifyExam} onChange={(v) => set("pleaseSpecifyExam", v)} />
                )}
                <TextInput label="Exam Score" value={value.examScore} onChange={(v) => set("examScore", v)} />
                <NumInput label="Qualified Year" value={value.qualifiedYear} onChange={(v) => set("qualifiedYear", v)} />
              </div>
            )}
          </div>
          <DegreeFields label="Secondary Education" level="HIGH_SCHOOL" value={value.secondaryEducation} onChange={(v) => set("secondaryEducation", v)} />
          <DegreeFields label="Intermediate / Diploma / ITI" level="INTERMEDIATE" value={value.intermediateDiplomaIti} onChange={(v) => set("intermediateDiplomaIti", v)} />
          <DegreeFields label="UG Details" level="UG" value={value.ugDetails} onChange={(v) => set("ugDetails", v)} />
          <DegreeFieldsList label="UG Details" level="UG" items={value.additionalUgDetails} onChange={(v) => set("additionalUgDetails", v)} />
          <DegreeFields label="PG Details" level="PG" value={value.pgDetails} onChange={(v) => set("pgDetails", v)} />
          <DegreeFieldsList label="PG Details" level="PG" items={value.additionalPgDetails} onChange={(v) => set("additionalPgDetails", v)} />
          <DegreeFields label="Ph.D. Details" level="DOCTORAL" value={value.phdDetails} onChange={(v) => set("phdDetails", v)} />
          <DegreeFieldsList label="Ph.D. Details" level="DOCTORAL" items={value.additionalPhdDetails} onChange={(v) => set("additionalPhdDetails", v)} />
          <DegreeFields label="Postdoctoral Fellowship Details" level="POST_DOCTORAL" value={value.postdoctoralFellowshipDetails} onChange={(v) => set("postdoctoralFellowshipDetails", v)} />
        </>
      )}

      <SectionTitle>Module 2 - Previous Experience</SectionTitle>
      <RepeatingGroup
        title="Previous Experience"
        items={value.academicExperience}
        empty={EMPTY_PREVIOUS_INSTITUTION}
        onChange={(v) => set("academicExperience", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="Institution Name" value={item.institutionName} onChange={(v) => update({ institutionName: v })} />
            <TextInput label="Designation" value={item.designation} onChange={(v) => update({ designation: v })} />
            {(() => {
              const fromDate = item.fromDate ?? (item.fromYear ? `${item.fromYear}-01-01` : undefined);
              return (
                <>
                  <DateInput label="From Date" value={fromDate} onChange={(v) => update({ fromDate: v })} />
                  <DateInput
                    label="To Date"
                    value={item.toDate ?? (item.toYear ? `${item.toYear}-01-01` : undefined)}
                    // min steers the native picker; the clamp below is the
                    // actual guarantee since a typed/pasted value can still
                    // bypass min - never let To Date land before From Date.
                    onChange={(v) => update({ toDate: fromDate && v && v < fromDate ? fromDate : v })}
                    min={fromDate}
                  />
                </>
              );
            })()}
            <NumInput label="Joining Salary" value={item.joiningSalary} onChange={(v) => update({ joiningSalary: v })} />
            <NumInput label="Leaving Salary" value={item.leavingSalary} onChange={(v) => update({ leavingSalary: v })} />
            <div className="sm:col-span-2 space-y-2">
              <Label>Academic Roles/Responsibilities</Label>
              <Textarea value={item.rolesResponsibilities ?? ""} onChange={(e) => update({ rolesResponsibilities: e.target.value })} />
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Reason for Leaving</Label>
              <Textarea value={item.reasonForLeaving ?? ""} onChange={(e) => update({ reasonForLeaving: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>NOC Obtained</Label>
              <Select value={item.nocObtained ?? ""} onValueChange={(v) => update({ nocObtained: v as PreviousInstitution["nocObtained"] })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="YES">Yes</SelectItem>
                  <SelectItem value="NO">No</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <CertificateUploadField
                label="Experience Certificate"
                value={item.experienceCertificateUrl}
                onUploaded={(url) => update({ experienceCertificateUrl: url })}
                onRemoved={() => update({ experienceCertificateUrl: "" })}
              />
            </div>
          </>
        )}
      />
      {!hidePromotionHistory && (
        <RepeatingGroup
          title="Promotion History"
          items={value.promotionHistory}
          empty={EMPTY_PROMOTION}
          onChange={(v) => set("promotionHistory", v)}
          renderRow={(item, update) => {
            const today = new Date().toISOString().slice(0, 10);
            const duration = durationBetween(item.fromDate, item.toDate || today);
            return (
              <>
                {/* Same catalogue-backed picker as the College Office promotion
                    page - this form writes the identical promotionHistory field,
                    so leaving it free-text here would let the two disagree. */}
                <DesignationSelect label="Designation" value={item.designation} onChange={(v) => update({ designation: v })} />
                <DateInput label="From Date" value={item.fromDate} onChange={(v) => update({ fromDate: v })} />
                <DateInput
                  label="To Date"
                  hint="Leave blank if currently serving"
                  value={item.toDate}
                  onChange={(v) => update({ toDate: v })}
                  min={item.fromDate}
                />
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Experience in this Designation</Label>
                  <p className="text-sm font-medium pt-2">{item.fromDate ? formatDuration(duration) : "-"}</p>
                </div>
                {item.fromDate && !item.toDate && (
                  <p className="sm:col-span-2 text-xs text-muted-foreground">
                    No To Date yet - experience is calculated up to today and will keep increasing until one is set.
                  </p>
                )}
                <div className="sm:col-span-2">
                  <CertificateUploadField
                    label="Promotion Order"
                    value={item.promotionOrderUrl}
                    onUploaded={(url) => update({ promotionOrderUrl: url })}
                    onRemoved={() => update({ promotionOrderUrl: "" })}
                  />
                </div>
              </>
            );
          }}
        />
      )}

      {includeTeachingAssignment && (
        <p className="text-xs text-muted-foreground">
          Subject-level teaching assignments (course, section, subject, weekly schedule) are managed below in &ldquo;Current Teaching Assignments&rdquo;.
        </p>
      )}

      {/* Module 3 */}
      {!hideResearchModule && (
        <>
          <SectionTitle>Module 3 - Research &amp; Innovation</SectionTitle>
          <p className="text-xs text-muted-foreground">
            Individual publication records are maintained by the R&amp;D office - view them on the Research &amp; Innovation module.
            The fields below are self-reported summary metrics.
          </p>
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
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Research Profiles</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextInput label="ORCID iD" value={value.orcidId} onChange={(v) => set("orcidId", v)} />
            <TextInput label="Scopus Author ID" value={value.scopusAuthorId} onChange={(v) => set("scopusAuthorId", v)} />
            <TextInput label="Researcher ID" value={value.researcherId} onChange={(v) => set("researcherId", v)} />
            <TextInput label="Google Scholar ID" value={value.googleScholarId} onChange={(v) => set("googleScholarId", v)} />
            <TextInput label="IRINS Profile" value={value.irinsProfile} onChange={(v) => set("irinsProfile", v)} />
          </div>
        </>
      )}

      {/* Module 5 */}
      <SectionTitle>Module 5 - Professional Development</SectionTitle>
      <RepeatingGroup
        title="New Labs Established"
        items={value.newLabsEstablished}
        empty={EMPTY_LAB}
        onChange={(v) => set("newLabsEstablished", v)}
        renderRow={(item, update) => (
          <>
            <TextInput label="Facility Details" value={item.facilityDetails} onChange={(v) => update({ facilityDetails: v })} />
            <TextInput label="Outcomes" value={item.outcomes} onChange={(v) => update({ outcomes: v })} />
          </>
        )}
      />
      <RepeatingGroup
        title="Academic Responsibilities"
        items={value.academicResponsibilities}
        empty={EMPTY_ADMIN_RESPONSIBILITY}
        onChange={(v) => set("academicResponsibilities", v)}
        renderRow={(item, update) => {
          // Falls back to Jan 1 of the legacy year-only value so an older record
          // still shows something to correct (same seeding as MentorshipFields).
          const fromDate = item.fromDate ?? (item.fromYear ? `${item.fromYear}-01-01` : undefined);
          const toDate = item.toDate ?? (item.toYear ? `${item.toYear}-01-01` : undefined);
          return (
          <>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={item.category} onValueChange={(v) => update({ category: v as AdminResponsibilityCategory })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ADMIN_RESPONSIBILITY_CATEGORY_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {item.category === "OTHER" && (
              <TextInput label="Other Category" value={item.otherCategory} onChange={(v) => update({ otherCategory: v })} />
            )}
            <TextInput label="Description" value={item.description} onChange={(v) => update({ description: v })} />
            <DateInput label="From Date" value={fromDate} onChange={(v) => update({ fromDate: v })} />
            <DateInput
              label="To Date"
              hint="Leave blank if ongoing"
              value={toDate}
              onChange={(v) => update({ toDate: fromDate && v && v < fromDate ? fromDate : v })}
              min={fromDate}
            />
          </>
          );
        }}
      />
      <RepeatingGroup
        title="FDPs, Workshops, MOOCs & Certifications"
        items={value.fdpsWorkshopsMoocsCertifications}
        empty={() => ({ ...EMPTY_TRAINING, id: crypto.randomUUID() })}
        onChange={(v) => set("fdpsWorkshopsMoocsCertifications", v)}
        renderRow={(item, update) => (
          // No facultyId/owner name yet - this record doesn't exist until the
          // wizard is submitted, so co-conductor sync can't apply here (see
          // syncTrainingEntryCoConductors); it starts working once this entry
          // is next edited via the Mentorship module edit page.
          <TrainingEntryFields item={item} update={update} />
        )}
      />
      <RepeatingGroup
        title="Professional Memberships"
        items={value.professionalMemberships}
        empty={EMPTY_MEMBERSHIP}
        onChange={(v) => set("professionalMemberships", v)}
        renderRow={(item, update) => (
          <>
            <div className="space-y-2">
              <Label>Body</Label>
              <Select value={item.body} onValueChange={(v) => update({ body: v as ProfessionalBody })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PROFESSIONAL_BODY_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {item.body === "OTHER" && (
              <TextInput label="Body Name" value={item.bodyName} onChange={(v) => update({ bodyName: v })} />
            )}
            <TextInput
              label="Membership Type"
              value={item.membershipType}
              onChange={(v) => update({ membershipType: v })}
              placeholder="e.g. Senior Fellowship / Associate Fellowship / Fellowship"
            />
            <TextInput label="Membership ID" value={item.membershipId} onChange={(v) => update({ membershipId: v })} />
            <div className="space-y-2">
              <Label>Membership Validity</Label>
              <Select value={item.membershipValidity ?? ""} onValueChange={(v) => update({ membershipValidity: v as MembershipValidity })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(MEMBERSHIP_VALIDITY_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {item.membershipValidity === "LIFETIME" && (
              <DateInput label="Member Since" value={item.memberSince} onChange={(v) => update({ memberSince: v })} />
            )}
            {item.membershipValidity === "ANNUAL" && (
              <>
                <DateInput label="Valid From" value={item.validFrom} onChange={(v) => update({ validFrom: v })} />
                <DateInput label="Valid To" value={item.validTo} onChange={(v) => update({ validTo: v })} min={item.validFrom} />
              </>
            )}
          </>
        )}
      />
      <RepeatingGroup
        title="Awards & Recognition"
        items={value.awardsRecognition}
        empty={EMPTY_AWARD}
        onChange={(v) => set("awardsRecognition", v)}
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
            {item.category === "OTHER" && (
              <TextInput label="Other Category" value={item.otherCategory} onChange={(v) => update({ otherCategory: v })} />
            )}
            <TextInput label="Title of Award" value={item.titleOfAward} onChange={(v) => update({ titleOfAward: v })} />
            <TextInput label="Awarding Agency/Body" value={item.awardingAgencyBody} onChange={(v) => update({ awardingAgencyBody: v })} />
            <DateInput
              label="Date of Award"
              value={item.dateOfAward}
              onChange={(v) => update({ dateOfAward: v })}
            />
            <div className="space-y-2">
              <Label>State / National / International</Label>
              <Select value={item.stateNationalInternational ?? ""} onValueChange={(v) => update({ stateNationalInternational: v as AwardLevel })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(AWARD_LEVEL_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 space-y-2">
              <Label>Other Details</Label>
              <Textarea value={item.otherDetails ?? ""} onChange={(e) => update({ otherDetails: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <CertificateUploadField
                label="Certificate"
                value={item.certificateUrl}
                onUploaded={(url) => update({ certificateUrl: url })}
                onRemoved={() => update({ certificateUrl: "" })}
              />
            </div>
          </>
        )}
      />
      {/* Module 6 */}
      {!hideFinancialModule && (
        <>
          <SectionTitle>Module 6 - Financial Standing &amp; Budgetary Impact</SectionTitle>
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current Financial Standing</p>
            <NumInput label="Monthly Salary (₹)" value={value.monthlySalary} onChange={(v) => set("monthlySalary", v)} />
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Budgetary Impact</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <NumInput label="Gross Annual CTC (₹)" value={value.grossAnnualCTC} onChange={(v) => set("grossAnnualCTC", v)} />
              <NumInput label="Increments Awarded" value={value.incrementsAwarded} onChange={(v) => set("incrementsAwarded", v)} />
              <NumInput label="Funding/Consultancy Revenue Generation (₹)" value={value.fundingConsultancyRevenueGeneration} onChange={(v) => set("fundingConsultancyRevenueGeneration", v)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Revenue brought in through research/consultancy grants, offsetting this faculty member&rsquo;s salary cost to the institution.
            </p>
          </div>
        </>
      )}

      {/* Module 7 */}
      <SectionTitle>Module 7 - Others</SectionTitle>
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
