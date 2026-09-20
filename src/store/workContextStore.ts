import { create } from "zustand";
import { persist } from "zustand/middleware";

// Which "Working as" context each login last chose (see navConfig's
// getWorkContexts), remembered per browser. Keyed by uid so two people sharing
// a machine don't inherit each other's choice.
interface WorkContextState {
  chosen: Record<string, string>;
  choose: (uid: string, key: string) => void;
}

export const useWorkContextStore = create<WorkContextState>()(
  persist(
    (set) => ({
      chosen: {},
      choose: (uid, key) => set((s) => ({ chosen: { ...s.chosen, [uid]: key } })),
    }),
    { name: "fms-work-context" }
  )
);
