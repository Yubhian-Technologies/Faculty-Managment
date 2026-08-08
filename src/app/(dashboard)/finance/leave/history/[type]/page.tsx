"use client";

import { notFound } from "next/navigation";
import { use } from "react";
import { LeaveTypeHistoryView, parseLeaveHistoryFilter } from "@/components/leave/LeaveTypeHistoryView";

export default function FinanceLeaveTypeHistoryPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params);
  const filter = parseLeaveHistoryFilter(type);
  if (!filter) notFound();
  return <LeaveTypeHistoryView backHref="/finance/leave" type={filter} />;
}
