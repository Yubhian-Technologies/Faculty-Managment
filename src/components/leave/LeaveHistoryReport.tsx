"use client";

import { useState, Fragment } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EFFECTIVE_CATEGORY_LABELS } from "@/types/leave";
import type { EffectiveLeaveCategory, LeaveTypeCode } from "@/types/leave";
import type { Department } from "@/types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const YEARS = [2024, 2025, 2026];

// OD is unlimited (no balance) - only "taken" is meaningful for it.
const BALANCE_TYPES: LeaveTypeCode[] = ["CL", "SL", "SCL", "EL"];

interface TypeSummary {
  taken: number;
  opb?: number;
  clb?: number;
}

export interface LeaveHistoryReportRow {
  uid: string;
  employeeId: string;
  name: string;
  role: "HOD" | "PANEL_MEMBER";
  category: EffectiveLeaveCategory | null;
  types: Partial<Record<LeaveTypeCode, TypeSummary>>;
  lopDays: number;
}

interface LeaveHistoryReportProps {
  // Full API URL (minus year/month, which this component appends and manages
  // itself) - e.g. "/api/college/leave-history-report?departmentId=abc" or
  // "/api/college/leave-history-report" (HOD - self-resolves department).
  apiUrl: string;
  queryKey: unknown[];
  // Base path an employee row links to - e.g. "/hod/leave-history" or
  // "/principal/leave-history/{deptId}".
  employeeHrefBase: string;
  emptyTitle?: string;
}

// Monthly leave register table: month/year picker + the two-tier-header
// register itself. Shared by Principal (per department, HOD row included)
// and HOD (own department only, HOD row excluded - see the API route).
export function LeaveHistoryReport({ apiUrl, queryKey, employeeHrefBase, emptyTitle }: LeaveHistoryReportProps) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: [...queryKey, year, month],
    queryFn: () =>
      fetch(`${apiUrl}${apiUrl.includes("?") ? "&" : "?"}year=${year}&month=${month}`)
        .then((r) => r.json() as Promise<{ department: Department; rows: LeaveHistoryReportRow[] }>),
  });

  const th = "border border-blue-900 bg-[#0a0a7a] text-white px-3 py-2 text-xs font-semibold text-center whitespace-nowrap";
  const td = "border px-3 py-2 text-sm text-center whitespace-nowrap";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {MONTH_NAMES.map((name, idx) => (
              <SelectItem key={idx + 1} value={String(idx + 1)}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {YEARS.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={<History className="h-6 w-6" />} title={emptyTitle ?? "No faculty with a login here yet"} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th rowSpan={2} className={th}>Sno</th>
                    <th rowSpan={2} className={th}>Employee Code</th>
                    <th rowSpan={2} className={th}>Employee Name</th>
                    <th rowSpan={2} className={th}>Category</th>
                    <th colSpan={4} className={th}>Attendance</th>
                    {BALANCE_TYPES.map((code) => (
                      <th key={code} colSpan={3} className={th}>{code}</th>
                    ))}
                    <th className={th}>OD</th>
                  </tr>
                  <tr>
                    <th className={th}>Days Attended</th>
                    <th className={th}>Weekly Offs</th>
                    <th className={th}>Holidays</th>
                    <th className={th}>LOP</th>
                    {BALANCE_TYPES.map((code) => (
                      <Fragment key={code}>
                        <th className={th}>Taken</th>
                        <th className={th}>OPB</th>
                        <th className={th}>CLB</th>
                      </Fragment>
                    ))}
                    <th className={th}>Taken</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={row.uid} className="hover:bg-muted/40">
                      <td className={td}>{i + 1}</td>
                      <td className={td}>{row.employeeId}</td>
                      <td className={`${td} text-left`}>
                        <Link href={`${employeeHrefBase}/${row.uid}`} className="text-primary hover:underline font-medium">
                          {row.name}
                        </Link>
                        {row.role === "HOD" && <span className="text-xs text-muted-foreground"> (HOD)</span>}
                      </td>
                      <td className={td}>{row.category ? EFFECTIVE_CATEGORY_LABELS[row.category] : "-"}</td>
                      <td className={td}>-</td>
                      <td className={td}>-</td>
                      <td className={td}>-</td>
                      <td className={td}>{row.lopDays || "-"}</td>
                      {BALANCE_TYPES.map((code) => {
                        const t = row.types[code];
                        return (
                          <Fragment key={code}>
                            <td className={td}>{t ? t.taken : "-"}</td>
                            <td className={td}>{t?.opb ?? "-"}</td>
                            <td className={td}>{t?.clb ?? "-"}</td>
                          </Fragment>
                        );
                      })}
                      <td className={td}>{row.types.OD ? row.types.OD.taken : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
