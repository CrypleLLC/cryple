import { describe, expect, it } from 'vitest';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  CONNECTION_KEY_BYTES,
  ConnectionKeyError,
  createConnectionKey,
  keyFingerprint,
  MalformedPartyAddressError,
  openConnectionKey,
  sealConnectionKey,
  unwrapUnderConnection,
  wrapUnderConnection,
  WRAP_IV_BYTES,
} from './keys';

const senderAddress = 'a'.repeat(64);
const recipientAddress = 'b'.repeat(64);

function recipientPair() {
  const x25519PrivateKey = x25519.utils.randomSecretKey();
  const kem = ml_kem768.keygen();

  return {
    keys: {
      x25519PublicKey: x25519.getPublicKey(x25519PrivateKey),
      mlkemPublicKey: kem.publicKey,
    },
    secrets: { x25519PrivateKey, mlkemSecretKey: kem.secretKey },
  };
}

describe('the connection key', () => {
  it('is 32 bytes and never repeats', () => {
    const first = createConnectionKey();
    const second = createConnectionKey();

    expect(first).toHaveLength(CONNECTION_KEY_BYTES);
    expect(Array.from(first)).not.toEqual(Array.from(second));
  });

  it('survives a round trip through PQXDH', async () => {
    const { keys, secrets } = recipientPair();
    const connectionKey = createConnectionKey();

    const blob = await sealConnectionKey(connectionKey, keys, senderAddress, recipientAddress);
    const opened = await openConnectionKey(blob, secrets, senderAddress, recipientAddress);

    expect(Array.from(opened)).toEqual(Array.from(connectionKey));
  });

  it('refuses to open under a different pair of addresses', async () => {
    const { keys, secrets } = recipientPair();
    const blob = await sealConnectionKey(
      createConnectionKey(),
      keys,
      senderAddress,
      recipientAddress,
    );

    await expect(
      openConnectionKey(blob, secrets, senderAddress, 'c'.repeat(64)),
    ).rejects.toThrow();
  });

  it('refuses a payload that is not a connection key', async () => {
    const { keys, secrets } = recipientPair();
    const blob = await sealConnectionKey(
      new Uint8Array(16),
      keys,
      senderAddress,
      recipientAddress,
    );

    await expect(
      openConnectionKey(blob, secrets, senderAddress, recipientAddress),
    ).rejects.toBeInstanceOf(ConnectionKeyError);
  });
});

describe('refusing an address that cannot reproduce the exchange', () => {
  it('will not seal when the recipient address is missing', async () => {
    const { keys } = recipientPair();

    await expect(
      sealConnectionKey(
        createConnectionKey(),
        keys,
        senderAddress,
        undefined as unknown as string,
      ),
    ).rejects.toBeInstanceOf(MalformedPartyAddressError);
  });

  it('will not seal when an address is the wrong shape', async () => {
    const { keys } = recipientPair();

    await expect(
      sealConnectionKey(createConnectionKey(), keys, senderAddress, 'NOT-HEX'),
    ).rejects.toBeInstanceOf(MalformedPartyAddressError);
  });

  it('will not open with a missing counterparty, rather than failing blankly', async () => {
    const { keys, secrets } = recipientPair();
    const blob = await sealConnectionKey(
      createConnectionKey(),
      keys,
      senderAddress,
      recipientAddress,
    );

    await expect(
      openConnectionKey(blob, secrets, undefined as unknown as string, recipientAddress),
    ).rejects.toBeInstanceOf(MalformedPartyAddressError);
  });

  it('says which side is wrong, because the fix differs', async () => {
    const { keys } = recipientPair();

    await expect(
      sealConnectionKey(createConnectionKey(), keys, '', recipientAddress),
    ).rejects.toThrow(/sender address is empty/);
  });
});

describe('wrapping a DEK under a connection', () => {
  it('opens what it sealed', async () => {
    const connectionKey = createConnectionKey();
    const dek = crypto.getRandomValues(new Uint8Array(32));

    const wrapped = await wrapUnderConnection(connectionKey, dek);
    const opened = await unwrapUnderConnection(connectionKey, wrapped);

    expect(Array.from(opened)).toEqual(Array.from(dek));
  });

  it('draws a fresh IV for every wrap, never a counter', async () => {
    const connectionKey = createConnectionKey();
    const dek = new Uint8Array(32).fill(7);

    const first = await wrapUnderConnection(connectionKey, dek);
    const second = await wrapUnderConnection(connectionKey, dek);

    expect(first).not.toBe(second);
    expect(atob(first).slice(0, WRAP_IV_BYTES)).not.toBe(atob(second).slice(0, WRAP_IV_BYTES));
  });

  it('is 60 bytes for a 32-byte DEK, not a second PQXDH envelope', async () => {
    const wrapped = await wrapUnderConnection(createConnectionKey(), new Uint8Array(32));

    expect(atob(wrapped)).toHaveLength(WRAP_IV_BYTES + 32 + 16);
  });

  it('does not open under a different connection key', async () => {
    const wrapped = await wrapUnderConnection(createConnectionKey(), new Uint8Array(32));

    await expect(unwrapUnderConnection(createConnectionKey(), wrapped)).rejects.toThrow();
  });

  it('refuses a blob shorter than its IV', async () => {
    await expect(
      unwrapUnderConnection(createConnectionKey(), btoa('short')),
    ).rejects.toBeInstanceOf(ConnectionKeyError);
  });
});

describe('the key fingerprint', () => {
  it('is stable for one key pair and differs for another', async () => {
    const first = recipientPair().keys;
    const second = recipientPair().keys;

    expect(await keyFingerprint(first)).toBe(await keyFingerprint(first));
    expect(await keyFingerprint(first)).not.toBe(await keyFingerprint(second));
  });

  it('covers both keys, so swapping either one changes it', async () => {
    const a = recipientPair().keys;
    const b = recipientPair().keys;

    const swappedMlkem = { x25519PublicKey: a.x25519PublicKey, mlkemPublicKey: b.mlkemPublicKey };
    const swappedX25519 = { x25519PublicKey: b.x25519PublicKey, mlkemPublicKey: a.mlkemPublicKey };

    expect(await keyFingerprint(swappedMlkem)).not.toBe(await keyFingerprint(a));
    expect(await keyFingerprint(swappedX25519)).not.toBe(await keyFingerprint(a));
  });

  it('reads as six groups of four, for a human to compare aloud', async () => {
    const fingerprint = await keyFingerprint(recipientPair().keys);

    expect(fingerprint).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){5}$/);
  });
});
