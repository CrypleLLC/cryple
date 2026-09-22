import { sha256 } from '@noble/hashes/sha2.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  spkiBase64ToUncompressedPoint,
  utf8ToBytes,
  P256_SPKI_BASE64_LENGTH,
} from '@/lib/encoding';
import {
  KEYRING_SCOPES,
  formatScopeList,
  isKeyringScope,
  keyringScopesOf,
  parseScopeList,
  type KeyringScope,
  type Scope,
} from '@/lib/scopes';
import { signPayload, verifyPayload, type Signer } from '@/lib/signing';

export const CHAIN_VERSION = 'Cryple-Chain-v1';
export const ZERO_HASH = '0'.repeat(64);
export const ROOT_SIGNER = 'root';
export const GENESIS_LENGTH = 3;

const SEPARATOR = '|';
const X25519_KEY_BYTES = 32;
const MLKEM_PUBLIC_KEY_BYTES = 1184;
const CANONICAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type EventType =
  | 'device-add'
  | 'device-remove'
  | 'device-scopes'
  | 'keyring-rotate'
  | 'sharing-keys';

export interface ChainEvent {
  statement: string;
  signer: string;
  signature: string;
}

export interface StoredChainEvent extends ChainEvent {
  seq: number;
  event_hash: string;
  created_at?: string;
}

export interface DeviceKeysDeclaration {
  deviceId: string;
  signingPublicKey: string;
  x25519PublicKey: string;
  mlkemPublicKey: string;
  scopes: readonly Scope[];
}

export interface SharingPublicKeys {
  x25519PublicKey: string;
  mlkemPublicKey: string;
}

export interface ChainDevice {
  signingPublicKey: string;
  x25519PublicKey: string;
  mlkemPublicKey: string;
  scopes: Set<Scope>;
  active: boolean;
}

export type Rotations = Partial<Record<KeyringScope, number>>;

export class InvalidChainError extends Error {
  constructor(message: string) {
    super(`invalid account event: ${message}`);
    this.name = 'InvalidChainError';
  }
}

function invalid(message: string): InvalidChainError {
  return new InvalidChainError(message);
}

export function eventHash(statement: string, signer: string, signatureBase64: string): string {
  return bytesToHex(sha256(utf8ToBytes([statement, signer, signatureBase64].join(SEPARATOR))));
}

export function buildStatement(
  userAddress: string,
  seq: number,
  prev: string,
  type: EventType,
  fields: readonly (string | number)[],
): string {
  const parts = [CHAIN_VERSION, userAddress, String(seq), prev, type, ...fields.map(String)];
  for (const part of parts) {
    if (part.includes(SEPARATOR)) {
      throw invalid('a statement field contains "|"');
    }
  }
  return parts.join(SEPARATOR);
}

export function deviceAddFields(device: DeviceKeysDeclaration): string[] {
  return [
    device.deviceId,
    device.signingPublicKey,
    device.x25519PublicKey,
    device.mlkemPublicKey,
    formatScopeList(device.scopes),
  ];
}

export function formatRotations(rotations: Rotations): string {
  const pairs = KEYRING_SCOPES.filter((scope) => rotations[scope] !== undefined).map(
    (scope) => `${scope}=${rotations[scope]}`,
  );
  if (pairs.length === 0) {
    throw invalid('keyring-rotate names no scope');
  }
  return pairs.join(',');
}

export function parseRotations(field: string): Rotations {
  if (field === '') {
    throw invalid('keyring-rotate names no scope');
  }
  const rotations: Rotations = {};
  const names: string[] = [];
  for (const pair of field.split(',')) {
    const [name, value, extra] = pair.split('=');
    if (extra !== undefined || value === undefined || !isKeyringScope(name)) {
      throw invalid('keyring-rotate names an unknown keyring scope');
    }
    rotations[name] = parseGeneration(value);
    names.push(name);
  }
  try {
    parseScopeList(names.join(','));
  } catch {
    throw invalid('keyring-rotate scopes are not in canonical order');
  }
  return rotations;
}

export function parseGeneration(value: string): number {
  const generation = Number(value);
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(generation)) {
    throw invalid('generation is not a positive decimal');
  }
  return generation;
}

