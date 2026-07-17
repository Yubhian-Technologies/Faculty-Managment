// Test-account registry, sourced entirely from environment variables so this
// suite never hardcodes real UIDs/emails. See tests/e2e/README.md for the
// full list of variables and how to seed a matching test college.
//
// Every budget/indent lifecycle test needs at least: HOD, PRINCIPAL (or
// VICE_PRINCIPAL), FINANCE, PURCHASE_DEPT, MANAGEMENT — all sharing one
// TEST_COLLEGE_ID so requests raised by one role are visible to the next.

export type TestRole =
  | "HOD"
  | "PRINCIPAL"
  | "VICE_PRINCIPAL"
  | "FINANCE"
  | "PURCHASE_DEPT"
  | "MANAGEMENT"
  | "SUPER_ADMIN";

export interface TestUser {
  uid: string;
  email: string;
  role: TestRole;
  collegeId: string;
  locationId: string;
  password?: string; // only needed for AUTH_MODE=login
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing ${name}. Copy tests/e2e/.env.test.example to .env.test and fill in a seeded test college's IDs.`
    );
  }
  return v;
}

function optionalEnv(name: string): string {
  return process.env[name] ?? "";
}

function buildUser(prefix: string, role: TestRole): TestUser {
  return {
    uid: requireEnv(`${prefix}_UID`),
    email: optionalEnv(`${prefix}_EMAIL`) || `${prefix.toLowerCase()}@test.invalid`,
    role,
    collegeId: requireEnv("TEST_COLLEGE_ID"),
    locationId: optionalEnv("TEST_LOCATION_ID"),
    password: optionalEnv(`${prefix}_PASSWORD`),
  };
}

// Lazily constructed — importing this module must not throw just because a
// suite that doesn't need every role is running (e.g. a Non-Goods-only spec
// file shouldn't require TEST_PURCHASE_DEPT_UID to be set).
export const testUsers = {
  get hod(): TestUser {
    return buildUser("TEST_HOD", "HOD");
  },
  get principal(): TestUser {
    return buildUser("TEST_PRINCIPAL", "PRINCIPAL");
  },
  get vicePrincipal(): TestUser {
    return buildUser("TEST_VICE_PRINCIPAL", "VICE_PRINCIPAL");
  },
  get finance(): TestUser {
    // FINANCE is a GLOBAL role — collegeId is not on its own session, but we
    // still stamp TEST_COLLEGE_ID here so the auth fixture's ?collegeId=
    // query-param fallback (requireCollegeContext) has something to send.
    return { ...buildUser("TEST_FINANCE", "FINANCE"), collegeId: optionalEnv("TEST_COLLEGE_ID") };
  },
  get purchaseDept(): TestUser {
    return { ...buildUser("TEST_PURCHASE_DEPT", "PURCHASE_DEPT"), collegeId: optionalEnv("TEST_COLLEGE_ID") };
  },
  get management(): TestUser {
    return {
      uid: requireEnv("TEST_MANAGEMENT_UID"),
      email: optionalEnv("TEST_MANAGEMENT_EMAIL") || "management@test.invalid",
      role: "MANAGEMENT",
      collegeId: "",
      locationId: "",
      password: optionalEnv("TEST_MANAGEMENT_PASSWORD"),
    };
  },
};

export const testCollegeId = () => requireEnv("TEST_COLLEGE_ID");
