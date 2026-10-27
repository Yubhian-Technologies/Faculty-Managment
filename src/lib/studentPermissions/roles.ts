// The one place the permission module names roles. Everything else imports these
// instead of repeating the string literals.

export const STUDENT_ROLE = "STUDENT";

/** Who may raise a request on students' behalf: any teaching login. */
export const FACULTY_RAISER_ROLES = ["PANEL_MEMBER", "HOD", "VICE_PRINCIPAL", "PRINCIPAL"] as const;

/** Roles a permission type can be limited to, in the order the configuration screen lists them. */
export const REQUESTER_ROLE_LABELS: Record<string, string> = {
  STUDENT: "Student", PANEL_MEMBER: "Faculty", HOD: "HOD", VICE_PRINCIPAL: "Vice Principal", PRINCIPAL: "Principal",
};

/** Who may see the department-wide (oversight) list. */
export const OVERSIGHT_ROLES = ["HOD", "VICE_PRINCIPAL", "PRINCIPAL"] as const;

/** Who may decide a request at any stage; their approval completes the whole request. */
export const OVERSEER_ROLES = ["PRINCIPAL", "VICE_PRINCIPAL"] as const;

export const hasAnyRole = (roles: readonly string[], wanted: readonly string[]) => wanted.some((r) => roles.includes(r));
export const oversees = (roles: readonly string[]) => hasAnyRole(roles, OVERSEER_ROLES);
/** A student-only login: can see requests that cover them but is never an approver. */
export const isStudentOnly = (roles: readonly string[]) => roles.length === 1 && roles[0] === STUDENT_ROLE;
