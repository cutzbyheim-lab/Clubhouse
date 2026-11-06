import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { AppError } from '@shared/ipc/result';
import { Button } from '@/design/Button';
import { Segmented, TextInput } from '@/design/controls';
import { Illustration, type Art } from '@/design/Illustrations';
import { mutate } from '@/lib/api';
import { useProfile } from '@/stores/profile';

const STARTS: Array<{ to: string; art: Art; title: string; body: string }> = [
  { to: '/bag', art: 'bag', title: 'Set up your bag', body: 'Add the clubs you carry. ChatGPT can identify the real models and draw each one in 3D.' },
  { to: '/course', art: 'contours', title: 'Find your home course', body: 'Search real courses, check them against aerial photos, and walk every hole in 3D.' },
  { to: '/rounds', art: 'flag', title: 'Record a round', body: 'Score hole by hole. Putts and fairways unlock greens in regulation, scrambling and more.' },
];

/** A few details that make every screen read right: name, hand, distance unit. Saved as you go. */
function AboutYou() {
  const profile = useProfile((s) => s.profile);
  const update = useProfile((s) => s.update);
  const [name, setName] = useState(profile?.displayName ?? '');
  useEffect(() => setName(profile?.displayName ?? ''), [profile?.displayName]);
  if (!profile) return null;
  const saveName = () => {
    const v = name.trim();
    if (v !== (profile.displayName ?? '')) void update({ displayName: v === '' ? null : v.slice(0, 80) });
  };
  return (
    <section className="animate-rise rounded-panel border border-rule bg-raised p-6" style={{ animationDelay: '150ms' }}>
      <h2 className="figures text-lg font-semibold">About you</h2>
      <p className="mt-0.5 text-sm text-ink-muted">Optional, and you can change it any time.</p>
      <div className="mt-5 flex flex-col gap-5">
        <label className="flex flex-col gap-1.5 text-sm text-ink-soft">
          What should Clubhouse call you?
          <TextInput
            value={name}
            maxLength={80}
            placeholder="First name"
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        </label>
        <div className="flex items-center justify-between gap-4 text-sm text-ink-soft">
          <span>You play</span>
          <Segmented
            label="Handedness"
            value={profile.handedness}
            options={[
              { value: 'right', label: 'Right-handed' },
              { value: 'left', label: 'Left-handed' },
            ]}
            onChange={(v) => void update({ handedness: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-4 text-sm text-ink-soft">
          <span>Distances in</span>
          <Segmented
            label="Distance unit"
            value={profile.distanceUnit}
            options={[
              { value: 'yards', label: 'Yards' },
              { value: 'metres', label: 'Metres' },
            ]}
            onChange={(v) => void update({ distanceUnit: v, speedUnit: v === 'yards' ? 'mph' : 'kmh' })}
          />
        </div>
      </div>
    </section>
  );
}

export function FirstRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const loadSample = async () => {
    setBusy(true);
    const res = await mutate('data.loadSample', {}, { done: 'Sample data loaded' });
    setBusy(false);
    if (!res.ok) setError(res.error);
  };
  return (
    <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)] items-start gap-6">
      <div className="flex flex-col gap-4">
        <ul className="grid grid-cols-3 gap-4">
          {STARTS.map((s, i) => (
            <li key={s.to} className="animate-rise" style={{ animationDelay: `${i * 70}ms` }}>
              <Link
                to={s.to}
                className="group flex h-full flex-col rounded-panel border border-rule bg-raised p-5 transition-colors duration-200 hover:border-fairway hover:bg-[#262c27]"
              >
                <Illustration art={s.art} className="-ml-3 transition-colors duration-200 group-hover:text-ink" />
                <span className="figures mt-3 text-lg font-semibold text-ink">{s.title}</span>
                <span className="mt-1 text-sm text-ink-muted">{s.body}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex animate-rise flex-wrap items-center gap-3 rounded-panel border border-dashed border-rule-strong px-5 py-4" style={{ animationDelay: '260ms' }}>
          <p className="mr-auto text-sm text-ink-soft">
            Just looking? Fill the app with an invented player to see what it does. It’s clearly marked and comes out in one click.
          </p>
          <Button busy={busy} onClick={() => void loadSample()}>
            Load sample data
          </Button>
          {error && <p className="w-full text-sm text-hazard">{error.message}</p>}
        </div>
      </div>
      <AboutYou />
    </div>
  );
}
