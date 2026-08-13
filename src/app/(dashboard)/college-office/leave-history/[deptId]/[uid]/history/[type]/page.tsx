"use client";

import { notFound } from "next/navigation";
import { use } from "react";
import { LeaveTypeHistoryView, parseLeaveHistoryFilter } from "@/components/leave/LeaveTypeHistoryView";

export default function CollegeOfficeEmployeeLeaveTypeHistoryPage({
  params,
}: {
  params: Promise<{ deptId: string; uid: string; type: string }>;
}) {
  const { deptId, uid, type } = use(params);
  const filter = parseLeaveHistoryFilter(type);
  if (!filter) notFound();
  return <LeaveTypeHistoryView uid={uid} backHref={`/college-office/leave-history/${deptId}/${uid}`} type={filter} />;
}
