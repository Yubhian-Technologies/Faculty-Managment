// The ONE list of Personal Details fields a Faculty edit page loads from, and
// PATCHes back to, a facultyMembers doc.
//
// The HOD edit page (hod/faculty/[id]/[module]/edit) and the faculty member's
// own self-edit page (components/faculty/MyProfileModuleEditPage) both build
// their form state with personalRecordFromDoc() and their PATCH body with
// personalPatchBody() - so the two can never disagree about which fields exist
// (the self-edit page used to omit Mother Tongue, Languages Known, Height,
// Weight, PF Number, ... entirely). Field names are the stored key names.
//
// esiNumber is deliberately not here: it is hidden for Faculty on both surfaces.

import { toDateInputValue } from "@/lib/utils";
import { ratificationRecordsFromDoc, normalizeRatificationRecords } from "@/lib/faculty/ratificationHistory";
import type { FacultyEditRecord } from "@/components/faculty/FacultyProfileModuleEditor";

type Doc = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

// Form state for the Personal Details module, from a (lifted) facultyMembers doc.
//
// `ratificationHistory` must be true ONLY for a genuine facultyMembers doc
// (HOD's Faculty edit pages, and the Panel self-edit page via /api/college/
// faculty/me) - this same function is also called by every other role's "My
// Profile" edit page (MyProfileModuleEditPage), which for them reads/writes a
// plain FMSUser doc instead. Left false (the default) there so those saves
// keep using the single Proceedings Number/Date pair untouched, instead of
// wrongly emitting the Faculty-only multi-entry `ratifications` array.
export function personalRecordFromDoc(m: Doc, opts: { ratificationHistory?: boolean } = {}): Partial<FacultyEditRecord> {
  const { ratificationHistory = false } = opts;
  return {
    gender: str(m.gender),
    dateOfBirth: toDateInputValue(m.dateOfBirth as never) || undefined,
    legalName: str(m.legalName),
    nameAsPerAadhar: str(m.nameAsPerAadhar),
    nameAsPerPan: str(m.nameAsPerPan),
    fatherName: str(m.fatherName),
    motherName: str(m.motherName),
    religion: m.religion as never,
    caste: m.caste as never,
    subCaste: str(m.subCaste),
    aadharNo: str(m.aadharNo),
    panNo: str(m.panNo),
    passportNo: str(m.passportNo),
    differentlyAbled: (m.differentlyAbled as boolean) ?? undefined,
    differentlyAbledDetails: str(m.differentlyAbledDetails),
    bankAccountNumber: str(m.bankAccountNumber),
    ifscCode: str(m.ifscCode),
    bankName: str(m.bankName),
    bankBranch: str(m.bankBranch),
    bankOtherDetails: str(m.bankOtherDetails),
    emergencyContactName: str(m.emergencyContactName),
    emergencyContactRelation: str(m.emergencyContactRelation),
    emergencyContactMobileNo: str(m.emergencyContactMobileNo),
    ratificationStatus: str(m.ratificationStatus),
    ...(ratificationHistory
      ? { ratifications: ratificationRecordsFromDoc(m) }
      : {
          ratificationProceedingsNumber: str(m.ratificationProceedingsNumber),
          ratificationDate: toDateInputValue(m.ratificationDate as never) || undefined,
        }),
    maritalStatus: str(m.maritalStatus),
    spouseName: str(m.spouseName),
    numberOfChildren: m.numberOfChildren as number | undefined,
    temporaryAddress: str(m.temporaryAddress),
    permanentAddressSameAsTemporary: (m.permanentAddressSameAsTemporary as boolean) ?? false,
    permanentAddress: str(m.permanentAddress),
    bloodGroup: str(m.bloodGroup),
    motherTongue: str(m.motherTongue),
    languagesKnown: (m.languagesKnown as string[]) ?? [],
    height: str(m.height),
    weightKg: m.weightKg as number | undefined,
    pfNumber: str(m.pfNumber),
    uanNumber: str(m.uanNumber),
  };
}

// PATCH body for the Personal Details module, from the form state. See
// personalRecordFromDoc's own doc-comment on `ratificationHistory`.
export function personalPatchBody(record: FacultyEditRecord, opts: { ratificationHistory?: boolean } = {}): Record<string, unknown> {
  const { ratificationHistory = false } = opts;
  return {
    gender: record.gender, dateOfBirth: record.dateOfBirth, legalName: record.legalName,
    nameAsPerAadhar: record.nameAsPerAadhar, nameAsPerPan: record.nameAsPerPan,
    fatherName: record.fatherName, motherName: record.motherName, religion: record.religion,
    caste: record.caste, subCaste: record.subCaste, aadharNo: record.aadharNo, panNo: record.panNo,
    passportNo: record.passportNo,
    differentlyAbled: record.differentlyAbled, differentlyAbledDetails: record.differentlyAbledDetails,
    bankAccountNumber: record.bankAccountNumber, ifscCode: record.ifscCode,
    bankName: record.bankName, bankBranch: record.bankBranch, bankOtherDetails: record.bankOtherDetails,
    emergencyContactName: record.emergencyContactName, emergencyContactRelation: record.emergencyContactRelation,
    emergencyContactMobileNo: record.emergencyContactMobileNo, ratificationStatus: record.ratificationStatus,
    ...(ratificationHistory
      ? { ratifications: normalizeRatificationRecords(record.ratifications) }
      : { ratificationProceedingsNumber: record.ratificationProceedingsNumber, ratificationDate: record.ratificationDate }),
    maritalStatus: record.maritalStatus, spouseName: record.spouseName,
    numberOfChildren: record.numberOfChildren,
    temporaryAddress: record.temporaryAddress, permanentAddressSameAsTemporary: record.permanentAddressSameAsTemporary,
    permanentAddress: record.permanentAddress, bloodGroup: record.bloodGroup,
    motherTongue: record.motherTongue, languagesKnown: record.languagesKnown,
    height: record.height, weightKg: record.weightKg,
    pfNumber: record.pfNumber, uanNumber: record.uanNumber,
  };
}
