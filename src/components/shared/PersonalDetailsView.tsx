import { formatDate } from "@/lib/utils";
import { RELIGION_LABELS, CASTE_LABELS } from "@/types";
import type { Religion, Caste, RatificationRecord } from "@/types";
import type { Timestamp } from "firebase/firestore";
import { migratePersonalFlat } from "@/lib/faculty/fieldRenames";
import { ratificationRecordsFromDoc } from "@/lib/faculty/ratificationHistory";
import { designationLabel } from "@/lib/designations/config";
import { OptionalField as Field, hasAnyValue } from "@/components/shared/ProfileFieldPrimitives";

// "5.7" -> "5 ft 7 in". Height is stored feet.inches (see types/core.ts), not
// decimal feet, so this is a string split, never a numeric conversion.
function formatHeight(height: string): string {
  const [feet, inches] = height.split(".");
  return inches !== undefined ? `${feet} ft ${inches} in` : `${feet} ft`;
}

// Ratification records store a plain "YYYY-MM-DD" string (see
// RatificationRecord in types/core.ts), not a Firestore Timestamp - formatted
// the same "DD Mon YYYY" style as formatDate() for consistency with every
// other date on this page. Parsed as UTC midnight so the displayed day never
// shifts from what was entered.
function formatRatificationDate(date: string | undefined): string {
  if (!date) return "-";
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export interface PersonalDetailsSource {
  gender?: string;
  dateOfBirth?: Timestamp | Date | { _seconds: number; _nanoseconds?: number } | { seconds: number; nanoseconds?: number };
  legalName?: string;
  nameAsPerAadhar?: string;
  nameAsPerPan?: string;
  fatherName?: string;
  motherName?: string;
  religion?: Religion | string; // string fallback - legacy free-text values pre-dating the dropdown
  caste?: Caste | string;
  subCaste?: string;
  aadharNo?: string;
  panNo?: string;
  passportNo?: string;
  differentlyAbled?: boolean;
  differentlyAbledDetails?: string;
  bankAccountNumber?: string;
  ifscCode?: string;
  bankName?: string;
  bankBranch?: string;
  bankOtherDetails?: string;
  emergencyContactName?: string;
  emergencyContactRelation?: string;
  emergencyContactMobileNo?: string;
  ratificationStatus?: string;
  ratificationProceedingsNumber?: string;
  ratificationDate?: Timestamp | Date | { _seconds: number; _nanoseconds?: number } | { seconds: number; nanoseconds?: number };
  // Faculty-only multi-entry shape (see lib/faculty/ratificationHistory.ts) -
  // only read when the `ratificationHistory` prop is true.
  ratifications?: RatificationRecord[];
  maritalStatus?: string;
  spouseName?: string;
  numberOfChildren?: number;
  temporaryAddress?: string;
  permanentAddressSameAsTemporary?: boolean;
  permanentAddress?: string;
  bloodGroup?: string;
  motherTongue?: string;
  languagesKnown?: string[];
  height?: string; // "<feet>.<inches>" e.g. "5.7" = 5 ft 7 in
  weightKg?: number;
  pfNumber?: string;
  uanNumber?: string;
  esiNumber?: string;
}

interface Props {
  value: PersonalDetailsSource | undefined;
  // Faculty's Add/Edit surfaces move Full Name (as per SSC) up into their
  // "core" identity step, shown on FacultyProfileHub's own top summary
  // instead - so FacultyProfileModuleContent passes this to avoid showing it
  // a second time here. Supporting/Non-Technical Staff don't pass this, so
  // legalName stays exactly where it always was (matches PersonalDetailsFields'
  // own hiddenFields doc-comment).
  hideLegalName?: boolean;
  // Fields to skip - mirrors PersonalDetailsFields' hiddenFields, so a surface
  // whose edit form hides a field (Faculty hides ESI Number) doesn't show it
  // here either.
  hiddenFields?: (keyof PersonalDetailsSource)[];
  // Faculty only - see PersonalDetailsFields' showNameAsPerPan.
  showNameAsPerPan?: boolean;
  // Faculty only (a genuine facultyMembers record) - see PersonalDetailsFields'
  // own doc-comment on this same prop. Shows the multi-entry Ratification
  // Records list instead of the single Proceedings Number/Date pair.
  ratificationHistory?: boolean;
}

export function PersonalDetailsView({ value, hideLegalName = false, hiddenFields = [], showNameAsPerPan = false, ratificationHistory = false }: Props) {
  // Lift a record still carrying the legacy key names (passportNumber, bankAccountNo, ...).
  const p = (value ? migratePersonalFlat(value as Record<string, unknown>) : {}) as PersonalDetailsSource;
  // Auto-migrates a doc still on the old flat ratificationProceedingsNumber/
  // ratificationDate pair into a single entry (Designation blank) - see
  // ratificationRecordsFromDoc's own doc-comment.
  const ratificationRecords = ratificationHistory ? ratificationRecordsFromDoc(p as Record<string, unknown>) : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Name (as per Aadhar)" value={p.nameAsPerAadhar} />
        {showNameAsPerPan && <Field label="Name (as per PAN)" value={p.nameAsPerPan} />}
        <Field label="Date of Birth" value={p.dateOfBirth ? formatDate(p.dateOfBirth) : undefined} />
        <Field label="Gender" value={p.gender} />
        {!hideLegalName && <Field label="Full Name (as per SSC)" value={p.legalName} />}
        <Field label="Father Name" value={p.fatherName} />
        <Field label="Mother Name" value={p.motherName} />
        <Field label="Religion" value={p.religion ? (RELIGION_LABELS[p.religion as Religion] ?? p.religion) : undefined} />
        {/* A record saved before the bare "BC" option was split into
            BC-A..BC-E (see types/core.ts) still has that removed value on
            file - shown as blank rather than a stale "BC" until it's re-saved
            with a real category. */}
        <Field label="Caste" value={p.caste && p.caste !== "BC" ? (CASTE_LABELS[p.caste as Caste] ?? p.caste) : undefined} />
        <Field label="Sub Caste" value={p.subCaste} />
        <Field label="Aadhar No" value={p.aadharNo} />
        <Field label="PAN No" value={p.panNo} />
        <Field label="Passport No" value={p.passportNo} />
        <Field label="Differently Abled" value={p.differentlyAbled === undefined ? undefined : p.differentlyAbled ? "Yes" : "No"} />
        {p.differentlyAbled && <Field label="Differently Abled Details" value={p.differentlyAbledDetails} />}
      </div>

      {hasAnyValue(p.motherTongue, p.languagesKnown?.length ? "x" : undefined, p.height, p.weightKg) && (
        <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Personal Attributes</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Mother Tongue" value={p.motherTongue} />
            <Field label="Languages Known" value={p.languagesKnown && p.languagesKnown.length > 0 ? p.languagesKnown.join(", ") : undefined} />
            <Field label="Height" value={p.height ? formatHeight(p.height) : undefined} />
            <Field label="Weight" value={p.weightKg !== undefined ? `${p.weightKg} kg` : undefined} />
          </div>
        </div>
      )}

      {hasAnyValue(
        p.maritalStatus, p.bloodGroup, p.spouseName, p.numberOfChildren,
        p.temporaryAddress, p.permanentAddress, p.permanentAddressSameAsTemporary
      ) && (
        <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Family &amp; Other Details</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Marital Status" value={p.maritalStatus} />
            <Field label="Blood Group" value={p.bloodGroup} />
            {p.maritalStatus === "Married" && (
              <>
                <Field label="Spouse Name" value={p.spouseName} />
                <Field label="Number of Children" value={p.numberOfChildren !== undefined ? String(p.numberOfChildren) : undefined} />
              </>
            )}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-3">
            <Field label="Temporary Address" value={p.temporaryAddress} />
            <Field
              label="Permanent Address"
              value={p.permanentAddressSameAsTemporary ? p.permanentAddress || p.temporaryAddress : p.permanentAddress}
            />
            {/* Only shown when the answer is actually "Yes", where it explains why
                the two addresses above read identically. A "No" is already
                evident from the two differing addresses, so the row was stating
                the obvious; unset says nothing at all. */}
            {p.permanentAddressSameAsTemporary === true && (
              <Field label="Permanent Address Same as Temporary" value="Yes" />
            )}
          </div>
        </div>
      )}

      {hasAnyValue(p.bankAccountNumber, p.ifscCode, p.bankName, p.bankBranch, p.pfNumber, p.uanNumber, p.esiNumber, p.bankOtherDetails) && (
        <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Bank Account Details</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Bank Account Number" value={p.bankAccountNumber} />
            <Field label="IFSC Code" value={p.ifscCode} />
            <Field label="Bank Name" value={p.bankName} />
            <Field label="Bank Branch" value={p.bankBranch} />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mt-3">
            <Field label="PF Number" value={p.pfNumber} />
            <Field label="UAN Number" value={p.uanNumber} />
            {!hiddenFields.includes("esiNumber") && <Field label="ESI Number" value={p.esiNumber} />}
          </div>
          {p.bankOtherDetails && (
            <div className="mt-3">
              <Field label="Bank Other Details" value={p.bankOtherDetails} />
            </div>
          )}
        </div>
      )}

      {hasAnyValue(p.emergencyContactName, p.emergencyContactRelation, p.emergencyContactMobileNo) && (
        <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Emergency Contact</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Emergency Contact Name" value={p.emergencyContactName} />
            <Field label="Emergency Contact Relation" value={p.emergencyContactRelation} />
            <Field label="Emergency Contact Mobile No" value={p.emergencyContactMobileNo} />
          </div>
        </div>
      )}

      {(ratificationHistory
        ? hasAnyValue(p.ratificationStatus, ratificationRecords.length ? "x" : undefined)
        : hasAnyValue(p.ratificationStatus, p.ratificationProceedingsNumber, p.ratificationDate)
      ) && (
        <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Ratification</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Ratification Status" value={p.ratificationStatus} />
          </div>
          {p.ratificationStatus === "Ratified" && (
            ratificationHistory ? (
              ratificationRecords.length > 0 && (
                <div className="mt-3 space-y-2">
                  {ratificationRecords.map((r: RatificationRecord, i) => (
                    <div key={i} className="grid grid-cols-2 gap-4 sm:grid-cols-4 rounded-md bg-background/60 p-2">
                      <Field label="Designation" value={r.designation ? designationLabel(r.designation) : undefined} />
                      <Field label="Ratification Proceedings Number" value={r.proceedingsNumber} />
                      <Field label="Ratification Date" value={r.date ? formatRatificationDate(r.date) : undefined} />
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mt-3">
                <Field label="Ratification Proceedings Number" value={p.ratificationProceedingsNumber} />
                <Field label="Ratification Date" value={p.ratificationDate ? formatDate(p.ratificationDate) : undefined} />
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
