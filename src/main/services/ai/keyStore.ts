import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError } from '../../errors';

/**
 * Where the OpenAI API key lives. The app's implementation encrypts it with the
 * operating system's credential protection (DPAPI on Windows, Keychain on
 * macOS) via Electron safeStorage, in its own file outside the database so
 * backups and exports never carry it. The key never crosses to the renderer.
 */
export interface KeyStore {
  available(): boolean;
  get(): string | null;
  set(key: string): void;
  clear(): void;
}

export interface Encryptor {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export function fileKeyStore(dir: string, enc: Encryptor): KeyStore {
  const file = join(dir, 'openai-key.bin');
  return {
    available: () => enc.isEncryptionAvailable(),
    get() {
      if (!existsSync(file) || !enc.isEncryptionAvailable()) return null;
      try {
        return enc.decryptString(readFileSync(file));
      } catch {
        // Encrypted under another user account or a reinstalled OS: unusable, ask again.
        return null;
      }
    },
    set(key) {
      if (!enc.isEncryptionAvailable()) {
        throw new DomainError('UNAVAILABLE', "This computer can't store the key securely, so Clubhouse won't save it.");
      }
      writeFileSync(file, enc.encryptString(key), { mode: 0o600 });
    },
    clear() {
      rmSync(file, { force: true });
    },
  };
}

export function memoryKeyStore(initial: string | null = null): KeyStore {
  let key = initial;
  return {
    available: () => true,
    get: () => key,
    set: (k) => void (key = k),
    clear: () => void (key = null),
  };
}
