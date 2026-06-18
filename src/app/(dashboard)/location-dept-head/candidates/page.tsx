"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";
import { useAuthStore } from "@/store/authStore";

interface LocationCandidate {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  appliedPosition: string;
  department: string;
  status: string;
  createdAt: unknown;
}

export default function LocationDeptHeadCandidatesPage() {
  const isMobile = useMobile();
  const user = useAuthStore((s) => s.user);
  const [candidates, setCandidates] = useState<LocationCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/location/candidates")
      .then((r) => r.json() as Promise<{ candidates: LocationCandidate[] }>)
      .then((d) => {
        // Dept head sees only candidates for their department
        const all = d.candidates ?? [];
        const filtered = user?.department
          ? all.filter((c) => c.department === user.department)
          : all;
        setCandidates(filtered);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidates" }))
      .finally(() => setIsLoading(false));
  }, [user?.department]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Department Candidates"
        description={`All candidates applying for ${user?.department ?? "your"} department positions`}
      />

      {isMobile ? (
        <div className="space-y-3">
          {candidates.map((c) => (
            <MobileCard
              key={c.id}
              title={c.name}
              subtitle={c.appliedPosition}
              badge={<StatusBadge status={c.status} />}
              fields={[
                { label: "Email", value: c.email ?? "—" },
                { label: "Phone", value: c.phone ?? "—" },
              ]}
            />
          ))}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={candidates as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search candidates..."
          searchKeys={["name", "appliedPosition"]}
          csvFilename="dept-candidates"
          columns={[
            { key: "name", header: "Name" },
            { key: "appliedPosition", header: "Applied For" },
            { key: "email", header: "Email", render: (r) => (r as unknown as LocationCandidate).email ?? "—" },
            { key: "phone", header: "Phone", render: (r) => (r as unknown as LocationCandidate).phone ?? "—" },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={(r as unknown as LocationCandidate).status} /> },
            { key: "createdAt", header: "Applied", render: (r) => formatDate((r as unknown as LocationCandidate).createdAt as Parameters<typeof formatDate>[0]) },
          ]}
        />
      )}
    </div>
  );
}
