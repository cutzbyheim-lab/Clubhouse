import { beforeEach, describe, expect, it } from 'vitest';
import { ClubLookup, ClubModelInfo, PlayerAnalysis } from '@shared/schemas';
import { ClubSummary } from '@shared/dto';
import { DomainError } from '../src/main/errors';
import { saveClub, setBagClubs, setModelInfo } from '../src/main/db/repositories/clubs';
import { updateProfile } from '../src/main/db/repositories/profile';
import { listClubSummaries } from '../src/main/services/clubs';
import {
  aiConnect,
  aiDisconnect,
  aiSetModel,
  aiStatus,
  analysisPayload,
  analyzeBag,
  latestAnalysis,
  lookupClub,
  resetAiCache,
  type AiDeps,
} from '../src/main/services/ai';
import { fileKeyStore, memoryKeyStore } from '../src/main/services/ai/keyStore';
import { chatModels, readOutput, type AiHttp } from '../src/main/services/ai/openai';
import { bagAnalysisSchema, clubLookupSchema } from '../src/main/services/ai/schema';
import { freshDb } from './helpers';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

/** A scripted stand-in for api.openai.com. */
function fakeOpenAi(reply: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const http: AiHttp = {
    request: async (url, init) => {
      const call = { url, method: init.method, headers: init.headers, body: init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null };
      calls.push(call);
      return reply(call);
    },
  };
  return { http, calls };
}

const modelsReply = { status: 200, body: { data: [{ id: 'gpt-4o-audio-preview' }, { id: 'gpt-5.5' }, { id: 'text-embedding-3-large' }, { id: 'gpt-6.1-sol' }, { id: 'whisper-1' }] } };

const message = (json: unknown, annotations: unknown[] = []) => ({
  type: 'message',
  role: 'assistant',
  content: [{ type: 'output_text', text: JSON.stringify(json), annotations }],
});

const qi10 = {
  found: true,
  make: 'TaylorMade',
  model: 'Qi10 Max',
  releaseYear: 2024,
  kind: 'driver',
  clubName: 'Driver',
  playerCategory: 'game-improvement',
  construction: 'Carbon crown and face with a titanium body; adjustable loft sleeve.',
  head: { style: 'wood-deep', volumeCc: 460, finish: 'black', crownColor: '#1E2A3A', offset: 'none', weighting: 'low-back', adjustableHosel: true },
  specOptions: [
    { label: '9°', loftDeg: 9, lieDeg: 60, lengthIn: 45.75, swingWeight: 'd4' },
    { label: '10.5°', loftDeg: 10.5, lieDeg: 60, lengthIn: 45.75, swingWeight: 'D4' },
    { label: 'Bogus', loftDeg: 140, lieDeg: null, lengthIn: null, swingWeight: null },
  ],
  stockShafts: [{ make: 'Fujikura', model: 'Ventus TR Blue', flexes: ['R', 'S', 'Z'], weightG: 55 }],
  designedFor: 'Players who want maximum forgiveness.',
  playerSignals: ['Values forgiveness over workability', 'Likely misses vary across the face'],
  confidence: 'high',
  note: null,
};

function lookupReply(call: Call): { status: number; body: unknown } {
  if (call.url.endsWith('/models')) return modelsReply;
  return {
    status: 200,
    body: {
      status: 'completed',
      output: [
        {
          type: 'web_search_call',
          status: 'completed',
          action: { type: 'search', query: 'Qi10 Max driver specs', sources: [{ type: 'url', url: 'https://www.taylormadegolf.com/qi10-max-driver.html' }] },
        },
        message(qi10, [{ type: 'url_citation', url: 'https://www.taylormadegolf.com/qi10-max-driver.html', title: 'Qi10 Max Driver | TaylorMade', start_index: 0, end_index: 5 }]),
      ],
    },
  };
}

const analysisBody = {
  headline: 'A mid-handicapper who leans on forgiveness off the tee.',
  skill: { level: 'mid-handicap', handicapRange: '12–18', reasoning: 'Max-forgiveness driver.' },
  swingSpeed: { driverSpeed: '92–100 mph', basis: 'equipment', reasoning: 'Regular-flex 55 g shaft.' },
  ballFlight: { tendency: 'Mid-high, fights a slice', reasoning: 'Low-back weighting.' },
  traits: [{ title: 'Forgiveness first', detail: 'Both clubs are game-improvement designs.', clubs: ['Driver', '7 Iron'] }],
  suggestions: [{ title: 'Check gapping', detail: 'Log some 7 iron shots.' }],
  caveats: 'Equipment alone can’t show strike quality.',
};

