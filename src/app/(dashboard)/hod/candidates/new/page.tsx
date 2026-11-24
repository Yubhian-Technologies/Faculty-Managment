"use client";

import { NewCandidateForm } from "@/components/hiring/NewCandidateForm";

export default function NewCandidatePage() {
  return <NewCandidateForm basePath="/hod" afterAttachPath="/hod/pipeline" />;
}
