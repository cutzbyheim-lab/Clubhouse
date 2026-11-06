import { NavLink } from 'react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useUi } from '@/stores/ui';
import { MODULE_GROUPS } from './module';
import { modules } from './registry';

/** Concentric green contours — the one decorative flourish in the chrome. */
function Contours() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 240 120"
      className="pointer-events-none absolute inset-0 h-full w-full text-fairway opacity-40"
      preserveAspectRatio="xMidYMid slice"
    >
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <ellipse
          key={i}
          cx={196}
          cy={64}
          rx={22 + i * 19}
          ry={12 + i * 11}
          transform={`rotate(${-14 + i * 2.5} 196 64)`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}

export function Rail() {
  const collapsed = useUi((s) => s.railCollapsed);
  const toggle = useUi((s) => s.toggleRail);

  return (
    <nav
      aria-label="Modules"
      className={`flex shrink-0 flex-col border-r border-rule bg-sunken transition-[width] duration-200 ${
        collapsed ? 'w-[60px]' : 'w-[232px]'
      }`}
    >
      <div className="relative h-[88px] overflow-hidden border-b border-rule">
        {!collapsed && <Contours />}
        <div className="relative flex h-full items-end px-4 pb-4">
          {collapsed ? (
            <span className="figures text-xl font-bold text-green-speed">C</span>
          ) : (
            <span className="figures text-2xl font-bold tracking-tight text-ink">Clubhouse</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {MODULE_GROUPS.map((group) => {
          const items = modules.filter((m) => m.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="mb-4">
              {!collapsed && group !== 'Overview' && (
                <div className="px-2 pb-1 text-xs font-medium text-ink-faint">{group}</div>
              )}
              <ul className="flex flex-col gap-0.5">
                {items.map(({ id, path, title, icon: Icon }) => (
                  <li key={id}>
                    <NavLink
                      to={`/${path}`}
                      end={path === ''}
                      title={collapsed ? title : undefined}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-control px-2.5 py-2 text-sm transition-colors ${
                          isActive
                            ? 'bg-fairway-deep text-ink shadow-[inset_2px_0_0_var(--color-green-speed)]'
                            : 'text-ink-soft hover:bg-raised hover:text-ink'
                        }`
                      }
                    >
                      <Icon size={17} strokeWidth={1.75} className="shrink-0" aria-hidden />
                      {!collapsed && <span className="truncate">{title}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="m-2 flex items-center gap-3 rounded-control px-2.5 py-2 text-sm text-ink-muted hover:bg-raised hover:text-ink"
      >
        {collapsed ? <PanelLeftOpen size={17} aria-hidden /> : <PanelLeftClose size={17} aria-hidden />}
        {!collapsed && <span>Collapse</span>}
      </button>
    </nav>
  );
}
