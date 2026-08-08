"use client";

import { usePathname } from "next/navigation";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";

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

  return (
    <SegmentedTabs
      value={isSupportingStaff ? "supporting" : "faculty"}
      options={[
        { key: "faculty", label: "Teaching Faculty", href: facultyHref },
        { key: "supporting", label: "Technical Staff", href: supportingStaffHref },
      ]}
    />
  );
}
