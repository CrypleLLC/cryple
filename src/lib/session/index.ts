import { bytesToHex, hexToBytes, zeroBytes } from '@/lib/encoding';
import {
  deriveKeyTree,
  deriveKeyTreeFromSeed,
  zeroKeyTree,
  type CrypleKeyTree,
} from '@/lib/keys';
import {
  deriveServerAuthTokenBytes,
  unlockSeedVault,
  type UnlockResult,
  type VaultStorage,
} from '@/lib/pin';

export const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export type SessionUnlockResult =
  | { status: 'unlocked'; userAddress: string }
  | Exclude<UnlockResult, { status: 'unlocked' }>;

export interface SessionKeystoreOptions {
  idleTimeoutMs?: number;
  storage?: VaultStorage;
}

interface SessionState {
  tree: CrypleKeyTree;
  serverAuthToken?: Uint8Array;
}

export interface SessionHandoffMaterial {
  seedHex: string;
  serverAuthToken?: string;
}

export class SessionKeystore {
  private state?: SessionState;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private readonly idleTimeoutMs: number;
  private readonly storage?: VaultStorage;
  private readonly lockListeners = new Set<() => void>();

  constructor(options: SessionKeystoreOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.storage = options.storage;
  }

  get isUnlocked(): boolean {
    return this.state !== undefined;
  }

  async unlock(pin: string): Promise<SessionUnlockResult> {
    this.lock();

    const opened = this.storage
      ? await unlockSeedVault(pin, this.storage)
      : await unlockSeedVault(pin);

    if (opened.status !== 'unlocked') {
      return opened;
    }

    const tree = await deriveKeyTree(opened.seedPhrase);
    const serverAuthToken = await deriveServerAuthTokenBytes(pin, tree.userAddress);

    this.state = { tree, serverAuthToken };
    this.touch();
    return { status: 'unlocked', userAddress: tree.userAddress };
  }

  async unlockWithMnemonic(mnemonic: string, pin?: string): Promise<string> {
    this.lock();

    const tree = await deriveKeyTree(mnemonic);
    const serverAuthToken =
      pin === undefined ? undefined : await deriveServerAuthTokenBytes(pin, tree.userAddress);

    this.state = { tree, serverAuthToken };
    this.touch();
    return tree.userAddress;
  }

  exportForHandoff(): SessionHandoffMaterial {
    const state = this.require();
    return {
      seedHex: bytesToHex(state.tree.seed),
      serverAuthToken: this.serverAuthToken(),
    };
  }

  async adoptHandoff(material: SessionHandoffMaterial): Promise<string> {
    this.lock();

    const seed = hexToBytes(material.seedHex);
    try {
      const tree = await deriveKeyTreeFromSeed(seed);
      this.state = {
        tree,
        serverAuthToken:
          material.serverAuthToken === undefined
            ? undefined
            : hexToBytes(material.serverAuthToken),
      };
      this.touch();
      return tree.userAddress;
    } finally {
      zeroBytes(seed);
    }
  }

  async rekeySecondFactor(pin: string): Promise<void> {
    const state = this.require();
    const replacement = await deriveServerAuthTokenBytes(pin, state.tree.userAddress);
    if (state.serverAuthToken !== undefined) {
      zeroBytes(state.serverAuthToken);
    }
    state.serverAuthToken = replacement;
  }

  lock(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (this.state === undefined) {
      return;
    }

    zeroKeyTree(this.state.tree);
    if (this.state.serverAuthToken !== undefined) {
      zeroBytes(this.state.serverAuthToken);
    }
    this.state = undefined;

    for (const listener of this.lockListeners) {
      listener();
    }
  }

  onLock(listener: () => void): () => void {
    this.lockListeners.add(listener);
    return () => void this.lockListeners.delete(listener);
  }

  private require(): SessionState {
    if (this.state === undefined) {
      throw new Error('session is locked — unlock with the PIN before signing');
    }
    this.touch();
    return this.state;
  }

  private touch(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (this.idleTimeoutMs > 0 && this.state !== undefined) {
      this.idleTimer = setTimeout(() => this.lock(), this.idleTimeoutMs);
      this.idleTimer.unref?.();
    }
  }

  get userAddress(): string {
    return this.require().tree.userAddress;
  }

  get identityPrivateKey(): Uint8Array {
    return this.require().tree.identity.privateKey;
  }

  get identityPublicKeySpkiBase64(): string {
    return this.require().tree.identity.publicKeySpkiBase64;
  }

  get identityPublicKeyUncompressed(): Uint8Array {
    return this.require().tree.identity.publicKeyUncompressed;
  }

  get x25519PrivateKey(): Uint8Array {
    return this.require().tree.x25519.privateKey;
  }

  get x25519PublicKey(): Uint8Array {
    return this.require().tree.x25519.publicKey;
  }

  get mlkem768SecretKey(): Uint8Array {
    return this.require().tree.mlkem768.secretKey;
  }

  get mlkem768PublicKey(): Uint8Array {
    return this.require().tree.mlkem768.publicKey;
  }

  get vaultKek(): Uint8Array {
    return this.require().tree.vaultKek;
  }

  get enrollmentPublicKeys(): {
    publicKey: string;
    encryptionPublicKeyX25519: string;
    encryptionPublicKeyMlkem: string;
  } {
    const { tree } = this.require();
    return {
      publicKey: tree.identity.publicKeySpkiBase64,
      encryptionPublicKeyX25519: tree.x25519.publicKeyBase64,
      encryptionPublicKeyMlkem: tree.mlkem768.publicKeyBase64,
    };
  }

  serverAuthToken(): string | undefined {
    const { serverAuthToken } = this.require();
    return serverAuthToken === undefined ? undefined : bytesToHex(serverAuthToken);
  }
}

export const sessionKeystore = new SessionKeystore();
