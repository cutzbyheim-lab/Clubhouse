import { createHashRouter, type RouteObject } from 'react-router';
import { modules } from './registry';
import { RouteError } from './RouteError';
import { Shell } from './Shell';

// Hash routing: the production renderer is loaded from file://.
const children: RouteObject[] = modules.map((m) => ({
  id: m.id,
  ...(m.path === '' ? { index: true } : { path: m.path }),
  errorElement: <RouteError />,
  lazy: async () => ({ Component: (await m.load()).default }),
}));

export const router = createHashRouter([
  {
    path: '/',
    element: <Shell />,
    errorElement: <RouteError />,
    // Shown for the first frame while the initial module's code loads.
    hydrateFallbackElement: <div className="h-full bg-ground" />,
    children,
  },
]);
