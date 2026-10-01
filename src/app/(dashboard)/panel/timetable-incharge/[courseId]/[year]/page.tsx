import { redirect } from "next/navigation";

// Retired section picker: the section filter + Load lives on the Timetable page.
export default function Page() {
  redirect("/panel/timetable-incharge");
}
