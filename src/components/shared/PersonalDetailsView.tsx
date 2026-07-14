import { formatDate } from "@/lib/utils";
import type { Timestamp } from "firebase/firestore";

export interface PersonalDetailsSource {
  gender?: string;
  dateOfBirth?: Timestamp | Date | { _seconds: number; _nanoseconds?: number } | { seconds: number; nanoseconds?: number };
  legalName?: string;
  fatherName?: string;
  motherName?: string;
  religion?: string;
  caste?: string;
  aadharNo?: string;
  panNo?: string;
  ratificationStatus?: string;
  ratificationDate?: Timestamp | Date | { _seconds: number; _nanoseconds?: number } | { seconds: number; nanoseconds?: number };
}

interface Props {
  value: PersonalDetailsSource | undefined;
}

function Field({ label, value }: { label: string; value: string | undefined | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value || "—"}</p>
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
        <Field label="Father / Husband Name" value={p.fatherName} />
        <Field label="Mother Name" value={p.motherName} />
        <Field label="Religion" value={p.religion} />
        <Field label="Caste" value={p.caste} />
        <Field label="Aadhar No" value={p.aadharNo} />
        <Field label="PAN No" value={p.panNo} />
      </div>

      <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Ratification</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Ratification Status" value={p.ratificationStatus} />
          <Field label="Ratification Date" value={p.ratificationDate ? formatDate(p.ratificationDate) : undefined} />
        </div>
      </div>
    </div>
  );
}
