"use client";

import { InternalMarksEntry } from "@/components/exams/InternalMarksEntry";
import { EmptyState } from "@/components/shared/EmptyState";
import { useAuth } from "@/hooks/useAuth";

// College Admin > Internal Marks > Enter on Behalf (reached at /college-admin/internal-marks/enter).
export default function EnterMarksOnBehalfPage() {
  const { user } = useAuth();
  if (user && user.realRole !== "COLLEGE_ADMIN") return <EmptyState title="Only the College Admin can enter marks on a faculty member's behalf." />;
  return <InternalMarksEntry onBehalf />;
}
