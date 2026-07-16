"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Building, ChevronRight, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import type { College, Department, FinancePurchaseClearance, IndentRequest } from "@/types";

const ACTIONABLE = new Set(["PENDING_PURCHASE_REVIEW", "RETURNED_TO_PURCHASE"]);

interface DeptRow extends Department {
  indentCount: number;
  clearanceCount: number;
  pendingCount: number;
}

export default function PurchaseBrowseDepartmentsPage() {
  const params = useParams<{ locationId: string; collegeId: string }>();
  const setSelectedCollegeId = useAuthStore((s) => s.setSelectedCollegeId);
  const [college, setCollege] = useState<College | null>(null);
  const [rows, setRows] = useState<DeptRow[]>([]);
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
            <Link key={dept.id} href={`/purchase/indents?department=${encodeURIComponent(dept.name)}`}>
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
    </div>
  );
}
