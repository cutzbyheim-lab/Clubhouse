import { useMatches } from 'react-router';
import { EmptyState } from '@/design/StateViews';
import { Page } from '@/design/Page';
import { modules } from './registry';

/**
 * Stand-in page for a module whose implementation has not landed yet.
 * Removed module by module as each one is built.
 */
export default function ModulePending() {
  const id = useMatches().at(-1)?.id;
  const mod = modules.find((m) => m.id === id);
  if (!mod) return null;
  return (
    <Page title={mod.title} lede={mod.lede}>
      <EmptyState title="Not built yet">
        <p>
          The {mod.title.toLowerCase()} module is registered and routed. Its screens arrive in an upcoming build
          phase.
        </p>
      </EmptyState>
    </Page>
  );
}
