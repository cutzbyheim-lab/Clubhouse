import type { Channel, ChannelInput, ChannelOutput } from '../shared/ipc/contract';
import type { Result } from '../shared/ipc/result';

export interface ClubhouseBridge {
  invoke<C extends Channel>(channel: C, input: ChannelInput<C>): Promise<Result<ChannelOutput<C>>>;
  readonly platform: string;
}

declare global {
  interface Window {
    readonly clubhouse: ClubhouseBridge;
  }
}
