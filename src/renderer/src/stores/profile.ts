import { create } from 'zustand';
import { distanceSuffix, speedSuffix, toDistance, toSpeed } from '@shared/domain/units';
import type { PlayerProfile, PlayerProfileUpdate } from '@shared/schemas';
import { call } from '@/lib/api';
import { useDataVersion } from './dataVersion';

interface ProfileState {
  profile: PlayerProfile | null;
  load: () => Promise<void>;
  update: (patch: PlayerProfileUpdate) => Promise<void>;
}

export const useProfile = create<ProfileState>()((set) => ({
  profile: null,
  load: async () => {
    const res = await call('profile.get', {});
    if (res.ok) set({ profile: res.data });
  },
  update: async (patch) => {
    const res = await call('profile.update', patch);
    if (res.ok) {
      set({ profile: res.data });
      useDataVersion.getState().bump();
    }
  },
}));

/** Unit-aware formatters driven by the player's preferences. */
export function useUnits() {
  const profile = useProfile((s) => s.profile);
  const du = profile?.distanceUnit ?? 'yards';
  const su = profile?.speedUnit ?? 'mph';
  return {
    du,
    su,
    dSuffix: distanceSuffix(du),
    sSuffix: speedSuffix(su),
    /** Metres → display number. */
    d: (m: number) => toDistance(m, du),
    /** Metres → "146 yd". Null → "—". */
    dist: (m: number | null | undefined, digits = 0) =>
      m === null || m === undefined ? '—' : `${toDistance(m, du).toFixed(digits)} ${distanceSuffix(du)}`,
    speed: (mps: number | null | undefined, digits = 0) =>
      mps === null || mps === undefined ? '—' : `${toSpeed(mps, su).toFixed(digits)} ${speedSuffix(su)}`,
    s: (mps: number) => toSpeed(mps, su),
  };
}
