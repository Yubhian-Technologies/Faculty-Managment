import type { LeaveTypeCode, LeaveTypeFull } from "@/types/leave";

// Half day only makes sense for these leave types.
export const HALF_DAY_ELIGIBLE_TYPES: LeaveTypeCode[] = ["SL", "SCL", "OD"];

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
      // (vacation: 6, non-vacation: 30). daysPerYear is unused for EL.
      eligibleCategories: ["vacation", "non-vacation"],
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
      eligibleCategories: ["new-joining", "vacation", "non-vacation"],
    },
  },
  {
    id: "SH",
    code: "SH",
    label: "Summer Holidays",
    shortLabel: "SH",
    color: "orange",
    isActive: true,
    sortOrder: 6,
    rules: {
      // Same as OD - the college's own declared break, not a personal
      // allowance, so nothing is drawn down (see LeaveApplyForm.tsx, which
      // locks the From/To dates to whatever College Office set in the
      // Holidays page's "Summer Holidays" section - src/types/attendance.ts's
      // SummerHoliday).
      unlimited: true,
      eligibleCategories: ["new-joining", "vacation", "non-vacation"],
    },
  },
];
