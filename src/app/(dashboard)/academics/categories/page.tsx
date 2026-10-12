"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { CategoriesManager, categoryPrefillText } from "@/components/academics/CategoriesManager";
import { ArrowLeft } from "lucide-react";

// Academics > Categories. The dean defines each subject category once, as a
// short code and its full form. Course Structure files may then use either in
// their Category column; a code or name that isn't defined here is rejected
// before anything is imported. The Add/List/Edit/Delete UI itself lives in
// CategoriesManager, shared with the inline dialog Course Structure and
// Import Subjects open instead of linking out here.

export default function CategoriesPage() {
  return (
    <Suspense fallback={null}>
      <CategoriesPageInner />
    </Suspense>
  );
}

function CategoriesPageInner() {
  const searchParams = useSearchParams();
  // ?add=Audit Course|SEC pre-fills one "CODE: Full form" line per value, so
  // the categories a failed import named can be defined in one go.
  const initialText = categoryPrefillText((searchParams.get("add") ?? "").split("|"));

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Subject categories"
        description="Define each category as a short code and its full form. Course Structure files can then use the code or the full form in their Category column."
        actions={
          <Button variant="outline" asChild>
            <Link href="/academics"><ArrowLeft className="h-4 w-4 mr-1" />Back to Academics</Link>
          </Button>
        }
      />
      <CategoriesManager initialText={initialText} />
    </div>
  );
}
