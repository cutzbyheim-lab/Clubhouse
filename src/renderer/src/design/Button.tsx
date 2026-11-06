import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'quiet' | 'danger';

const STYLES: Record<Variant, string> = {
  primary: 'bg-fairway text-ink hover:bg-[#35784f] border border-fairway',
  quiet: 'border border-rule-strong text-ink-soft hover:bg-overlay hover:text-ink',
  danger: 'border border-rule-strong text-hazard hover:bg-overlay',
};

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
      className={`inline-flex items-center gap-2 rounded-control px-3.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${STYLES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
