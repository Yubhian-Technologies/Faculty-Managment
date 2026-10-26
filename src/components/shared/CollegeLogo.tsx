"use client";

import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { VISHNU_LOGO_URL } from "@/lib/pdf/logo";

/** The college's own logo when it has set one, otherwise the default Vishnu logo. */
export function CollegeLogo({ className, alt }: { className?: string; alt?: string }) {
  const { collegeInfo } = useCollegeInfo();
  const src = collegeInfo?.hasCustomLogo && collegeInfo.logoUrl ? collegeInfo.logoUrl : VISHNU_LOGO_URL;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt ?? (collegeInfo?.name ? `${collegeInfo.name} logo` : "Logo")} className={className} />;
}
