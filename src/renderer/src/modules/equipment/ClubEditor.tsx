import { useEffect, useState } from 'react';
import { ClubInput, CLUB_KINDS, type ClubKind, type ClubModelInfo } from '@shared/schemas';
import type { ClubSummary } from '@shared/dto';
import type { AppError } from '@shared/ipc/result';
import { Button } from '@/design/Button';
import { Drawer, Field, Select, TextInput } from '@/design/controls';
import { mutate } from '@/lib/api';
import { useProfile, useUnits } from '@/stores/profile';
import { ClubFinder, type Applied } from '../bag/ClubFinder';
import { ClubViewer } from '../bag/three/ClubViewer';
import { clubSpec } from '../bag/three/clubModel';

const KIND_LABEL: Record<ClubKind, string> = {
  driver: 'Driver',
  wood: 'Fairway wood',
  hybrid: 'Hybrid',
  iron: 'Iron',
  wedge: 'Wedge',
  putter: 'Putter',
};
export const kindLabel = (k: ClubKind) => KIND_LABEL[k];

type Form = Record<
  'label' | 'make' | 'model' | 'loft' | 'lie' | 'length' | 'shaftMake' | 'shaftModel' | 'shaftWeight' | 'swingWeight' | 'grip' | 'acquiredOn' | 'retiredOn' | 'notes',
  string
> & { kind: ClubKind; shaftFlex: string };

const IN_PER_M = 39.3701;

const str = (v: number | string | null | undefined, digits?: number) =>
  v === null || v === undefined ? '' : typeof v === 'number' && digits !== undefined ? String(Number(v.toFixed(digits))) : String(v);

function toForm(c: ClubSummary | null, metric: boolean): Form {
  return {
    kind: c?.kind ?? 'iron',
    label: c?.label ?? '',
    make: str(c?.make),
    model: str(c?.model),
    loft: str(c?.loftDeg, 1),
    lie: str(c?.lieDeg, 1),
    length: c?.lengthM ? str(metric ? c.lengthM * 100 : c.lengthM * IN_PER_M, 2) : '',
    shaftMake: str(c?.shaftMake),
    shaftModel: str(c?.shaftModel),
    shaftFlex: c?.shaftFlex ?? '',
    shaftWeight: str(c?.shaftWeightG, 0),
    swingWeight: str(c?.swingWeight),
    grip: str(c?.grip),
    acquiredOn: str(c?.acquiredOn),
    retiredOn: str(c?.retiredOn),
    notes: str(c?.notes),
  };
}

const num = (s: string) => (s.trim() === '' ? null : Number(s));
const txt = (s: string) => (s.trim() === '' ? null : s.trim());

/** A typed number inside a range, else null (so the 3D view never draws nonsense). */
const within = (s: string, lo: number, hi: number) => {
  const v = num(s);
  return v !== null && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
};

