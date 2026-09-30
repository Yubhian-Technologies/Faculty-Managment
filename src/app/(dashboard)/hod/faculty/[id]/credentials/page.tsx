"use client";

import { useParams } from "next/navigation";
import { FacultyCredentialsPage } from "@/components/faculty/FacultyCredentialsPage";

export default function HodFacultyCredentialsPage() {
  const { id } = useParams<{ id: string }>();
  return <FacultyCredentialsPage facultyId={id} listHref="/hod/faculty" />;
}
