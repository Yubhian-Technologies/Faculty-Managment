import type {
  LeaveValidationContext,
  ValidationResult,
  LeaveTypeFull,
  EmployeeLeaveProfile,
  LeaveBalanceV2,
} from "@/types/leave";
import { yearsOfService } from "./dayCounter";

// Each validator returns an array of results (may be empty if all OK).
type Validator = (ctx: LeaveValidationContext) => ValidationResult[];

// ─── Eligibility ──────────────────────────────────────────────────────────────

function validateEligibility(ctx: LeaveValidationContext): ValidationResult[] {
  const issues: ValidationResult[] = [];
  const { leaveType, profile, today } = ctx;
  const rules = leaveType.rules;
  const elig = rules.eligibility;
  if (!elig) return [];

  if (elig.employmentTypes && !elig.employmentTypes.includes(profile.employmentType)) {
    issues.push({
      ok: false,
      code: "EMPLOYMENT_TYPE",
      message: `${leaveType.label} is only available to ${elig.employmentTypes.join(" / ")} employees.`,
      severity: "error",
    });
  }

  if (elig.isTeachingStaffOnly && !profile.isTeachingStaff) {
    issues.push({
      ok: false,
      code: "NOT_TEACHING_STAFF",
      message: `${leaveType.label} is only available to teaching staff.`,
      severity: "error",
    });
  }

  if (elig.genderAllowed && !elig.genderAllowed.includes(profile.gender)) {
    issues.push({
      ok: false,
      code: "GENDER_INELIGIBLE",
      message: `${leaveType.label} is only available to ${elig.genderAllowed.join(" / ")} employees.`,
      severity: "error",
    });
  }

  if (elig.maritalStatus && profile.maritalStatus !== elig.maritalStatus) {
    issues.push({
      ok: false,
      code: "MARITAL_STATUS",
      message: `${leaveType.label} requires marital status: ${elig.maritalStatus}.`,
      severity: "error",
    });
  }

  if (elig.isConfirmedRequired && !profile.isConfirmed) {
    issues.push({
      ok: false,
      code: "NOT_CONFIRMED",
      message: `${leaveType.label} is only available to confirmed employees.`,
      severity: "error",
    });
  }

  if (elig.minServiceYears !== undefined) {
    const doj = profile.dateOfJoining.toDate?.() ?? new Date(profile.dateOfJoining as unknown as string);
    const yrs = yearsOfService(doj, today);
    if (yrs < elig.minServiceYears) {
      issues.push({
        ok: false,
        code: "MIN_SERVICE_YEARS",
        message: `${leaveType.label} requires at least ${elig.minServiceYears} year(s) of service. You have ${yrs} year(s).`,
        severity: "error",
      });
    }
  }

  if (elig.maxLivingChildren !== undefined && profile.livingChildrenCount > elig.maxLivingChildren) {
    issues.push({
      ok: false,
      code: "CHILDREN_LIMIT",
      message: `${leaveType.label} is not available when you have more than ${elig.maxLivingChildren} living child(ren).`,
      severity: "error",
    });
  }

  if (elig.oneTimeOnly && profile.maternityLeaveUsedOnce) {
    issues.push({
      ok: false,
      code: "ONE_TIME_EXHAUSTED",
      message: `${leaveType.label} can only be availed once in service.`,
      severity: "error",
    });
  }

  if (elig.staffCategories && !elig.staffCategories.includes(profile.staffCategory)) {
    issues.push({
      ok: false,
      code: "STAFF_CATEGORY",
      message: `${leaveType.label} is only available to ${elig.staffCategories.join(" / ")} staff.`,
      severity: "error",
    });
  }

  return issues;
}

// ─── Day Limits ───────────────────────────────────────────────────────────────

function validateDayLimits(ctx: LeaveValidationContext): ValidationResult[] {
  const issues: ValidationResult[] = [];
  const { leaveType, computedDays } = ctx;
  const { minPerApplication, maxPerApplication } = leaveType.rules;

  if (minPerApplication !== undefined && computedDays < minPerApplication) {
    issues.push({
      ok: false,
      code: "MIN_DAYS",
      message: `Minimum ${minPerApplication} day(s) required for ${leaveType.label}.`,
      severity: "error",
    });
  }

  if (maxPerApplication !== undefined && computedDays > maxPerApplication) {
    issues.push({
      ok: false,
      code: "MAX_DAYS",
      message: `Maximum ${maxPerApplication} day(s) allowed per application for ${leaveType.label}.`,
      severity: "error",
    });
  }

  return issues;
}

// ─── Advance Notice & Retroactive ─────────────────────────────────────────────

