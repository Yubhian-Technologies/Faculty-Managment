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
      daysPerYear: 10,
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
];
