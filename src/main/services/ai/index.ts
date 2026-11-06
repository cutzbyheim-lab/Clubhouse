import { createHash } from 'node:crypto';
import {
  ClubLookup,
  HEAD_STYLES,
  PlayerAnalysisBody,
  type AiStatus,
  type ClubKind,
  type HeadStyle,
  type PlayerAnalysis,
  type PlayerProfile,
} from '@shared/schemas';
import type { ClubSummary } from '@shared/dto';
import { distanceSuffix, speedSuffix, toDistance, toSpeed } from '@shared/domain/units';
import type { DB } from '../../db/connection';
import { getProfile } from '../../db/repositories/profile';
import { DomainError } from '../../errors';
import { listClubSummaries } from '../clubs';
import type { KeyStore } from './keyStore';
import { listModels, respond, type AiHttp } from './openai';
import { bagAnalysisSchema, clubLookupSchema } from './schema';

export interface AiDeps {
  http: AiHttp;
  keys: KeyStore;
}

// ─── Settings ───────────────────────────────────────────────────────────────

const MODEL_KEY = 'openai.model';

const getSetting = (db: DB, key: string) => db.prepare<[string], { value: string }>('SELECT value FROM app_setting WHERE key = ?').get(key)?.value ?? null;
const setSetting = (db: DB, key: string, value: string | null) =>
  value === null
    ? db.prepare('DELETE FROM app_setting WHERE key = ?').run(key)
    : db.prepare('INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

/** Model list fetched with the current key; refreshed on connect. */
let modelCache: { hint: string; models: string[] } | null = null;

const hintOf = (key: string) => key.slice(-4);

function requireKey(deps: AiDeps): string {
  const key = deps.keys.get();
  if (!key) throw new DomainError('VALIDATION', 'Connect ChatGPT first: add your OpenAI API key in ChatGPT settings.');
  return key;
}

async function modelsFor(deps: AiDeps, key: string): Promise<string[]> {
  if (modelCache?.hint === hintOf(key)) return modelCache.models;
  const models = await listModels(deps.http, key);
  modelCache = { hint: hintOf(key), models };
  return models;
}

export async function aiStatus(db: DB, deps: AiDeps): Promise<AiStatus> {
  const key = deps.keys.get();
  if (!key) return { connected: false, keyHint: null, model: null, models: [], secureStorage: deps.keys.available() };
  // Offline is fine: still connected, just no fresh model list.
  const models = await modelsFor(deps, key).catch(() => modelCache?.models ?? []);
  return { connected: true, keyHint: hintOf(key), model: getSetting(db, MODEL_KEY), models, secureStorage: deps.keys.available() };
}

export async function aiConnect(db: DB, deps: AiDeps, apiKey: string): Promise<AiStatus> {
  const key = apiKey.trim();
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)) {
    throw new DomainError('VALIDATION', 'That doesn’t look like an OpenAI API key. Keys start with "sk-" and come from platform.openai.com → API keys.');
  }
  if (!deps.keys.available()) throw new DomainError('UNAVAILABLE', "This computer can't store the key securely, so Clubhouse won't save it.");
  modelCache = null;
  const models = await modelsFor(deps, key); // proves the key works before saving it
  if (models.length === 0) throw new DomainError('UNAVAILABLE', 'That key works, but it has no ChatGPT models available. Check the key’s project permissions.');
  deps.keys.set(key);
  const current = getSetting(db, MODEL_KEY);
  if (current === null || !models.includes(current)) setSetting(db, MODEL_KEY, models[0] ?? null);
  return aiStatus(db, deps);
}

export function aiDisconnect(db: DB, deps: AiDeps): Promise<AiStatus> {
  deps.keys.clear();
  modelCache = null;
  return aiStatus(db, deps);
}

export async function aiSetModel(db: DB, deps: AiDeps, model: string): Promise<AiStatus> {
  const models = await modelsFor(deps, requireKey(deps));
  if (!models.includes(model)) throw new DomainError('VALIDATION', 'That model isn’t available on your OpenAI account.');
  setSetting(db, MODEL_KEY, model);
  return aiStatus(db, deps);
}

async function ready(db: DB, deps: AiDeps): Promise<{ key: string; model: string }> {
  const key = requireKey(deps);
  let model = getSetting(db, MODEL_KEY);
  if (model === null) {
    model = (await modelsFor(deps, key))[0] ?? null;
    if (model === null) throw new DomainError('UNAVAILABLE', 'No ChatGPT model is available on your OpenAI account.');
    setSetting(db, MODEL_KEY, model);
  }
  return { key, model };
}

