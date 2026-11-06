import { Check, TriangleAlert, X } from 'lucide-react';
import { useToasts } from '@/stores/toasts';

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-center gap-2.5 rounded-full border bg-overlay py-2 pr-2 pl-3.5 text-sm text-ink shadow-[0_8px_30px_rgba(0,0,0,0.45)] ${
            t.leaving ? 'animate-toast-out' : 'animate-toast-in'
          } ${t.tone === 'done' ? 'border-fairway/60' : 'border-hazard/50'}`}
        >
          {t.tone === 'done' ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-fairway">
              <Check size={12} strokeWidth={3} aria-hidden />
            </span>
          ) : (
            <TriangleAlert size={15} className="text-hazard" aria-hidden />
          )}
          <span>{t.message}</span>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded-full p-1 text-ink-muted hover:bg-raised hover:text-ink">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
