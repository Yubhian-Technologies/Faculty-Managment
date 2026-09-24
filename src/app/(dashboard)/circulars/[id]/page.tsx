import { CircularViewer } from "@/components/circular/CircularViewer";
import { PageHeader } from "@/components/shared/PageHeader";
export default function CircularDashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Circular" description="View, download and print" />
      <CircularViewer />
    </div>
  );
}
