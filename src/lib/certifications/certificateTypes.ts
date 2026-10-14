import type { CertificateTypeDef } from "@/types";

// The hardcoded flow for this prototype phase. This function is the ONLY
// seam a later dynamic/admin-configurable version needs to change: swapping
// its internals to read a Firestore `certificateTypesConfig` doc changes
// nothing in transitions.ts / service.ts / decisionRules.ts, which only ever
// call this function and never embed "HOD"/"LIBRARY"/etc. as special cases.

const NO_DUE_DEF: CertificateTypeDef = {
  key: "NO_DUE",
  label: "No Due Certificate",
  flow: [
    { id: "hod", type: "SEQUENTIAL", label: "HOD Verification", recipient: { kind: "STUDENT_DEPARTMENT_HOD" } },
    {
      id: "clearances",
      type: "PARALLEL",
      label: "Department Clearances",
      branches: [
        { key: "PLACEMENT_DEPT", label: "Placement Cell (CRT Fee)", recipient: { kind: "ROLE", role: "PLACEMENT_DEPT" } },
        { key: "LIBRARY", label: "Library (Books)", recipient: { kind: "ROLE", role: "LIBRARY" } },
        { key: "HOSTEL", label: "Hostel (Fee)", recipient: { kind: "ROLE", role: "HOSTEL" } },
        { key: "PD", label: "Physical Education (Sports Kit)", recipient: { kind: "ROLE", role: "PD" } },
      ],
    },
    // After every clearance branch accepts, the College Office verifies no
    // other fees are pending before the request can proceed to issuance.
    { id: "officeFeeCheck", type: "SEQUENTIAL", label: "College Office - Fee Verification", recipient: { kind: "ROLE", role: "COLLEGE_OFFICE" } },
  ],
  issuer: { kind: "ROLE", role: "COLLEGE_OFFICE" },
  templateKey: "NO_DUE",
};

export function getCertificateTypeDef(key: "NO_DUE"): CertificateTypeDef {
  return NO_DUE_DEF;
}

/** Every certificate type a student can request - the Certificate Type dropdown's options. */
export function listCertificateTypeDefs(): CertificateTypeDef[] {
  return [NO_DUE_DEF];
}
