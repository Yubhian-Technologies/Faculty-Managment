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
import type { FMSUser } from "@/types";

export default function HODAnnexurePage() {
  const isMobile = useMobile();
  const [users, setUsers] = useState<FMSUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/users?role=ANNEXURE")
      .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
      .then((d) => setUsers(d.users ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load annexure staff" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Annexure"
        description="Staff accounts with an Annexure reference for your department"
        actions={
          <Button asChild>
            <Link href="/hod/annexure/new">+ Add Staff</Link>
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
              badge={<Badge variant="secondary">Annexure {u.annexure}</Badge>}
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
          searchKeys={["name", "email", "annexure"]}
          csvFilename="annexure-staff"
          columns={[
            { key: "name", header: "Name" },
            { key: "email", header: "Email" },
            {
              key: "annexure", header: "Annexure",
              render: (r) => <Badge variant="secondary">{(r as unknown as FMSUser).annexure}</Badge>,
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
