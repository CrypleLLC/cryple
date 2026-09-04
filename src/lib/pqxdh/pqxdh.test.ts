import { describe, expect, it } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@/lib/encoding';
import { deriveKeyTreeFromSeed } from '@/lib/keys';
import {
  buildInfo,
  deriveSessionKey,
  MalformedPqxdhBlobError,
  parseBlob,
  pqxdhUnwrap,
  pqxdhWrap,
  PQXDH_USAGES,
  PQXDH_VERSION,
  UnsupportedPqxdhVersionError,
  EPHEMERAL_PUBLIC_LENGTH,
  KEM_CIPHERTEXT_LENGTH,
  IV_LENGTH,
  type PqxdhContext,
} from './index';

const pq = vectors.pqxdh;
const userAddress = vectors.seed_and_user_address.user_address;

const tree = await deriveKeyTreeFromSeed(hexToBytes(vectors.seed_and_user_address.seed_hex));

const context: PqxdhContext = {
  usage: 'recovery-share',
  senderUserAddress: userAddress,
  recipientUserAddress: userAddress,
};

const secrets = {
  x25519PrivateKey: tree.x25519.privateKey,
  mlkemSecretKey: tree.mlkem768.secretKey,
};

const recipient = {
  x25519PublicKey: tree.x25519.publicKey,
  mlkemPublicKey: tree.mlkem768.publicKey,
};

describe('the info string is built exactly as specified', () => {
  it('reproduces the vector info', () => {
    expect(buildInfo(context)).toBe(pq.inputs.info);
  });

  it('joins version, usage, sender and recipient with pipes', () => {
    expect(
      buildInfo({
        usage: 'recovery-share',
        senderUserAddress: 'a'.repeat(64),
        recipientUserAddress: 'b'.repeat(64),
      }),
    ).toBe(`Cryple-PQXDH-v1|recovery-share|${'a'.repeat(64)}|${'b'.repeat(64)}`);
  });

  it('defines exactly the two usage labels', () => {
    expect([...PQXDH_USAGES]).toEqual(['recovery-share', 'recovery-session']);
  });
});

describe('the combiner reproduces the recorded session key', () => {
  it('derives session_key_hex from the recorded ecdh and kem secrets', async () => {
    const sessionKey = await deriveSessionKey(
      hexToBytes(pq.intermediate.ecdh_secret_hex),
      hexToBytes(pq.intermediate.kem_secret_hex),
      context,
    );
    expect(bytesToHex(sessionKey)).toBe(pq.output.session_key_hex);
  });

  it('pins the normative IKM prefix and zero salt', () => {
    expect(pq.intermediate.ikm_prefix_hex).toBe('ff'.repeat(32));
    expect(pq.intermediate.salt_hex).toBe('00'.repeat(32));
  });

  it('changes the session key when the usage changes', async () => {
    const other = await deriveSessionKey(
      hexToBytes(pq.intermediate.ecdh_secret_hex),
      hexToBytes(pq.intermediate.kem_secret_hex),
      { ...context, usage: 'recovery-session' },
    );
    expect(bytesToHex(other)).not.toBe(pq.output.session_key_hex);
  });

  it('changes the session key when either address changes', async () => {
    for (const patch of [
      { senderUserAddress: 'c'.repeat(64) },
      { recipientUserAddress: 'd'.repeat(64) },
    ]) {
      const other = await deriveSessionKey(
        hexToBytes(pq.intermediate.ecdh_secret_hex),
        hexToBytes(pq.intermediate.kem_secret_hex),
        { ...context, ...patch },
      );
      expect(bytesToHex(other)).not.toBe(pq.output.session_key_hex);
    }
  });

  it('is order-sensitive in the IKM — swapping the two secrets diverges', async () => {
    const swapped = await deriveSessionKey(
      hexToBytes(pq.intermediate.kem_secret_hex),
      hexToBytes(pq.intermediate.ecdh_secret_hex),
      context,
    );
    expect(bytesToHex(swapped)).not.toBe(pq.output.session_key_hex);
  });
});

