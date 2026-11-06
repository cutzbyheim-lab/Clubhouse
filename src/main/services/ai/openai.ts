import { DomainError } from '../../errors';
import type { WebSource } from '@shared/schemas';

/**
 * A small client for OpenAI's Responses API. HTTP is injected so tests run
 * against a scripted fake; the app passes Electron's net.fetch so the
 * computer's proxy settings apply.
 *
 * Requests are sent with `store: false` so OpenAI doesn't keep the
 * conversation for later retrieval.
 */

export const OPENAI_BASE = 'https://api.openai.com/v1';

export interface AiHttp {
  request(
    url: string,
    init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
    timeoutMs: number,
  ): Promise<{ status: number; body: unknown }>;
}

type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

export function createAiHttp(fetchImpl: FetchLike): AiHttp {
  return {
    async request(url, init, timeoutMs) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
        const text = await res.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = { error: { message: text.slice(0, 300) } };
        }
        return { status: res.status, body };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new DomainError('UNAVAILABLE', 'ChatGPT took too long to answer. Try again.');
        }
        throw new DomainError('UNAVAILABLE', "Couldn't reach OpenAI. Check your internet connection.");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Turns an OpenAI error response into a message a golfer can act on. */
export function apiError(status: number, body: unknown): DomainError {
  const err = rec(rec(body)['error']);
  const code = str(err['code']) ?? str(err['type']) ?? '';
  const message = str(err['message']) ?? '';
  if (status === 401) return new DomainError('VALIDATION', "OpenAI didn't accept that API key. Check it was copied in full, or make a new one.");
  if (status === 403) return new DomainError('UNAVAILABLE', `OpenAI refused the request${message ? `: ${message}` : '.'}`);
  if (code === 'insufficient_quota') {
    return new DomainError('UNAVAILABLE', 'Your OpenAI account has no API credit left. Add credit at platform.openai.com → Billing, then try again.');
  }
  if (status === 429) return new DomainError('UNAVAILABLE', 'OpenAI is rate-limiting this key right now. Wait a minute and try again.');
  if (status === 404 || code === 'model_not_found') {
    return new DomainError('UNAVAILABLE', 'The selected ChatGPT model isn’t available on your OpenAI account. Pick another model in the ChatGPT settings.');
  }
  if (status >= 500) return new DomainError('UNAVAILABLE', 'OpenAI is having trouble right now. Try again in a minute.');
  return new DomainError('UNAVAILABLE', `OpenAI couldn't run the request${message ? `: ${message.slice(0, 240)}` : ` (${status}).`}`);
}

const auth = (key: string) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });

/** Text-generation model ids on the account, best candidates first. */
export async function listModels(http: AiHttp, key: string): Promise<string[]> {
  const res = await http.request(`${OPENAI_BASE}/models`, { method: 'GET', headers: auth(key) }, 20_000);
  if (res.status !== 200) throw apiError(res.status, res.body);
  const data = rec(res.body)['data'];
  const ids = (Array.isArray(data) ? data : []).map((m) => str(rec(m)['id'])).filter((id): id is string => id !== null);
  return chatModels(ids);
}

const NOT_CHAT = /(audio|realtime|transcribe|tts|whisper|dall-e|image|embedding|moderation|instruct|search-preview|codex|davinci|babbage|computer-use|deep-research)/;

/** Preferred in this order when present: capable models with web search, mid-cost first. */
export const PREFERRED_MODELS = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-5.5', 'gpt-6-luna', 'gpt-5.4-mini', 'gpt-5.4', 'gpt-5-mini', 'gpt-5', 'gpt-4.1'];

export function chatModels(ids: readonly string[]): string[] {
  const chat = [...new Set(ids)].filter((id) => /^(gpt-|o\d)/.test(id) && !NOT_CHAT.test(id));
  const rank = (id: string) => {
    const i = PREFERRED_MODELS.indexOf(id);
    return i === -1 ? PREFERRED_MODELS.length : i;
  };
  return chat.sort((a, b) => rank(a) - rank(b) || b.localeCompare(a));
}

export interface JsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
}

export interface RespondRequest {
  key: string;
  model: string;
  instructions: string;
  input: string;
  format: JsonSchemaFormat;
  webSearch: boolean;
}

export interface RespondResult {
  json: unknown;
  sources: WebSource[];
}