export function batchDigest(events: readonly ChainEvent[]): string {
  return bytesToHex(sha256(utf8ToBytes(events.map((event) => event.statement).join('\n'))));
}

export async function signStatement(
  statement: string,
  signerName: string,
  signer: Signer,
): Promise<ChainEvent> {
  return { statement, signer: signerName, signature: await signPayload(statement, signer) };
}

function verifyEventSignature(publicKeySpki: string, event: ChainEvent): boolean {
  let point: Uint8Array;
  try {
    point = spkiBase64ToUncompressedPoint(publicKeySpki);
  } catch {
    return false;
  }
  return verifyPayload(event.statement, event.signature, point);
}

function isCanonicalBase64(value: string, length: number): boolean {
  try {
    const raw = base64ToBytes(value);
    return raw.length === length && bytesToBase64(raw) === value;
  } catch {
    return false;
  }
}

export function validateX25519PublicKey(value: string): void {
  if (!isCanonicalBase64(value, X25519_KEY_BYTES)) {
    throw invalid('x25519 key is not 32 bytes of canonical base64');
  }
}

export function validateMlkemPublicKey(value: string): void {
  if (!isCanonicalBase64(value, MLKEM_PUBLIC_KEY_BYTES)) {
    throw invalid('ml-kem key is not a canonical base64 ML-KEM-768 encapsulation key');
  }
  try {
    ml_kem768.encapsulate(base64ToBytes(value));
  } catch {
    throw invalid('ml-kem key is not a valid ML-KEM-768 encapsulation key');
  }
}

export function validateSigningPublicKey(value: string): void {
  if (value.length !== P256_SPKI_BASE64_LENGTH) {
    throw invalid('signing key is not a base64 SPKI P-256 key');
  }
  try {
    spkiBase64ToUncompressedPoint(value);
  } catch {
    throw invalid('signing key is not a base64 SPKI P-256 key');
  }
}

interface ParsedStatement {
  type: string;
  fields: string[];
}

interface BatchTally {
  rotated: Map<KeyringScope, number[]>;
  announced: number[];
  lost: Map<string, Set<Scope>>;
}

function newTally(): BatchTally {
  return { rotated: new Map(), announced: [], lost: new Map() };
}

export class ChainState {
  readonly userAddress: string;
  readonly rootKey: string;
  seq = 0;
  head = ZERO_HASH;
  readonly devices = new Map<string, ChainDevice>();
  readonly generations = new Map<KeyringScope, number>();
  readonly sharingKeys = new Map<number, SharingPublicKeys>();

  constructor(userAddress: string, rootKey: string) {
    this.userAddress = userAddress;
    this.rootKey = rootKey;
  }

  static replay(
    userAddress: string,
    rootKey: string,
    events: readonly StoredChainEvent[],
  ): ChainState {
    const state = new ChainState(userAddress, rootKey);
    state.appendStored(events);
    return state;
  }

  appendStored(events: readonly StoredChainEvent[]): void {
    let run: StoredChainEvent[] = [];
    const flush = () => {
      if (run.length > 0) {
        this.applyRun(run);
        run = [];
      }
    };
    for (const event of events) {
      if (run.length > 0 && run[run.length - 1].signer !== event.signer) {
        flush();
      }
      run.push(event);
    }
    flush();
  }

  private applyRun(run: readonly StoredChainEvent[]): void {
    const tally = newTally();
    for (const event of run) {
      if (event.seq !== this.seq + 1) {
        throw invalid(`stored event ${event.seq} is out of sequence`);
      }
      this.apply(event, tally, true);
      if (event.event_hash !== this.head) {
        throw invalid(`stored event ${event.seq} carries a hash that does not match it`);
      }
    }
    this.checkTally(tally, true);
  }

  applyBatch(events: readonly ChainEvent[]): void {
    if (events.length === 0) {
      throw invalid('a batch needs at least one event');
    }
    if (this.seq === 0 && events.length !== GENESIS_LENGTH) {
      throw invalid(`the genesis is exactly ${GENESIS_LENGTH} events`);
    }
    const tally = newTally();
    for (const event of events) {
      this.apply(event, tally, false);
    }
    this.checkTally(tally, false);
  }

