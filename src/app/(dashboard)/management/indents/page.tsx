"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IndentStatusBadge } from "@/components/shared/indent/IndentStatusBadge";
import { IndentHistoryTimeline } from "@/components/shared/indent/IndentHistoryTimeline";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate, toDate } from "@/lib/utils";
import { indentItemsTotal, INDENT_STATUS_LABELS, type College, type Department, type IndentRequest, type IndentStatus } from "@/types";

type OverviewIndent = IndentRequest & { collegeName: string; locationId: string; locationName: string };

const EARLIEST_ACADEMIC_START_YEAR = 2008;

function academicYearLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function currentAcademicStartYear(): number {
  const d = new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; // FY starts April
}

const ACADEMIC_YEARS = Array.from(
  { length: currentAcademicStartYear() - EARLIEST_ACADEMIC_START_YEAR + 1 },
  (_, i) => academicYearLabel(currentAcademicStartYear() - i)
);

function academicYearOf(value: Parameters<typeof toDate>[0]): string {
  const d = toDate(value);
  if (!d) return "";
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return academicYearLabel(startYear);
}

export default function ManagementIndentsPage() {
  const [requests, setRequests] = useState<OverviewIndent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [colleges, setColleges] = useState<College[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [academicYear, setAcademicYear] = useState<string>("ALL");
  const [collegeId, setCollegeId] = useState<string>("ALL");
  const [department, setDepartment] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  useEffect(() => {
    fetch("/api/management/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((d) => setColleges(d.colleges ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load colleges" }));
  }, []);

  useEffect(() => {
    setDepartment("ALL");
    if (collegeId === "ALL") {
      setDepartments([]);
      return;
    }
    fetch(`/api/management/colleges/${collegeId}/departments`)
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }));
  }, [collegeId]);

  useEffect(() => {
    setIsLoading(true);
    const params = new URLSearchParams();
    if (collegeId !== "ALL") params.set("collegeId", collegeId);
    fetch(`/api/purchase/indents/overview?${params.toString()}`)
      .then((r) => r.json() as Promise<{ indents: OverviewIndent[] }>)
      .then((d) => setRequests(d.indents ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load indent requests" }))
      .finally(() => setIsLoading(false));
  }, [collegeId]);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (department !== "ALL" && r.department !== department) return false;
      if (academicYear !== "ALL" && academicYearOf(r.createdAt) !== academicYear) return false;
      return true;
    });
  }, [requests, statusFilter, department, academicYear]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget History"
        description="Complete, org-wide view of every indent request - every step from submission through completion, across all colleges"
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Select value={academicYear} onValueChange={setAcademicYear}>
          <SelectTrigger className="sm:max-w-[180px]">
            <SelectValue placeholder="Academic Year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Years</SelectItem>
            {ACADEMIC_YEARS.map((y) => (
              <SelectItem key={y} value={y}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={collegeId} onValueChange={setCollegeId}>
          <SelectTrigger className="sm:max-w-[220px]">
            <SelectValue placeholder="College" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Colleges</SelectItem>
            {colleges.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={department} onValueChange={setDepartment} disabled={collegeId === "ALL"}>
          <SelectTrigger className="sm:max-w-[200px]">
            <SelectValue placeholder={collegeId === "ALL" ? "Select a college first" : "Department"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:max-w-[200px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {(Object.keys(INDENT_STATUS_LABELS) as IndentStatus[]).map((status) => (
              <SelectItem key={status} value={status}>{INDENT_STATUS_LABELS[status]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <EmptyState
          title="No indent requests"
          description="Indent requests raised by HODs across every college will appear here, with their full step-by-step history."
          icon={<ClipboardList className="h-8 w-8" />}
        />
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="space-y-4">
          {filtered.map((r) => (
            <Card key={r.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex flex-wrap items-center justify-between gap-2">
                  <span>{r.title}</span>
                  <IndentStatusBadge status={r.status} />
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {r.collegeName} · {r.department} · Raised by {r.hodName} on {formatDate(r.createdAt)}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="font-medium">{formatCurrency(indentItemsTotal(r.items))}</span>
                  <span className="text-muted-foreground">{r.category}</span>
                  <span className="text-muted-foreground">{r.requestType === "NON_GOODS" ? "Non-Goods" : "Goods"}</span>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Steps</p>
                  <IndentHistoryTimeline history={r.history} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
