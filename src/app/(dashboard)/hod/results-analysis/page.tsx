"use client";

import { ResultsAnalysisView } from "@/components/exams/ResultsAnalysisView";

// The HOD's own departments only - the API limits the classes and branches.
export default function HodResultsAnalysisPage() {
  return <ResultsAnalysisView description="Published semester results of your department - pass percentages, SGPA, subject-wise performance, toppers and backlogs." />;
}