export function ClubEditor({
  club,
  open,
  onClose,
  onSaved,
}: {
  club: ClubSummary | null;
  open: boolean;
  onClose: () => void;
  /** Called after a successful save; `identified` when ChatGPT identified the club in this edit. */
  onSaved?: (r: { identified: boolean }) => void;
}) {
  const u = useUnits();
  const leftHanded = useProfile((s) => s.profile?.handedness === 'left');
  const metric = u.du === 'metres';
  const [form, setForm] = useState<Form>(() => toForm(club, metric));
  const [modelInfo, setModelInfo] = useState<ClubModelInfo | null>(club?.modelInfo ?? null);
  const [infoTouched, setInfoTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(toForm(club, metric));
      setModelInfo(club?.modelInfo ?? null);
      setInfoTouched(false);
      setErrors({});
      setServerError(null);
    }
  }, [open, club, metric]);

  const set = <K extends keyof Form>(k: K) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value as Form[K] }));

  const save = async () => {
    const lengthRaw = num(form.length);
    const candidate = {
      kind: form.kind,
      label: form.label,
      make: txt(form.make),
      model: txt(form.model),
      loftDeg: num(form.loft),
      lieDeg: num(form.lie),
      lengthM: lengthRaw === null ? null : metric ? lengthRaw / 100 : lengthRaw / IN_PER_M,
      shaftMake: txt(form.shaftMake),
      shaftModel: txt(form.shaftModel),
      shaftFlex: form.shaftFlex === '' ? null : form.shaftFlex,
      shaftWeightG: num(form.shaftWeight),
      swingWeight: txt(form.swingWeight)?.toUpperCase() ?? null,
      grip: txt(form.grip),
      acquiredOn: txt(form.acquiredOn),
      retiredOn: txt(form.retiredOn),
      notes: txt(form.notes),
    };
    const parsed = ClubInput.safeParse(candidate);
    if (!parsed.success) {
      const map: Record<string, string> = {};
      for (const i of parsed.error.issues) map[String(i.path[0] ?? '_')] ??= i.message;
      setErrors(map);
      return;
    }
    setBusy(true);
    const res = await mutate('clubs.save', { id: club?.id ?? null, club: parsed.data, ...(infoTouched ? { modelInfo } : {}) });
    setBusy(false);
    if (!res.ok) return setServerError(res.error);
    onSaved?.({ identified: infoTouched && modelInfo !== null });
    onClose();
  };

  /** Fills the form from the club ChatGPT found; the player can still edit every field before saving. */
  const applyLookup = ({ info, lookup, option, shaft }: Applied) => {
    setModelInfo(info);
    setInfoTouched(true);
    setForm((f) => {
      const next = { ...f, kind: lookup.kind, make: info.make, model: info.model };
      if (!f.label.trim() && info.clubName) next.label = info.clubName.slice(0, 40);
      if (option?.loftDeg != null) next.loft = String(option.loftDeg);
      if (option?.lieDeg != null) next.lie = String(option.lieDeg);
      if (option?.lengthIn != null) next.length = String(Number((metric ? option.lengthIn * 2.54 : option.lengthIn).toFixed(2)));
      if (option?.swingWeight) next.swingWeight = option.swingWeight;
      if (shaft) {
        next.shaftMake = shaft.make;
        next.shaftModel = shaft.model;
        if (shaft.weightG !== null) next.shaftWeight = String(Math.round(shaft.weightG));
        if (shaft.flexes.length === 1 && shaft.flexes[0]) next.shaftFlex = shaft.flexes[0];
      }
      return next;
    });
  };

  const spec = clubSpec({ kind: form.kind, loftDeg: within(form.loft, 0, 70), lieDeg: within(form.lie, 40, 80), head: modelInfo?.head }, leftHanded);

  const remove = async () => {
    if (!club) return;
    setBusy(true);
    const res = await mutate('clubs.delete', { id: club.id });
    setBusy(false);
    if (!res.ok) return setServerError(res.error);
    onClose();
  };

  const err = (k: string) => errors[k];

  return (
    <Drawer
      open={open}
      width={600}
      title={club ? `Edit ${club.label}` : 'Add a club'}
      onClose={onClose}
      footer={
        <>
          {club && (
            <Button variant="danger" className="mr-auto" busy={busy} onClick={() => void remove()}>
              Delete club
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {club ? 'Save changes' : 'Add club'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {serverError && <p className="rounded-control border border-hazard/40 bg-hazard/10 px-3 py-2 text-sm text-hazard">{serverError.message}</p>}
        {open && <ClubViewer spec={spec} height={250} caption={modelInfo ? `${modelInfo.make} ${modelInfo.model}` : 'Generic head for this type'} />}
        <ClubFinder
          kind={form.kind}
          label={form.label}
          loft={within(form.loft, 0, 70)}
          current={modelInfo}
          onApply={applyLookup}
          onForget={() => {
            setModelInfo(null);
            setInfoTouched(true);
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" error={err('label')}>
            {(id) => <TextInput id={id} value={form.label} onChange={set('label')} placeholder="7 Iron" maxLength={40} />}
          </Field>
          <Field label="Type">
            {(id) => (
              <Select id={id} value={form.kind} onChange={set('kind')}>
                {CLUB_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Make" error={err('make')}>
            {(id) => <TextInput id={id} value={form.make} onChange={set('make')} />}
          </Field>
          <Field label="Model" error={err('model')}>
            {(id) => <TextInput id={id} value={form.model} onChange={set('model')} />}
          </Field>
        </div>

        <fieldset className="grid grid-cols-3 gap-3">
          <legend className="figures mb-2 text-sm font-semibold text-ink-soft">Specs</legend>
          <Field label="Loft (°)" error={err('loftDeg')}>
            {(id) => <TextInput id={id} inputMode="decimal" value={form.loft} onChange={set('loft')} />}
          </Field>
          <Field label="Lie (°)" error={err('lieDeg')}>
            {(id) => <TextInput id={id} inputMode="decimal" value={form.lie} onChange={set('lie')} />}
          </Field>
          <Field label={`Length (${metric ? 'cm' : 'in'})`} error={err('lengthM')}>
            {(id) => <TextInput id={id} inputMode="decimal" value={form.length} onChange={set('length')} />}
          </Field>
        </fieldset>

        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="figures mb-2 text-sm font-semibold text-ink-soft">Shaft and grip</legend>
          <Field label="Shaft make">{(id) => <TextInput id={id} value={form.shaftMake} onChange={set('shaftMake')} />}</Field>
          <Field label="Shaft model">{(id) => <TextInput id={id} value={form.shaftModel} onChange={set('shaftModel')} />}</Field>
          <Field label="Flex">
            {(id) => (
              <Select id={id} value={form.shaftFlex} onChange={set('shaftFlex')}>
                <option value="">Not set</option>
                {['L', 'A', 'R', 'S', 'X', 'TX'].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Shaft weight (g)" error={err('shaftWeightG')}>
            {(id) => <TextInput id={id} inputMode="numeric" value={form.shaftWeight} onChange={set('shaftWeight')} />}
          </Field>
          <Field label="Swing weight" error={err('swingWeight')} hint="e.g. D2">
            {(id) => <TextInput id={id} value={form.swingWeight} onChange={set('swingWeight')} />}
          </Field>
          <Field label="Grip">{(id) => <TextInput id={id} value={form.grip} onChange={set('grip')} />}</Field>
        </fieldset>

        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="figures mb-2 text-sm font-semibold text-ink-soft">History</legend>
          <Field label="In use since" error={err('acquiredOn')}>
            {(id) => <TextInput id={id} type="date" value={form.acquiredOn} onChange={set('acquiredOn')} />}
          </Field>
          <Field label="Retired on" error={err('retiredOn')} hint="Retired clubs leave the bag">
            {(id) => <TextInput id={id} type="date" value={form.retiredOn} onChange={set('retiredOn')} />}
          </Field>
        </fieldset>

        <Field label="Notes" error={err('notes')}>
          {(id) => (
            <textarea
              id={id}
              value={form.notes}
              onChange={set('notes')}
              rows={3}
              maxLength={2000}
              className="w-full rounded-control border border-rule-strong bg-sunken px-2.5 py-1.5 text-sm text-ink focus:border-green-speed focus:outline-none"
            />
          )}
        </Field>
      </div>
    </Drawer>
  );
}
