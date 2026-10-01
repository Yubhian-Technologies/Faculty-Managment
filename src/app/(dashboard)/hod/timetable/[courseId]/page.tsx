import { redirect } from "next/navigation";

// Retired year picker: Course / Year / Section are filters on the Timetable page.
export default function Page() {
  redirect("/hod/timetable");
}
