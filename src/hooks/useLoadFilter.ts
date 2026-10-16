"use client";

import { useCallback, useRef, useState } from "react";

/**
 * A filter bar that reads NOTHING until Load is pressed.
 *
 *  - `draft` is what the pickers show; editing it never touches the network.
 *  - `load()` freezes a copy of the draft as `applied` (with a fresh `nonce`, so
 *    pressing Load again with the same picks re-reads).
 *  - the page fetches from `applied` only - an effect keyed on `applied`, or a
 *    handler `load()` calls - so a half-chosen filter can never cost a read.
 *  - `dirty` is true while the pickers differ from what is on screen, so a page
 *    can say "filters changed - press Load".
 *
 * Page size / page number are NOT filters: they belong to the loaded result and
 * stay out of this hook.
 */
export interface LoadFilter<F extends object> {
  draft: F;
  /** Merge into the draft; never fetches. */
  setDraft: (patch: Partial<F> | ((d: F) => Partial<F>)) => void;
  /** The filters of the last Load (`null` until the first one). */
  applied: (F & { nonce: number }) | null;
  loaded: boolean;
  /** The pickers differ from what the last Load fetched. */
  dirty: boolean;
  load: () => void;
  reset: () => void;
}

export function useLoadFilter<F extends object>(initial: F): LoadFilter<F> {
  const initialRef = useRef(initial);
  const [draft, setDraftState] = useState<F>(initial);
  const draftRef = useRef(draft);
  const nonceRef = useRef(0);
  const [applied, setApplied] = useState<(F & { nonce: number }) | null>(null);

  const setDraft = useCallback((patch: Partial<F> | ((d: F) => Partial<F>)) => {
    setDraftState((d) => {
      const next = { ...d, ...(typeof patch === "function" ? patch(d) : patch) };
      draftRef.current = next;
      return next;
    });
  }, []);

  const load = useCallback(() => {
    nonceRef.current += 1;
    setApplied({ ...draftRef.current, nonce: nonceRef.current });
  }, []);

  const reset = useCallback(() => {
    draftRef.current = initialRef.current;
    setDraftState(initialRef.current);
    setApplied(null);
  }, []);

  const dirty =
    applied !== null &&
    (Object.keys(draft) as (keyof F)[]).some((k) => draft[k] !== (applied as F)[k]);

  return { draft, setDraft, applied, loaded: applied !== null, dirty, load, reset };
}
