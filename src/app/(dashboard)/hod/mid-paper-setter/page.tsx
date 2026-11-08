import { redirect } from "next/navigation";

// The old Mid Paper Setter page is gone: setters are assigned per deadline on Mid Question Papers / Bank
// ("The HOD assigns"). Kept only so old links and bookmarks land there.
export default function MidPaperSetterMovedPage() {
  redirect("/hod/question-banks");
}