/** Collects the reply text, any refusal, and every web source the model consulted. */
export function readOutput(body: unknown): { text: string; refusal: string | null; sources: WebSource[] } {
  const b = rec(body);
  const status = str(b['status']);
  if (status === 'failed') {
    throw new DomainError('UNAVAILABLE', `ChatGPT couldn't finish: ${str(rec(b['error'])['message']) ?? 'unknown error'}`);
  }
  if (status === 'incomplete') {
    const reason = str(rec(b['incomplete_details'])['reason']);
    throw new DomainError(
      'UNAVAILABLE',
      reason === 'content_filter' ? 'ChatGPT declined to answer that.' : 'ChatGPT ran out of room before finishing. Try again, or pick a different model.',
    );
  }
  let text = '';
  let refusal: string | null = null;
  const seen = new Map<string, WebSource>();
  const addSource = (url: string | null, title: string | null) => {
    if (!url || !/^https?:\/\//.test(url) || url.length > 2000) return;
    const clean = url.replace(/[?&]utm_source=openai$/, '');
    const prev = seen.get(clean);
    if (!prev || (!prev.title && title)) seen.set(clean, { url: clean, title: (title ?? '').slice(0, 300) });
  };
  const output = b['output'];
  for (const item of Array.isArray(output) ? output : []) {
    const it = rec(item);
    if (it['type'] === 'web_search_call') {
      const sources = rec(it['action'])['sources'];
      for (const s of Array.isArray(sources) ? sources : []) addSource(str(rec(s)['url']), str(rec(s)['title']));
    }
    if (it['type'] !== 'message') continue;
    const content = it['content'];
    for (const part of Array.isArray(content) ? content : []) {
      const p = rec(part);
      if (p['type'] === 'output_text') {
        text += str(p['text']) ?? '';
        const ann = p['annotations'];
        for (const a of Array.isArray(ann) ? ann : []) {
          const ar = rec(a);
          if (ar['type'] === 'url_citation') addSource(str(ar['url']), str(ar['title']));
        }
      } else if (p['type'] === 'refusal') {
        refusal = str(p['refusal']) ?? 'ChatGPT declined to answer.';
      }
    }
  }
  return { text, refusal, sources: [...seen.values()] };
}

async function post(http: AiHttp, key: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await http.request(`${OPENAI_BASE}/responses`, { method: 'POST', headers: auth(key), body: JSON.stringify(payload) }, 180_000);
  if (res.status !== 200) throw apiError(res.status, res.body);
  return res.body;
}

const formatOf = (f: JsonSchemaFormat) => ({ format: { type: 'json_schema', name: f.name, schema: f.schema, strict: true } });

/** Some models reject web search combined with a JSON schema; those get a two-step request. */
const isComboRejection = (err: unknown) =>
  err instanceof DomainError && /json_schema|text\.format|structured|not supported with|web_search/i.test(err.message);

/**
 * One structured answer from the model, optionally researched on the web.
 * Returns parsed JSON (validated by the caller) plus the web sources used.
 */
export async function respond(http: AiHttp, req: RespondRequest): Promise<RespondResult> {
  const base = { model: req.model, instructions: req.instructions, store: false, max_output_tokens: 16_000 };
  let body: unknown;
  let sources: WebSource[] = [];
  if (req.webSearch) {
    try {
      body = await post(http, req.key, {
        ...base,
        input: req.input,
        tools: [{ type: 'web_search', search_context_size: 'medium' }],
        include: ['web_search_call.action.sources'],
        text: formatOf(req.format),
      });
    } catch (err) {
      if (!isComboRejection(err)) throw err;
      // Step 1: research in prose with citations. Step 2: structure that research without tools.
      const research = readOutput(
        await post(http, req.key, {
          ...base,
          input: `${req.input}\n\nResearch this on the web and write up the facts you find, citing sources.`,
          tools: [{ type: 'web_search', search_context_size: 'medium' }],
          include: ['web_search_call.action.sources'],
        }),
      );
      if (research.refusal) throw new DomainError('UNAVAILABLE', research.refusal);
      sources = research.sources;
      body = await post(http, req.key, {
        ...base,
        input: `${req.input}\n\nUse only these research notes:\n${research.text.slice(0, 20_000)}`,
        text: formatOf(req.format),
      });
    }
  } else {
    body = await post(http, req.key, { ...base, input: req.input, text: formatOf(req.format) });
  }
  const out = readOutput(body);
  if (out.refusal) throw new DomainError('UNAVAILABLE', out.refusal);
  let json: unknown;
  try {
    json = JSON.parse(out.text);
  } catch {
    throw new DomainError('UNAVAILABLE', 'ChatGPT sent back an answer the app couldn’t read. Try again.');
  }
  return { json, sources: dedupe([...out.sources, ...sources]) };
}

const dedupe = (xs: WebSource[]) => [...new Map(xs.map((s) => [s.url, s])).values()];
