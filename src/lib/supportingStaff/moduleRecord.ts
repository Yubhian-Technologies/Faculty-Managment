import type { SupportingStaffEditRecord } from "@/components/supportingStaff/SupportingStaffModuleEditor";
import type { SupportingStaffModuleKey } from "@/lib/supportingStaff/profileModules";
import { migrateSupportingStaffDoc } from "@/lib/faculty/fieldRenames";
import { toDateInputValue } from "@/lib/utils";

// The form state / PATCH body of a Supporting Staff profile module, shared by the per-module edit page
// ([id]/[module]/edit) and the tabbed Edit page (SupportingStaffEditPage) so the two can never disagree about
// which fields exist or what a save sends. Extracted unchanged from SupportingStaffModuleEditPage.

/** Form state for every module, from a raw supportingStaff doc. */
export function supportingStaffRecordFromDoc(doc: Record<string, unknown>): SupportingStaffEditRecord {
  const m = migrateSupportingStaffDoc(doc);
  return {
    gender: (m.gender as string) ?? "",
    dateOfBirth: toDateInputValue(m.dateOfBirth as never) || undefined,
    legalName: (m.legalName as string) ?? "",
    nameAsPerAadhar: (m.nameAsPerAadhar as string) ?? "",
    nameAsPerPan: (m.nameAsPerPan as string) ?? "",
    fatherName: (m.fatherName as string) ?? "",
    motherName: (m.motherName as string) ?? "",
    religion: m.religion as never,
    caste: m.caste as never,
    subCaste: (m.subCaste as string) ?? "",
    aadharNo: (m.aadharNo as string) ?? "",
    panNo: (m.panNo as string) ?? "",
    passportNo: (m.passportNo as string) ?? "",
    bankAccountNumber: (m.bankAccountNumber as string) ?? "",
    ifscCode: (m.ifscCode as string) ?? "",
    bankName: (m.bankName as string) ?? "",
    bankBranch: (m.bankBranch as string) ?? "",
    bankOtherDetails: (m.bankOtherDetails as string) ?? "",
    emergencyContactName: (m.emergencyContactName as string) ?? "",
    emergencyContactRelation: (m.emergencyContactRelation as string) ?? "",
    emergencyContactMobileNo: (m.emergencyContactMobileNo as string) ?? "",
    ratificationStatus: (m.ratificationStatus as string) ?? "",
    ratificationProceedingsNumber: (m.ratificationProceedingsNumber as string) ?? "",
    ratificationDate: (m.ratificationDate as string) ?? undefined,
    maritalStatus: (m.maritalStatus as string) ?? "",
    spouseName: (m.spouseName as string) ?? "",
    numberOfChildren: m.numberOfChildren as number | undefined,
    temporaryAddress: (m.temporaryAddress as string) ?? "",
    permanentAddressSameAsTemporary: (m.permanentAddressSameAsTemporary as boolean) ?? false,
    permanentAddress: (m.permanentAddress as string) ?? "",
    bloodGroup: (m.bloodGroup as string) ?? "",
    motherTongue: (m.motherTongue as string) ?? "",
    languagesKnown: (m.languagesKnown as string[]) ?? [],
    height: (m.height as string) ?? "",
    weightKg: m.weightKg as number | undefined,
    pfNumber: (m.pfNumber as string) ?? "",
    uanNumber: (m.uanNumber as string) ?? "",
    esiNumber: (m.esiNumber as string) ?? "",
    supportingStaffProfile: (m.supportingStaffProfile as SupportingStaffEditRecord["supportingStaffProfile"]) ?? {},
  };
}

/** The PATCH body that saves ONE module (personal -> the personal fields, every other module -> the whole profile object). */
export function supportingStaffModulePatchBody(moduleKey: SupportingStaffModuleKey, record: SupportingStaffEditRecord): Record<string, unknown> {
  if (moduleKey !== "personal") return { supportingStaffProfile: record.supportingStaffProfile };
  return {
    gender: record.gender, dateOfBirth: record.dateOfBirth, legalName: record.legalName,
    nameAsPerAadhar: record.nameAsPerAadhar, nameAsPerPan: record.nameAsPerPan,
    fatherName: record.fatherName, motherName: record.motherName, religion: record.religion,
    caste: record.caste, subCaste: record.subCaste, aadharNo: record.aadharNo, panNo: record.panNo,
    passportNo: record.passportNo,
    bankAccountNumber: record.bankAccountNumber, ifscCode: record.ifscCode,
    bankName: record.bankName, bankBranch: record.bankBranch, bankOtherDetails: record.bankOtherDetails,
    emergencyContactName: record.emergencyContactName, emergencyContactRelation: record.emergencyContactRelation,
    emergencyContactMobileNo: record.emergencyContactMobileNo, ratificationStatus: record.ratificationStatus,
    ratificationProceedingsNumber: record.ratificationProceedingsNumber,
    ratificationDate: record.ratificationDate, maritalStatus: record.maritalStatus, spouseName: record.spouseName,
    numberOfChildren: record.numberOfChildren,
    temporaryAddress: record.temporaryAddress, permanentAddressSameAsTemporary: record.permanentAddressSameAsTemporary,
    permanentAddress: record.permanentAddress, bloodGroup: record.bloodGroup,
    motherTongue: record.motherTongue, languagesKnown: record.languagesKnown,
    height: record.height, weightKg: record.weightKg,
    pfNumber: record.pfNumber, uanNumber: record.uanNumber, esiNumber: record.esiNumber,
  };
}

export interface SupportingStaffIdentityForm {
  apaarFacultyId: string;
  mobileNo: string;
  collegeEmail: string;
  designation: string;
  otherDesignationTitle: string;
  department: string;
  highestQualification: string;
  status: string;
  joiningDate: string;
}

/**
 * The PATCH body of the Identity & Employment tab. `departmentMode` "locked" (HOD) never sends the department - a
 * Technical record stays owned by the department it was created in; every other mode sends it, exactly as the two
 * separate Edit pages always did. Blank extra phone numbers are dropped; the photo is sent only when the page knows
 * about one (undefined = never touched, "" = removed).
 */
export function supportingStaffIdentityPatchBody(args: {
  form: SupportingStaffIdentityForm;
  legalName: string;
  email: string;
  employeeId: string;
  extraPhones: { label?: string; number: string }[];
  photoUrl: string | undefined;
  departmentMode: "locked" | "library" | "select";
}): Record<string, unknown> {
  const { department, ...rest } = args.form;
  return {
    ...rest,
    ...(args.departmentMode === "locked" ? {} : { department }),
    legalName: args.legalName,
    email: args.email,
    employeeId: args.employeeId,
    additionalPhoneNumbers: args.extraPhones.filter((p) => p.number.trim()),
    ...(args.photoUrl !== undefined ? { profilePhotoUrl: args.photoUrl } : {}),
  };
}
