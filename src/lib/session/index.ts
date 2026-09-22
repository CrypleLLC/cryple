import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { zeroBytes } from '@/lib/encoding';
import {
  deviceSigner,
  x25519Agreement,
  zeroDeviceKeys,
  type DeviceKeys,
  type DeviceX25519,
} from '@/lib/device/keys';
import type { DeviceSecrets } from '@/lib/keyrings/crypto';
import { openSharingMaterial, zeroSharingKeys, type SharingKeyPair } from '@/lib/keyrings/crypto';
import { isFullDevice, type KeyringScope, type Scope } from '@/lib/scopes';
import type { Signer } from '@/lib/signing';

export const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export interface KeyringEntry {
  scope: KeyringScope;
  generation: number;
  kek: Uint8Array;
  sealedMaterial?: string;
}

export type CurrentGenerations = Partial<Record<KeyringScope, number>>;

export interface SessionKeys {
  userAddress: string;
  rootPublicKey: string;
  deviceId: string;
  registrationId?: string;
  scopes: readonly Scope[];
  device: DeviceKeys;
  keyrings: readonly KeyringEntry[];
  current: CurrentGenerations;
}

export interface SessionHandoffMaterial {
  userAddress: string;
  rootPublicKey: string;
  deviceId: string;
  registrationId?: string;
  scopes: Scope[];
  signingKey: CryptoKey;
  signingPublicKey: string;
  x25519: DeviceX25519;
  x25519PublicKey: Uint8Array;
  mlkemSeed: Uint8Array;
  keyrings: KeyringEntry[];
  current: CurrentGenerations;
}

export class ScopeNotHeldError extends Error {
  readonly scope: string;

  constructor(scope: string) {
    super(`this device does not hold the ${scope} scope`);
    this.name = 'ScopeNotHeldError';
    this.scope = scope;
  }
}

export class MissingGenerationError extends Error {
  readonly scope: KeyringScope;
  readonly generation: number;

  constructor(scope: KeyringScope, generation: number) {
    super(
      `this device holds no wrap of ${scope} generation ${generation}. That is a bug to report: ` +
        'every generation of a held scope must be wrapped to every device holding it',
    );
    this.name = 'MissingGenerationError';
    this.scope = scope;
    this.generation = generation;
  }
}

export interface SessionKeystoreOptions {
  idleTimeoutMs?: number;
}

interface SessionState {
  keys: SessionKeys;
  keks: Map<string, KeyringEntry>;
  current: CurrentGenerations;
  sharing: Map<number, SharingKeyPair>;
}

function kekId(scope: KeyringScope, generation: number): string {
  return `${scope}:${generation}`;
}

export class SessionKeystore {
  private state?: SessionState;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private readonly idleTimeoutMs: number;
  private readonly lockListeners = new Set<() => void>();

