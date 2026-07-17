"use client";

import { LocationBrowserList } from "@/components/shared/LocationCollegeBrowser";

// Top level of the Location → College → Department browse hierarchy — lets
// Purchase Dept (a cross-college GLOBAL role) drill from the org's broadest
// view down to a specific department's requests.
export default function PurchaseBrowseLocationsPage() {
  return <LocationBrowserList basePath="/purchase/browse" />;
}
