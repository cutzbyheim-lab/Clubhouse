import { Suspense, useEffect } from 'react';
import { Outlet } from 'react-router';
import { LoadingState } from '@/design/StateViews';
import { useProfile } from '@/stores/profile';
import { Rail } from './Rail';

export function Shell() {
  const load = useProfile((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full">
      <Rail />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Suspense fallback={<LoadingState label="Opening module" />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
