import { describe, expect, it } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { bytesToBase64, bytesToHex, hexToBytes } from '@/lib/encoding';
import { deriveRootKeys, mnemonicToSeed } from '@/lib/keys';
import { buildInfo, deviceRecipientSlot } from '@/lib/pqxdh';
import { ITEM_SCOPES } from '@/lib/scopes';
import {
  DEVICE_KEYRING_USAGE,
  deriveShareSubkey,
  generateScopeKek,
  generateSharingKeys,
  openDeviceWrap,
  openRootWrap,
  openSharingMaterial,
  sealSharingMaterial,
  wrapKekForDevice,
  wrapKekForRoot,
} from './crypto';

const dk = vectors.device_keys;
const userAddress = vectors.seed_and_user_address.user_address;

describe('the root wrap', () => {
  it('reproduces the vector wrap of the fixed scope KEK under the vault-kek leaf', async () => {
    const root = await deriveRootKeys(await mnemonicToSeed(vectors.seed_and_user_address.mnemonic));
    const wrapped = await wrapKekForRoot(
      root.wrapKey,
      hexToBytes(dk.root_wrap.scope_kek_hex),
      hexToBytes(dk.root_wrap.iv_hex),
    );
    expect(wrapped).toBe(dk.root_wrap.wrapped_base64);
    expect(bytesToHex(await openRootWrap(root.wrapKey, wrapped))).toBe(dk.root_wrap.scope_kek_hex);
  });
});

describe('the device-keyring wrap', () => {
  it('builds the vector info string, binding the account and the device', () => {
    expect(
      buildInfo({
        usage: DEVICE_KEYRING_USAGE,
        senderUserAddress: userAddress,
        recipientUserAddress: deviceRecipientSlot(userAddress, dk.genesis_device.device_id),
      }),
    ).toBe(dk.device_keyring_pqxdh.info);
  });

  it('opens for its device and for no other device of the same account', async () => {
    const device = generateSharingKeys();
    const kek = generateScopeKek();
    const recipient = {
      deviceId: crypto.randomUUID(),
      x25519PublicKey: bytesToBase64(device.x25519PublicKey),
      mlkemPublicKey: bytesToBase64(device.mlkemPublicKey),
    };
    const wrapped = await wrapKekForDevice(kek, userAddress, recipient);
    const opened = await openDeviceWrap(wrapped, userAddress, {
      deviceId: recipient.deviceId,
      x25519: device.x25519PrivateKey,
      mlkemSecretKey: device.mlkemSecretKey,
    });
    expect(bytesToHex(opened)).toBe(bytesToHex(kek));

    await expect(
      openDeviceWrap(wrapped, userAddress, {
        deviceId: crypto.randomUUID(),
        x25519: device.x25519PrivateKey,
        mlkemSecretKey: device.mlkemSecretKey,
      }),
    ).rejects.toThrow();
  });

  it('opens through a WebCrypto X25519 key that never leaves the browser', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, false, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const mlkem = generateSharingKeys();
    const kek = generateScopeKek();
    const deviceId = crypto.randomUUID();
    const wrapped = await wrapKekForDevice(kek, userAddress, {
      deviceId,
      x25519PublicKey: bytesToBase64(publicKey),
      mlkemPublicKey: bytesToBase64(mlkem.mlkemPublicKey),
    });
    const opened = await openDeviceWrap(wrapped, userAddress, {
      deviceId,
      x25519: {
        deriveSharedSecret: async (peer) => {
          const peerKey = await crypto.subtle.importKey('raw', peer, { name: 'X25519' }, false, []);
          return new Uint8Array(
            await crypto.subtle.deriveBits({ name: 'X25519', public: peerKey }, pair.privateKey, 256),
          );
        },
      },
      mlkemSecretKey: mlkem.mlkemSecretKey,
    });
    expect(bytesToHex(opened)).toBe(bytesToHex(kek));
  });
});

describe('the sharing material', () => {
  it('round-trips under the sharing KEK and rebuilds the same public keys', async () => {
    const keys = generateSharingKeys();
    const kek = generateScopeKek();
    const sealed = await sealSharingMaterial(kek, keys);
    const opened = await openSharingMaterial(kek, sealed);
    expect(bytesToHex(opened.x25519PublicKey)).toBe(bytesToHex(keys.x25519PublicKey));
    expect(bytesToHex(opened.mlkemPublicKey)).toBe(bytesToHex(keys.mlkemPublicKey));
    await expect(openSharingMaterial(generateScopeKek(), sealed)).rejects.toThrow();
  });

  it('rebuilds the genesis sharing public keys from the vector material', async () => {
    const { sharingKeysFromMaterial } = await import('./crypto');
    const keys = sharingKeysFromMaterial(
      hexToBytes(dk.genesis_sharing_keys.x25519_private_key_hex),
      hexToBytes(dk.genesis_sharing_keys.mlkem_seed_hex),
    );
    expect(bytesToBase64(keys.x25519PublicKey)).toBe(dk.genesis_sharing_keys.x25519_public_key);
    const { sha256 } = await import('@noble/hashes/sha2.js');
    expect(bytesToHex(sha256(keys.mlkemPublicKey))).toBe(
      dk.genesis_sharing_keys.mlkem_public_key_sha256,
    );
  });
});

describe('share sub-keys', () => {
  it('reproduces the vector sub-key of every item scope', async () => {
    const connectionKey = hexToBytes(dk.share_subkeys.connection_key_hex);
    for (const scope of ITEM_SCOPES) {
      expect(bytesToHex(await deriveShareSubkey(connectionKey, scope))).toBe(
        dk.share_subkeys[scope],
      );
    }
  });
});