let deps: AiDeps;
let calls: Call[];
type Reply = (call: Call) => { status: number; body: unknown };
const connect = (reply: Reply = lookupReply) => {
  const fake = fakeOpenAi(reply);
  calls = fake.calls;
  deps = { http: fake.http, keys: memoryKeyStore() };
};

beforeEach(() => {
  resetAiCache();
  connect();
});

describe('connecting ChatGPT', () => {
  it('starts disconnected and checks the key with OpenAI before keeping it', async () => {
    const db = freshDb();
    expect(await aiStatus(db, deps)).toMatchObject({ connected: false, keyHint: null, models: [] });
    const status = await aiConnect(db, deps, `  ${KEY}  `);
    expect(status).toMatchObject({ connected: true, keyHint: '0123', model: 'gpt-6.1-sol' });
    expect(status.models).toEqual(['gpt-6.1-sol', 'gpt-5.5']);
    expect(calls[0]?.headers['Authorization']).toBe(`Bearer ${KEY}`);
    expect(deps.keys.get()).toBe(KEY);
  });

  it('refuses something that is not an API key without calling OpenAI', async () => {
    const db = freshDb();
    await expect(aiConnect(db, deps, 'my chatgpt password')).rejects.toThrow(/doesn’t look like an OpenAI API key/);
    expect(calls).toHaveLength(0);
  });

  it('does not save a key OpenAI rejects', async () => {
    connect(() => ({ status: 401, body: { error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } } }));
    const db = freshDb();
    await expect(aiConnect(db, deps, KEY)).rejects.toThrow(/didn't accept that API key/);
    expect(deps.keys.get()).toBeNull();
  });

  it('explains an account with no credit', async () => {
    connect((c) => (c.url.endsWith('/models') ? modelsReply : { status: 429, body: { error: { code: 'insufficient_quota', message: 'quota' } } }));
    const db = freshDb();
    await aiConnect(db, deps, KEY);
    await expect(lookupClub(db, deps, { query: 'Qi10 driver', kind: 'driver', label: null })).rejects.toThrow(/no API credit/);
  });

  it('switches model only to one on the account, and disconnects cleanly', async () => {
    const db = freshDb();
    await aiConnect(db, deps, KEY);
    expect((await aiSetModel(db, deps, 'gpt-5.5')).model).toBe('gpt-5.5');
    await expect(aiSetModel(db, deps, 'gpt-made-up')).rejects.toBeInstanceOf(DomainError);
    const off = await aiDisconnect(db, deps);
    expect(off.connected).toBe(false);
    expect(deps.keys.get()).toBeNull();
  });

  it('keeps the key encrypted on disk, never in plain text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ch-key-'));
    const enc = {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
      decryptString: (b: Buffer) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
    };
    const store = fileKeyStore(dir, enc);
    store.set(KEY);
    expect(readFileSync(join(dir, 'openai-key.bin')).toString()).not.toContain('sk-');
    expect(store.get()).toBe(KEY);
    store.clear();
    expect(store.get()).toBeNull();
    const noCrypto = fileKeyStore(dir, { ...enc, isEncryptionAvailable: () => false });
    expect(() => noCrypto.set(KEY)).toThrow(/securely/);
  });

  it('lists only text models, preferred ones first', () => {
    expect(chatModels(['dall-e-3', 'gpt-4.1', 'o3', 'gpt-5.5', 'gpt-realtime', 'tts-1'])).toEqual(['gpt-5.5', 'gpt-4.1', 'o3']);
  });
});

