"use client";

import { useState, Fragment } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { History, Search, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toCSV, downloadCSV } from "@/lib/utils/csv";
import { EFFECTIVE_CATEGORY_LABELS, EFFECTIVE_CATEGORY_ORDER } from "@/types/leave";
import type { EffectiveLeaveCategory, LeaveTypeCode } from "@/types/leave";
import { ROLE_LABELS } from "@/types";
import type { Department, UserRole } from "@/types";

function roleTag(role: string): string | null {
  if (role === "HOD") return "HOD";
  if (role === "PANEL_MEMBER") return null;
  return ROLE_LABELS[role as UserRole] ?? role;
}

const CATEGORY_TABS = EFFECTIVE_CATEGORY_ORDER.map((key) => ({ key, label: EFFECTIVE_CATEGORY_LABELS[key] }));

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

interface PeriodSummary {
  types: Partial<Record<LeaveTypeCode, TypeSummary>>;
  lopDays: number;
  otherDays: number;
}

export interface LeaveHistoryReportRow extends PeriodSummary {
  uid: string;
  employeeId: string;
  name: string;
  role: string;
  category: EffectiveLeaveCategory | null;
  dateOfJoining?: string | null;
}

interface YearlyMonthSummary extends PeriodSummary {
  month: number; // 1-12
}

interface LeaveYearlyReportRow {
  uid: string;
  employeeId: string;
  name: string;
  role: string;
  category: EffectiveLeaveCategory | null;
  dateOfJoining?: string | null;
  months: YearlyMonthSummary[];
  totals: PeriodSummary;
}

// Flat, single-header-row CSV export shape - the register format College
// Office already maintains outside the app, so a filled sheet from here
// round-trips back through the Leave History import as-is. VC OPB/CLB are
// always 0 - VC (On Duty) is unlimited, no balance is ever tracked for it,
// same as OD everywhere else in this module.
const EXPORT_HEADERS = [
  "Sno", "Employee Code", "Employee Name", "Department", "Date of Joining", "Payroll Month",
  "Leaves Taken", "Days Attended", "Weekly Offs", "Holidays", "LOP",
  "CL OPB", "SL OPB", "EL OPB", "VC OPB",
  "CL", "SL", "EL", "VC",
  "CL CLB", "SL CLB", "EL CLB", "VC CLB",
  "Category", "Location",
];

function formatPayrollMonth(year: number, month: number): string {
  return `${year}/${String(month).padStart(2, "0")}/01`;
}

function formatJoinDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function exportRow(params: {
  sno: number;
  employeeId: string;
  name: string;
  department: string;
  dateOfJoining: string | null | undefined;
  payrollMonth: string;
  period: PeriodSummary;
  category: EffectiveLeaveCategory | null;
  location: string;
}): string[] {
  const { sno, employeeId, name, department, dateOfJoining, payrollMonth, period, category, location } = params;
  const t = period.types;
  // Each type's `taken` (computeMonthSummary in monthlySummary.ts) is the
  // request's full totalDays, LOP overflow included - lopDays must NOT be
  // added again here, or any month with LOP double-counts those same days.
  const leavesTaken =
    (t.CL?.taken ?? 0) + (t.SL?.taken ?? 0) + (t.EL?.taken ?? 0) + (t.OD?.taken ?? 0) + period.otherDays;
  return [
    String(sno), employeeId, name, department, formatJoinDate(dateOfJoining), payrollMonth,
    String(leavesTaken), "", "", "", String(period.lopDays || 0),
    String(t.CL?.opb ?? ""), String(t.SL?.opb ?? ""), String(t.EL?.opb ?? ""), "0",
    String(t.CL?.taken ?? 0), String(t.SL?.taken ?? 0), String(t.EL?.taken ?? 0), String(t.OD?.taken ?? 0),
    String(t.CL?.clb ?? ""), String(t.SL?.clb ?? ""), String(t.EL?.clb ?? ""), "0",
    category ? EFFECTIVE_CATEGORY_LABELS[category] : "", location,
  ];
}

