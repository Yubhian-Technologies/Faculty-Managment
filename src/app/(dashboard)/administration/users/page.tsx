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
import { ROLE_LABELS } from "@/types";
import type { FMSUser } from "@/types";

export default function AdministrationUsersPage() {
  const isMobile = useMobile();
  const [users, setUsers] = useState<FMSUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/location/users")
      .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
      .then((d) => setUsers(d.users ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load users" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Location Staff"
        description="HR Admin, Admin Office and Accounts staff for this location"
        actions={
          <Button asChild>
            <Link href="/administration/users/new">+ Add Staff</Link>
          </Button>
        }
      />

      {isMobile ? (
        <div className="space-y-3">
          {users.map((u) => (
            <MobileCard
              key={u.uid}
              title={u.name}
              subtitle={u.email}
              badge={<Badge variant="secondary">{ROLE_LABELS[u.role] ?? u.role}</Badge>}
              fields={[{ label: "Status", value: u.isActive ? "Active" : "Inactive" }]}
            />
          ))}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={users as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => (r as unknown as FMSUser).uid}
          isLoading={isLoading}
          searchPlaceholder="Search staff..."
          searchKeys={["name", "email"]}
          csvFilename="location-staff"
          columns={[
            { key: "name", header: "Name" },
            { key: "email", header: "Email" },
            {
              key: "role", header: "Role",
              render: (r) => <Badge variant="secondary">{ROLE_LABELS[(r as unknown as FMSUser).role] ?? (r as unknown as FMSUser).role}</Badge>,
            },
            {
              key: "isActive", header: "Status",
              render: (r) => <Badge variant={(r as unknown as FMSUser).isActive ? "default" : "secondary"}>{(r as unknown as FMSUser).isActive ? "Active" : "Inactive"}</Badge>,
            },
          ]}
        />
      )}
    </div>
  );
}