  private checkTally(tally: BatchTally, replay: boolean): void {
    const sharingRotations = tally.rotated.get('sharing') ?? [];
    for (const generation of tally.announced) {
      if (!sharingRotations.includes(generation)) {
        throw invalid(`sharing keys for generation ${generation} without rotating sharing to it`);
      }
    }
    for (const generation of sharingRotations) {
      if (!tally.announced.includes(generation)) {
        throw invalid(`sharing rotated to ${generation} without announcing its keys`);
      }
    }
    for (const [deviceId, lost] of tally.lost) {
      for (const scope of keyringScopesOf(lost)) {
        if (!tally.rotated.has(scope)) {
          throw invalid(`device ${deviceId} lost ${scope} without a rotation of it`);
        }
      }
    }
    if (!replay && tally.rotated.size > 0) {
      for (const [scope, generations] of tally.rotated) {
        if (generations.length !== 1) {
          throw invalid(`${scope} is rotated twice in one batch`);
        }
      }
    }
  }

  currentSharingKeys(): { generation: number; keys: SharingPublicKeys } | undefined {
    const generation = this.generations.get('sharing');
    if (generation === undefined) {
      return undefined;
    }
    const keys = this.sharingKeys.get(generation);
    return keys === undefined ? undefined : { generation, keys };
  }

  activeDevicesWith(scope: Scope): string[] {
    const ids: string[] = [];
    for (const [id, device] of this.devices) {
      if (device.active && device.scopes.has(scope)) {
        ids.push(id);
      }
    }
    return ids.sort();
  }

  activeDeviceIds(): string[] {
    return [...this.devices].filter(([, device]) => device.active).map(([id]) => id);
  }

  private apply(event: ChainEvent, tally: BatchTally, replay: boolean): void {
    const parsed = this.parse(event.statement);
    const signerDevice = this.signerDevice(event.signer);
    const signingKey = signerDevice?.signingPublicKey ?? this.rootKey;

    if (!verifyEventSignature(signingKey, event)) {
      throw invalid('signature does not verify');
    }

    this.checkGenesisOrder(parsed, event.signer);

    switch (parsed.type) {
      case 'device-add':
        this.applyDeviceAdd(parsed.fields, signerDevice);
        break;
      case 'device-remove':
        this.applyDeviceRemove(parsed.fields, event.signer, signerDevice, tally);
        break;
      case 'device-scopes':
        this.applyDeviceScopes(parsed.fields, signerDevice, tally);
        break;
      case 'keyring-rotate':
        this.applyKeyringRotate(parsed.fields, signerDevice, tally);
        break;
      case 'sharing-keys':
        this.applySharingKeys(parsed.fields, signerDevice, tally, replay);
        break;
      default:
        throw invalid(`unknown event type "${parsed.type}"`);
    }

    this.seq += 1;
    this.head = eventHash(event.statement, event.signer, event.signature);
  }

  private parse(text: string): ParsedStatement {
    const parts = text.split(SEPARATOR);
    if (parts.length < 5) {
      throw invalid('statement has too few fields');
    }
    if (parts[0] !== CHAIN_VERSION) {
      throw invalid('unknown statement version');
    }
    if (parts[1] !== this.userAddress) {
      throw invalid('statement names another account');
    }
    if (parts[2] !== String(this.seq + 1)) {
      throw invalid(`statement sequence is not ${this.seq + 1}`);
    }
    if (parts[3] !== this.head) {
      throw invalid('statement does not follow the chain head');
    }
    return { type: parts[4], fields: parts.slice(5) };
  }

  private signerDevice(signer: string): ChainDevice | undefined {
    if (signer === ROOT_SIGNER) {
      return undefined;
    }
    const device = this.devices.get(signer);
    if (device === undefined || !device.active) {
      throw invalid('signer is not an active device');
    }
    return device;
  }

  private checkGenesisOrder(parsed: ParsedStatement, signer: string): void {
    if (this.seq >= GENESIS_LENGTH) {
      return;
    }
    if (signer !== ROOT_SIGNER) {
      throw invalid('the genesis is signed by the root');
    }
    const expected = (['device-add', 'sharing-keys', 'keyring-rotate'] as const)[this.seq];
    if (parsed.type !== expected) {
      throw invalid(`genesis event ${this.seq + 1} must be ${expected}`);
    }
  }

