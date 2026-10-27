"use client";

import Link from "next/link";
import { UserCheck, Settings2, Tags, UserCog } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthStore } from "@/store/authStore";

// Reached from the gear in the top bar. Department-wide settings of the HOD.
export default function HodSettingsPage() {
  const realRole = useAuthStore((s) => s.user?.realRole);
  const items = [
    { href: "/hod/settings/class-representatives", label: "Class Representatives", description: "How many Class Representatives each section of the department has", icon: UserCheck },
    { href: "/hod/settings/sub-departments", label: "Sub-Departments", description: "Branches grouped under your department", icon: Settings2 },
    { href: "/hod/settings/designations", label: "Designations", description: "Designations used in the department", icon: Tags },
    // Appointing the Department Office head stays with the actual HOD (as in the sidebar).
    ...(realRole === "DEPARTMENT_OFFICE" ? [] : [{ href: "/hod/settings/department-office", label: "Department Office", description: "Who runs the department office", icon: UserCog }]),
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Settings that apply to the department" />
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map(({ href, label, description, icon: Icon }) => (
          <Link key={href} href={href}>
            <Card className="h-full transition-colors hover:bg-muted/40">
              <CardContent className="flex items-start gap-3 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span>
                <div>
                  <p className="font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
