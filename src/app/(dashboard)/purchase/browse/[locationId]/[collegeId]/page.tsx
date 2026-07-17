"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Building, ChevronRight, ArrowLeft, Tags, PackageCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import { INDENT_REQUEST_TYPE_LABELS, type College, type Department, type FinancePurchaseClearance, type IndentRequest } from "@/types";

const ACTIONABLE = new Set(["PENDING_PURCHASE_REVIEW", "RETURNED_TO_PURCHASE"]);

interface DeptRow extends Department {
  indentCount: number;
  clearanceCount: number;
  pendingCount: number;
}

interface BreakdownRow {
  key: string;
  label: string;
  count: number;
}

export default function PurchaseBrowseDepartmentsPage() {
  const params = useParams<{ locationId: string; collegeId: string }>();
  const setSelectedCollegeId = useAuthStore((s) => s.setSelectedCollegeId);
  const [college, setCollege] = useState<College | null>(null);
  const [rows, setRows] = useState<DeptRow[]>([]);
  const [categoryRows, setCategoryRows] = useState<BreakdownRow[]>([]);
  const [typeRows, setTypeRows] = useState<BreakdownRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Keep the top-bar CollegeSwitcher (and every other Purchase page) in sync
    // with whichever college is being browsed here.
    setSelectedCollegeId(params.collegeId);

    setIsLoading(true);
    Promise.all([
      fetch(`/api/admin/colleges?locationId=${params.locationId}`).then((r) => r.json() as Promise<{ colleges: College[] }>).then((d) => (d.colleges ?? []).find((c) => c.id === params.collegeId) ?? null),
      fetch(`/api/management/colleges/${params.collegeId}/departments`).then((r) => r.json() as Promise<{ departments: Department[] }>).then((d) => d.departments ?? []),
      fetch(`/api/college/indent-requests?collegeId=${params.collegeId}`).then((r) => r.json() as Promise<{ requests: IndentRequest[] }>).then((d) => d.requests ?? []),
      fetch(`/api/college/finance-purchase-clearance?collegeId=${params.collegeId}`).then((r) => r.json() as Promise<{ requests: FinancePurchaseClearance[] }>).then((d) => d.requests ?? []),
    ])
      .then(([college, departments, indents, clearances]) => {
        setCollege(college);
        setRows(
          departments.map((dept) => ({
            ...dept,
            indentCount: indents.filter((r) => r.department === dept.name).length,
            clearanceCount: clearances.filter((r) => r.department === dept.name).length,
            pendingCount:
              indents.filter((r) => r.department === dept.name && ACTIONABLE.has(r.status)).length +
              clearances.filter((r) => r.department === dept.name && ACTIONABLE.has(r.status)).length,
          }))
        );

        const categoryCounts = new Map<string, number>();
        for (const r of indents) categoryCounts.set(r.category, (categoryCounts.get(r.category) ?? 0) + 1);
        setCategoryRows(
          Array.from(categoryCounts.entries())
            .map(([key, count]) => ({ key, label: key, count }))
            .sort((a, b) => a.label.localeCompare(b.label))
        );

        const typeCounts = new Map<string, number>();
        for (const r of indents) typeCounts.set(r.requestType, (typeCounts.get(r.requestType) ?? 0) + 1);
        setTypeRows(
          Array.from(typeCounts.entries())
            .map(([key, count]) => ({ key, label: INDENT_REQUEST_TYPE_LABELS[key as keyof typeof INDENT_REQUEST_TYPE_LABELS] ?? key, count }))
            .sort((a, b) => a.label.localeCompare(b.label))
        );
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }))
      .finally(() => setIsLoading(false));
  }, [params.collegeId, params.locationId, setSelectedCollegeId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/purchase/browse/${params.locationId}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <PageHeader title={college?.name ?? "Departments"} description="Select a department to see its requests" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No departments found" icon={<Building className="h-8 w-8" />} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((dept) => (
            <Link key={dept.id} href={`/purchase/indents?collegeId=${params.collegeId}&department=${encodeURIComponent(dept.name)}`}>
              <Card className="cursor-pointer hover:border-primary hover:shadow-md transition-all h-full">
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Building className="h-5 w-5 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium">{dept.name}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{dept.indentCount} indents</Badge>
                        <Badge variant="outline" className="text-xs">{dept.clearanceCount} clearances</Badge>
                        {dept.pendingCount > 0 && (
                          <Badge className="text-xs bg-yellow-100 text-yellow-800 border-yellow-200">{dept.pendingCount} pending</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {!isLoading && (categoryRows.length > 0 || typeRows.length > 0) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {typeRows.length > 0 && (
            <Card>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <PackageCheck className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">Indents by Goods / Non-Goods</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {typeRows.map((row) => (
                    <Link key={row.key} href={`/purchase/indents?collegeId=${params.collegeId}&requestType=${row.key}`}>
                      <Badge variant="outline" className="text-xs cursor-pointer hover:border-primary">{row.label} ({row.count})</Badge>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {categoryRows.length > 0 && (
            <Card>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Tags className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">Indents by Category</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {categoryRows.map((row) => (
                    <Link key={row.key} href={`/purchase/by-category?collegeId=${params.collegeId}&category=${encodeURIComponent(row.key)}`}>
                      <Badge variant="outline" className="text-xs cursor-pointer hover:border-primary">{row.label} ({row.count})</Badge>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
