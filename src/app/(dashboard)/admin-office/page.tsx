"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { useNavVisibility } from "@/hooks/useNavVisibility";
import { isPathHidden } from "@/components/layout/navConfig";
import { ClipboardList, ArrowRight } from "lucide-react";

interface VacancyRequest {
  id: string;
  status: string;
}

export default function AdminOfficeDashboard() {
  const user = useAuthStore((s) => s.user);
  const { hiddenModules, hiddenItems } = useNavVisibility();
  const isHidden = (href: string) => !!user?.role && isPathHidden(href, user.role, hiddenModules, hiddenItems);
  const [vacancies, setVacancies] = useState<VacancyRequest[]>([]);

  useEffect(() => {
    fetch("/api/location/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
      .then((d) => setVacancies(d.vacancyRequests ?? []))
      .catch(() => setVacancies([]));
  }, []);

  const pending = vacancies.filter((v) => v.status === "PENDING_HR" || v.status === "PENDING_ADMIN").length;
  const approved = vacancies.filter((v) => v.status === "APPROVED").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name ?? "Admin Office"}`}
        description="Admin Office - location administrative support"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Total Requests</p>
            <p className="text-2xl font-semibold">{vacancies.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Pending</p>
            <p className="text-2xl font-semibold">{pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Approved</p>
            <p className="text-2xl font-semibold">{approved}</p>
          </CardContent>
        </Card>
      </div>

      {!isHidden("/admin-office/vacancies") && (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            Faculty Hiring Requests
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Raise a faculty vacancy for any location department. It routes through HR Admin and Administration for approval, same as a Dept Head&apos;s request.
          </p>
          <Button asChild className="shrink-0">
            <Link href="/admin-office/vacancies">
              View Requests
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
