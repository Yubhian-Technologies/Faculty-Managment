"use client";

import { ResultsAnalysisView } from "@/components/exams/ResultsAnalysisView";

// The HOD's own departments only - the API limits the classes and branches.
export default function HodResultsAnalysisPage() {
  return <ResultsAnalysisView description="Analyze published semester results, including pass percentages, SGPA, subject-wise performance, top performers, and backlogs." />;
}
