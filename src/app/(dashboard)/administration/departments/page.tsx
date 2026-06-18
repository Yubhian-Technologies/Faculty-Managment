"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { useMobile } from "@/hooks/useMobile";
import type { LocationDepartment } from "@/types";

export default function LocationDeptsPage() {
  const isMobile = useMobile();
  const [depts, setDepts] = useState<LocationDepartment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/location/departments")
      .then((r) => r.json() as Promise<{ departments: LocationDepartment[] }>)
      .then((d) => setDepts(d.departments ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }))
      .finally(() => setIsLoading(false));
  }, []);

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

      {isMobile ? (
        <div className="space-y-3">
          {depts.map((d) => (
            <MobileCard
              key={d.id}
              title={d.name}
              subtitle={d.deptHeadName ?? "No dept head assigned"}
              badge={<Badge variant={d.isActive ? "default" : "secondary"}>{d.isActive ? "Active" : "Inactive"}</Badge>}
              fields={[{ label: "Dept Head", value: d.deptHeadName ?? "—" }]}
            />
          ))}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={depts as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search departments..."
          searchKeys={["name"]}
          csvFilename="location-depts"
          columns={[
            { key: "name", header: "Department" },
            { key: "deptHeadName", header: "Dept Head", render: (r) => (r as unknown as LocationDepartment).deptHeadName ?? <span className="text-muted-foreground italic">Not assigned</span> },
            {
              key: "isActive", header: "Status",
              render: (r) => <Badge variant={(r as unknown as LocationDepartment).isActive ? "default" : "secondary"}>{(r as unknown as LocationDepartment).isActive ? "Active" : "Inactive"}</Badge>,
            },
          ]}
        />
      )}
    </div>
  );
}