describe('the recorded wire blob decrypts', () => {
  it('unwraps to the recorded plaintext DEK', async () => {
    const opened = await pqxdhUnwrap(pq.aead_wrap_example.wire_blob_base64, secrets, context);
    expect(bytesToHex(opened)).toBe(pq.aead_wrap_example.plaintext_dek_hex);
  });

  it('parses into the documented field lengths', () => {
    const parsed = parseBlob(pq.aead_wrap_example.wire_blob_base64);
    expect(parsed.version).toBe(PQXDH_VERSION);
    expect(parsed.kemCiphertext).toHaveLength(KEM_CIPHERTEXT_LENGTH);
    expect(parsed.ephemeralPublicKey).toHaveLength(EPHEMERAL_PUBLIC_LENGTH);
    expect(parsed.iv).toHaveLength(IV_LENGTH);
    expect(parsed.sealed).toHaveLength(32 + 16);
  });

  it('carries the recorded ephemeral public key, kem ciphertext and iv', () => {
    const parsed = parseBlob(pq.aead_wrap_example.wire_blob_base64);
    expect(bytesToHex(parsed.ephemeralPublicKey)).toBe(
      pq.inputs.sender_ephemeral_x25519_public_hex,
    );
    expect(bytesToHex(parsed.kemCiphertext)).toBe(pq.inputs.kem_ciphertext_hex);
    expect(bytesToHex(parsed.iv)).toBe(pq.aead_wrap_example.iv_hex);
  });

  it('fails to open under the wrong usage label', async () => {
    await expect(
      pqxdhUnwrap(pq.aead_wrap_example.wire_blob_base64, secrets, {
        ...context,
        usage: 'recovery-session',
      }),
    ).rejects.toThrow();
  });
});

describe('wrap and unwrap round-trip', () => {
  it('opens what it sealed', async () => {
    const payload = hexToBytes(pq.aead_wrap_example.plaintext_dek_hex);
    const blob = await pqxdhWrap(payload, recipient, context);
    expect(bytesToHex(await pqxdhUnwrap(blob, secrets, context))).toBe(
      pq.aead_wrap_example.plaintext_dek_hex,
    );
  });

  it('uses a fresh ephemeral key per wrap, so the blob is never repeated', async () => {
    const payload = utf8ToBytes('share');
    const first = parseBlob(await pqxdhWrap(payload, recipient, context));
    const second = parseBlob(await pqxdhWrap(payload, recipient, context));

    expect(bytesToHex(first.ephemeralPublicKey)).not.toBe(
      bytesToHex(second.ephemeralPublicKey),
    );
    expect(bytesToHex(first.kemCiphertext)).not.toBe(bytesToHex(second.kemCiphertext));
    expect(bytesToHex(first.iv)).not.toBe(bytesToHex(second.iv));
  });

  it('produces a self-contained blob of the documented size for a 32-byte DEK', async () => {
    const blob = await pqxdhWrap(new Uint8Array(32), recipient, context);
    expect(atob(blob)).toHaveLength(1181);
    expect(blob).toHaveLength(1576);
  });

  it('refuses to open under a different context than it was sealed with', async () => {
    const blob = await pqxdhWrap(utf8ToBytes('secret'), recipient, context);
    await expect(
      pqxdhUnwrap(blob, secrets, { ...context, senderUserAddress: 'e'.repeat(64) }),
    ).rejects.toThrow();
  });

  it('works for every defined usage label', async () => {
    for (const usage of PQXDH_USAGES) {
      const blob = await pqxdhWrap(utf8ToBytes(usage), recipient, { ...context, usage });
      const opened = await pqxdhUnwrap(blob, secrets, { ...context, usage });
      expect(new TextDecoder().decode(opened)).toBe(usage);
    }
  });
});

describe('malformed blobs are rejected before decryption is attempted', () => {
  it('rejects an unknown version byte rather than guessing', async () => {
    const blob = Uint8Array.from(atob(pq.aead_wrap_example.wire_blob_base64), (c) =>
      c.charCodeAt(0),
    );
    blob[0] = 0x02;
    const tampered = btoa(String.fromCharCode(...blob));

    expect(() => parseBlob(tampered)).toThrow(UnsupportedPqxdhVersionError);
    await expect(pqxdhUnwrap(tampered, secrets, context)).rejects.toThrow(
      UnsupportedPqxdhVersionError,
    );
  });

  it('rejects a blob shorter than the layout allows', () => {
    expect(() => parseBlob(btoa('\x01short'))).toThrow(MalformedPqxdhBlobError);
  });

  it('rejects a truncated blob that lost its tag', () => {
    const blob = Uint8Array.from(atob(pq.aead_wrap_example.wire_blob_base64), (c) =>
      c.charCodeAt(0),
    );
    const truncated = btoa(String.fromCharCode(...blob.subarray(0, 1140)));
    expect(() => parseBlob(truncated)).toThrow(MalformedPqxdhBlobError);
  });

  it('fails authentication on a tampered ciphertext', async () => {
    const blob = Uint8Array.from(atob(pq.aead_wrap_example.wire_blob_base64), (c) =>
      c.charCodeAt(0),
    );
    blob[blob.length - 1] ^= 0xff;
    await expect(
      pqxdhUnwrap(btoa(String.fromCharCode(...blob)), secrets, context),
    ).rejects.toThrow();
  });
});