  constructor(options: SessionKeystoreOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  get isUnlocked(): boolean {
    return this.state !== undefined;
  }

  open(keys: SessionKeys): void {
    this.lock();
    const keks = new Map<string, KeyringEntry>();
    for (const entry of keys.keyrings) {
      keks.set(kekId(entry.scope, entry.generation), entry);
    }
    this.state = { keys, keks, current: { ...keys.current }, sharing: new Map() };
    this.touch();
  }

  addKeyrings(entries: readonly KeyringEntry[], current: CurrentGenerations): void {
    const state = this.require();
    for (const entry of entries) {
      const id = kekId(entry.scope, entry.generation);
      const existing = state.keks.get(id);
      if (existing !== undefined && existing.kek !== entry.kek) {
        zeroBytes(existing.kek);
      }
      state.keks.set(id, entry);
    }
    for (const [scope, generation] of Object.entries(current) as [KeyringScope, number][]) {
      if (generation > (state.current[scope] ?? 0)) {
        state.current[scope] = generation;
      }
    }
  }

  setRegistration(registrationId: string): void {
    this.require().keys.registrationId = registrationId;
  }

  lock(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (this.state === undefined) {
      return;
    }

    for (const entry of this.state.keks.values()) {
      zeroBytes(entry.kek);
    }
    for (const keys of this.state.sharing.values()) {
      zeroSharingKeys(keys);
    }
    zeroDeviceKeys(this.state.keys.device);
    this.state = undefined;

    for (const listener of this.lockListeners) {
      listener();
    }
  }

  onLock(listener: () => void): () => void {
    this.lockListeners.add(listener);
    return () => void this.lockListeners.delete(listener);
  }

  get userAddress(): string {
    return this.require().keys.userAddress;
  }

  get rootPublicKey(): string {
    return this.require().keys.rootPublicKey;
  }

  get deviceId(): string {
    return this.require().keys.deviceId;
  }

  get registrationId(): string | undefined {
    return this.require().keys.registrationId;
  }

  get scopes(): readonly Scope[] {
    return this.require().keys.scopes;
  }

  get isFullDevice(): boolean {
    return isFullDevice(this.scopes);
  }

  get device(): DeviceKeys {
    return this.require().keys.device;
  }

  holds(scope: Scope): boolean {
    return this.state?.keys.scopes.includes(scope) ?? false;
  }

  requireScope(scope: Scope): void {
    if (!this.holds(scope)) {
      throw new ScopeNotHeldError(scope);
    }
  }

  signer(): Signer {
    return deviceSigner(this.require().keys.device);
  }

  deviceSecrets(): DeviceSecrets {
    const { device, deviceId } = this.require().keys;
    return {
      deviceId,
      x25519: x25519Agreement(device.x25519),
      mlkemSecretKey: device.mlkemSecretKey,
    };
  }

  currentGeneration(scope: KeyringScope): number {
    this.requireScope(scope);
    const generation = this.require().current[scope];
    if (generation === undefined) {
      throw new MissingGenerationError(scope, 0);
    }
    return generation;
  }

  currentGenerations(): CurrentGenerations {
    return { ...this.require().current };
  }

  kek(scope: KeyringScope, generation: number): Uint8Array {
    this.requireScope(scope);
    const entry = this.require().keks.get(kekId(scope, generation));
    if (entry === undefined) {
      throw new MissingGenerationError(scope, generation);
    }
    return entry.kek;
  }

  hasKek(scope: KeyringScope, generation: number): boolean {
    return this.state?.keks.has(kekId(scope, generation)) ?? false;
  }

  currentKek(scope: KeyringScope): { generation: number; kek: Uint8Array } {
    const generation = this.currentGeneration(scope);
    return { generation, kek: this.kek(scope, generation) };
  }

  heldGenerations(): { scope: KeyringScope; generation: number }[] {
    return [...this.require().keks.values()].map(({ scope, generation }) => ({ scope, generation }));
  }

  async sharingKeys(generation: number): Promise<SharingKeyPair> {
    const state = this.require();
    const cached = state.sharing.get(generation);
    if (cached !== undefined) {
      return cached;
    }
    const entry = state.keks.get(kekId('sharing', generation));
    if (entry === undefined) {
      throw new MissingGenerationError('sharing', generation);
    }
    if (entry.sealedMaterial === undefined) {
      throw new MissingGenerationError('sharing', generation);
    }
    const opened = await openSharingMaterial(entry.kek, entry.sealedMaterial);
    state.sharing.set(generation, opened);
    return opened;
  }

  exportForHandoff(): SessionHandoffMaterial {
    const { keys, keks, current } = this.require();
    return {
      userAddress: keys.userAddress,
      rootPublicKey: keys.rootPublicKey,
      deviceId: keys.deviceId,
      registrationId: keys.registrationId,
      scopes: [...keys.scopes],
      signingKey: keys.device.signingKey,
      signingPublicKey: keys.device.signingPublicKey,
      x25519:
        keys.device.x25519.kind === 'raw'
          ? { kind: 'raw', privateKey: keys.device.x25519.privateKey.slice() }
          : keys.device.x25519,
      x25519PublicKey: keys.device.x25519PublicKey.slice(),
      mlkemSeed: keys.device.mlkemSeed.slice(),
      keyrings: [...keks.values()].map((entry) => ({ ...entry, kek: entry.kek.slice() })),
      current: { ...current },
    };
  }

  adoptHandoff(material: SessionHandoffMaterial): void {
    const { secretKey, publicKey } = ml_kem768.keygen(material.mlkemSeed);
    this.open({
      userAddress: material.userAddress,
      rootPublicKey: material.rootPublicKey,
      deviceId: material.deviceId,
      registrationId: material.registrationId,
      scopes: material.scopes,
      device: {
        deviceId: material.deviceId,
        signingKey: material.signingKey,
        signingPublicKey: material.signingPublicKey,
        x25519: material.x25519,
        x25519PublicKey: material.x25519PublicKey,
        mlkemSeed: material.mlkemSeed,
        mlkemSecretKey: secretKey,
        mlkemPublicKey: publicKey,
      },
      keyrings: material.keyrings,
      current: material.current,
    });
  }

  private require(): SessionState {
    if (this.state === undefined) {
      throw new Error('session is locked — unlock with the PIN first');
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
}

export function isHandoffMaterial(value: unknown): value is SessionHandoffMaterial {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const material = value as Partial<SessionHandoffMaterial>;
  return (
    typeof material.userAddress === 'string' &&
    typeof material.deviceId === 'string' &&
    typeof material.rootPublicKey === 'string' &&
    Array.isArray(material.scopes) &&
    typeof material.signingKey === 'object' &&
    material.signingKey !== null &&
    material.mlkemSeed instanceof Uint8Array &&
    Array.isArray(material.keyrings)
  );
}

export const sessionKeystore = new SessionKeystore();
