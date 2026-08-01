"use client";

import { ClipboardList } from "lucide-react";
import { ComingSoon } from "@/components/shared/ComingSoon";

export default function PrincipalIndentsPage() {
  return (
    <ComingSoon
      icon={ClipboardList}
      title="Budget History"
      description="Past indent requests raised by departments"
    />
  );
}
