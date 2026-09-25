"use client";

import { useParams, useRouter } from "next/navigation";
import { SectionRoster } from "@/components/academics/SectionRoster";

export default function PrincipalSectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  return <SectionRoster sectionId={id} onBack={() => router.push("/principal/courses?tab=sections")} />;
}
