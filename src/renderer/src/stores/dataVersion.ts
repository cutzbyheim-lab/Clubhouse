import { create } from 'zustand';

/** Bumped after any write so every open query refetches. */
export const useDataVersion = create<{ version: number; bump: () => void }>()((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
