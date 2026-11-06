import { RefreshCw, Sparkles } from 'lucide-react';
import type { PlayerAnalysis } from '@shared/schemas';
import type { AppError } from '@shared/ipc/result';
import { Button } from '@/design/Button';
import { ChatGptTag } from './ChatGpt';

const LEVEL: Record<PlayerAnalysis['body']['skill']['level'], string> = {
  beginner: 'Beginner',
  'high-handicap': 'High handicap',
  'mid-handicap': 'Mid handicap',
  'low-handicap': 'Low handicap',
  'scratch-or-better': 'Scratch or better',
  unclear: 'Unclear',
};

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
};

function Estimate({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-control border border-brass/25 bg-sunken px-4 py-3">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="figures mt-0.5 text-lg font-semibold text-ink">{value}</div>
      <div className="text-[11px] text-brass/90">{note}</div>
    </div>
  );
}

/**
 * ChatGPT's read of the golfer behind the bag. Everything here is an estimate
 * from equipment (and measured averages where they exist) and is styled in
 * brass, apart from the green used for measured data elsewhere.
 */
export function PlayerRead({
  analysis,
  connected,
  busy,
  error,
  bagSize,
  onAnalyze,
  onConnect,
}: {
  analysis: PlayerAnalysis | null;
  connected: boolean;
  busy: boolean;
  error: AppError | null;
  bagSize: number;
  onAnalyze: () => void;
  onConnect: () => void;
}) {
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <h2 className="figures text-lg font-semibold">What your bag says about you</h2>
        <ChatGptTag />
      </div>
      {connected && analysis && (
        <div className="flex items-center gap-3 text-xs text-ink-faint">
          <span>
            Read {ago(analysis.createdAt)} · {analysis.aiModel}
          </span>
          <Button busy={busy} onClick={onAnalyze} disabled={bagSize === 0}>
            <RefreshCw size={13} /> Read again
          </Button>
        </div>
      )}
    </div>
  );

  let body;
  if (!connected) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-xl text-sm text-ink-soft">
          Connect ChatGPT to identify your real clubs and get a read on your game from what you carry: likely level, swing speed, ball flight and what to
          look at next.
        </p>
        <Button variant="primary" onClick={onConnect}>
          <Sparkles size={14} /> Connect ChatGPT
        </Button>
      </div>
    );
  } else if (busy && !analysis) {
    body = <p className="animate-pulse text-sm text-ink-muted">ChatGPT is reading your bag…</p>;
  } else if (!analysis) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-xl text-sm text-ink-soft">
          {bagSize === 0
            ? 'Put clubs in the bag, then ChatGPT can read it.'
            : 'ChatGPT looks at the clubs you carry, their specs and your measured averages, and describes the golfer they suggest. Identify your clubs first for the sharpest read.'}
        </p>
        <Button variant="primary" busy={busy} disabled={bagSize === 0} onClick={onAnalyze}>
          <Sparkles size={14} /> Read my bag
        </Button>
      </div>
    );
  } else {
    const b = analysis.body;
    body = (
      <div className={`flex flex-col gap-5 transition-opacity ${busy ? 'opacity-50' : ''}`}>
        {analysis.stale && !busy && (
          <p className="text-xs text-brass">Your bag or numbers have changed since this read. Read again to bring it up to date.</p>
        )}
        <p className="figures text-xl leading-snug text-ink">{b.headline}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Estimate label="Likely level" value={b.skill.handicapRange === 'unclear' ? LEVEL[b.skill.level] : `${LEVEL[b.skill.level]} · ${b.skill.handicapRange}`} note="Estimate from your equipment" />
          <Estimate
            label="Driver swing speed"
            value={b.swingSpeed.driverSpeed}
            note={b.swingSpeed.basis === 'measured' ? 'From your measured club speed' : b.swingSpeed.basis === 'equipment' ? 'Estimate from shafts and lofts' : 'Not enough to tell'}
          />
          <Estimate label="Ball flight" value={b.ballFlight.tendency} note="Estimate from head design" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-soft">What stands out</h3>
            <ul className="flex flex-col gap-3">
              {b.traits.map((t) => (
                <li key={t.title} className="border-l-2 border-brass/40 pl-3">
                  <div className="text-sm font-medium text-ink">{t.title}</div>
                  <p className="text-sm text-ink-soft">{t.detail}</p>
                  {t.clubs.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.clubs.map((c) => (
                        <span key={c} className="figures rounded-full bg-overlay px-2 py-0.5 text-[11px] text-ink-muted">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-soft">Worth looking at</h3>
            <ol className="flex flex-col gap-3">
              {b.suggestions.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span className="figures mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-overlay text-[11px] text-ink-muted">{i + 1}</span>
                  <div>
                    <div className="text-sm font-medium text-ink">{s.title}</div>
                    <p className="text-sm text-ink-soft">{s.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <details className="mt-4 text-xs text-ink-muted">
              <summary className="cursor-pointer hover:text-ink">Why ChatGPT thinks this</summary>
              <div className="mt-2 flex flex-col gap-2">
                <p>
                  <span className="text-ink-soft">Level: </span>
                  {b.skill.reasoning}
                </p>
                <p>
                  <span className="text-ink-soft">Speed: </span>
                  {b.swingSpeed.reasoning}
                </p>
                <p>
                  <span className="text-ink-soft">Flight: </span>
                  {b.ballFlight.reasoning}
                </p>
              </div>
            </details>
          </div>
        </div>
        <p className="text-xs text-ink-faint">{b.caveats} These are ChatGPT’s estimates, not measurements; your measured numbers are on the club cards.</p>
      </div>
    );
  }

  return (
    <section className="rounded-panel border border-rule bg-raised p-5 shadow-[inset_0_1px_0_rgba(196,163,94,0.08)]">
      <div className="mb-4">{header}</div>
      {error && <p className="mb-3 text-sm text-hazard">{error.message}</p>}
      {body}
    </section>
  );
}
