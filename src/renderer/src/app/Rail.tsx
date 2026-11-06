import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Segmented } from '@/design/controls';
import { useProfile } from '@/stores/profile';
import { useUi } from '@/stores/ui';
import { MODULE_GROUPS } from './module';
import { UpdateBadge } from './UpdateBadge';
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
  const profile = useProfile((s) => s.profile);
  const update = useProfile((s) => s.update);
  const list = useRef<HTMLDivElement>(null);
  const location = useLocation();
  // One highlight that glides to the current module rather than jumping.
  const [mark, setMark] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const place = () => {
      const a = el.querySelector<HTMLElement>('a[aria-current="page"]');
      setMark(a ? { top: a.offsetTop, height: a.offsetHeight } : null);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [location.pathname, collapsed]);

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

      <div ref={list} className="relative flex-1 overflow-y-auto px-2 py-3">
        {mark && (
          <span
            aria-hidden
            className="absolute right-2 left-2 rounded-control bg-fairway-deep shadow-[inset_2px_0_0_var(--color-green-speed)] transition-[top,height] duration-300 ease-(--ease-out)"
            style={{ top: mark.top, height: mark.height }}
          />
        )}
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
                        `relative flex items-center gap-3 rounded-control px-2.5 py-2 text-sm transition-colors duration-150 ${
                          isActive ? 'text-ink' : 'text-ink-soft hover:bg-raised/70 hover:text-ink'
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

      <UpdateBadge collapsed={collapsed} />
      {!collapsed && profile && (
        <div className="mx-3 mb-1 flex items-center justify-between border-t border-rule pt-3">
          <span className="text-xs text-ink-faint">Distances</span>
          <Segmented
            label="Distance unit"
            value={profile.distanceUnit}
            options={[
              { value: 'yards', label: 'yd' },
              { value: 'metres', label: 'm' },
            ]}
            onChange={(v) => void update({ distanceUnit: v, speedUnit: v === 'yards' ? 'mph' : 'kmh' })}
          />
        </div>
      )}
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