describe('looking up a real club', () => {
  it('asks for web research with a strict schema and nothing stored at OpenAI', async () => {
    const db = freshDb();
    await aiConnect(db, deps, KEY);
    await lookupClub(db, deps, { query: 'TaylorMade Qi10 Max driver', kind: 'driver', label: 'Driver' });
    const req = calls.at(-1)!;
    expect(req.url).toBe('https://api.openai.com/v1/responses');
    expect(req.body).toMatchObject({
      model: 'gpt-6.1-sol',
      store: false,
      tools: [{ type: 'web_search' }],
      include: ['web_search_call.action.sources'],
      text: { format: { type: 'json_schema', name: 'club_lookup', strict: true } },
    });
    expect(String(req.body!['input'])).toContain('TaylorMade Qi10 Max driver');
  });

  it('returns manufacturer specs, clamps impossible numbers and keeps the sources', async () => {
    const db = freshDb();
    await aiConnect(db, deps, KEY);
    const found = await lookupClub(db, deps, { query: 'TaylorMade Qi10 Max driver', kind: 'driver', label: null });
    expect(() => ClubLookup.parse(found)).not.toThrow();
    expect(found).toMatchObject({ found: true, make: 'TaylorMade', model: 'Qi10 Max', releaseYear: 2024, aiModel: 'gpt-6.1-sol' });
    expect(found.head.crownColor).toBe('#1e2a3a');
    expect(found.specOptions.map((o) => [o.label, o.loftDeg, o.swingWeight])).toEqual([
      ['9°', 9, 'D4'],
      ['10.5°', 10.5, 'D4'],
    ]);
    expect(found.stockShafts[0]?.flexes).toEqual(['R', 'S']); // "Z" isn't a flex
    expect(found.sources).toEqual([{ url: 'https://www.taylormadegolf.com/qi10-max-driver.html', title: 'Qi10 Max Driver | TaylorMade' }]);
  });

  it('gives a head shape that matches the club type even if ChatGPT picks the wrong family', async () => {
    connect((c) => (c.url.endsWith('/models') ? modelsReply : { status: 200, body: { status: 'completed', output: [message({ ...qi10, kind: 'iron', head: { ...qi10.head, style: 'wood-deep' } })] } }));
    const db = freshDb();
    await aiConnect(db, deps, KEY);
    const found = await lookupClub(db, deps, { query: 'something', kind: null, label: null });
    expect(found.head.style).toBe('iron-cavity');
  });

  it('falls back to research-then-structure when a model rejects search with a schema', async () => {
    let n = 0;
    connect((c) => {
      if (c.url.endsWith('/models')) return modelsReply;
      n += 1;
      if (n === 1) return { status: 400, body: { error: { message: "Web search can't be used with 'text.format' json_schema on this model." } } };
      if (n === 2) {
        expect(c.body!['text']).toBeUndefined();
        return { status: 200, body: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Qi10 Max: 9, 10.5, 12 degrees', annotations: [{ type: 'url_citation', url: 'https://example.com/qi10', title: 'Review' }] }] }] } };
      }
      expect(c.body!['tools']).toBeUndefined();
      return { status: 200, body: { status: 'completed', output: [message(qi10)] } };
    });
    const db = freshDb();
    await aiConnect(db, deps, KEY);
    const found = await lookupClub(db, deps, { query: 'Qi10 Max driver', kind: 'driver', label: null });
    expect(found.make).toBe('TaylorMade');
    expect(found.sources.map((s) => s.url)).toEqual(['https://example.com/qi10']);
  });

  it('reports refusals and cut-off answers instead of guessing', () => {
    expect(readOutput({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }] }).refusal).toBe('No.');
    expect(() => readOutput({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })).toThrow(/ran out of room/);
  });

  it('needs a key first', async () => {
    const db = freshDb();
    await expect(lookupClub(db, deps, { query: 'Qi10', kind: null, label: null })).rejects.toThrow(/Connect ChatGPT first/);
  });
});

describe('keeping what ChatGPT found with the club', () => {
  it('stores model info alongside the club and reads it back', () => {
    const db = freshDb();
    const id = saveClub(db, null, {
      kind: 'driver', label: 'Driver', make: 'TaylorMade', model: 'Qi10 Max', loftDeg: 10.5, lieDeg: 60, lengthM: 1.162,
      shaftMake: null, shaftModel: null, shaftFlex: 'R', shaftWeightG: 55, swingWeight: null, grip: null, acquiredOn: null, retiredOn: null, notes: null,
    });
    const info: ClubModelInfo = {
      make: 'TaylorMade', model: 'Qi10 Max', releaseYear: 2024, clubName: 'Driver', playerCategory: 'game-improvement', construction: 'Carbon',
      head: { style: 'wood-deep', volumeCc: 460, finish: 'black', crownColor: null, offset: 'none', weighting: 'low-back', adjustableHosel: true },
      designedFor: 'Forgiveness', playerSignals: ['x'], confidence: 'high', sources: [], aiModel: 'gpt-6.1-sol', specLabel: '10.5°', identifiedAt: '2026-11-06T10:00:00.000Z',
    };
    setModelInfo(db, id, info);
    const club = listClubSummaries(db).find((c) => c.id === id)!;
    expect(() => ClubSummary.parse(club)).not.toThrow();
    expect(club.modelInfo).toEqual(info);
    setModelInfo(db, id, undefined); // left alone
    expect(listClubSummaries(db)[0]?.modelInfo).toEqual(info);
    setModelInfo(db, id, null);
    expect(listClubSummaries(db)[0]?.modelInfo).toBeNull();
  });
});

