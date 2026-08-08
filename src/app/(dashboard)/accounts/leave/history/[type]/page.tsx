"use client";

import { notFound } from "next/navigation";
import { use } from "react";
import { LeaveTypeHistoryView, parseLeaveHistoryFilter } from "@/components/leave/LeaveTypeHistoryView";

export default function AccountsLeaveTypeHistoryPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params);
  const filter = parseLeaveHistoryFilter(type);
  if (!filter) notFound();
  return <LeaveTypeHistoryView backHref="/accounts/leave" type={filter} />;
}