interface LeaveHistoryReportProps {
  // Full API URL (minus year/month, which this component appends and manages
  // itself) - e.g. "/api/college/leave-history-report?departmentId=abc" or
  // "/api/college/leave-history-report" (HOD - self-resolves department).
  // The yearly view hits the same path with "/yearly" inserted before the
  // query string (see toYearlyApiUrl below) - that route mirrors this one.
  apiUrl: string;
  queryKey: unknown[];
  // Base path an employee row links to - e.g. "/hod/leave-history" or
  // "/principal/leave-history/{deptId}".
  employeeHrefBase: string;
  emptyTitle?: string;
  // New Joining/Vacation/Non-Vacation only helps when a roster mixes staff
  // types (a department's teaching + technical staff). A single college-wide
  // role's own register (Dean, College Office, ...) is already filtered to
  // just that role, so the split only hides the one or two people in it
  // behind an extra click - default true, the role-based registers pass false.
  showCategoryFilter?: boolean;
}

function toYearlyApiUrl(apiUrl: string): string {
  const [base, query] = apiUrl.split("?");
  return query ? `${base}/yearly?${query}` : `${base}/yearly`;
}

const th = "border border-blue-900 bg-[#0a0a7a] text-white px-3 py-2 text-xs font-semibold text-center whitespace-nowrap";
const td = "border px-3 py-2 text-sm text-center whitespace-nowrap";

// The Attendance/CL/SL/SCL/EL/OD/Others cells - identical structure for a
// month row in either view, so both the monthly table and each month/total
// row of the yearly table render through this.
function PeriodCells({ period }: { period: PeriodSummary }) {
  return (
    <>
      <td className={td}>-</td>
      <td className={td}>-</td>
      <td className={td}>-</td>
      <td className={td}>{period.lopDays || "-"}</td>
      {BALANCE_TYPES.map((code) => {
        const t = period.types[code];
        return (
          <Fragment key={code}>
            <td className={td}>{t ? t.taken : "-"}</td>
            <td className={td}>{t?.opb ?? "-"}</td>
            <td className={td}>{t?.clb ?? "-"}</td>
          </Fragment>
        );
      })}
      <td className={td}>{period.types.OD ? period.types.OD.taken : "-"}</td>
      <td className={td}>{period.otherDays || "-"}</td>
    </>
  );
}

function ReportTableHead({ monthColumn }: { monthColumn: boolean }) {
  return (
    <thead>
      <tr>
        <th rowSpan={2} className={th}>Sno</th>
        <th rowSpan={2} className={th}>Employee Code</th>
        <th rowSpan={2} className={th}>Employee Name</th>
        <th rowSpan={2} className={th}>Category</th>
        {monthColumn && <th rowSpan={2} className={th}>Month</th>}
        <th colSpan={4} className={th}>Attendance</th>
        {BALANCE_TYPES.map((code) => (
          <th key={code} colSpan={3} className={th}>{code}</th>
        ))}
        <th className={th}>OD</th>
        <th className={th}>Others</th>
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
        <th className={th}>Taken</th>
      </tr>
    </thead>
  );
}

const MODE_TABS = [
  { key: "month", label: "Monthly" },
  { key: "year", label: "Full Year" },
];

