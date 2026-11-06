import { Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Toaster } from '@/design/Toaster';
import { LoadingState } from '@/design/StateViews';
import { useProfile } from '@/stores/profile';
import { Rail } from './Rail';

export function Shell() {
  const load = useProfile((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  // Each module opens at the top, easing in, so the change of place reads clearly.
  useEffect(() => main.current?.scrollTo({ top: 0 }), [pathname]);

  return (
    <div className="flex h-full">
      <Rail />
      <main ref={main} className="min-w-0 flex-1 overflow-y-auto">
        <div key={pathname} className="flex min-h-full animate-route-in flex-col *:flex-1">
          <Suspense fallback={<div className="px-10 py-8"><LoadingState label="Opening module" /></div>}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <Toaster />
    </div>
  );
}
