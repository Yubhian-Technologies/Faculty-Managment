"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Technical Staff lives under the Faculty module now - no separate sidebar
// entry (see navConfig.ts) - this tab strip is how HOD moves between the two
// sibling lists, which otherwise remain fully separate pages/routes.
// (Non-Technical Staff has its own, unrelated module under College Office.)
interface FacultyModuleTabsProps {
  facultyHref: string;
  supportingStaffHref: string;
}

export function FacultyModuleTabs({ facultyHref, supportingStaffHref }: FacultyModuleTabsProps) {
  const pathname = usePathname();
  const isSupportingStaff = pathname?.startsWith(supportingStaffHref) ?? false;

  const tabs = [
    { href: facultyHref, label: "Teaching Faculty", active: !isSupportingStaff },
    { href: supportingStaffHref, label: "Technical Staff", active: isSupportingStaff },
  ];

  return (
    <div className="flex gap-2 flex-wrap">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
            tab.active
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background border-border hover:bg-muted"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