/** Test hook: forget the cached model list between cases. */
export const resetAiCache = () => void (modelCache = null);

// ─── Club lookup ────────────────────────────────────────────────────────────

const LOOKUP_INSTRUCTIONS = `You identify golf clubs for a golf statistics app.
Search the web for the exact club the golfer describes and report the manufacturer's published specifications.
Rules:
- Prefer the manufacturer's own spec pages; otherwise use reputable retailers or reviews.
- Every number must come from a source. If a spec isn't published, use null. Never estimate numbers.
- If you can't identify a real product, set found=false and leave the rest empty or null.
- specOptions: the published versions of THIS club only (for a driver, each head loft; for an iron, just that iron number; for a wedge, each loft/bounce).
- If the golfer didn't say which iron or wood number, use the one they named, or the most common (7 iron, 3 wood) and say so in note.
- head describes the general shape for a generic 3D drawing; pick the closest style that matches the club type.
- playerSignals: what choosing this club tends to say about a golfer (skill, swing speed, typical miss, priorities). Tendencies, not certainties.
- Plain English. No marketing language.`;

const KIND_FAMILY: Record<ClubKind, string> = { driver: 'wood-', wood: 'wood-', hybrid: 'wood-', iron: 'iron-', wedge: 'wedge-', putter: 'putter-' };
export const DEFAULT_STYLE: Record<ClubKind, HeadStyle> = {
  driver: 'wood-standard',
  wood: 'wood-standard',
  hybrid: 'wood-compact',
  iron: 'iron-cavity',
  wedge: 'wedge-blade',
  putter: 'putter-blade',
};

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const inRange = (v: unknown, lo: number, hi: number, digits = 1) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Number(v.toFixed(digits)) : null;
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => (values.includes(v as T) ? (v as T) : fallback);
const list = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);

/** Clamps model output into what the app accepts: out-of-range numbers become null, odd shapes get defaults. */
export function normalizeLookup(raw: unknown, kindHint: ClubKind | null, sources: ClubLookup['sources'], aiModel: string): ClubLookup {
  const r = rec(raw);
  const kind = oneOf(r['kind'], ['driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter'] as const, kindHint ?? 'iron');
  const head = rec(r['head']);
  const style = oneOf(head['style'], HEAD_STYLES, DEFAULT_STYLE[kind]);
  const color = text(head['crownColor'], 7);
  return ClubLookup.parse({
    found: r['found'] === true,
    make: text(r['make'], 60),
    model: text(r['model'], 80),
    releaseYear: typeof r['releaseYear'] === 'number' && Number.isInteger(r['releaseYear']) && r['releaseYear'] >= 1950 && r['releaseYear'] <= 2100 ? r['releaseYear'] : null,
    kind,
    clubName: text(r['clubName'], 40),
    playerCategory: oneOf(r['playerCategory'], ['tour', 'players', 'players-distance', 'game-improvement', 'super-game-improvement', 'unknown'] as const, 'unknown'),
    construction: text(r['construction'], 300),
    head: {
      style: style.startsWith(KIND_FAMILY[kind]) ? style : DEFAULT_STYLE[kind],
      volumeCc: inRange(head['volumeCc'], 50, 470),
      finish: oneOf(head['finish'], ['chrome', 'satin', 'black', 'gunmetal', 'raw', 'two-tone'] as const, kind === 'driver' || kind === 'wood' || kind === 'hybrid' ? 'black' : 'satin'),
      crownColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : null,
      offset: oneOf(head['offset'], ['none', 'minimal', 'moderate', 'strong'] as const, 'minimal'),
      weighting: oneOf(head['weighting'], ['neutral', 'draw', 'fade', 'low-back', 'low-forward', 'perimeter', 'unknown'] as const, 'unknown'),
      adjustableHosel: head['adjustableHosel'] === true,
    },
    specOptions: list(r['specOptions'], 12)
      .map((o) => {
        const x = rec(o);
        const sw = text(x['swingWeight'], 5).toUpperCase();
        return {
          label: text(x['label'], 60) || 'Standard',
          loftDeg: inRange(x['loftDeg'], 0, 70, 2),
          lieDeg: inRange(x['lieDeg'], 40, 80, 2),
          lengthIn: inRange(x['lengthIn'], 24, 49, 2),
          swingWeight: /^[A-G]\d(\.\d)?$/.test(sw) ? sw : null,
        };
      })
      .filter((o) => o.loftDeg !== null || o.lieDeg !== null || o.lengthIn !== null),
    stockShafts: list(r['stockShafts'], 8)
      .map((o) => {
        const x = rec(o);
        return {
          make: text(x['make'], 60),
          model: text(x['model'], 80),
          flexes: list(x['flexes'], 6).filter((f): f is 'L' | 'A' | 'R' | 'S' | 'X' | 'TX' => ['L', 'A', 'R', 'S', 'X', 'TX'].includes(f as string)),
          weightG: inRange(x['weightG'], 30, 150),
        };
      })
      .filter((s) => s.make && s.model),
    designedFor: text(r['designedFor'], 400),
    playerSignals: list(r['playerSignals'], 6)
      .map((p) => text(p, 300))
      .filter(Boolean),
    confidence: oneOf(r['confidence'], ['high', 'medium', 'low'] as const, 'low'),
    note: text(r['note'], 400) || null,
    sources: sources.slice(0, 10),
    aiModel: aiModel.slice(0, 100),
  });
}

