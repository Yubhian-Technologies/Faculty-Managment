"use client";

import { useSearchParams } from "next/navigation";
import { RETURN_PARAM, safeReturnTo } from "@/lib/faculty/returnTo";

/** The validated `?from=` list URL, or null. Callers must sit under <Suspense>. */
export function useReturnTo(): string | null {
  return safeReturnTo(useSearchParams().get(RETURN_PARAM));
}