  private applyDeviceAdd(fields: string[], signerDevice: ChainDevice | undefined): void {
    if (fields.length !== 5) {
      throw invalid('device-add takes 5 fields');
    }
    requireAdmin(signerDevice);

    const [id, signingKey, x25519Key, mlkemKey, scopeList] = fields;
    if (!CANONICAL_ID.test(id)) {
      throw invalid('device id is not a canonical UUID');
    }
    if (this.devices.has(id)) {
      throw invalid('device id was already used on this account');
    }
    validateSigningPublicKey(signingKey);
    validateX25519PublicKey(x25519Key);
    validateMlkemPublicKey(mlkemKey);

    const scopes = parseScopes(scopeList);
    if (this.seq === 0 && !scopes.has('admin')) {
      throw invalid('the first device must hold admin');
    }
    if (signerDevice !== undefined && ![...scopes].every((scope) => signerDevice.scopes.has(scope))) {
      throw invalid('a device cannot grant a scope it lacks');
    }

    this.devices.set(id, {
      signingPublicKey: signingKey,
      x25519PublicKey: x25519Key,
      mlkemPublicKey: mlkemKey,
      scopes,
      active: true,
    });
  }

  private applyDeviceRemove(
    fields: string[],
    signer: string,
    signerDevice: ChainDevice | undefined,
    tally: BatchTally,
  ): void {
    if (fields.length !== 1) {
      throw invalid('device-remove takes 1 field');
    }
    const [id] = fields;
    const device = this.devices.get(id);
    if (device === undefined || !device.active) {
      throw invalid('device-remove names no active device');
    }
    device.active = false;

    if (signer === id) {
      return;
    }
    requireAdmin(signerDevice);
    mergeLost(tally, id, device.scopes);
  }

  private applyDeviceScopes(
    fields: string[],
    signerDevice: ChainDevice | undefined,
    tally: BatchTally,
  ): void {
    if (fields.length !== 2) {
      throw invalid('device-scopes takes 2 fields');
    }
    requireAdmin(signerDevice);

    const [id, list] = fields;
    const device = this.devices.get(id);
    if (device === undefined || !device.active) {
      throw invalid('device-scopes names no active device');
    }
    const narrowed = parseScopes(list);
    const strictSubset =
      [...narrowed].every((scope) => device.scopes.has(scope)) &&
      device.scopes.size > narrowed.size;
    if (!strictSubset) {
      throw invalid('device-scopes may only narrow');
    }
    const lost = new Set([...device.scopes].filter((scope) => !narrowed.has(scope)));
    device.scopes = narrowed;
    mergeLost(tally, id, lost);
  }

  private applyKeyringRotate(
    fields: string[],
    signerDevice: ChainDevice | undefined,
    tally: BatchTally,
  ): void {
    if (fields.length !== 1) {
      throw invalid('keyring-rotate takes 1 field');
    }
    requireAdmin(signerDevice);

    const rotations = parseRotations(fields[0]);
    const scopes = Object.keys(rotations) as KeyringScope[];
    if (this.seq === 2 && scopes.length !== KEYRING_SCOPES.length) {
      throw invalid('the genesis rotation sets every keyring scope');
    }
    for (const scope of scopes) {
      const next = (this.generations.get(scope) ?? 0) + 1;
      if (rotations[scope] !== next) {
        throw invalid(`${scope} must rotate to generation ${next}`);
      }
    }
    for (const scope of scopes) {
      const generation = rotations[scope] as number;
      this.generations.set(scope, generation);
      tally.rotated.set(scope, [...(tally.rotated.get(scope) ?? []), generation]);
    }
  }

  private applySharingKeys(
    fields: string[],
    signerDevice: ChainDevice | undefined,
    tally: BatchTally,
    replay: boolean,
  ): void {
    if (fields.length !== 3) {
      throw invalid('sharing-keys takes 3 fields');
    }
    requireAdmin(signerDevice);

    const generation = parseGeneration(fields[0]);
    const current = this.generations.get('sharing') ?? 0;
    const rotatedHere = tally.rotated.get('sharing') ?? [];

    if (this.seq === 1) {
      if (generation !== 1) {
        throw invalid('the genesis sharing keys are generation 1');
      }
    } else if (generation !== current || !rotatedHere.includes(generation)) {
      throw invalid(
        replay
          ? 'sharing keys for an unexpected generation'
          : 'sharing keys must follow a rotation of sharing in the same batch',
      );
    }

    if (this.sharingKeys.has(generation)) {
      throw invalid(`sharing keys for generation ${generation} were already announced`);
    }
    validateX25519PublicKey(fields[1]);
    validateMlkemPublicKey(fields[2]);

    this.sharingKeys.set(generation, { x25519PublicKey: fields[1], mlkemPublicKey: fields[2] });
    tally.announced.push(generation);
  }
}

