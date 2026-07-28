"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { FMSUser } from "@/types";

// One holder per role for this college — see api/college/users (COLLEGE_SINGLETON_ROLES).
const COLLEGE_MEMBER_ROLES = ["OFFICE", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL"] as const;

export default function CollegeMembersPage() {
  const router = useRouter();
  const [members, setMembers] = useState<FMSUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/users")
      .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
      .then((d) => setMembers(d.users ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load college members" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="College Members"
        description="Office, Placement Department, Library, and Exam Cell login access for this college"
      />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {COLLEGE_MEMBER_ROLES.map((role) => {
            const holder = members.find((m) => m.role === role);
            return (
              <Card key={role}>
                <CardContent className="flex items-center justify-between p-4">
                  {holder ? (
                    <div>
                      <p className="font-medium">{holder.name}</p>
                      <p className="text-xs text-muted-foreground">{holder.email}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not assigned yet</p>
                  )}
                  {holder ? (
                    <Badge variant="outline" className="text-xs">{ROLE_LABELS[role]}</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push(`/principal/college-members/new?role=${role}`)}
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                      Add {ROLE_LABELS[role]}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
