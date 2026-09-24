import { ApiError, request } from '@/lib/api';
import type { StoredChainEvent } from '@/lib/chain';
import { requireToken, type AuthedContext, type TokenContext } from '@/lib/context';
import { isKeyringScope, type KeyringScope } from '@/lib/scopes';
import type { CurrentGenerations, KeyringEntry, SessionKeystore } from '@/lib/session';
import { MissingGenerationError } from '@/lib/session';
import { openDeviceWrap, openRootWrap, type DeviceSecrets } from './crypto';
import type { DeviceBatch, KeyringWrap } from './batches';

export interface KeyringGenerationRecord {
  scope: string;
  generation: number;
  wrapped_key: string | null;
  sealed_material?: string;
}

export interface KeyringsRecord {
  current: Record<string, number>;
  generations: KeyringGenerationRecord[];
}

export interface DeviceRecordOnServer {
  id: string;
  signing_public_key: string;
  encryption_public_key_x25519: string;
  encryption_public_key_mlkem: string;
  scopes: string;
  created_at: string;
}

export interface DevicesRecord {
  devices: DeviceRecordOnServer[];
  head: number;
}

export async function fetchKeyrings(context: TokenContext): Promise<KeyringsRecord> {
  const response = await request<KeyringsRecord>({
    method: 'GET',
    path: '/keyrings',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data;
}

export function currentFrom(record: KeyringsRecord): CurrentGenerations {
  const current: CurrentGenerations = {};
  for (const [scope, generation] of Object.entries(record.current ?? {})) {
    if (isKeyringScope(scope)) {
      current[scope] = generation;
    }
  }
  return current;
}

export async function openDeviceKeyrings(
  record: KeyringsRecord,
  userAddress: string,
  device: DeviceSecrets,
  skip: (scope: KeyringScope, generation: number) => boolean = () => false,
): Promise<KeyringEntry[]> {
  const entries: KeyringEntry[] = [];
  for (const generation of record.generations) {
    if (!isKeyringScope(generation.scope) || skip(generation.scope, generation.generation)) {
      continue;
    }
    if (generation.wrapped_key === null || generation.wrapped_key === undefined) {
      throw new MissingGenerationError(generation.scope, generation.generation);
    }
    entries.push({
      scope: generation.scope,
      generation: generation.generation,
      kek: await openDeviceWrap(generation.wrapped_key, userAddress, device),
      sealedMaterial: generation.sealed_material,
    });
  }
  return entries;
}

export async function openRootKeyrings(
  record: KeyringsRecord,
  rootWrapKey: Uint8Array,
): Promise<KeyringEntry[]> {
  const entries: KeyringEntry[] = [];
  for (const generation of record.generations) {
    if (!isKeyringScope(generation.scope)) {
      continue;
    }
    if (generation.wrapped_key === null || generation.wrapped_key === undefined) {
      throw new MissingGenerationError(generation.scope, generation.generation);
    }
    entries.push({
      scope: generation.scope,
      generation: generation.generation,
      kek: await openRootWrap(rootWrapKey, generation.wrapped_key),
      sealedMaterial: generation.sealed_material,
    });
  }
  return entries;
}

export async function refreshKeyrings(context: AuthedContext): Promise<void> {
  const { session } = context;
  const record = await fetchKeyrings(context);
  const entries = await openDeviceKeyrings(
    record,
    session.userAddress,
    session.deviceSecrets(),
    (scope, generation) => session.hasKek(scope, generation),
  );
  session.addKeyrings(entries, currentFrom(record));
}

export async function loadKeyrings(
  context: TokenContext,
  userAddress: string,
  device: DeviceSecrets,
): Promise<{ entries: KeyringEntry[]; current: CurrentGenerations }> {
  const record = await fetchKeyrings(context);
  return {
    entries: await openDeviceKeyrings(record, userAddress, device),
    current: currentFrom(record),
  };
}

export async function postOwnWraps(context: TokenContext, wraps: readonly KeyringWrap[]): Promise<void> {
  if (wraps.length === 0) {
    return;
  }
  await request<void>({
    method: 'POST',
    path: '/keyrings/wraps',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { wraps },
  });
}

export async function fetchChain(context: TokenContext, after = 0): Promise<StoredChainEvent[]> {
  const response = await request<StoredChainEvent[]>({
    method: 'GET',
    path: '/devices/chain',
    query: { after },
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return response.data ?? [];
}

export async function listDevices(context: TokenContext): Promise<DevicesRecord> {
  const response = await request<DevicesRecord>({
    method: 'GET',
    path: '/devices',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
  return { devices: response.data?.devices ?? [], head: response.data?.head ?? 0 };
}

export async function applyDeviceBatch(
  context: TokenContext,
  batch: DeviceBatch,
): Promise<DevicesRecord> {
  const response = await request<DevicesRecord>({
    method: 'POST',
    path: '/devices/batch',
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
    body: { batch },
  });
  return { devices: response.data?.devices ?? [], head: response.data?.head ?? 0 };
}

export function isStaleGeneration(error: unknown): boolean {
  return error instanceof ApiError && error.isStaleKeyGeneration;
}

export async function withCurrentGeneration<T>(
  context: AuthedContext,
  attempt: () => Promise<T>,
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!isStaleGeneration(error)) {
      throw error;
    }
  }
  await refreshKeyrings(context);
  return attempt();
}

export type { SessionKeystore };
