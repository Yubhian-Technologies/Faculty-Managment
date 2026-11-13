import { useQuery } from "@tanstack/react-query";
import type { HiringBatch } from "@/types";

export type NavHiringBatch = HiringBatch & { id: string };

// One shared read of a hiring-batches list for the navigation hooks (interviews badge, coordinator link),
// so the sidebar, mobile drawer and bottom bar don't each fetch it.
export function useHiringBatchesList(url: string, uid: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["nav", "hiringBatches", url, uid ?? ""],
    queryFn: async () => {
      const r = await fetch(url);
      const d = (await r.json()) as { batches?: NavHiringBatch[] };
      return d.batches ?? [];
    },
    enabled,
    staleTime: 60_000,
  });
}
