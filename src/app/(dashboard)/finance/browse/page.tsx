"use client";

import { LocationBrowserList } from "@/components/shared/LocationCollegeBrowser";

// Top level of the Location → College browse hierarchy — lets Finance (a
// cross-college GLOBAL role) drill from the org's broadest view down to a
// specific college's budget/indent activity.
export default function FinanceBrowseLocationsPage() {
  return <LocationBrowserList basePath="/finance/browse" />;
}