export async function lookupClub(db: DB, deps: AiDeps, q: { query: string; kind: ClubKind | null; label: string | null }): Promise<ClubLookup> {
  const { key, model } = await ready(db, deps);
  const context = [
    `Club the golfer is looking for: "${q.query}"`,
    q.kind ? `They've marked it as a ${q.kind}.` : null,
    q.label ? `They call it "${q.label}" in their bag.` : null,
  ]
    .filter(Boolean)
    .join('\n');
  const res = await respond(deps.http, {
    key,
    model,
    instructions: LOOKUP_INSTRUCTIONS,
    input: context,
    format: { name: 'club_lookup', schema: clubLookupSchema },
    webSearch: true,
  });
  return normalizeLookup(res.json, q.kind, res.sources, model);
}

// ─── Bag analysis ───────────────────────────────────────────────────────────

const ANALYSIS_INSTRUCTIONS = `You are a golf equipment analyst inside a golf statistics app.
From the golfer's bag (club models, specs, shafts, and what each model was designed for) and any measured launch-monitor averages, explain what the equipment suggests about the golfer.
Rules:
- Measured numbers are facts. Use them as given and never contradict them. Only set basis "measured" if a measured club speed is provided.
- Everything else is inference from equipment. Say so plainly; never present an estimate as a measurement.
- Point to the specific clubs (by the names given) behind each observation.
- Write distances and speeds in the golfer's units.
- If the bag doesn't support a judgement, say "unclear" rather than guessing.
- Short, plain sentences. No product adverts.`;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** What gets sent for analysis: equipment plus measured averages that clear the sample minimum. Nothing identifying. */
export function analysisPayload(clubs: readonly ClubSummary[], profile: PlayerProfile) {
  const du = profile.distanceUnit;
  const su = profile.speedUnit;
  const dist = (m: number | null) => (m === null ? null : `${Math.round(toDistance(m, du))} ${distanceSuffix(du)}`);
  const speed = (mps: number | null) => (mps === null ? null : `${Math.round(toSpeed(mps, su))} ${speedSuffix(su)}`);
  const bag = clubs.filter((c) => c.inBag).sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
  return {
    golfer: {
      plays: profile.handedness === 'left' ? 'left-handed' : 'right-handed',
      statedHandicapIndex: profile.handicapIndex,
      units: { distance: distanceSuffix(du), speed: speedSuffix(su) },
    },
    clubs: bag.map((c) => ({
      name: c.label,
      type: c.kind,
      make: c.modelInfo?.make ?? c.make,
      model: c.modelInfo?.model ?? c.model,
      releaseYear: c.modelInfo?.releaseYear ?? null,
      designedFor: c.modelInfo?.designedFor ?? null,
      category: c.modelInfo?.playerCategory ?? null,
      construction: c.modelInfo?.construction ?? null,
      headWeighting: c.modelInfo?.head.weighting ?? null,
      offset: c.modelInfo?.head.offset ?? null,
      loftDeg: c.loftDeg,
      lieDeg: c.lieDeg,
      lengthIn: c.lengthM === null ? null : r1(c.lengthM * 39.3701),
      shaft: c.shaftMake || c.shaftModel || c.shaftFlex || c.shaftWeightG ? { make: c.shaftMake, model: c.shaftModel, flex: c.shaftFlex, weightG: c.shaftWeightG } : null,
      swingWeight: c.swingWeight,
      measured:
        c.stats.carryMean === null
          ? null
          : {
              shots: c.stats.n,
              avgCarry: dist(c.stats.carryMean),
              carrySpread: dist(c.stats.carrySd),
              sideSpread: dist(c.stats.offlineSd),
              avgClubSpeed: speed(c.stats.clubSpeedMean),
              avgBallSpeed: speed(c.stats.ballSpeedMean),
              avgLaunchDeg: c.stats.launchMean === null ? null : r1(c.stats.launchMean),
              avgSpinRpm: c.stats.spinMean === null ? null : Math.round(c.stats.spinMean),
            },
    })),
  };
}

