"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { KeyRound, Users } from "lucide-react";
import type { FacultyAccountRequest, FMSUser } from "@/types";

export default function WebmasterDashboardPage() {
  const [pendingRequests, setPendingRequests] = useState(0);
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/faculty-account-requests").then((r) => r.json() as Promise<{ requests: FacultyAccountRequest[] }>),
      fetch("/api/college/users?includeAll=true").then((r) => r.json() as Promise<{ users: FMSUser[] }>),
    ])
      .then(([requestsRes, usersRes]) => {
        const pending = (requestsRes.requests ?? []).filter((r) => r.status !== "COMPLETED").length;
        setPendingRequests(pending);
        setTotalAccounts((usersRes.users ?? []).length);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="Webmaster" description="Manage login credentials and accounts for the college" />

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/webmaster/credential-requests">
          <Card className="hover:border-primary/50 transition-colors">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                <KeyRound className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending Credential Requests</p>
                <p className="text-2xl font-bold">{isLoading ? "…" : pendingRequests}</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/webmaster/users">
          <Card className="hover:border-primary/50 transition-colors">
            <CardContent className="p-6 flex items-center gap-4">
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
      </div>
    </div>
  );
}
