"use client";

import { use } from "react";
import { CareersPageClient } from "./CareersPageClient";

interface Props {
  params: Promise<{ collegeId: string }>;
}

export default function CareersPage({ params }: Props) {
  const { collegeId } = use(params);
  return <CareersPageClient collegeId={collegeId} />;
}
