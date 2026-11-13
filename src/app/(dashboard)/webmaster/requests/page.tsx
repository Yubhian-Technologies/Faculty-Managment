"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { EmailRequestQueue } from "../EmailRequestQueue";

export default function WebmasterRequestsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Requests"
        description="Pending official email requests for your college."
      />
      <EmailRequestQueue
        status="PENDING"
        emptyTitle="No pending requests"
        emptyDescription="The College Office raises a request once a candidate joins — new ones will show up here."
      />
    </div>
  );
}
