import { useEffect, useState } from 'react';
import { CourseCreate } from '@shared/dto';
import { fromDistance } from '@shared/domain/units';
import type { AppError } from '@shared/ipc/result';
import { Button } from '@/design/Button';
import { Drawer, Field, Segmented, TextInput } from '@/design/controls';
import { mutate } from '@/lib/api';
import { useUnits } from '@/stores/profile';

interface HoleRow {
  par: number;
  si: string;
  length: string;
}

const blank = (n: number): HoleRow[] => Array.from({ length: n }, () => ({ par: 4, si: '', length: '' }));

export function CourseEditor({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const u = useUnits();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [teeName, setTeeName] = useState('White');
  const [rating, setRating] = useState('');
  const [slope, setSlope] = useState('');
  const [count, setCount] = useState<9 | 18>(18);
  const [holes, setHoles] = useState<HoleRow[]>(blank(18));
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setLocation('');
      setRating('');
      setSlope('');
      setCount(18);
      setHoles(blank(18));
      setError(null);
      setServer(null);
    }
  }, [open]);

  const setHole = (i: number, patch: Partial<HoleRow>) => setHoles((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s));

  const save = async () => {
    const candidate = {
      name,
      location: location.trim() || null,
      tee: { name: teeName, courseRating: numOrNull(rating), slopeRating: numOrNull(slope) },
      holes: holes.slice(0, count).map((h, i) => ({
        number: i + 1,
        par: h.par,
        strokeIndex: numOrNull(h.si),
        lengthM: h.length.trim() === '' ? null : fromDistance(Number(h.length), u.du),
      })),
    };
    const parsed = CourseCreate.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue ? `${issue.path.join(' › ') || 'Course'}: ${issue.message}` : 'Check the course details');
      return;
    }
    setBusy(true);
    const res = await mutate('courses.create', parsed.data);
    setBusy(false);
    if (!res.ok) return setServer(res.error);
    onCreated(res.data.id);
    onClose();
  };

  const par = holes.slice(0, count).reduce((s, h) => s + h.par, 0);

  return (
    <Drawer
      open={open}
      title="Add a course"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Add course
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {(error || server) && <p className="rounded-control border border-hazard/40 bg-hazard/10 px-3 py-2 text-sm text-hazard">{server?.message ?? error}</p>}
        <p className="text-sm text-ink-muted">Copy these from the scorecard. Rating and slope are optional.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Course name">{(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />}</Field>
          <Field label="Location">{(id) => <TextInput id={id} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} />}</Field>
          <Field label="Tees">{(id) => <TextInput id={id} value={teeName} onChange={(e) => setTeeName(e.target.value)} maxLength={40} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rating">{(id) => <TextInput id={id} inputMode="decimal" value={rating} onChange={(e) => setRating(e.target.value)} />}</Field>
            <Field label="Slope">{(id) => <TextInput id={id} inputMode="numeric" value={slope} onChange={(e) => setSlope(e.target.value)} />}</Field>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Segmented
            label="Holes"
            value={count}
            options={[
              { value: 18, label: '18 holes' },
              { value: 9, label: '9 holes' },
            ]}
            onChange={(v) => {
              setCount(v);
              if (holes.length < v) setHoles((hs) => [...hs, ...blank(v - hs.length)]);
            }}
          />
          <span className="figures text-sm text-ink-muted">Par {par}</span>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-muted">
            <tr>
              <th className="pb-1 font-medium">Hole</th>
              <th className="pb-1 font-medium">Par</th>
              <th className="pb-1 font-medium">Stroke index</th>
              <th className="pb-1 font-medium">Length ({u.dSuffix})</th>
            </tr>
          </thead>
          <tbody>
            {holes.slice(0, count).map((h, i) => (
              <tr key={i}>
                <td className="figures py-1 pr-2 text-ink-muted">{i + 1}</td>
                <td className="py-1 pr-2">
                  <Segmented
                    label={`Par for hole ${i + 1}`}
                    value={h.par}
                    options={[3, 4, 5].map((p) => ({ value: p, label: String(p) }))}
                    onChange={(p) => setHole(i, { par: p })}
                  />
                </td>
                <td className="py-1 pr-2">
                  <TextInput aria-label={`Stroke index for hole ${i + 1}`} inputMode="numeric" value={h.si} onChange={(e) => setHole(i, { si: e.target.value })} className="w-16" />
                </td>
                <td className="py-1">
                  <TextInput aria-label={`Length of hole ${i + 1}`} inputMode="numeric" value={h.length} onChange={(e) => setHole(i, { length: e.target.value })} className="w-24" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Drawer>
  );
}
