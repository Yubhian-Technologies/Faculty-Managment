import { redirect } from "next/navigation";

// Merged into the Curriculum journey's Syllabus step. Kept as a redirect
// for any bookmarked links.
export default function AcademicsSyllabusRedirect() {
  redirect("/academics/course-structure?step=syllabus");
}
