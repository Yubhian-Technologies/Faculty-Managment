"use client";

import { useParams } from "next/navigation";
import { FacultyIdentityEditPage } from "@/components/faculty/FacultyIdentityEditPage";

export default function EditHodFacultyIdentityPage() {
  const { id } = useParams<{ id: string }>();
  return <FacultyIdentityEditPage facultyId={id} detailHref={`/hod/faculty/${id}`} listHref="/hod/faculty" />;
}
