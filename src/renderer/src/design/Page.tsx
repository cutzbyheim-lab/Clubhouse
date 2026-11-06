import type { ReactNode } from 'react';

export function Page({
  title,
  lede,
  actions,
  children,
}: {
  title: string;
  lede?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-end justify-between gap-6 border-b border-rule px-10 pt-9 pb-6">
        <div>
          <h1 className="figures text-3xl leading-tight font-semibold text-ink">{title}</h1>
          {lede ? <p className="mt-1 max-w-[70ch] text-ink-muted">{lede}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="flex-1 px-10 py-8">{children}</div>
    </div>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-panel border border-rule bg-raised ${className}`}>{children}</section>
  );
}
