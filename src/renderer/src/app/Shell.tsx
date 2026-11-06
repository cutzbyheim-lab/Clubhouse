import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { LoadingState } from '@/design/StateViews';
import { Rail } from './Rail';

export function Shell() {
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
