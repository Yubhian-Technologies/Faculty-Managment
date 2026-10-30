"use client";

import Link from "next/link";
import { useMemo } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { NavIcon } from "@/components/layout/NavIcon";
import { filterVisibleNavItems, getCollegeAdminNavItems } from "@/components/layout/navConfig";
import { groupNavItems } from "@/components/layout/navGroups";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { useNavVisibility } from "@/hooks/useNavVisibility";

// College Admin's home: a role-login with no person behind it, so no greeting by name and nothing
// personal. It lists what the college admin can open - the same menu as the sidebar (same list, same Nav
// Visibility settings, R&D included) - under the same module headings.

export default function CollegeAdminHome() {
  const { collegeInfo } = useCollegeInfo();
  const { hiddenModules, hiddenItems } = useNavVisibility();

  const groups = useMemo(
    () => groupNavItems(
      filterVisibleNavItems(getCollegeAdminNavItems(), hiddenModules, hiddenItems, "COLLEGE_ADMIN", true).filter((i) => i.href !== "/college-admin")
    ),
    [hiddenModules, hiddenItems]
  );

  return (
    <div className="space-y-6">
      <PageHeader title="College Admin" description={collegeInfo?.name ?? "Your college"} />

      {groups.map((g, gi) => (
        <section key={`${g.title ?? "top"}-${gi}`} className="space-y-2">
          {g.title && <h2 className="text-sm font-semibold text-muted-foreground">{g.title}</h2>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((item) => (
              <Link key={item.href} href={item.href}>
                <Card className="h-full transition-colors hover:bg-muted/50">
                  <CardContent className="flex items-center gap-3 py-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <NavIcon name={item.iconName} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 text-sm font-medium">{item.label}</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
