import { redirect } from "next/navigation";

// The Exam Cell's settings were all Mid set-up and now live on Mid Configuration;
// kept so old links and bookmarks still land there.
export default function ExamCellSettingsRedirect() {
  redirect("/exam-cell/mid-configuration");
}
