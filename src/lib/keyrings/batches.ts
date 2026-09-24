import { bytesToBase64 } from '@/lib/encoding';
import {
  ChainState,
  ROOT_SIGNER,
  buildStatement,
  deviceAddFields,
  eventHash,
  formatRotations,
  signStatement,
  type ChainEvent,
  type DeviceKeysDeclaration,
  type EventType,
  type Rotations,
} from '@/lib/chain';
import { KEYRING_SCOPES, formatScopeList, keyringScopesOf, type KeyringScope } from '@/lib/scopes';
import type { Signer } from '@/lib/signing';
import {
  generateScopeKek,
  generateSharingKeys,
  sealSharingMaterial,
  wrapKekForDevice,
  zeroSharingKeys,
  type SharingKeyPair,
} from './crypto';

export interface KeyringWrap {
  scope: KeyringScope;
  generation: number;
  recipient: string;
  wrapped_key: string;
}

export interface KeyringMaterial {
  scope: 'sharing';
  generation: number;
  sealed_material: string;
}

export interface DeviceBatch {
  events: ChainEvent[];
  wraps: KeyringWrap[];
  materials: KeyringMaterial[];
}

export interface CreatedGeneration {
  scope: KeyringScope;
  generation: number;
  kek: Uint8Array;
  sharingKeys?: SharingKeyPair;
}

export interface BuiltBatch {
  batch: DeviceBatch;
  created: CreatedGeneration[];
}

export type RootWrapper = (kek: Uint8Array) => Promise<string>;

export interface BatchAuthor {
  name: string;
  signer: Signer;
}

type PlannedEvent = { type: EventType; fields: readonly (string | number)[] };

async function signEvents(
  state: ChainState,
  author: BatchAuthor,
  planned: readonly PlannedEvent[],
): Promise<ChainEvent[]> {
  let seq = state.seq;
  let head = state.head;
  const events: ChainEvent[] = [];
  for (const event of planned) {
    seq += 1;
    const statement = buildStatement(state.userAddress, seq, head, event.type, event.fields);
    const signed = await signStatement(statement, author.name, author.signer);
    head = eventHash(signed.statement, signed.signer, signed.signature);
    events.push(signed);
  }
  return events;
}

async function wrapGeneration(
  state: ChainState,
  created: CreatedGeneration,
  wrapForRoot: RootWrapper,
): Promise<KeyringWrap[]> {
  const wraps: KeyringWrap[] = [
    {
      scope: created.scope,
      generation: created.generation,
      recipient: ROOT_SIGNER,
      wrapped_key: await wrapForRoot(created.kek),
    },
  ];
  for (const deviceId of state.activeDevicesWith(created.scope)) {
    const device = state.devices.get(deviceId);
    if (device === undefined) {
      continue;
    }
    wraps.push({
      scope: created.scope,
      generation: created.generation,
      recipient: deviceId,
      wrapped_key: await wrapKekForDevice(created.kek, state.userAddress, {
        deviceId,
        x25519PublicKey: device.x25519PublicKey,
        mlkemPublicKey: device.mlkemPublicKey,
      }),
    });
  }
  return wraps;
}

async function assemble(
  state: ChainState,
  author: BatchAuthor,
  planned: PlannedEvent[],
  created: CreatedGeneration[],
  wrapForRoot: RootWrapper,
): Promise<BuiltBatch> {
  try {
    const events = await signEvents(state, author, planned);
    state.applyBatch(events);

    const wraps: KeyringWrap[] = [];
    const materials: KeyringMaterial[] = [];
    for (const generation of created) {
      wraps.push(...(await wrapGeneration(state, generation, wrapForRoot)));
      if (generation.sharingKeys !== undefined) {
        materials.push({
          scope: 'sharing',
          generation: generation.generation,
          sealed_material: await sealSharingMaterial(generation.kek, generation.sharingKeys),
        });
      }
    }
    return { batch: { events, wraps, materials }, created };
  } catch (error) {
    zeroCreated(created);
    throw error;
  }
}

export function zeroCreated(created: readonly CreatedGeneration[]): void {
  for (const generation of created) {
    generation.kek.fill(0);
    zeroSharingKeys(generation.sharingKeys);
  }
}

function rotationPlan(
  state: ChainState,
  scopes: readonly KeyringScope[],
): { planned: PlannedEvent[]; created: CreatedGeneration[] } {
  const ordered = KEYRING_SCOPES.filter((scope) => scopes.includes(scope));
  if (ordered.length === 0) {
    return { planned: [], created: [] };
  }
  const rotations: Rotations = {};
  const created: CreatedGeneration[] = [];
  for (const scope of ordered) {
    const generation = (state.generations.get(scope) ?? 0) + 1;
    rotations[scope] = generation;
    created.push({
      scope,
      generation,
      kek: generateScopeKek(),
      sharingKeys: scope === 'sharing' ? generateSharingKeys() : undefined,
    });
  }
  const planned: PlannedEvent[] = [{ type: 'keyring-rotate', fields: [formatRotations(rotations)] }];
  const sharing = created.find((generation) => generation.scope === 'sharing');
  if (sharing?.sharingKeys !== undefined) {
    planned.push({
      type: 'sharing-keys',
      fields: [
        sharing.generation,
        bytesToBase64(sharing.sharingKeys.x25519PublicKey),
        bytesToBase64(sharing.sharingKeys.mlkemPublicKey),
      ],
    });
  }
  return { planned, created };
}

