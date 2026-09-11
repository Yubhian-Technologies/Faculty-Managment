import { formatDate } from "@/lib/utils";
import { RELIGION_LABELS, CASTE_LABELS } from "@/types";
import type { Religion, Caste } from "@/types";
import type { Timestamp } from "firebase/firestore";

export interface PersonalDetailsSource {
  gender?: string;
  dateOfBirth?: Timestamp | Date | { _seconds: number; _nanoseconds?: number } | { seconds: number; nanoseconds?: number };
  legalName?: string;
  nameAsPerAadhar?: string;
  fatherName?: string;
  motherName?: string;
  religion?: Religion | string; // string fallback - legacy free-text values pre-dating the dropdown
  caste?: Caste | string;
  subCaste?: string;
  aadharNo?: string;
  panNo?: string;
  passportNumber?: string;
  differentlyAbled?: boolean;
  differentlyAbledDetails?: string;
  bankAccountNo?: string;
  ifscCode?: string;
  bankName?: string;
  bankBranch?: string;
  bankOtherDetails?: string;
  emergencyContactName?: string;
  emergencyContactRelation?: string;
  emergencyContactPhone?: string;
  ratificationStatus?: string;
  ratificationProceedingsNumber?: string;
  ratificationDate?: Timestamp | Date | { _seconds: number; _nanoseconds?: number } | { seconds: number; nanoseconds?: number };
  maritalStatus?: string;
  spouseName?: string;
  numberOfChildren?: number;
  temporaryAddress?: string;
  permanentSameAsTemporary?: boolean;
  permanentAddress?: string;
  bloodGroup?: string;
  motherTongue?: string;
  languagesKnown?: string[];
  heightFeet?: number;
  heightInches?: number;
  weightKg?: number;
  pfNumber?: string;
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
}

function Field({ label, value }: { label: string; value: string | undefined | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value || "-"}</p>
    </div>
  );
}

export function PersonalDetailsView({ value, hideLegalName = false }: Props) {
  const p = value ?? {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Name (as per Aadhar)" value={p.nameAsPerAadhar} />
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
        <Field label="Passport No" value={p.passportNumber} />
        <Field label="Differently Abled" value={p.differentlyAbled === undefined ? undefined : p.differentlyAbled ? `Yes${p.differentlyAbledDetails ? ` (${p.differentlyAbledDetails})` : ""}` : "No"} />
      </div>

      <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Personal Attributes</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Mother Tongue" value={p.motherTongue} />
          <Field label="Languages Known" value={p.languagesKnown && p.languagesKnown.length > 0 ? p.languagesKnown.join(", ") : undefined} />
          <Field label="Height" value={p.heightFeet || p.heightInches ? `${p.heightFeet ?? 0} ft ${p.heightInches ?? 0} in` : undefined} />
          <Field label="Weight" value={p.weightKg !== undefined ? `${p.weightKg} kg` : undefined} />
        </div>
      </div>

      <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Family &amp; Other Details</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Marital Status" value={p.maritalStatus} />
          <Field label="Blood Group" value={p.bloodGroup} />
          {p.maritalStatus === "Married" && (
            <>
              <Field label={p.gender === "Female" ? "Husband Name" : "Spouse Name"} value={p.spouseName} />
              <Field label="Number of Children" value={p.numberOfChildren !== undefined ? String(p.numberOfChildren) : undefined} />
            </>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-3">
          <Field label="Temporary Address" value={p.temporaryAddress} />
          <Field
            label="Permanent Address"
            value={p.permanentSameAsTemporary ? "Same as temporary" : p.permanentAddress}
          />
        </div>
      </div>

      <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Bank Account Details</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="A/C Number" value={p.bankAccountNo} />
          <Field label="IFSC Code" value={p.ifscCode} />
          <Field label="Bank Name" value={p.bankName} />
          <Field label="Branch" value={p.bankBranch} />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mt-3">
          <Field label="PF Number" value={p.pfNumber} />
          <Field label="ESI Number" value={p.esiNumber} />
        </div>
        {p.bankOtherDetails && (
          <div className="mt-3">
            <Field label="Other Details" value={p.bankOtherDetails} />
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Emergency Contact</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Emergency Contact Person Name" value={p.emergencyContactName} />
          <Field label="Relation (with Emergency Contact)" value={p.emergencyContactRelation} />
          <Field label="Emergency Contact Mobile No" value={p.emergencyContactPhone} />
        </div>
      </div>

      <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Ratification</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Ratification Status" value={p.ratificationStatus} />
          <Field label="Proceedings Number" value={p.ratificationProceedingsNumber} />
          <Field label="Ratification Proceedings Date" value={p.ratificationDate ? formatDate(p.ratificationDate) : undefined} />
        </div>
      </div>
    </div>
  );
}
