import type { Firestore } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { badBodyResponse } from "@/lib/http/readJsonBody";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import type { EmployeePay, PayEmployeeKind, PayrollSettings } from "@/types/payroll";
import { PayrollRuleError, defaultPayrollSettings, grossActual, revisionFor } from "./rules";

// Server side of payroll: where things live and who may see / change them. Salary data is
// confidential - only the location Accounts (and Super Admin) maintain it; the College Office reads
// pay structures for its own college. Every read and write goes through these guards (Admin SDK only;
// the Firestore rules deny all client access to these collections by default).

export const PAYROLL_ACCOUNTS_ROLES = ["ACCOUNTS", "SUPER_ADMIN"] as const;
export const PAYROLL_READER_ROLES = [...PAYROLL_ACCOUNTS_ROLES, "COLLEGE_OFFICE"] as const;
/** Monthly runs are also readable (totals + register) by the Principal / Vice Principal of the college. */
export const PAYROLL_RUN_READER_ROLES = [...PAYROLL_READER_ROLES, "PRINCIPAL", "VICE_PRINCIPAL"] as const;

export const payrollRefs = (db: Firestore, collegeId: string) => {
  const college = db.collection("colleges").doc(collegeId);
  return {
    college,
    settings: college.collection("payrollSettings").doc("config"),
    pay: college.collection("employeePay"),
    runs: college.collection("payrollRuns"),
  };
};

export class PayrollError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 = 400) { super(message); }
}

async function collegeFor(db: Firestore, request: Request, session: { role: string; collegeId: string; locationId: string }) {
  const asked = new URL(request.url).searchParams.get("collegeId") || "";
  if (session.role !== "ACCOUNTS" && session.role !== "SUPER_ADMIN") {
    if (asked && asked !== session.collegeId) throw new PayrollError("Not your college", 403);
    if (!session.collegeId) throw new PayrollError("Pick a college", 400);
    return session.collegeId;
  }
  const collegeId = asked || session.collegeId || "";
  if (!collegeId) throw new PayrollError("Pick a college", 400);
  if (session.role === "ACCOUNTS") {
    const snap = await db.collection("colleges").doc(collegeId).get();
    const loc = (snap.data() as { locationId?: string } | undefined)?.locationId;
    const ok = snap.exists && (collegeId === session.collegeId || (!!session.locationId && loc === session.locationId));
    if (!ok) throw new PayrollError("This college isn't in your location", 403);
  }
  return collegeId;
}

/** Accounts / Super Admin, for the college named by ?collegeId (must be in the Accounts login's location). */
export async function requirePayrollAccounts(db: Firestore, request: Request) {
  const session = await requireRole(...PAYROLL_ACCOUNTS_ROLES);
  return { ...session, collegeId: await collegeFor(db, request, session) };
}

/** Accounts / Super Admin (any college of their location) or the College Office (its own college) - read only. */
export async function requirePayrollReader(db: Firestore, request: Request) {
  const session = await requireRole(...PAYROLL_READER_ROLES);
  return { ...session, collegeId: await collegeFor(db, request, session) };
}

/** Reads a month's runs: Accounts / Super Admin / College Office, plus the Principal and VP (read only). */
export async function requirePayrollRunReader(db: Firestore, request: Request) {
  const session = await requireRole(...PAYROLL_RUN_READER_ROLES);
  return { ...session, collegeId: await collegeFor(db, request, session) };
}

/** Acts on a run: the College Office (prepares, adjusts, submits) or Accounts (review, release); Super Admin either. */
export async function requirePayrollActor(db: Firestore, request: Request) {
  const session = await requireRole(...PAYROLL_READER_ROLES);
  const collegeId = await collegeFor(db, request, session);
  const actor: "OFFICE" | "ACCOUNTS" = session.role === "COLLEGE_OFFICE" ? "OFFICE" : "ACCOUNTS";
  return { ...session, collegeId, actor, superAdmin: session.role === "SUPER_ADMIN" };
}

export async function loadPayrollSettings(db: Firestore, collegeId: string): Promise<{ settings: PayrollSettings; saved: boolean }> {
  const snap = await payrollRefs(db, collegeId).settings.get();
  return snap.exists ? { settings: snap.data() as PayrollSettings, saved: true } : { settings: defaultPayrollSettings(), saved: false };
}

// ─── Employees (faculty + supporting staff) ─────────────────────────────────────

export interface PayEmployee {
  employeeKey: string;
  kind: PayEmployeeKind;
  recordId: string;
  employeeCode: string;
  name: string;
  department: string;
  designation: string;
  status: string;
  section: "TEACHING" | "NON_TEACHING";
  joiningDate?: string;               // YYYY-MM-DD
  /** Server-only details for the monthly run (never sent with the pay-structure list). */
  extra: { userUid?: string; lastWorkingDate?: string; bank: { account: string; ifsc: string; bankName: string }; pan?: string; uan?: string };
}

export const employeeKeyOf = (kind: PayEmployeeKind, recordId: string) => `${kind}_${recordId}`;
export const normCode = (code: unknown) => String(code ?? "").trim().toUpperCase();

