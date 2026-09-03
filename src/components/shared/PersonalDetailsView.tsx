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
  sscHallTicketNo?: string;
  differentlyAbled?: boolean;
  differentlyAbledDetails?: string;
  bankAccountNo?: string;
  ifscCode?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  ratificationStatus?: string;
  ratificationDate?: Timestamp | Date | { _seconds: number; _nanoseconds?: number } | { seconds: number; nanoseconds?: number };
  maritalStatus?: string;
  spouseName?: string;
  numberOfChildren?: number;
  referral?: string;
  nativePlace?: string;
  temporaryAddress?: string;
  permanentSameAsTemporary?: boolean;
  permanentAddress?: string;
  bloodGroup?: string;
}

interface Props {
  value: PersonalDetailsSource | undefined;
}

function Field({ label, value }: { label: string; value: string | undefined | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value || "-"}</p>
    </div>
  );
}

export function PersonalDetailsView({ value }: Props) {
  const p = value ?? {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Gender" value={p.gender} />
        <Field label="Date of Birth" value={p.dateOfBirth ? formatDate(p.dateOfBirth) : undefined} />
        <Field label="Legal Name (as per SSC)" value={p.legalName} />
        <Field label="SSC Hall Ticket No" value={p.sscHallTicketNo} />
        <Field label="Father / Husband Name" value={p.fatherName} />
        <Field label="Mother Name" value={p.motherName} />
        <Field label="Religion" value={p.religion ? (RELIGION_LABELS[p.religion as Religion] ?? p.religion) : undefined} />
        <Field label="Caste" value={p.caste ? (CASTE_LABELS[p.caste as Caste] ?? p.caste) : undefined} />
        <Field label="Sub Caste" value={p.subCaste} />
        <Field label="Name (as per Aadhar)" value={p.nameAsPerAadhar} />
        <Field label="Aadhar No" value={p.aadharNo} />
        <Field label="PAN No" value={p.panNo} />
        <Field label="Passport No" value={p.passportNumber} />
        <Field label="Referral" value={p.referral} />
        <Field label="Differently Abled" value={p.differentlyAbled === undefined ? undefined : p.differentlyAbled ? `Yes${p.differentlyAbledDetails ? ` (${p.differentlyAbledDetails})` : ""}` : "No"} />
      </div>

      <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Bank Account Details</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="A/C Number" value={p.bankAccountNo} />
          <Field label="IFSC Code" value={p.ifscCode} />
        </div>
      </div>

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
            value={p.permanentSameAsTemporary ? "Same as temporary" : p.permanentAddress}
          />
        </div>
      </div>

      <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Emergency Contact</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Name" value={p.emergencyContactName} />
          <Field label="Phone" value={p.emergencyContactPhone} />
        </div>
      </div>

      <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Ratification</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Ratification Status" value={p.ratificationStatus} />
          <Field label="Ratification Date" value={p.ratificationDate ? formatDate(p.ratificationDate) : undefined} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Native Place" value={p.nativePlace} />
      </div>
    </div>
  );
}
