"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { Building2, UserCircle, Users } from "lucide-react";
import type { LocationDepartment, FMSUser } from "@/types";

export default function LocationDeptsPage() {
  const [depts, setDepts] = useState<LocationDepartment[]>([]);
  const [users, setUsers] = useState<FMSUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/location/departments").then((r) => r.json() as Promise<{ departments: LocationDepartment[] }>).then((d) => d.departments ?? []),
      fetch("/api/location/users").then((r) => r.json() as Promise<{ users: FMSUser[] }>).then((d) => d.users ?? []),
    ])
      .then(([d, u]) => {
        setDepts(d);
        setUsers(u);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }))
      .finally(() => setIsLoading(false));
  }, []);

  function memberCount(dept: LocationDepartment) {
    return users.filter(
      (u) => (u as { locationDeptId?: string }).locationDeptId === dept.id || u.department === dept.name
    ).length;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Location Departments"
        description="Manage Electrical, Civil, Accounts and other administrative departments"
        actions={
          <Button asChild>
            <Link href="/administration/departments/new">+ Add Department</Link>
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : depts.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">No departments yet. Add your first one.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {depts.map((d) => (
            <Link key={d.id} href={`/administration/departments/${d.id}`}>
              <Card className="h-full transition-colors hover:border-primary/50 hover:bg-muted/30">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="h-4 w-4 text-primary shrink-0" />
                      <p className="font-semibold text-sm truncate">{d.name}</p>
                    </div>
                    <Badge variant={d.isActive ? "default" : "secondary"} className="shrink-0">
                      {d.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <UserCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{d.deptHeadName ?? "No dept head assigned"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5 shrink-0" />
                    <span>{memberCount(d)} member{memberCount(d) !== 1 ? "s" : ""}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
