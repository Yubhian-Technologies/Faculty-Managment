"use client";

import { NewCandidateForm } from "@/components/hiring/NewCandidateForm";

export default function HrNewCandidatePage() {
  return <NewCandidateForm basePath="/hr" afterAttachPath="/hr/applications" />;
}
