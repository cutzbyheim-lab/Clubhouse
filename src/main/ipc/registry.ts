import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC_INVOKE } from '@shared/constants';
import {
  contract,
  isChannel,
  type Channel,
  type ChannelOutput,
} from '@shared/ipc/contract';
import { fail, ok, type Result } from '@shared/ipc/result';
import { DomainError } from '../errors';

type Input<C extends Channel> = z.output<(typeof contract)[C]['input']>;
type Handler<C extends Channel> = (input: Input<C>) => ChannelOutput<C> | Promise<ChannelOutput<C>>;

const handlers = new Map<Channel, (input: unknown) => unknown>();

/** Register the implementation for one contract channel. */
export function handle<C extends Channel>(channel: C, fn: Handler<C>): void {
  if (handlers.has(channel)) throw new Error(`IPC handler for "${channel}" registered twice`);
  handlers.set(channel, fn as (input: unknown) => unknown);
}

export const registeredChannels = (): Channel[] => [...handlers.keys()];

function issuesOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    out[key] ??= issue.message;
  }
  return out;
}

/** Validates, dispatches and wraps every renderer request. Exported for tests. */
export async function dispatch(channel: unknown, payload: unknown): Promise<Result<unknown>> {
  if (!isChannel(channel)) return fail('VALIDATION', `Unknown channel: ${String(channel)}`);
  const fn = handlers.get(channel);
  if (!fn) return fail('INTERNAL', `No handler registered for "${channel}"`);

  const parsed = contract[channel].input.safeParse(payload ?? {});
  if (!parsed.success) return fail('VALIDATION', 'Invalid input', issuesOf(parsed.error));

  try {
    const data = await fn(parsed.data);
    return ok(data);
  } catch (err) {
    if (err instanceof DomainError) return fail(err.code, err.message);
    const message = err instanceof Error ? err.message : String(err);
    const isSqlite = err instanceof Error && err.name === 'SqliteError';
    console.error(`[ipc] ${channel} failed:`, err);
    return fail(isSqlite ? 'DATABASE' : 'INTERNAL', message);
  }
}

export function installIpc(): void {
  ipcMain.handle(IPC_INVOKE, (_event, channel: unknown, payload: unknown) => dispatch(channel, payload));
}