describe('reading the bag', () => {
  const analysisReply = (c: Call) => (c.url.endsWith('/models') ? modelsReply : { status: 200, body: { status: 'completed', output: [message(analysisBody)] } });

  function bagDb() {
    const db = freshDb();
    const base = { make: null, model: null, lieDeg: null, lengthM: null, shaftMake: null, shaftModel: null, shaftFlex: null, shaftWeightG: null, swingWeight: null, grip: null, acquiredOn: null, retiredOn: null, notes: null };
    const d = saveClub(db, null, { ...base, kind: 'driver', label: 'Driver', loftDeg: 10.5, shaftFlex: 'R' });
    const i = saveClub(db, null, { ...base, kind: 'iron', label: '7 Iron', loftDeg: 29 });
    saveClub(db, null, { ...base, kind: 'wedge', label: 'Spare wedge', loftDeg: 58 });
    setBagClubs(db, [d, i]);
    return { db, driverId: d };
  }

  it('sends only bag equipment and stated facts, no personal details', () => {
    const { db } = bagDb();
    updateProfile(db, { displayName: 'Jamie Private', handicapIndex: 14.2 });
    const payload = analysisPayload(listClubSummaries(db), { displayName: 'Jamie Private', handedness: 'right', handicapIndex: 14.2, distanceUnit: 'yards', speedUnit: 'mph', updatedAt: '2026-01-01T00:00:00.000Z' });
    const text = JSON.stringify(payload);
    expect(text).not.toContain('Jamie');
    expect(payload.clubs.map((c) => c.name)).toEqual(['Driver', '7 Iron']);
    expect(payload.golfer.statedHandicapIndex).toBe(14.2);
    expect(payload.clubs[0]?.measured).toBeNull(); // no shots logged → nothing "measured"
  });

  it('stores the read, and marks it out of date when the bag changes', async () => {
    connect(analysisReply);
    const { db, driverId } = bagDb();
    expect(latestAnalysis(db)).toBeNull();
    await aiConnect(db, deps, KEY);
    const a = await analyzeBag(db, deps);
    expect(() => PlayerAnalysis.parse(a)).not.toThrow();
    expect(a).toMatchObject({ clubCount: 2, stale: false, aiModel: 'gpt-6.1-sol' });
    const req = calls.at(-1)!;
    expect(req.body!['tools']).toBeUndefined(); // no web search needed to read a bag
    expect(req.body).toMatchObject({ store: false, text: { format: { name: 'bag_analysis', strict: true } } });
    setBagClubs(db, [driverId]);
    expect(latestAnalysis(db)?.stale).toBe(true);
  });

  it('won’t read an empty bag', async () => {
    connect(analysisReply);
    const db = freshDb();
    await aiConnect(db, deps, KEY);
    await expect(analyzeBag(db, deps)).rejects.toThrow(/Put some clubs in the bag/);
  });
});

describe('structured-output schemas', () => {
  const strict = (schema: unknown, path = '$'): string[] => {
    const s = schema as Record<string, unknown>;
    const problems: string[] = [];
    if (s['type'] === 'object') {
      const props = Object.keys(s['properties'] as object);
      if (s['additionalProperties'] !== false) problems.push(`${path}: additionalProperties`);
      if (JSON.stringify([...(s['required'] as string[])].sort()) !== JSON.stringify([...props].sort())) problems.push(`${path}: required`);
      for (const [k, v] of Object.entries(s['properties'] as object)) problems.push(...strict(v, `${path}.${k}`));
    }
    if (s['type'] === 'array') problems.push(...strict(s['items'], `${path}[]`));
    return problems;
  };
  it('meet OpenAI strict-mode rules', () => {
    expect(strict(clubLookupSchema)).toEqual([]);
    expect(strict(bagAnalysisSchema)).toEqual([]);
  });
});
