import type { LeaveTypeFull } from "@/types/leave";

export const LEAVE_TYPE_SEED: LeaveTypeFull[] = [
  {
    id: "CL",
    code: "CL",
    label: "Casual Leave",
    shortLabel: "CL",
    color: "blue",
    isActive: true,
    sortOrder: 1,
    rules: {
      daysPerYear: 12,
      eligibleCategories: ["new-joining", "vacation", "non-vacation"],
    },
  },
  {
    id: "SL",
    code: "SL",
    label: "Sick Leave",
    shortLabel: "SL",
    color: "red",
    isActive: true,
    sortOrder: 2,
    rules: {
      daysPerYear: 20,
      halfDayAllowed: true,
      eligibleCategories: ["vacation", "non-vacation"],
    },
  },
  {
    id: "SCL",
    code: "SCL",
    label: "Special Casual Leave",
    shortLabel: "SCL",
    color: "purple",
    isActive: true,
    sortOrder: 3,
    rules: {
      daysPerYear: 7,
      halfDayAllowed: true,
      eligibleCategories: ["vacation"],
    },
  },
  {
    id: "EL",
    code: "EL",
    label: "Earned Leave",
    shortLabel: "EL",
    color: "green",
    isActive: true,
    sortOrder: 4,
    rules: {
      // Category-dependent - see computeEntitlement() in balanceEngine.ts
      // (vacation: 6, non-vacation: 30). daysPerYear is unused for EL. A
      // college can override either number via Settings > Leave Policy's
      // entitlementByCategory (see resolveLeaveTypes.ts).
      eligibleCategories: ["vacation", "non-vacation"],
      // Default cap kept in sync with the old EL_CARRY_FORWARD_CAP constant
      // in balanceEngine.ts - a college can raise/lower it via Settings, or
      // turn carry-forward off entirely, through the same override.
      carryForward: { enabled: true, cap: 300 },
    },
  },
  {
    id: "OD",
    code: "OD",
    label: "On Duty",
    shortLabel: "OD",
    color: "amber",
    isActive: true,
    sortOrder: 5,
    rules: {
      unlimited: true,
      halfDayAllowed: true,
      eligibleCategories: ["new-joining", "vacation", "non-vacation"],
    },
  },
  {
    id: "SH",
    code: "SH",
    label: "Summer Vacation",
    shortLabel: "SH",
    color: "orange",
    isActive: true,
    sortOrder: 6,
    rules: {
      // Same as OD - the college's own declared break, not a personal
      // allowance, so nothing is drawn down (see LeaveApplyForm.tsx, which
      // locks the From/To dates to whatever College Office set in the
      // Holidays page's "Summer Vacation" section - src/types/attendance.ts's
      // SummerHoliday).
      unlimited: true,
      // Vacation (teaching) staff only - the summer break is their vacation
      // entitlement, not a college-wide shutdown, so supporting staff work
      // through it and must not be offered it. Same shape as SCL above, and
      // like SCL this excludes "new-joining": that category replaces the
      // staff category outright for the first newJoiningYears of service
      // (computeEffectiveCategory), so a recently-joined teacher is not yet
      // in the vacation bucket.
      eligibleCategories: ["vacation"],
    },
  },
];
