import { redirect } from "next/navigation";

// Merged into the Curriculum journey's Subjects step. Kept as a redirect
// for any bookmarked links.
export default function AcademicsSubjectsRedirect() {
  redirect("/academics/course-structure?step=subjects");
}
