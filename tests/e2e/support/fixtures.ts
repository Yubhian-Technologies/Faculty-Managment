// Minimal-but-VALID request bodies for the routes the scope-security spec
// exercises. "Valid" matters here: every route validates all required fields
// before it ever reaches the department-scope check these tests are actually
// probing (see e.g. src/app/api/college/faculty/route.ts's required-field
// block ahead of its "Resolve the owning department" section), so a sloppily
// -built body would 400 before the scope check even runs, and the test would
// "pass" for the wrong reason. None of these fields are format-validated
// server-side beyond non-empty (src/lib/firestore/personalDetails.ts takes
// them as-is) - only presence and a few enum checks (employeeCategory,
// status) are enforced, which keeps these fixtures simple.

// Unique enough across runs/collections without a shared counter - both
// employeeId (global, cross-college uniqueness) and collegeEmail (this
// college's own Firebase Auth namespace) must be unique per created record.
function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

export function validFacultyCreatePayload(department: string, overrides: Record<string, unknown> = {}) {
  const suffix = uniqueSuffix();
  return {
    employeeId: `E2E-FAC-${suffix}`,
    collegeEmail: `e2e.faculty.${suffix}@example-college.test`,
    password: "TestPassword123!",
    designation: "Assistant Professor",
    employeeCategory: "REGULAR",
    highestQualification: "Ph.D",
    joiningDate: "2020-06-01",
    department,
    mobileNo: "9000000000",
    legalName: `E2E Faculty ${suffix}`,
    gender: "Other",
    dateOfBirth: "1990-01-01",
    aadharNo: `E2E-AADHAR-${suffix}`,
    panNo: `E2EPAN${suffix}`,
    ratificationStatus: "Not Ratified",
    ...overrides,
  };
}

export function validLinkHodPayload(department: string, linkUid: string, overrides: Record<string, unknown> = {}) {
  const suffix = uniqueSuffix();
  return {
    linkUid,
    department,
    employeeId: `E2E-LNK-${suffix}`,
    mobileNo: "9000000001",
    designation: "HOD",
    highestQualification: "Ph.D",
    joiningDate: "2020-06-01",
    legalName: `E2E Linked HOD ${suffix}`,
    gender: "Other",
    dateOfBirth: "1985-01-01",
    aadharNo: `E2E-AADHAR-L-${suffix}`,
    panNo: `E2EPANL${suffix}`,
    ratificationStatus: "Not Ratified",
    ...overrides,
  };
}
