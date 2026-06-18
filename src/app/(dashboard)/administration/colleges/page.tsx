"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { MobileCard } from "@/components/shared/MobileCard";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { useMobile } from "@/hooks/useMobile";
import type { College } from "@/types";

export default function AdministrationCollegesPage() {
  const isMobile = useMobile();
  const [colleges, setColleges] = useState<College[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((d) => setColleges(d.colleges ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load colleges" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Colleges"
        description="Colleges under this location. Contact Super Admin to add new colleges."
      />

      {isMobile ? (
        <div className="space-y-3">
          {colleges.map((c) => (
            <MobileCard
              key={c.id}
              title={c.name}
              subtitle={c.contactEmail ?? "—"}
              badge={<Badge variant={c.isActive ? "default" : "secondary"}>{c.isActive ? "Active" : "Inactive"}</Badge>}
              fields={[{ label: "Contact", value: c.contactPhone ?? "—" }]}
            />
          ))}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={colleges as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search colleges..."
          searchKeys={["name"]}
          csvFilename="colleges"
          columns={[
            { key: "name", header: "College Name" },
            { key: "contactEmail", header: "Email", render: (r) => (r as unknown as College).contactEmail ?? "—" },
            { key: "contactPhone", header: "Phone", render: (r) => (r as unknown as College).contactPhone ?? "—" },
            {
              key: "isActive", header: "Status",
              render: (r) => <Badge variant={(r as unknown as College).isActive ? "default" : "secondary"}>{(r as unknown as College).isActive ? "Active" : "Inactive"}</Badge>,
            },
          ]}
        />
      )}
    </div>
  );
}
