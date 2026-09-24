import { ApiError } from '@/lib/api';
import type { AuthedContext } from '@/lib/context';
import { bytesToUtf8, utf8ToBytes, zeroBytes } from '@/lib/encoding';
import { refreshKeyrings } from '@/lib/keyrings/api';
import { openBlob, sealBlob } from '@/lib/sealed';
import type { SessionKeystore } from '@/lib/session';
import { getFolderManifest, putFolderManifest, type FolderManifestRecord, type ManifestScope } from './api';
import {
  emptyFolderManifest,
  mergeFolderManifests,
  parseFolderManifest,
  validateFolderManifest,
  type FolderEdit,
  type FolderManifest,
  type FolderRules,
} from './manifest';

export const MAX_FOLDER_MANIFEST_ATTEMPTS = 4;

export const MANIFEST_SCOPE_RULES: Record<ManifestScope, FolderRules> = {
  secrets: { maxDepth: 1, home: true },
  notes: { maxDepth: 1, home: true },
};

interface LoadedManifest {
  manifest: FolderManifest;
  revision: number;
}

type ScopeCache = Partial<Record<ManifestScope, LoadedManifest>>;

const cache = new WeakMap<SessionKeystore, ScopeCache>();

function sessionCache(session: SessionKeystore): ScopeCache {
  let entry = cache.get(session);
  if (entry === undefined) {
    const created: ScopeCache = {};
    session.onLock(() => {
      for (const scope of Object.keys(created) as ManifestScope[]) {
        delete created[scope];
      }
    });
    cache.set(session, created);
    entry = created;
  }
  return entry;
}

async function scopeKek(context: AuthedContext, scope: ManifestScope, generation: number): Promise<Uint8Array> {
  if (!context.session.hasKek(scope, generation)) {
    await refreshKeyrings(context);
  }
  return context.session.kek(scope, generation);
}

async function openRecord(
  context: AuthedContext,
  scope: ManifestScope,
  record: FolderManifestRecord,
): Promise<FolderManifest> {
  const kek = await scopeKek(context, scope, record.key_generation);
  const dek = await openBlob(record.wrapped_dek, kek);
  try {
    const plaintext = await openBlob(record.ciphertext, dek);
    try {
      return validateFolderManifest(parseFolderManifest(bytesToUtf8(plaintext)), MANIFEST_SCOPE_RULES[scope]);
    } finally {
      zeroBytes(plaintext);
    }
  } finally {
    zeroBytes(dek);
  }
}

async function sealManifest(context: AuthedContext, scope: ManifestScope, manifest: FolderManifest) {
  const { generation, kek } = context.session.currentKek(scope);
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const plaintext = utf8ToBytes(JSON.stringify(manifest));
  try {
    return {
      ciphertext: await sealBlob(plaintext, dek),
      wrapped_dek: await sealBlob(dek, kek),
      key_generation: generation,
    };
  } finally {
    zeroBytes(dek, plaintext);
  }
}

export async function loadFolders(
  context: AuthedContext,
  scope: ManifestScope,
  options: { fresh?: boolean } = {},
): Promise<FolderManifest> {
  const holder = sessionCache(context.session);
  const cached = holder[scope];
  if (!options.fresh && cached !== undefined) {
    return cached.manifest;
  }
  const record = await getFolderManifest(context, scope);
  const loaded: LoadedManifest =
    record === undefined
      ? { manifest: emptyFolderManifest(MANIFEST_SCOPE_RULES[scope]), revision: 0 }
      : { manifest: await openRecord(context, scope, record), revision: record.revision };
  holder[scope] = loaded;
  return loaded.manifest;
}

export async function editFolders(
  context: AuthedContext,
  scope: ManifestScope,
  edit: FolderEdit,
): Promise<FolderManifest> {
  const holder = sessionCache(context.session);
  const rules = MANIFEST_SCOPE_RULES[scope];
  let fresh = holder[scope] === undefined;

  for (let attempt = 0; attempt < MAX_FOLDER_MANIFEST_ATTEMPTS; attempt += 1) {
    if (fresh || holder[scope] === undefined) {
      await loadFolders(context, scope, { fresh: true });
    }
    const loaded = holder[scope] as LoadedManifest;
    const edited = edit(loaded.manifest, rules);
    if (edited === loaded.manifest) {
      return loaded.manifest;
    }
    const next = mergeFolderManifests(loaded.manifest, edited, rules);

    try {
      const stored = await putFolderManifest(context, scope, {
        ...(await sealManifest(context, scope, next)),
        expected_revision: loaded.revision,
      });
      holder[scope] = { manifest: next, revision: stored.revision };
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.isStaleKeyGeneration) {
        await refreshKeyrings(context);
        fresh = false;
        continue;
      }
      if (error instanceof ApiError && error.status === 409) {
        fresh = true;
        continue;
      }
      throw error;
    }
  }

  throw new Error('the folders kept changing on another device; try again');
}

export async function resetFolders(context: AuthedContext, scope: ManifestScope): Promise<FolderManifest> {
  const holder = sessionCache(context.session);
  const manifest = emptyFolderManifest(MANIFEST_SCOPE_RULES[scope]);

  for (let attempt = 0; attempt < MAX_FOLDER_MANIFEST_ATTEMPTS; attempt += 1) {
    const record = await getFolderManifest(context, scope);
    try {
      const stored = await putFolderManifest(context, scope, {
        ...(await sealManifest(context, scope, manifest)),
        expected_revision: record?.revision ?? 0,
      });
      holder[scope] = { manifest, revision: stored.revision };
      return manifest;
    } catch (error) {
      if (error instanceof ApiError && error.isStaleKeyGeneration) {
        await refreshKeyrings(context);
        continue;
      }
      if (error instanceof ApiError && error.status === 409) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('the folders kept changing on another device; try again');
}
