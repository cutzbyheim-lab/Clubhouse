import { useState } from 'react';
import { KeyRound, Sparkles } from 'lucide-react';
import type { AiStatus } from '@shared/schemas';
import type { AppError } from '@shared/ipc/result';
import { Button } from '@/design/Button';
import { Drawer, Field, Select, TextInput } from '@/design/controls';
import { mutate, useQuery } from '@/lib/api';

export const useAiStatus = () => useQuery('ai.status', {});

/** Marks content written by ChatGPT, so it's never mistaken for measured data. */
export function ChatGptTag({ label = 'ChatGPT' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brass/40 bg-brass/10 px-2 py-0.5 text-[11px] font-medium text-brass">
      <Sparkles size={11} aria-hidden /> {label}
    </span>
  );
}

export function WhatIsSent() {
  return (
    <details className="text-xs text-ink-muted">
      <summary className="cursor-pointer text-ink-soft hover:text-ink">What gets sent to OpenAI</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        <li>For a club lookup: only what you type in the search box, plus the club type.</li>
        <li>
          For a bag read: the clubs in your bag (makes, models, lofts, shafts), your average numbers from logged shots where there are at least 5, your
          handicap if you’ve entered one, and which hand you play.
        </li>
        <li>Never your name, email, rounds, courses or where you play.</li>
        <li>Requests are sent with storage off, so OpenAI doesn’t keep them for later use.</li>
      </ul>
    </details>
  );
}

/** Paste-a-key form. The key goes straight to the main process, is checked with OpenAI, then stored encrypted. */
export function ConnectForm({ onConnected, compact = false }: { onConnected?: (s: AiStatus) => void; compact?: boolean }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const connect = async () => {
    setBusy(true);
    setError(null);
    const res = await mutate('ai.connect', { apiKey: key });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setKey('');
    onConnected?.(res.data);
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void connect();
      }}
    >
      {!compact && (
        <p className="text-sm text-ink-soft">
          Clubhouse talks to ChatGPT with your own OpenAI API key. A ChatGPT Plus subscription doesn’t include one: create a key at{' '}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-green-speed hover:underline">
            platform.openai.com/api-keys
          </a>{' '}
          and add a little credit under Billing. A club lookup typically costs a few cents.
        </p>
      )}
      <Field label="OpenAI API key" error={error?.message}>
        {(id) => (
          <div className="flex gap-2">
            <TextInput id={id} type="password" autoComplete="off" spellCheck={false} placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} className="min-w-0 flex-1" />
            <Button variant="primary" type="submit" busy={busy} disabled={key.trim().length < 10}>
              <KeyRound size={14} /> Connect
            </Button>
          </div>
        )}
      </Field>
      <p className="text-xs text-ink-faint">The key is checked with OpenAI, then stored encrypted by Windows on this computer only. It never leaves this computer except to talk to OpenAI.</p>
    </form>
  );
}

export function ChatGptSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const status = useAiStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const run = async (p: Promise<{ ok: boolean; error?: AppError }>) => {
    setBusy(true);
    setError(null);
    const res = await p;
    setBusy(false);
    if (!res.ok && res.error) setError(res.error);
  };
  const s = status.status === 'ready' || status.status === 'empty' ? status.data : null;
  return (
    <Drawer open={open} title="ChatGPT" onClose={onClose} width={480}>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-ink-soft">
          ChatGPT identifies the real make and model of your clubs from the web, and reads your bag to describe the kind of golfer it suggests. Its answers
          are estimates and are always labelled <ChatGptTag />. They never change your measured numbers.
        </p>
        {status.status === 'loading' && <p className="text-sm text-ink-muted">Checking connection…</p>}
        {status.status === 'error' && <p className="text-sm text-hazard">{status.error.message}</p>}
        {s && !s.secureStorage && !s.connected && <p className="text-sm text-hazard">This computer can’t store the key securely, so ChatGPT can’t be connected here.</p>}
        {s && s.connected ? (
          <>
            <div className="flex items-center justify-between rounded-panel border border-rule bg-sunken px-4 py-3">
              <div>
                <div className="text-sm font-medium text-ink">Connected</div>
                <div className="figures text-xs text-ink-muted">Key ending …{s.keyHint}</div>
              </div>
              <Button variant="danger" busy={busy} onClick={() => void run(mutate('ai.disconnect', {}))}>
                Disconnect
              </Button>
            </div>
            <Field label="Model" hint="Bigger models are more thorough and cost more per request.">
              {(id) => (
                <Select id={id} value={s.model ?? ''} disabled={busy || s.models.length === 0} onChange={(e) => void run(mutate('ai.setModel', { model: e.target.value }))}>
                  {s.models.length === 0 && <option value={s.model ?? ''}>{s.model ?? 'Couldn’t load models (offline?)'}</option>}
                  {s.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {error && <p className="text-sm text-hazard">{error.message}</p>}
          </>
        ) : (
          s?.secureStorage !== false && <ConnectForm />
        )}
        <WhatIsSent />
      </div>
    </Drawer>
  );
}
