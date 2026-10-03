export const DEFAULT_UNTRACKED_CODES: string[];

export interface DriftBalanceInput {
  id: string; uid: string; leaveTypeCode: string; year: number; used?: number; entitled?: number;
}
export interface DriftRequestInput {
  id: string; uid: string; leaveTypeCode?: string; status: string; fromDate: unknown;
  totalDays?: number; lopDays?: number; isLateAttendancePenalty?: boolean;
}
export interface DriftRow {
  kind: "NO_BALANCE_DOC" | "USED_WITHOUT_APPROVED_REQUESTS" | "OVER_DEDUCTED" | "UNDER_DEDUCTED";
  balanceId: string | null;
  uid: string;
  leaveTypeCode: string;
  year: number;
  storedUsed: number;
  expectedUsed: number;
  delta: number;
  entitled: number | null;
  approvedRequestIds: string[];
}
export interface DriftReport {
  checkedBalances: number;
  approvedRequestsCounted: number;
  skippedRequestsWithoutDate: number;
  driftRows: number;
  byKind: Record<string, number>;
  rows: DriftRow[];
}
export function computeLeaveBalanceDrift(input: {
  balances: DriftBalanceInput[];
  requests: DriftRequestInput[];
  untrackedCodes?: string[];
}): DriftReport;
