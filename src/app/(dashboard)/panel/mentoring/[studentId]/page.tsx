"use client";

import { useParams } from "next/navigation";
import { MenteeProgress } from "@/components/mentoring/MenteeProgress";

export default function PanelMenteePage() {
  const { studentId } = useParams<{ studentId: string }>();
  return <MenteeProgress studentId={studentId} backHref="/panel/mentoring" />;
}
