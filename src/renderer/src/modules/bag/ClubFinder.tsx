import { useEffect, useState } from 'react';
import { ExternalLink, RotateCcw, Search, X } from 'lucide-react';
import type { ClubKind, ClubLookup, ClubModelInfo, SpecOption, StockShaft } from '@shared/schemas';
import type { AppError } from '@shared/ipc/result';
import { Button } from '@/design/Button';
import { Select, TextInput } from '@/design/controls';
import { call } from '@/lib/api';
import { ChatGptTag, ConnectForm, useAiStatus } from './ChatGpt';

export const CATEGORY_LABEL: Record<ClubLookup['playerCategory'], string> = {
  tour: 'Tour / elite',
  players: 'Players',
  'players-distance': 'Players distance',
  'game-improvement': 'Game improvement',
  'super-game-improvement': 'Max forgiveness',
  unknown: 'Category unknown',
};

const CONFIDENCE: Record<ClubLookup['confidence'], string> = { high: 'Confident match', medium: 'Probable match', low: 'Unsure match' };

const fmt = (n: number | null, digits = 1, suffix = '') => (n === null ? '—' : `${Number(n.toFixed(digits))}${suffix}`);
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function SourceList({ sources }: { sources: ClubModelInfo['sources'] }) {
  if (sources.length === 0) return <p className="text-xs text-ink-faint">No web sources were returned for this answer, so double-check the specs.</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {sources.slice(0, 6).map((s) => (
        <li key={s.url}>
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            title={s.title || s.url}
            className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-rule px-2 py-0.5 text-[11px] text-ink-muted hover:border-rule-strong hover:text-ink"
          >
            <ExternalLink size={10} aria-hidden />
            <span className="truncate">{host(s.url)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export interface Applied {
  info: ClubModelInfo;
  lookup: ClubLookup;
  option: SpecOption | null;
  shaft: StockShaft | null;
}

/**
 * "Find your real club": the player types a club, ChatGPT researches it on the
 * web and returns the manufacturer's specs with sources, and the player picks
 * which loft and shaft they have.
 */
export function ClubFinder({
  kind,
  label,
  loft,
  current,
  onApply,
  onForget,
}: {
  kind: ClubKind;
  label: string;
  /** The loft currently in the form, to pre-select the matching version. */
  loft: number | null;
  current: ClubModelInfo | null;
  onApply: (a: Applied) => void;
  onForget: () => void;
}) {
  const status = useAiStatus();
  const connected = (status.status === 'ready' || status.status === 'empty') && status.data.connected;
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [result, setResult] = useState<ClubLookup | null>(null);
  const [optionIx, setOptionIx] = useState(0);
  const [shaftIx, setShaftIx] = useState(-1);
  const [searching, setSearching] = useState(current === null);

  useEffect(() => setSearching(current === null), [current]);

  const lookup = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await call('ai.lookupClub', { query, kind, label: label.trim() || null });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setResult(res.data);
    // Pre-select the version that matches the club's current loft, or its name (e.g. "7 Iron").
    const opts = res.data.specOptions;
    const byLoft = loft === null ? -1 : opts.findIndex((o) => o.loftDeg !== null && Math.abs(o.loftDeg - loft) < 0.26);
    const byName = opts.findIndex((o) => label.trim() !== '' && o.label.toLowerCase().includes(label.trim().toLowerCase()));
    setOptionIx(Math.max(0, byLoft >= 0 ? byLoft : byName));
    setShaftIx(-1);
  };

  const apply = () => {
    if (!result) return;
    const option = result.specOptions[optionIx] ?? null;
    const shaft = shaftIx >= 0 ? (result.stockShafts[shaftIx] ?? null) : null;
    const info: ClubModelInfo = {
      make: result.make,
      model: result.model,
      releaseYear: result.releaseYear,
      clubName: result.clubName,
      playerCategory: result.playerCategory,
      construction: result.construction,
      head: result.head,
      designedFor: result.designedFor,
      playerSignals: result.playerSignals,
      confidence: result.confidence,
      sources: result.sources,
      aiModel: result.aiModel,
      specLabel: option?.label ?? null,
      identifiedAt: new Date().toISOString(),
    };
    onApply({ info, lookup: result, option, shaft });
    setResult(null);
    setSearching(false);
  };

  if (current && !searching) {
    return (
      <section className="rounded-panel border border-brass/30 bg-brass/[0.04] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2">
              <ChatGptTag label="Identified by ChatGPT" />
              <span className="text-[11px] text-ink-faint">{CONFIDENCE[current.confidence]}</span>
            </div>
            <div className="figures truncate text-base font-semibold text-ink">
              {current.make} {current.model} {current.releaseYear ? <span className="font-normal text-ink-muted">({current.releaseYear})</span> : null}
            </div>
            <div className="text-xs text-ink-muted">
              {CATEGORY_LABEL[current.playerCategory]}
              {current.specLabel ? ` · ${current.specLabel}` : ''}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={() => setSearching(true)} title="Look up again" aria-label="Look up again" className="rounded-control p-1.5 text-ink-muted hover:bg-overlay hover:text-ink">
              <RotateCcw size={14} />
            </button>
            <button type="button" onClick={onForget} title="Forget the identification" aria-label="Forget the identification" className="rounded-control p-1.5 text-ink-muted hover:bg-overlay hover:text-ink">
              <X size={14} />
            </button>
          </div>
        </div>
        {current.playerSignals.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-semibold text-ink-soft">What this club says about you</div>
            <ul className="list-disc space-y-0.5 pl-4 text-sm text-ink-soft">
              {current.playerSignals.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3">
          <SourceList sources={current.sources} />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-panel border border-rule bg-sunken/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="figures text-sm font-semibold text-ink">Find your real club</h3>
        <ChatGptTag label="ChatGPT + web" />
      </div>
      {!connected ? (
        status.status === 'loading' ? (
          <p className="text-sm text-ink-muted">Checking ChatGPT…</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-soft">Type the club you have and ChatGPT looks up its manufacturer specs on the web. Connect your OpenAI key to start.</p>
            <ConnectForm compact />
          </>
        )
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim().length >= 2) void lookup();
            }}
          >
            <TextInput aria-label="Club to look up" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. TaylorMade Qi10 Max driver" maxLength={120} className="min-w-0 flex-1" />
            <Button type="submit" variant="primary" busy={busy} disabled={query.trim().length < 2}>
              <Search size={14} /> Look up
            </Button>
          </form>
          {current && (
            <button type="button" onClick={() => setSearching(false)} className="mt-2 text-xs text-ink-muted hover:text-ink">
              Keep {current.make} {current.model}
            </button>
          )}
          {busy && <p className="mt-3 text-sm text-ink-muted">ChatGPT is searching the web for the maker’s specs. This takes 10–40 seconds…</p>}
          {error && <p className="mt-3 text-sm text-hazard">{error.message}</p>}
          {result && !result.found && (
            <p className="mt-3 text-sm text-ink-soft">
              ChatGPT couldn’t identify a real club from that. {result.note ?? 'Try the brand, model and club type, e.g. “Ping G430 7 iron”.'}
            </p>
          )}
          {result?.found && (
            <div className="mt-4 flex flex-col gap-3">
              <div>
                <div className="flex items-center gap-2 text-[11px] text-ink-faint">
                  <span>{CONFIDENCE[result.confidence]}</span>·<span>{CATEGORY_LABEL[result.playerCategory]}</span>
                </div>
                <div className="figures text-lg font-semibold text-ink">
                  {result.make} {result.model} <span className="font-normal text-ink-muted">{result.clubName}</span>
                  {result.releaseYear ? <span className="ml-1 text-sm font-normal text-ink-faint">{result.releaseYear}</span> : null}
                </div>
                {result.construction && <p className="mt-1 text-sm text-ink-soft">{result.construction}</p>}
                {result.designedFor && <p className="mt-1 text-sm text-ink-muted">{result.designedFor}</p>}
              </div>

              {result.specOptions.length > 0 ? (
                <fieldset>
                  <legend className="mb-1.5 text-xs font-semibold text-ink-soft">Which one do you have?</legend>
                  <div className="overflow-hidden rounded-control border border-rule">
                    <table className="figures w-full text-left text-xs">
                      <thead className="bg-raised text-ink-faint">
                        <tr>
                          <th className="w-7 px-2 py-1.5" />
                          <th className="px-2 py-1.5 font-medium">Version</th>
                          <th className="px-2 py-1.5 font-medium">Loft</th>
                          <th className="px-2 py-1.5 font-medium">Lie</th>
                          <th className="px-2 py-1.5 font-medium">Length</th>
                          <th className="px-2 py-1.5 font-medium">SW</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.specOptions.map((o, i) => (
                          <tr key={`${o.label}-${i}`} className={`cursor-pointer border-t border-rule ${i === optionIx ? 'bg-fairway/20' : 'hover:bg-overlay'}`} onClick={() => setOptionIx(i)}>
                            <td className="px-2 py-1.5">
                              <input type="radio" name="spec-option" checked={i === optionIx} onChange={() => setOptionIx(i)} aria-label={o.label} />
                            </td>
                            <td className="px-2 py-1.5 text-ink">{o.label}</td>
                            <td className="px-2 py-1.5">{fmt(o.loftDeg, 1, '°')}</td>
                            <td className="px-2 py-1.5">{fmt(o.lieDeg, 1, '°')}</td>
                            <td className="px-2 py-1.5">{fmt(o.lengthIn, 2, '″')}</td>
                            <td className="px-2 py-1.5">{o.swingWeight ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </fieldset>
              ) : (
                <p className="text-sm text-ink-muted">No published specs were found, so your own numbers stay as they are.</p>
              )}

              {result.stockShafts.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-ink-soft">
                  <span className="shrink-0">Shaft</span>
                  <Select value={shaftIx} onChange={(e) => setShaftIx(Number(e.target.value))} className="min-w-0 flex-1">
                    <option value={-1}>Keep my shaft details</option>
                    {result.stockShafts.map((s, i) => (
                      <option key={`${s.make}-${s.model}-${i}`} value={i}>
                        {s.make} {s.model}
                        {s.weightG ? ` · ${s.weightG} g` : ''}
                        {s.flexes.length ? ` · ${s.flexes.join('/')}` : ''}
                      </option>
                    ))}
                  </Select>
                </label>
              )}

              {result.note && <p className="rounded-control border border-brass/30 bg-brass/5 px-3 py-2 text-xs text-ink-soft">{result.note}</p>}
              <SourceList sources={result.sources} />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-ink-faint">Specs are the maker’s published numbers found by ChatGPT. Check them against your club.</p>
                <Button variant="primary" className="shrink-0 whitespace-nowrap" onClick={apply}>
                  Use this club
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