function validateAdvanceNotice(ctx: LeaveValidationContext): ValidationResult[] {
  const issues: ValidationResult[] = [];
  const { leaveType, fromDate, today } = ctx;
  const { advanceNoticeDays = 0, retroactiveAllowed = false } = leaveType.rules;

  const todayMidnight = new Date(today);
  todayMidnight.setHours(0, 0, 0, 0);
  const fromMidnight = new Date(fromDate);
  fromMidnight.setHours(0, 0, 0, 0);

  if (!retroactiveAllowed && fromMidnight < todayMidnight) {
    issues.push({
      ok: false,
      code: "RETROACTIVE_NOT_ALLOWED",
      message: `${leaveType.label} cannot be applied retroactively.`,
      severity: "error",
    });
    return issues;
  }

  if (advanceNoticeDays > 0) {
    const minFrom = new Date(todayMidnight);
    minFrom.setDate(minFrom.getDate() + advanceNoticeDays);
    if (fromMidnight < minFrom) {
      issues.push({
        ok: false,
        code: "ADVANCE_NOTICE",
        message: `${leaveType.label} requires at least ${advanceNoticeDays} day(s) advance notice.`,
        severity: "error",
      });
    }
  }

  return issues;
}

// ─── Balance Check ────────────────────────────────────────────────────────────

function validateBalance(ctx: LeaveValidationContext): ValidationResult[] {
  const issues: ValidationResult[] = [];
  const { leaveType, computedDays, currentBalance } = ctx;

  // Skip balance check for leave types that don't track a running balance
  if (
    leaveType.rules.isLeaveWithoutPay ||
    leaveType.rules.isVacationEntitlement ||
    leaveType.rules.accrualBasis === "none"
  ) {
    return [];
  }

  if (!currentBalance) {
    issues.push({
      ok: false,
      code: "NO_BALANCE_RECORD",
      message: "Your leave balance has not been initialized. Please contact HR.",
      severity: "error",
    });
    return issues;
  }

  const available = currentBalance.opening + currentBalance.credited - currentBalance.used - currentBalance.pending;

  if (available < computedDays) {
    issues.push({
      ok: false,
      code: "INSUFFICIENT_BALANCE",
      message: `Insufficient balance. You have ${available} day(s) available but are applying for ${computedDays} day(s).`,
      severity: "error",
    });
  }

  return issues;
}

// ─── Handover Warning ─────────────────────────────────────────────────────────

function validateHandover(ctx: LeaveValidationContext): ValidationResult[] {
  const { leaveType, computedDays } = ctx;
  const { requiresHandoverAfterDays } = leaveType.rules;

  if (requiresHandoverAfterDays !== undefined && computedDays >= requiresHandoverAfterDays) {
    return [
      {
        ok: true,
        code: "HANDOVER_REQUIRED",
        message: `Leave spans ${computedDays} day(s). Please arrange a handover.`,
        severity: "warning",
      },
    ];
  }

  return [];
}

// ─── Certificate Warning ──────────────────────────────────────────────────────

function validateCertificate(ctx: LeaveValidationContext): ValidationResult[] {
  const { leaveType, computedDays } = ctx;
  const { certificateRequiredAfterDays } = leaveType.rules;

  if (certificateRequiredAfterDays !== undefined && computedDays > certificateRequiredAfterDays) {
    return [
      {
        ok: true,
        code: "CERTIFICATE_REQUIRED",
        message:
          certificateRequiredAfterDays === 0
            ? "A medical / authority certificate is required for this leave."
            : `A certificate is required when leave exceeds ${certificateRequiredAfterDays} day(s). Please carry one upon return.`,
        severity: "warning",
      },
    ];
  }

  return [];
}

// ─── Gender-day FPL Check ─────────────────────────────────────────────────────

function validateGenderDayAllocation(ctx: LeaveValidationContext): ValidationResult[] {
  const { leaveType, computedDays, profile } = ctx;
  const { genderDayAllocation } = leaveType.rules;
  if (!genderDayAllocation) return [];

  const entitledDays = genderDayAllocation[profile.gender];
  if (computedDays > entitledDays) {
    return [
      {
        ok: false,
        code: "GENDER_DAY_LIMIT",
        message: `${leaveType.label} allows a maximum of ${entitledDays} days for ${profile.gender} employees.`,
        severity: "error",
      },
    ];
  }

  return [];
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

const VALIDATORS: Validator[] = [
  validateEligibility,
  validateDayLimits,
  validateAdvanceNotice,
  validateBalance,
  validateHandover,
  validateCertificate,
  validateGenderDayAllocation,
];

export interface RuleEngineResult {
  errors: ValidationResult[];
  warnings: ValidationResult[];
  canSubmit: boolean;
}

export function runRuleEngine(ctx: LeaveValidationContext): RuleEngineResult {
  const all = VALIDATORS.flatMap((v) => v(ctx));
  const errors = all.filter((r) => !r.ok && r.severity === "error");
  const warnings = all.filter((r) => r.severity === "warning");
  return { errors, warnings, canSubmit: errors.length === 0 };
}

// ─── Helper: build a quick context for server-side validation ─────────────────

export function buildValidationContext(params: {
  fromDate: Date;
  toDate: Date;
  computedDays: number;
  leaveType: LeaveTypeFull;
  profile: EmployeeLeaveProfile;
  currentBalance: LeaveBalanceV2 | null;
  holidayDates: Set<string>;
}): LeaveValidationContext {
  return { ...params, leaveTypeCode: params.leaveType.code, today: new Date() };
}