export async function buildGenesis(options: {
  userAddress: string;
  rootPublicKey: string;
  root: Signer;
  wrapForRoot: RootWrapper;
  device: DeviceKeysDeclaration;
}): Promise<BuiltBatch> {
  const state = new ChainState(options.userAddress, options.rootPublicKey);
  const created: CreatedGeneration[] = KEYRING_SCOPES.map((scope) => ({
    scope,
    generation: 1,
    kek: generateScopeKek(),
    sharingKeys: scope === 'sharing' ? generateSharingKeys() : undefined,
  }));
  const sharing = created.find((generation) => generation.scope === 'sharing');
  const sharingKeys = sharing?.sharingKeys as SharingKeyPair;

  const planned: PlannedEvent[] = [
    { type: 'device-add', fields: deviceAddFields(options.device) },
    {
      type: 'sharing-keys',
      fields: [1, bytesToBase64(sharingKeys.x25519PublicKey), bytesToBase64(sharingKeys.mlkemPublicKey)],
    },
    {
      type: 'keyring-rotate',
      fields: [formatRotations(Object.fromEntries(KEYRING_SCOPES.map((scope) => [scope, 1])))],
    },
  ];

  return assemble(state, { name: ROOT_SIGNER, signer: options.root }, planned, created, options.wrapForRoot);
}

export async function buildEnrolment(options: {
  state: ChainState;
  root: Signer;
  wrapForRoot: RootWrapper;
  device: DeviceKeysDeclaration;
  removeDeviceIds?: readonly string[];
}): Promise<BuiltBatch> {
  const removed = options.removeDeviceIds ?? [];
  const lost = new Set<KeyringScope>();
  for (const deviceId of removed) {
    for (const scope of keyringScopesOf(options.state.devices.get(deviceId)?.scopes ?? [])) {
      lost.add(scope);
    }
  }
  const rotation = rotationPlan(options.state, [...lost]);
  const planned: PlannedEvent[] = [
    { type: 'device-add', fields: deviceAddFields(options.device) },
    ...removed.map((deviceId) => ({ type: 'device-remove' as const, fields: [deviceId] })),
    ...rotation.planned,
  ];
  return assemble(
    options.state,
    { name: ROOT_SIGNER, signer: options.root },
    planned,
    rotation.created,
    options.wrapForRoot,
  );
}

export async function buildDeviceRemoval(options: {
  state: ChainState;
  author: BatchAuthor;
  wrapForRoot: RootWrapper;
  removeDeviceIds: readonly string[];
}): Promise<BuiltBatch> {
  const lost = new Set<KeyringScope>();
  for (const deviceId of options.removeDeviceIds) {
    if (deviceId === options.author.name) {
      throw new Error('a device leaving on its own uses buildSelfRemoval');
    }
    for (const scope of keyringScopesOf(options.state.devices.get(deviceId)?.scopes ?? [])) {
      lost.add(scope);
    }
  }
  const rotation = rotationPlan(options.state, [...lost]);
  const planned: PlannedEvent[] = [
    ...options.removeDeviceIds.map((deviceId) => ({ type: 'device-remove' as const, fields: [deviceId] })),
    ...rotation.planned,
  ];
  return assemble(options.state, options.author, planned, rotation.created, options.wrapForRoot);
}

export async function buildRotation(options: {
  state: ChainState;
  author: BatchAuthor;
  wrapForRoot: RootWrapper;
  scopes: readonly KeyringScope[];
}): Promise<BuiltBatch> {
  const rotation = rotationPlan(options.state, options.scopes);
  if (rotation.planned.length === 0) {
    throw new Error('a rotation names at least one keyring scope');
  }
  return assemble(options.state, options.author, rotation.planned, rotation.created, options.wrapForRoot);
}

export async function buildSelfRemoval(options: {
  state: ChainState;
  author: BatchAuthor;
}): Promise<DeviceBatch> {
  const events = await signEvents(options.state, options.author, [
    { type: 'device-remove', fields: [options.author.name] },
  ]);
  options.state.applyBatch(events);
  return { events, wraps: [], materials: [] };
}

export function fullDeviceScopes(): string {
  return formatScopeList(['admin', ...KEYRING_SCOPES]);
}
