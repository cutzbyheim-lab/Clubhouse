import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'quiet' | 'danger';

const STYLES: Record<Variant, string> = {
  primary: 'bg-fairway text-ink hover:bg-[#35784f] border border-fairway shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
  quiet: 'border border-rule-strong text-ink-soft hover:bg-overlay hover:text-ink',
  danger: 'border border-rule-strong text-hazard hover:bg-overlay',
};

/** Small ring shown while an action is running. */
export function Spinner({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className="animate-spin" aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  variant = 'quiet',
  busy = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled === true || busy}
      aria-busy={busy}
      className={`relative inline-flex items-center gap-2 rounded-control px-3.5 py-1.5 text-sm font-medium transition-[background-color,color,transform,opacity] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${
        busy ? 'disabled:opacity-80' : ''
      } ${STYLES[variant]} ${className}`}
    >
      {busy && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </span>
      )}
      <span className={`inline-flex items-center gap-2 ${busy ? 'invisible' : ''}`}>{children}</span>
    </button>
  );
}
