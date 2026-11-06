import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  railCollapsed: boolean;
  toggleRail: () => void;
}

/** Window-chrome preferences. Golf data never lives here — it lives in SQLite. */
export const useUi = create<UiState>()(
  persist(
    (set) => ({
      railCollapsed: false,
      toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
    }),
    { name: 'clubhouse.ui' },
  ),
);
