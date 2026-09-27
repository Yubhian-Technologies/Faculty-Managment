"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Building2, ClipboardList, Settings2, CalendarCheck, FileText, UsersRound, ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { LocationCollegeSelect } from "@/components/shared/LocationCollegeSelect";
import { useAuthStore } from "@/store/authStore";
import { useNavVisibility } from "@/hooks/useNavVisibility";
import { isPathHidden } from "@/components/layout/navConfig";

interface CollegeOption { id: string; name?: string; isActive?: boolean }

export default function AdministrationDashboard() {
  const user = useAuthStore((s) => s.user);
  const { hiddenModules, hiddenItems } = useNavVisibility();
  const isHidden = (href: string) => !!user?.role && isPathHidden(href, user.role, hiddenModules, hiddenItems);
  const [pendingVacancies, setPendingVacancies] = useState<number | null>(null);
  const [pendingInterviews, setPendingInterviews] = useState<number | null>(null);
  const [pendingOffers, setPendingOffers] = useState<number | null>(null);
  const [selectedCollegeId, setSelectedCollegeId] = useState("");
  const [colleges, setColleges] = useState<CollegeOption[]>([]);

  useEffect(() => {
    fetch("/api/location/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: unknown[] }>)
      .then((d) => setPendingVacancies(d.vacancyRequests?.length ?? 0))
      .catch(() => {});

    fetch("/api/location/interviews")
      .then((r) => r.json() as Promise<{ interviews: unknown[] }>)
      .then((d) => setPendingInterviews(d.interviews?.length ?? 0))
      .catch(() => {});

    fetch("/api/location/offers")
      .then((r) => r.json() as Promise<{ offers: unknown[] }>)
      .then((d) => setPendingOffers(d.offers?.length ?? 0))
      .catch(() => {});

    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: CollegeOption[] }>)
      .then((d) => setColleges(d.colleges ?? []))
      .catch(() => {});
  }, []);

  const selectedCollegeName = colleges.find((c) => c.id === selectedCollegeId)?.name ?? "";
  const collegeQuery = selectedCollegeId
    ? `?collegeId=${selectedCollegeId}&collegeName=${encodeURIComponent(selectedCollegeName)}`
    : "";

  const hiringActions = [
    { label: "Hiring Requests", href: `/administration/vacancies${collegeQuery}`, baseHref: "/administration/vacancies", icon: ClipboardList, desc: `${pendingVacancies ?? "…"} pending from HR Admin` },
    { label: "Interview Plans", href: `/administration/interviews${collegeQuery}`, baseHref: "/administration/interviews", icon: CalendarCheck, desc: `${pendingInterviews ?? "…"} plans awaiting approval` },
    { label: "Offer Letters", href: `/administration/offers${collegeQuery}`, baseHref: "/administration/offers", icon: FileText, desc: `${pendingOffers ?? "…"} offer letters to approve` },
  ].filter((a) => !isHidden(a.baseHref));

  const managementActions = [
    { label: "Location Users", href: "/administration/users", baseHref: "/administration/users", icon: Users, desc: "Provision Staff Admin, HR Admin, Accounts & Dept Heads" },
    { label: "Departments & Heads", href: "/location-staff-admin/departments", baseHref: "/location-staff-admin/departments", icon: Settings2, desc: "Manage campus departments and appoint Dept Heads" },
    { label: "Campus Staff Directory", href: "/location-staff-admin/staff", baseHref: "/location-staff-admin/staff", icon: UsersRound, desc: "Browse full staff roster with filters & detailed profiles" },
    { label: "Staff Attendance", href: "/location-staff-admin/attendance", baseHref: "/location-staff-admin/attendance", icon: ClipboardCheck, desc: "Campus-wide check-in / check-out daily attendance records" },
    { label: "Colleges", href: `/administration/colleges${collegeQuery}`, baseHref: "/administration/colleges", icon: Building2, desc: "View colleges & assign Principals" },
  ].filter((a) => !isHidden(a.baseHref));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.name ?? "Admin"}`}
        description="Location-level administration overview"
      />

      <div className="flex flex-col gap-1.5 sm:max-w-xs">
        <Label className="text-xs text-muted-foreground">Filter by college</Label>
        <LocationCollegeSelect allowEmpty value={selectedCollegeId} onChange={setSelectedCollegeId} placeholder="All Colleges" />
      </div>

      <div className="space-y-5">
        {hiringActions.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Hiring Approvals</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {hiringActions.map((action) => (
                <Card key={action.href} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <action.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{action.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{action.desc}</p>
                      <Button asChild size="sm" variant="outline" className="mt-3">
                        <Link href={action.href}>Review</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {managementActions.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Location Staff & Campus Operations</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {managementActions.map((action) => (
                <Card key={action.href} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <action.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{action.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{action.desc}</p>
                      <Button asChild size="sm" variant="outline" className="mt-3">
                        <Link href={action.href}>Open</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