// Monthly leave register table: month/year picker + the two-tier-header
// register itself. Shared by Principal (per department, HOD row included)
// and HOD (own department only, HOD row excluded - see the API route).
export function LeaveHistoryReport({ apiUrl, queryKey, employeeHrefBase, emptyTitle, showCategoryFilter = true }: LeaveHistoryReportProps) {
  const now = new Date();
  const [mode, setMode] = useState<"month" | "year">("month");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [category, setCategory] = useState<EffectiveLeaveCategory>("vacation");
  const [search, setSearch] = useState("");

  const monthlyQuery = useQuery({
    queryKey: [...queryKey, "month", year, month],
    queryFn: () =>
      fetch(`${apiUrl}${apiUrl.includes("?") ? "&" : "?"}year=${year}&month=${month}`)
        .then((r) => r.json() as Promise<{ department: Department; rows: LeaveHistoryReportRow[]; location?: string }>),
    enabled: mode === "month",
  });

  const yearlyApiUrl = toYearlyApiUrl(apiUrl);
  const yearlyQuery = useQuery({
    queryKey: [...queryKey, "year", year],
    queryFn: () =>
      fetch(`${yearlyApiUrl}${yearlyApiUrl.includes("?") ? "&" : "?"}year=${year}`)
        .then((r) => r.json() as Promise<{ department: Department; rows: LeaveYearlyReportRow[]; location?: string }>),
    enabled: mode === "year",
  });

  const { data, isLoading } = mode === "month" ? monthlyQuery : yearlyQuery;
  const categoryRows = showCategoryFilter
    ? (data?.rows ?? []).filter((row) => row.category === category)
    : (data?.rows ?? []);
  const searchTerm = search.trim().toLowerCase();
  const rows = searchTerm
    ? categoryRows.filter(
        (row) =>
          row.employeeId.toLowerCase().includes(searchTerm) ||
          row.name.toLowerCase().includes(searchTerm)
      )
    : categoryRows;

  function handleExport() {
    const department = data?.department?.name ?? "";
    const location = data?.location ?? "";
    const csvRows = mode === "month"
      ? (rows as LeaveHistoryReportRow[]).map((row, i) =>
          exportRow({
            sno: i + 1,
            employeeId: row.employeeId,
            name: row.name,
            department,
            dateOfJoining: row.dateOfJoining,
            payrollMonth: formatPayrollMonth(year, month),
            period: row,
            category: row.category,
            location,
          })
        )
      : (rows as LeaveYearlyReportRow[]).flatMap((row, i) => [
          ...row.months.map((m) =>
            exportRow({
              sno: i + 1,
              employeeId: row.employeeId,
              name: row.name,
              department,
              dateOfJoining: row.dateOfJoining,
              payrollMonth: formatPayrollMonth(year, m.month),
              period: m,
              category: row.category,
              location,
            })
          ),
          exportRow({
            sno: i + 1,
            employeeId: row.employeeId,
            name: row.name,
            department,
            dateOfJoining: row.dateOfJoining,
            payrollMonth: "Total",
            period: row.totals,
            category: row.category,
            location,
          }),
        ]);
    downloadCSV(toCSV([EXPORT_HEADERS, ...csvRows]), `leave-history-${mode === "month" ? `${year}-${String(month).padStart(2, "0")}` : year}.csv`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {showCategoryFilter && (
            <SegmentedTabs value={category} onChange={(key) => setCategory(key as EffectiveLeaveCategory)} options={CATEGORY_TABS} />
          )}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by employee code or name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedTabs value={mode} onChange={(key) => setMode(key as "month" | "year")} options={MODE_TABS} />
          {mode === "month" && (
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
          )}
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
          <Button variant="outline" size="sm" onClick={handleExport} disabled={rows.length === 0}>
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<History className="h-6 w-6" />}
                title={
                  !data || data.rows.length === 0
                    ? (emptyTitle ?? "No faculty with a login here yet")
                    : categoryRows.length === 0
                    ? `No ${EFFECTIVE_CATEGORY_LABELS[category]} found`
                    : `No results for "${search.trim()}"`
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <ReportTableHead monthColumn={mode === "year"} />
                <tbody>
                  {mode === "month"
                    ? (rows as LeaveHistoryReportRow[]).map((row, i) => (
                        <tr key={row.uid} className="hover:bg-muted/40">
                          <td className={td}>{i + 1}</td>
                          <td className={td}>{row.employeeId}</td>
                          <td className={`${td} text-left`}>
                            <Link href={`${employeeHrefBase}/${row.uid}`} className="text-primary hover:underline font-medium">
                              {row.name}
                            </Link>
                            {roleTag(row.role) && <span className="text-xs text-muted-foreground"> ({roleTag(row.role)})</span>}
                          </td>
                          <td className={td}>{row.category ? EFFECTIVE_CATEGORY_LABELS[row.category] : "-"}</td>
                          <PeriodCells period={row} />
                        </tr>
                      ))
                    : (rows as LeaveYearlyReportRow[]).map((row, i) => (
                        <Fragment key={row.uid}>
                          {row.months.map((m, mi) => (
                            <tr key={m.month} className="hover:bg-muted/40">
                              {mi === 0 && (
                                <>
                                  <td rowSpan={13} className={td}>{i + 1}</td>
                                  <td rowSpan={13} className={td}>{row.employeeId}</td>
                                  <td rowSpan={13} className={`${td} text-left`}>
                                    <Link href={`${employeeHrefBase}/${row.uid}`} className="text-primary hover:underline font-medium">
                                      {row.name}
                                    </Link>
                                    {roleTag(row.role) && <span className="text-xs text-muted-foreground"> ({roleTag(row.role)})</span>}
                                  </td>
                                  <td rowSpan={13} className={td}>{row.category ? EFFECTIVE_CATEGORY_LABELS[row.category] : "-"}</td>
                                </>
                              )}
                              <td className={td}>{MONTH_NAMES[m.month - 1]}</td>
                              <PeriodCells period={m} />
                            </tr>
                          ))}
                          <tr className="bg-muted/60 font-semibold">
                            <td className={td}>Total</td>
                            <PeriodCells period={row.totals} />
                          </tr>
                        </Fragment>
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
