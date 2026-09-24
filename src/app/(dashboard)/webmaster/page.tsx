"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthStore } from "@/store/authStore";
import { useNavVisibility } from "@/hooks/useNavVisibility";
import { isPathHidden } from "@/components/layout/navConfig";
import type { FacultyAccountRequest, FMSUser } from "@/types";

export default function WebmasterDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { hiddenModules, hiddenItems } = useNavVisibility();
  const isHidden = (href: string) => !!user?.role && isPathHidden(href, user.role, hiddenModules, hiddenItems);
  const [pendingFacultyAccountRequests, setPendingFacultyAccountRequests] = useState(0);
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/faculty-account-requests").then((r) => r.json() as Promise<{ requests: FacultyAccountRequest[] }>),
      fetch("/api/college/users?includeAll=true").then((r) => r.json() as Promise<{ users: FMSUser[] }>),
    ])
      .then(([accountRequestsRes, usersRes]) => {
        setPendingFacultyAccountRequests(
          (accountRequestsRes.requests ?? []).filter((r) => r.status !== "COMPLETED").length
        );
        setTotalAccounts((usersRes.users ?? []).length);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webmaster Dashboard"
        description="Create and manage login credentials for your college"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {!isHidden("/webmaster/credential-requests") && (
        <Link href="/webmaster/credential-requests">
          <Card className="hover:border-primary/50 transition-colors h-full">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                <KeyRound className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Faculty Account Requests</p>
                <p className="text-2xl font-bold">{isLoading ? "…" : pendingFacultyAccountRequests}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        )}
        {!isHidden("/webmaster/users") && (
        <Link href="/webmaster/users">
          <Card className="hover:border-primary/50 transition-colors h-full">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Accounts</p>
                <p className="text-2xl font-bold">{isLoading ? "…" : totalAccounts}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        )}
      </div>
    </div>
  );
}
