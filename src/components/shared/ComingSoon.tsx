import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  icon: LucideIcon;
  title: string;
  description?: string;
  message?: string;
}

// Placeholder for a page whose module isn't cleared for this production
// launch yet - keeps the route resolving (no 404 for direct/bookmarked
// links) while the real feature stays hidden from nav.
export function ComingSoon({ icon: Icon, title, description, message = "This feature is coming soon" }: Props) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <Icon className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
