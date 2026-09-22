import { describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import vectors from '@/test/fixtures/test-vectors.json';
import { bytesToBase64, hexToBytes, uncompressedPointToSpkiBase64 } from '@/lib/encoding';
import { deriveRootKeys, mnemonicToSeed } from '@/lib/keys';
import { rawKeySigner, type Signer } from '@/lib/signing';
import { generateSharingKeys } from '@/lib/keyrings/crypto';
import {
  buildDeviceRemoval,
  buildGenesis,
  buildRotation,
  buildSelfRemoval,
  type BuiltBatch,
} from '@/lib/keyrings/batches';
import type { Scope } from '@/lib/scopes';
import {
  ChainState,
  InvalidChainError,
  ROOT_SIGNER,
  batchDigest,
  buildStatement,
  deviceAddFields,
  eventHash,
  formatRotations,
  parseRotations,
  signStatement,
  verifyProofPath,
  type ChainEvent,
  type DeviceKeysDeclaration,
  type StoredChainEvent,
} from './index';

const dk = vectors.device_keys;
const mnemonic = vectors.seed_and_user_address.mnemonic;
const userAddress = vectors.seed_and_user_address.user_address;

async function rootOf() {
  return deriveRootKeys(await mnemonicToSeed(mnemonic));
}

function stored(events: readonly ChainEvent[], from = 1): StoredChainEvent[] {
  return events.map((event, index) => ({
    ...event,
    seq: from + index,
    event_hash: eventHash(event.statement, event.signer, event.signature),
  }));
}

interface TestDevice {
  declaration: DeviceKeysDeclaration;
  signer: Signer;
}

function testDevice(scopes: readonly Scope[]): TestDevice {
  const privateKey = p256.utils.randomSecretKey();
  const sharing = generateSharingKeys();
  return {
    declaration: {
      deviceId: crypto.randomUUID(),
      signingPublicKey: uncompressedPointToSpkiBase64(p256.getPublicKey(privateKey, false)),
      x25519PublicKey: bytesToBase64(sharing.x25519PublicKey),
      mlkemPublicKey: bytesToBase64(sharing.mlkemPublicKey),
      scopes,
    },
    signer: rawKeySigner(privateKey),
  };
}

const ALL: Scope[] = ['admin', 'passwords', 'secrets', 'notes', 'documents', 'files', 'sharing'];
const wrapForRoot = async () => 'AQ'.padEnd(64, 'A');

async function genesisWith(first: TestDevice) {
  const root = await rootOf();
  const built = await buildGenesis({
    userAddress: root.userAddress,
    rootPublicKey: root.signing.publicKeySpkiBase64,
    root: rawKeySigner(root.signing.privateKey),
    wrapForRoot,
    device: first.declaration,
  });
  return { root, built, events: stored(built.batch.events) };
}

async function enrolByRoot(state: ChainState, rootSigner: Signer, device: TestDevice) {
  const statement = buildStatement(
    state.userAddress,
    state.seq + 1,
    state.head,
    'device-add',
    deviceAddFields(device.declaration),
  );
  const event = await signStatement(statement, ROOT_SIGNER, rootSigner);
  state.applyBatch([event]);
  return event;
}

describe('the device_keys vectors', () => {
  it('pins the canonical scope list', () => {
    expect(dk.canonical_scopes).toBe(ALL.join(','));
  });

  it('reproduces every genesis statement from its fields', async () => {
    const device = dk.genesis_device;
    const sharing = dk.genesis_sharing_keys;
    const chain = dk.genesis_chain;
    const deviceAdd = chain[0].statement.split('|');

    expect(
      buildStatement(userAddress, 1, '0'.repeat(64), 'device-add', [
        device.device_id,
        device.signing_public_key_spki,
        device.x25519_public_key,
        deviceAdd[8],
        device.scopes,
      ]),
    ).toBe(chain[0].statement);
    expect(
      buildStatement(userAddress, 2, chain[0].event_hash, 'sharing-keys', [
        sharing.generation,
        sharing.x25519_public_key,
        chain[1].statement.split('|')[7],
      ]),
    ).toBe(chain[1].statement);
    expect(
      buildStatement(userAddress, 3, chain[1].event_hash, 'keyring-rotate', [
        formatRotations(parseRotations(device.genesis_keyring_rotation)),
      ]),
    ).toBe(chain[2].statement);
  });

  it('reproduces every event hash', () => {
    for (const event of dk.genesis_chain) {
      expect(eventHash(event.statement, event.signer, event.signature_base64)).toBe(
        event.event_hash,
      );
    }
  });

  it('replays the recorded genesis from the root key, with every signature verifying', () => {
    const state = ChainState.replay(
      userAddress,
      dk.root_wrap.root_public_key,
      dk.genesis_chain.map((event, index) => ({
        statement: event.statement,
        signer: event.signer,
        signature: event.signature_base64,
        seq: index + 1,
        event_hash: event.event_hash,
      })),
    );
    expect(state.seq).toBe(3);
    expect(state.head).toBe(dk.genesis_chain[2].event_hash);
    expect(state.activeDevicesWith('secrets')).toEqual([dk.genesis_device.device_id]);
    expect(state.generations.get('sharing')).toBe(1);
    expect(state.currentSharingKeys()?.keys.x25519PublicKey).toBe(
      dk.genesis_sharing_keys.x25519_public_key,
    );
  });

  it('refuses the recorded genesis under another root key', () => {
    const other = uncompressedPointToSpkiBase64(
      p256.getPublicKey(hexToBytes(dk.genesis_device.signing_private_key_hex), false),
    );
    expect(() =>
      ChainState.replay(
        userAddress,
        other,
        dk.genesis_chain.map((event, index) => ({
          statement: event.statement,
          signer: event.signer,
          signature: event.signature_base64,
          seq: index + 1,
          event_hash: event.event_hash,
        })),
      ),
    ).toThrow(InvalidChainError);
  });

  it('matches the vector root public key with the one derived from the seed', async () => {
    const root = await rootOf();
    expect(root.signing.publicKeySpkiBase64).toBe(dk.root_wrap.root_public_key);
  });
});

describe('a genesis built by this client', () => {
  it('verifies as a batch and replays from the root key', async () => {
    const first = testDevice(ALL);
    const { root, built, events } = await genesisWith(first);
    const state = ChainState.replay(root.userAddress, root.signing.publicKeySpkiBase64, events);
    expect(state.seq).toBe(3);
    expect(built.created.map((generation) => generation.scope)).toEqual([
      'passwords',
      'secrets',
      'notes',
      'documents',
      'files',
      'sharing',
    ]);
  });

  it('wraps every generation to the root and to the device, and seals the sharing material', async () => {
    const first = testDevice(ALL);
    const { built } = await genesisWith(first);
    expect(built.batch.wraps).toHaveLength(12);
    for (const wrap of built.batch.wraps) {
      expect([ROOT_SIGNER, first.declaration.deviceId]).toContain(wrap.recipient);
    }
    expect(built.batch.materials).toHaveLength(1);
    expect(built.batch.materials[0]).toMatchObject({ scope: 'sharing', generation: 1 });
  });

  it('refuses a first device without admin', async () => {
    const first = testDevice(['secrets', 'notes']);
    await expect(genesisWith(first)).rejects.toThrow(/admin/);
  });

  it('computes the enrolment digest over the statements joined by newlines', async () => {
    const first = testDevice(ALL);
    const { built } = await genesisWith(first);
    const { sha256 } = await import('@noble/hashes/sha2.js');
    const joined = built.batch.events.map((event) => event.statement).join('\n');
    expect(batchDigest(built.batch.events)).toBe(
      Buffer.from(sha256(new TextEncoder().encode(joined))).toString('hex'),
    );
  });
});

describe('the verifier refuses what the server refuses', () => {
  async function twoDevices() {
    const first = testDevice(ALL);
    const second = testDevice(ALL);
    const { root, events } = await genesisWith(first);
    const state = ChainState.replay(root.userAddress, root.signing.publicKeySpkiBase64, events);
    const added = await enrolByRoot(state, rawKeySigner(root.signing.privateKey), second);
    return { root, first, second, state, events: [...events, ...stored([added], 4)] };
  }

  it('a wrong sequence', async () => {
    const { state, first } = await twoDevices();
    const statement = buildStatement(state.userAddress, state.seq + 2, state.head, 'keyring-rotate', [
      'secrets=2',
    ]);
    const event = await signStatement(statement, first.declaration.deviceId, first.signer);
    expect(() => state.applyBatch([event])).toThrow(/sequence/);
  });

  it('a wrong head', async () => {
    const { state, first } = await twoDevices();
    const statement = buildStatement(state.userAddress, state.seq + 1, 'f'.repeat(64), 'keyring-rotate', [
      'secrets=2',
    ]);
    const event = await signStatement(statement, first.declaration.deviceId, first.signer);
    expect(() => state.applyBatch([event])).toThrow(/head/);
  });

  it('a stored event whose hash is not its own', async () => {
    const { root, events } = await twoDevices();
    const tampered = events.map((event, index) =>
      index === 1 ? { ...event, event_hash: 'a'.repeat(64) } : event,
    );
    expect(() =>
      ChainState.replay(root.userAddress, root.signing.publicKeySpkiBase64, tampered),
    ).toThrow(InvalidChainError);
  });

  it('a removed signer', async () => {
    const { state, first, second } = await twoDevices();
    await buildSelfRemoval({ state, author: { name: second.declaration.deviceId, signer: second.signer } });
    const statement = buildStatement(state.userAddress, state.seq + 1, state.head, 'device-remove', [
      first.declaration.deviceId,
    ]);
    const event = await signStatement(statement, second.declaration.deviceId, second.signer);
    expect(() => state.applyBatch([event])).toThrow(/not an active device/);
  });

  it('a device granting a scope it lacks', async () => {
    const first = testDevice(ALL);
    const limitedAdmin = testDevice(['admin', 'notes']);
    const { root, events } = await genesisWith(first);
    const state = ChainState.replay(root.userAddress, root.signing.publicKeySpkiBase64, events);
    await enrolByRoot(state, rawKeySigner(root.signing.privateKey), limitedAdmin);

    const third = testDevice(['notes', 'secrets']);
    const statement = buildStatement(
      state.userAddress,
      state.seq + 1,
      state.head,
      'device-add',
      deviceAddFields(third.declaration),
    );
    const event = await signStatement(statement, limitedAdmin.declaration.deviceId, limitedAdmin.signer);
    expect(() => state.applyBatch([event])).toThrow(/scope it lacks/);
  });

  it('a narrowing that widens', async () => {
    const first = testDevice(ALL);
    const narrow = testDevice(['notes']);
    const { root, events } = await genesisWith(first);
    const state = ChainState.replay(root.userAddress, root.signing.publicKeySpkiBase64, events);
    await enrolByRoot(state, rawKeySigner(root.signing.privateKey), narrow);

    const statement = buildStatement(state.userAddress, state.seq + 1, state.head, 'device-scopes', [
      narrow.declaration.deviceId,
      'notes,files',
    ]);
    const event = await signStatement(statement, first.declaration.deviceId, first.signer);
    expect(() => state.applyBatch([event])).toThrow(/only narrow/);
  });

  it('a removal of another device without rotating what it lost', async () => {
    const { state, first, second } = await twoDevices();
    const statement = buildStatement(state.userAddress, state.seq + 1, state.head, 'device-remove', [
      second.declaration.deviceId,
    ]);
    const event = await signStatement(statement, first.declaration.deviceId, first.signer);
    expect(() => state.applyBatch([event])).toThrow(/without a rotation/);
  });

  it('a sharing rotation without its keys', async () => {
    const { state, first } = await twoDevices();
    const statement = buildStatement(state.userAddress, state.seq + 1, state.head, 'keyring-rotate', [
      'sharing=2',
    ]);
    const event = await signStatement(statement, first.declaration.deviceId, first.signer);
    expect(() => state.applyBatch([event])).toThrow(/without announcing its keys/);
  });

  it('a limited device signing anything but its own removal', async () => {
    const first = testDevice(ALL);
    const limited = testDevice(['notes']);
    const { root, events } = await genesisWith(first);
    const state = ChainState.replay(root.userAddress, root.signing.publicKeySpkiBase64, events);
    await enrolByRoot(state, rawKeySigner(root.signing.privateKey), limited);
    const statement = buildStatement(state.userAddress, state.seq + 1, state.head, 'keyring-rotate', [
      'notes=2',
    ]);
    const event = await signStatement(statement, limited.declaration.deviceId, limited.signer);
    expect(() => state.applyBatch([event])).toThrow(/admin/);
  });
});

describe('the batches this client builds pass its own verifier', () => {
  it('removing another device rotates every keyring it held and wraps to exactly the remaining holders', async () => {
    const first = testDevice(ALL);
    const second = testDevice(ALL);
    const third = testDevice(['admin', 'notes']);
    const { root, events } = await genesisWith(first);
    const state = ChainState.replay(root.userAddress, root.signing.publicKeySpkiBase64, events);
    const signer = rawKeySigner(root.signing.privateKey);
    await enrolByRoot(state, signer, second);
    await enrolByRoot(state, signer, third);

    const built: BuiltBatch = await buildDeviceRemoval({
      state,
      author: { name: first.declaration.deviceId, signer: first.signer },
      wrapForRoot,
      removeDeviceIds: [second.declaration.deviceId],
    });

    expect(built.created.map((generation) => generation.scope)).toEqual([
      'passwords',
      'secrets',
      'notes',
      'documents',
      'files',
      'sharing',
    ]);
    const notesRecipients = built.batch.wraps
      .filter((wrap) => wrap.scope === 'notes')
      .map((wrap) => wrap.recipient)
      .sort();
    expect(notesRecipients).toEqual(
      [ROOT_SIGNER, first.declaration.deviceId, third.declaration.deviceId].sort(),
    );
    const secretsRecipients = built.batch.wraps
      .filter((wrap) => wrap.scope === 'secrets')
      .map((wrap) => wrap.recipient)
      .sort();
    expect(secretsRecipients).toEqual([ROOT_SIGNER, first.declaration.deviceId].sort());
    expect(built.batch.materials).toHaveLength(1);
    expect(state.generations.get('sharing')).toBe(2);
  });

  it('a plain rotation of one scope needs no sharing keys', async () => {
    const first = testDevice(ALL);
    const { root, events } = await genesisWith(first);
    const state = ChainState.replay(root.userAddress, root.signing.publicKeySpkiBase64, events);
    const built = await buildRotation({
      state,
      author: { name: first.declaration.deviceId, signer: first.signer },
      wrapForRoot,
      scopes: ['secrets'],
    });
    expect(built.batch.events).toHaveLength(1);
    expect(built.batch.wraps).toHaveLength(2);
    expect(state.generations.get('secrets')).toBe(2);
  });

  it('a stored chain with a removal and its rotation replays', async () => {
    const first = testDevice(ALL);
    const second = testDevice(ALL);
    const { root, events } = await genesisWith(first);
    const live = ChainState.replay(root.userAddress, root.signing.publicKeySpkiBase64, events);
    const added = await enrolByRoot(live, rawKeySigner(root.signing.privateKey), second);
    const removal = await buildDeviceRemoval({
      state: live,
      author: { name: first.declaration.deviceId, signer: first.signer },
      wrapForRoot,
      removeDeviceIds: [second.declaration.deviceId],
    });

    const all = [...events, ...stored([added], 4), ...stored(removal.batch.events, 5)];
    const replayed = ChainState.replay(root.userAddress, root.signing.publicKeySpkiBase64, all);
    expect(replayed.head).toBe(live.head);
    expect(replayed.activeDeviceIds()).toEqual([first.declaration.deviceId]);
  });
});

describe('proof paths', () => {
  it('a root-announced genesis proof verifies', async () => {
    const first = testDevice(ALL);
    const { root, events } = await genesisWith(first);
    const state = ChainState.replay(root.userAddress, root.signing.publicKeySpkiBase64, events);
    const current = state.currentSharingKeys()!;
    expect(() =>
      verifyProofPath(
        root.userAddress,
        root.signing.publicKeySpkiBase64,
        {
          generation: current.generation,
          encryption_public_key_x25519: current.keys.x25519PublicKey,
          encryption_public_key_mlkem: current.keys.mlkemPublicKey,
        },
        [events[1]],
      ),
    ).not.toThrow();
  });

  it('a rotation announced by a device verifies through that device\'s device-add', async () => {
    const first = testDevice(ALL);
    const { root, events } = await genesisWith(first);
    const state = ChainState.replay(root.userAddress, root.signing.publicKeySpkiBase64, events);
    const rotation = await buildRotation({
      state,
      author: { name: first.declaration.deviceId, signer: first.signer },
      wrapForRoot,
      scopes: ['sharing'],
    });
    const rotated = stored(rotation.batch.events, 4);
    const current = state.currentSharingKeys()!;
    const keys = {
      generation: current.generation,
      encryption_public_key_x25519: current.keys.x25519PublicKey,
      encryption_public_key_mlkem: current.keys.mlkemPublicKey,
    };
    expect(current.generation).toBe(2);
    expect(() =>
      verifyProofPath(root.userAddress, root.signing.publicKeySpkiBase64, keys, [events[0], rotated[1]]),
    ).not.toThrow();

    const impostor = testDevice(ALL);
    expect(() =>
      verifyProofPath(root.userAddress, impostor.declaration.signingPublicKey, keys, [
        events[0],
        rotated[1],
      ]),
    ).toThrow(InvalidChainError);
    expect(() =>
      verifyProofPath(
        root.userAddress,
        root.signing.publicKeySpkiBase64,
        { ...keys, encryption_public_key_x25519: first.declaration.x25519PublicKey },
        [events[0], rotated[1]],
      ),
    ).toThrow(/not the ones/);
    expect(() =>
      verifyProofPath(root.userAddress, root.signing.publicKeySpkiBase64, keys, [rotated[1]]),
    ).toThrow(InvalidChainError);
  });
});
