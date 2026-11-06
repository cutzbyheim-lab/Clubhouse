import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { X } from 'lucide-react';

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-control border border-rule bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors ${
            o.value === value ? 'bg-overlay text-ink' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SampleBadge({ show = true }: { show?: boolean }) {
  if (!show) return null;
  return (
    <span className="rounded-full border border-brass/50 px-1.5 py-px text-[10px] font-medium text-brass" title="Sample data">
      Sample
    </span>
  );
}

const inputCls =
  'rounded-control border border-rule-strong bg-sunken px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-green-speed focus:outline-none disabled:opacity-50';

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | undefined; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-ink-soft">
        {label}
      </label>
      {children(id)}
      {error ? <span className="text-xs text-hazard">{error}</span> : hint ? <span className="text-xs text-ink-faint">{hint}</span> : null}
    </div>
  );
}

/** Full width unless the caller sets its own width class. */
const widthed = (extra?: string) => `${inputCls} ${extra && /(^|\s)w-/.test(extra) ? '' : 'w-full'} ${extra ?? ''}`;

export const TextInput = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={widthed(p.className)} />;

export const Select = ({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={widthed(p.className)}>
    {children}
  </select>
);

/** Side panel for editing. Esc and backdrop close it; focus moves into it on open. */
export function Drawer({ open, title, onClose, children, footer, width = 460 }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} style={{ width: `min(${width}px, 100vw)` }} className="relative flex h-full flex-col border-l border-rule bg-raised shadow-2xl">
        <div className="flex items-center justify-between border-b border-rule px-6 py-4">
          <h2 className="figures text-xl font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-control p-1 text-ink-muted hover:bg-overlay hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-rule px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

/** Thin horizontal meter, e.g. a percentage. */
export function Meter({ value, max = 1, color = 'var(--color-green-speed)' }: { value: number; max?: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken" aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%`, background: color }} />
    </div>
  );
}
