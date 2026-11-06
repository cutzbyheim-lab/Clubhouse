import { DomainError } from '../../errors';

/**
 * Minimal HTTP access to OpenStreetMap services. Injected so tests can run
 * against fixtures without the network.
 *
 * Usage policies honoured: a descriptive User-Agent (no personal data), one
 * search per explicit request (no search-as-you-type), and Overpass queries
 * bounded to a single course's area.
 */
export interface Http {
  getJson(url: string, timeoutMs: number): Promise<unknown>;
  postForm(url: string, form: Record<string, string>, timeoutMs: number): Promise<unknown>;
  /** Raw bytes, or null if the resource doesn't exist (404). */
  getBuffer(url: string, timeoutMs: number): Promise<Uint8Array | null>;
}

const USER_AGENT = 'Clubhouse/0.8 (desktop golf app; https://github.com/cutzbyheim-lab/Clubhouse)';

export const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'] as const;

type FetchLike = (input: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export function createHttp(fetchImpl: FetchLike): Http {
  const request = async (url: string, init: Parameters<FetchLike>[1], timeoutMs: number, as: 'json' | 'bytes' = 'json') => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...init.headers } });
      if (as === 'bytes' && res.status === 404) return null;
      if (res.status === 429 || res.status === 504) throw new DomainError('UNAVAILABLE', 'The map service is busy right now. Try again in a minute.');
      if (!res.ok) throw new DomainError('UNAVAILABLE', `The map service returned an error (${res.status}).`);
      return as === 'bytes' ? new Uint8Array(await res.arrayBuffer()) : await res.json();
    } catch (err) {
      if (err instanceof DomainError) throw err;
      if (err instanceof Error && err.name === 'AbortError') throw new DomainError('UNAVAILABLE', 'The map service took too long to answer. Try again.');
      throw new DomainError('UNAVAILABLE', "Couldn't reach the map service. Check your internet connection.");
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    getJson: (url, timeoutMs) => request(url, { method: 'GET' }, timeoutMs),
    getBuffer: async (url, timeoutMs) => (await request(url, { method: 'GET', headers: { Accept: 'image/*' } }, timeoutMs, 'bytes')) as Uint8Array | null,
    postForm: (url, form, timeoutMs) =>
      request(url, { method: 'POST', body: new URLSearchParams(form).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, timeoutMs),
  };
}
