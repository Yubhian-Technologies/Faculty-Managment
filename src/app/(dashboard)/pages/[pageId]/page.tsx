"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { BlockRenderer } from "@/components/customNav/BlockRenderer";
import { Skeleton } from "@/components/shared/SkeletonLoader";
import type { CustomPage } from "@/types";

// A Super-Admin-built page, opened from a custom sidebar tab. Access (enabled,
// the login's role, not switched off in nav visibility) is enforced by the API;
// a page the login may not see is indistinguishable from one that doesn't exist.
export default function CustomPageView() {
  const { pageId } = useParams<{ pageId: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["custom-page", pageId],
    queryFn: async () => {
      const res = await fetch(`/api/college/custom-nav/pages/${encodeURIComponent(pageId)}`, { cache: "no-store" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to load page");
      return ((await res.json()) as { page: CustomPage }).page;
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return <div className="space-y-4 max-w-3xl"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
  }
  if (isError) return <p className="text-sm text-destructive">This page could not be loaded. Please try again.</p>;
  if (!data) return <p className="text-sm text-muted-foreground">This page isn&apos;t available.</p>;

  return (
    <div className="space-y-6">
      <PageHeader title={data.title} />
      <BlockRenderer blocks={data.blocks} />
    </div>
  );
}