const fingerprintOf = (payload: unknown) => createHash('sha256').update(JSON.stringify(payload)).digest('hex');

interface AnalysisRow {
  id: number;
  fingerprint: string;
  ai_model: string;
  club_count: number;
  body: string;
  created_at: string;
}

function currentFingerprint(db: DB): string {
  return fingerprintOf(analysisPayload(listClubSummaries(db), getProfile(db)));
}

export function latestAnalysis(db: DB): PlayerAnalysis | null {
  const row = db.prepare<[], AnalysisRow>('SELECT * FROM player_analysis ORDER BY id DESC LIMIT 1').get();
  if (!row) return null;
  const body = PlayerAnalysisBody.safeParse(JSON.parse(row.body));
  if (!body.success) return null;
  return { id: row.id, body: body.data, aiModel: row.ai_model, clubCount: row.club_count, createdAt: row.created_at, stale: row.fingerprint !== currentFingerprint(db) };
}

export async function analyzeBag(db: DB, deps: AiDeps): Promise<PlayerAnalysis> {
  const payload = analysisPayload(listClubSummaries(db), getProfile(db));
  if (payload.clubs.length === 0) throw new DomainError('VALIDATION', 'Put some clubs in the bag first, then ChatGPT can read it.');
  const { key, model } = await ready(db, deps);
  const res = await respond(deps.http, {
    key,
    model,
    instructions: ANALYSIS_INSTRUCTIONS,
    input: `The golfer's bag, as JSON:\n${JSON.stringify(payload, null, 1)}`,
    format: { name: 'bag_analysis', schema: bagAnalysisSchema },
    webSearch: false,
  });
  const parsed = PlayerAnalysisBody.safeParse(trimAnalysis(res.json));
  if (!parsed.success) throw new DomainError('UNAVAILABLE', 'ChatGPT’s answer was missing parts. Try again.');
  const id = Number(
    db
      .prepare('INSERT INTO player_analysis (fingerprint, ai_model, club_count, body) VALUES (?, ?, ?, ?)')
      .run(fingerprintOf(payload), model.slice(0, 100), payload.clubs.length, JSON.stringify(parsed.data)).lastInsertRowid,
  );
  // Only the last few are worth keeping.
  db.prepare('DELETE FROM player_analysis WHERE id NOT IN (SELECT id FROM player_analysis ORDER BY id DESC LIMIT 5)').run();
  const saved = latestAnalysis(db);
  if (!saved || saved.id !== id) throw new DomainError('NOT_FOUND', 'The analysis could not be read back after saving');
  return saved;
}

/** Trims over-long strings and lists so a chatty answer still fits the stored shape. */
function trimAnalysis(raw: unknown): unknown {
  const r = rec(raw);
  const part = (v: unknown, fields: Record<string, number>) => Object.fromEntries(Object.entries(fields).map(([k, max]) => [k, text(rec(v)[k], max)]));
  return {
    headline: text(r['headline'], 300),
    skill: { ...part(r['skill'], { handicapRange: 40, reasoning: 800 }), level: oneOf(rec(r['skill'])['level'], ['beginner', 'high-handicap', 'mid-handicap', 'low-handicap', 'scratch-or-better', 'unclear'] as const, 'unclear') },
    swingSpeed: { ...part(r['swingSpeed'], { driverSpeed: 40, reasoning: 800 }), basis: oneOf(rec(r['swingSpeed'])['basis'], ['measured', 'equipment', 'unclear'] as const, 'unclear') },
    ballFlight: part(r['ballFlight'], { tendency: 120, reasoning: 800 }),
    traits: list(r['traits'], 6).map((t) => ({
      ...part(t, { title: 100, detail: 600 }),
      clubs: list(rec(t)['clubs'], 14)
        .map((c) => text(c, 40))
        .filter(Boolean),
    })),
    suggestions: list(r['suggestions'], 5).map((t) => part(t, { title: 100, detail: 600 })),
    caveats: text(r['caveats'], 600),
  };
}
