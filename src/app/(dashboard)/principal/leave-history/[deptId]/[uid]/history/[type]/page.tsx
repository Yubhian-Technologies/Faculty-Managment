"use client";

import { notFound } from "next/navigation";
import { use } from "react";
import { LeaveTypeHistoryView, parseLeaveHistoryFilter } from "@/components/leave/LeaveTypeHistoryView";

export default function PrincipalEmployeeLeaveTypeHistoryPage({
  params,
}: {
  params: Promise<{ deptId: string; uid: string; type: string }>;
}) {
  const { deptId, uid, type } = use(params);
  const filter = parseLeaveHistoryFilter(type);
  if (!filter) notFound();
  return <LeaveTypeHistoryView uid={uid} backHref={`/principal/leave-history/${deptId}/${uid}`} type={filter} showOtherLeaveCategory />;
}
