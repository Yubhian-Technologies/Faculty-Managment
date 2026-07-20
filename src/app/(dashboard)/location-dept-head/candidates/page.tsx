"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
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
  qualification?: string;
  status: string;
  createdAt: unknown;
}

export default function LocationDeptHeadCandidatesPage() {
  const router = useRouter();
  const isMobile = useMobile();
  const user = useAuthStore((s) => s.user);
  const [candidates, setCandidates] = useState<LocationCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    setIsLoading(true);
    fetch("/api/location/candidates")
      .then((r) => r.json() as Promise<{ candidates: LocationCandidate[] }>)
      .then((d) => {
        const all = d.candidates ?? [];
        const filtered = user?.department
          ? all.filter((c) => c.department === user.department)
          : all;
        setCandidates(filtered);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidates" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
  }, [user?.department]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Department Candidates"
        description={`Candidates for ${user?.department ?? "your"} department`}
        actions={<Button onClick={() => router.push("/location-dept-head/candidates/new")}>+ Add Candidate</Button>}
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
                { label: "Qualification", value: c.qualification ?? "—" },
              ]}
            />
          ))}
          {!isLoading && candidates.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No candidates yet. Add the first candidate for your department.</p>
          )}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={candidates as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search candidates..."
          searchKeys={["name", "appliedPosition", "email"]}
          csvFilename="dept-candidates"
          columns={[
            { key: "name", header: "Name" },
            { key: "appliedPosition", header: "Applied For" },
            { key: "qualification", header: "Qualification", render: (r) => (r as unknown as LocationCandidate).qualification ?? "—" },
            { key: "email", header: "Email", render: (r) => (r as unknown as LocationCandidate).email ?? "—" },
            { key: "phone", header: "Phone", render: (r) => (r as unknown as LocationCandidate).phone ?? "—" },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={(r as unknown as LocationCandidate).status} /> },
            { key: "createdAt", header: "Added", render: (r) => formatDate((r as unknown as LocationCandidate).createdAt as Parameters<typeof formatDate>[0]) },
          ]}
        />
      )}
    </div>
  );
}
