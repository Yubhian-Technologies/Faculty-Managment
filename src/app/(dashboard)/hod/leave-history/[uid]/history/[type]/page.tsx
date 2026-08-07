"use client";

import { notFound } from "next/navigation";
import { use } from "react";
import { LeaveTypeHistoryView, parseLeaveHistoryFilter } from "@/components/leave/LeaveTypeHistoryView";

export default function HodEmployeeLeaveTypeHistoryPage({
  params,
}: {
  params: Promise<{ uid: string; type: string }>;
}) {
  const { uid, type } = use(params);
  const filter = parseLeaveHistoryFilter(type);
  if (!filter) notFound();
  return <LeaveTypeHistoryView uid={uid} backHref={`/hod/leave-history/${uid}`} type={filter} />;
}