const dateKey = (v: unknown): string | undefined => {
  const d = v && typeof v === "object" && "toDate" in v && typeof (v as { toDate: unknown }).toDate === "function"
    ? (v as { toDate: () => Date }).toDate()
    : v instanceof Date ? v : typeof v === "string" && v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10) : undefined;
};

/** Everyone who can be paid: faculty and supporting staff of the college (not interview-stage records). */
export async function listPayEmployees(db: Firestore, collegeId: string): Promise<PayEmployee[]> {
  const { college } = payrollRefs(db, collegeId);
  const [fac, staff] = await Promise.all([college.collection("facultyMembers").get(), college.collection("supportingStaff").get()]);
  const out: PayEmployee[] = [];
  const add = (kind: PayEmployeeKind, id: string, raw: unknown) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (r.status === "INTERVIEW_DONE") return;
    const designation = kind === "STAFF" && r.designation === "OTHER" ? String(r.otherDesignationTitle ?? "Other") : String(r.designation ?? "");
    out.push({
      employeeKey: employeeKeyOf(kind, id), kind, recordId: id,
      employeeCode: String(r.employeeId ?? "").trim(),
      name: facultyDisplayName(r as { legalName?: string; honorific?: string }) || String(r.name ?? r.fullName ?? "").trim() || "(no name)",
      department: String(r.department ?? ""), designation, status: String(r.status ?? "ACTIVE"),
      section: kind === "FACULTY" ? "TEACHING" : "NON_TEACHING",
      joiningDate: dateKey(r.joiningDate),
      extra: {
        userUid: typeof r.userUid === "string" && r.userUid ? r.userUid : undefined,
        lastWorkingDate: r.status === "RESIGNED" ? dateKey(r.resignedDate) : r.status === "RETIRED" ? dateKey(r.retiredDate) : undefined,
        bank: { account: String(r.bankAccountNumber ?? "").trim(), ifsc: String(r.ifscCode ?? "").trim().toUpperCase(), bankName: String(r.bankName ?? "").trim() },
        pan: String(r.panNo ?? "").trim().toUpperCase() || undefined,
        uan: String(r.uanNumber ?? "").trim() || undefined,
      },
    });
  };
  fac.docs.forEach((d) => add("FACULTY", d.id, d.data()));
  staff.docs.forEach((d) => add("STAFF", d.id, d.data()));
  return out.sort((a, b) => a.section.localeCompare(b.section) || a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true }));
}

/** A row of the pay-structure list: the person + the pay in force for `month`. */
export function payRowView({ extra: _extra, ...e }: PayEmployee, pay: EmployeePay | undefined, month: string) {
  void _extra;
  const current = pay ? revisionFor(pay.revisions, month) : null;
  const upcoming = pay?.revisions.filter((r) => r.effectiveFrom > month).map((r) => r.effectiveFrom) ?? [];
  return {
    ...e,
    hasPay: !!current,
    effectiveFrom: current?.effectiveFrom ?? null,
    amounts: current?.amounts ?? {},
    exempt: current?.exempt ?? [],
    grossActual: current ? grossActual(current.amounts) : 0,
    revisionCount: pay?.revisions.length ?? 0,
    upcoming,
  };
}

/** The first month a released payroll run exists on or after `month` - pay can't be changed back into it. */
export async function releasedOnOrAfter(db: Firestore, collegeId: string, month: string): Promise<string | null> {
  const snap = await payrollRefs(db, collegeId).runs.where("status", "==", "RELEASED").get();
  const months = snap.docs.map((d) => d.id).filter((m) => m >= month).sort();
  return months[0] ?? null;
}

export function payrollErrorResponse(err: unknown, label: string): NextResponse {
  const bad = badBodyResponse(err);
  if (bad) return bad;
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
    return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
  }
  if (err instanceof PayrollError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof PayrollRuleError) return NextResponse.json({ error: err.message }, { status: 400 });
  console.error(label, err);
  return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
}

// ─── Employees' own payslips ────────────────────────────────────────────────────

/** College roles a faculty / staff member can sign in with - each may read their OWN payslips only. */
export const PAYSLIP_ROLES = [
  "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "COLLEGE_STAFF", "EXAM_CELL", "ACADEMICS", "IQAC_COORDINATOR",
  "T_AND_P", "R_AND_D", "LIBRARY", "HOSTEL", "PLACEMENT_DEPT", "PD", "COLLEGE_ACCOUNTS", "WEBMASTER",
] as const;

/** The faculty / staff record linked to this login, or null. */
export async function myPayEmployee(db: Firestore, collegeId: string, uid: string): Promise<PayEmployee | null> {
  return (await listPayEmployees(db, collegeId)).find((e) => e.extra.userUid === uid) ?? null;
}

/** Letterhead for a payslip: the college's name and its own uploaded logo (else the default). */
export async function payslipCollege(db: Firestore, collegeId: string): Promise<{ name: string; logoUrl?: string }> {
  const c = ((await db.collection("colleges").doc(collegeId).get()).data() ?? {}) as { name?: string; logoUrl?: string };
  const logo = c.logoUrl?.trim();
  return { name: c.name ?? "College", ...(logo && logo !== "/vishnulogo.png" ? { logoUrl: logo } : {}) };
}
