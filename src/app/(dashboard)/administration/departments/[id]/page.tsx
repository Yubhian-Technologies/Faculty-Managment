"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { ROLE_LABELS } from "@/types";
import { UserCircle, Mail, Phone, Users, ArrowLeft } from "lucide-react";
import type { LocationDepartment, FMSUser } from "@/types";

export default function LocationDeptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [dept, setDept] = useState<LocationDepartment | null>(null);
  const [users, setUsers] = useState<FMSUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/location/departments").then((r) => r.json() as Promise<{ departments: LocationDepartment[] }>).then((d) => d.departments ?? []),
      fetch("/api/location/users").then((r) => r.json() as Promise<{ users: FMSUser[] }>).then((d) => d.users ?? []),
    ])
      .then(([depts, u]) => {
        setDept(depts.find((d) => d.id === id) ?? null);
        setUsers(u);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load department" }))
      .finally(() => setIsLoading(false));
  }, [id]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Department" description="Loading..." />
        <div className="h-48 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!dept) {
    return <div className="text-center py-12 text-muted-foreground">Department not found</div>;
  }

  const members = users.filter(
    (u) => ((u as { locationDeptId?: string }).locationDeptId === dept.id || u.department === dept.name) && u.uid !== dept.deptHeadUid
  );
  const head = dept.deptHeadUid ? users.find((u) => u.uid === dept.deptHeadUid) : undefined;

  return (
    <div className="space-y-6">
      <Link href="/administration/departments" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        All Departments
      </Link>

      <PageHeader
        title={dept.name}
        description="Department overview"
        actions={<Badge variant={dept.isActive ? "default" : "secondary"}>{dept.isActive ? "Active" : "Inactive"}</Badge>}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserCircle className="h-4 w-4 text-primary" />
            Department Head
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dept.deptHeadName ? (
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-semibold text-primary">{dept.deptHeadName.charAt(0).toUpperCase()}</span>
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm">{dept.deptHeadName}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
                  {head?.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{head.email}</span>}
                  {head?.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{head.phone}</span>}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">No department head assigned yet.</p>
              <Button asChild size="sm" variant="outline">
                <Link href="/administration/users/new">Assign Head</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Other Members ({members.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other staff assigned to this department.</p>
          ) : (
            members.map((m) => (
              <div key={m.uid} className="flex items-center gap-3 p-3 rounded-lg border">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-primary">{m.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{ROLE_LABELS[m.role] ?? m.role} · {m.email}</p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="font-medium">{dept.isActive ? "Active" : "Inactive"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Created</p>
            <p className="font-medium">{formatDate(dept.createdAt as Parameters<typeof formatDate>[0])}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