function requireAdmin(signerDevice: ChainDevice | undefined): void {
  if (signerDevice !== undefined && !signerDevice.scopes.has('admin')) {
    throw invalid('signing device does not hold admin');
  }
}

function parseScopes(list: string): Set<Scope> {
  try {
    return new Set(parseScopeList(list));
  } catch {
    throw invalid('scopes are not a canonical list');
  }
}

function mergeLost(tally: BatchTally, deviceId: string, scopes: Iterable<Scope>): void {
  const lost = tally.lost.get(deviceId) ?? new Set<Scope>();
  for (const scope of scopes) {
    lost.add(scope);
  }
  tally.lost.set(deviceId, lost);
}

export interface PublishedSharingKeys {
  generation: number;
  encryption_public_key_x25519: string;
  encryption_public_key_mlkem: string;
}

export function verifyProofPath(
  userAddress: string,
  rootPublicKey: string,
  sharingKeys: PublishedSharingKeys,
  proof: readonly StoredChainEvent[],
): void {
  if (proof.length === 0) {
    throw invalid('the proof path is empty');
  }

  const signers = new Map<string, { key: string; admin: boolean }>();
  let previousSeq = 0;

  proof.forEach((event, index) => {
    const parts = event.statement.split(SEPARATOR);
    if (parts.length < 5 || parts[0] !== CHAIN_VERSION) {
      throw invalid('a proof statement is malformed');
    }
    if (parts[1] !== userAddress) {
      throw invalid('a proof statement names another account');
    }
    const seq = Number(parts[2]);
    if (!Number.isSafeInteger(seq) || seq <= previousSeq || seq !== event.seq) {
      throw invalid('the proof path is out of order');
    }
    previousSeq = seq;

    const signer =
      event.signer === ROOT_SIGNER ? { key: rootPublicKey, admin: true } : signers.get(event.signer);
    if (signer === undefined) {
      throw invalid('a proof event is signed by a device the path never added');
    }
    if (index === 0 && event.signer !== ROOT_SIGNER) {
      throw invalid('the proof path does not start at the root');
    }
    if (!signer.admin) {
      throw invalid('a proof event is signed by a device without admin');
    }
    if (!verifyEventSignature(signer.key, event)) {
      throw invalid('a proof signature does not verify');
    }
    if (event.event_hash !== eventHash(event.statement, event.signer, event.signature)) {
      throw invalid('a proof event carries a hash that does not match it');
    }

    const type = parts[4];
    const fields = parts.slice(5);
    const last = index === proof.length - 1;

    if (last) {
      if (type !== 'sharing-keys' || fields.length !== 3) {
        throw invalid('the proof path does not end at a sharing-keys event');
      }
      if (
        parseGeneration(fields[0]) !== sharingKeys.generation ||
        fields[1] !== sharingKeys.encryption_public_key_x25519 ||
        fields[2] !== sharingKeys.encryption_public_key_mlkem
      ) {
        throw invalid('the published sharing keys are not the ones the proof announces');
      }
      return;
    }

    if (type !== 'device-add' || fields.length !== 5) {
      throw invalid('a proof path step is not a device-add');
    }
    const scopes = parseScopes(fields[4]);
    signers.set(fields[0], { key: fields[1], admin: scopes.has('admin') });
  });
}

export function sharingKeysFromState(state: ChainState): PublishedSharingKeys | undefined {
  const current = state.currentSharingKeys();
  if (current === undefined) {
    return undefined;
  }
  return {
    generation: current.generation,
    encryption_public_key_x25519: current.keys.x25519PublicKey,
    encryption_public_key_mlkem: current.keys.mlkemPublicKey,
  };
}
