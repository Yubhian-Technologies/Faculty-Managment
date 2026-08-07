"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, CheckCircle2, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmailRequestQueue } from "./EmailRequestQueue";
import type { EmailCreationRequest } from "@/types";

export default function WebmasterDashboardPage() {
  const [stats, setStats] = useState({ pending: 0, completed: 0 });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/email-requests")
      .then((r) => r.json() as Promise<{ requests: EmailCreationRequest[] }>)
      .then((d) => {
        const requests = d.requests ?? [];
        setStats({
          pending: requests.filter((r) => r.status === "PENDING").length,
          completed: requests.filter((r) => r.status === "COMPLETED").length,
        });
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webmaster Dashboard"
        description="Provision official institutional emails for newly hired faculty at your college"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Pending Requests</p>
              <p className="text-2xl font-bold text-yellow-600">{isLoading ? "…" : stats.pending}</p>
            </div>
            <Clock className="h-8 w-8 text-yellow-500/60" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Emails Created</p>
              <p className="text-2xl font-bold text-green-600">{isLoading ? "…" : stats.completed}</p>
            </div>
            <CheckCircle2 className="h-8 w-8 text-green-500/60" />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Pending Requests</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/webmaster/requests">
              View all <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
        </div>
        <EmailRequestQueue
          status="PENDING"
          limit={5}
          emptyTitle="No pending requests"
          emptyDescription="The College Office raises a request once a candidate joins — new ones will show up here."
        />
      </div>
    </div>
  );
}
