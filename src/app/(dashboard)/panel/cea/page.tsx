"use client";

import { use } from "react";
import { CeaMarks } from "@/components/cea/CeaMarks";

// Faculty > CIE Marks: Continuous Evaluation marks, unit by unit, for each section taught.
// ?assignment=...&unit=n (the link from Mid Marks) opens that unit's sheet directly.
export default function PanelCeaPage({ searchParams }: { searchParams: Promise<{ assignment?: string; unit?: string }> }) {
  const sp = use(searchParams);
  const unit = Number(sp.unit);
  const start = sp.assignment && Number.isInteger(unit) && unit > 0 ? { assignmentId: sp.assignment, unit } : null;
  return <CeaMarks start={start} />;
}
