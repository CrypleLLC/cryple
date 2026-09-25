import { describe, expect, it } from 'vitest';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519 } from '@noble/curves/ed25519.js';
import vectors from '@/test/fixtures/test-vectors.json';
import { bytesToBase64, hexToBytes } from '@/lib/encoding';
import {
  displayFingerprint,
  formatPairingCode,
  MalformedPairingCodeError,
  normalisePairingCode,
  pairingFingerprint,
} from './fingerprint';

const deviceVectors = vectors.device_keys;

describe('the pairing fingerprint', () => {
  it('reproduces the vector', () => {
    const device = deviceVectors.genesis_device;
    const mlkem = ml_kem768.keygen(hexToBytes(device.mlkem_seed_hex));
    const fingerprint = pairingFingerprint({
      code: deviceVectors.pairing_fingerprint.code,
      userAddress: vectors.seed_and_user_address.user_address,
      rootPublicKey: deviceVectors.root_wrap.root_public_key,
      deviceId: device.device_id,
      signingPublicKey: device.signing_public_key_spki,
      x25519PublicKey: bytesToBase64(x25519.getPublicKey(hexToBytes(device.x25519_private_key_hex))),
      mlkemPublicKey: bytesToBase64(mlkem.publicKey),
    });
    expect(fingerprint).toBe(deviceVectors.pairing_fingerprint.fingerprint);
    expect(displayFingerprint(fingerprint)).toMatch(/^\d{3} \d{3}$/);
  });

  it('changes when any key, the account or the code changes', () => {
    const base = {
      code: 'K7QM9XP2',
      userAddress: 'a'.repeat(64),
      rootPublicKey: 'root',
      deviceId: '00000000-0000-4000-8000-000000000001',
      signingPublicKey: 'sig',
      x25519PublicKey: 'x',
      mlkemPublicKey: 'm',
    };
    const reference = pairingFingerprint(base);
    for (const field of Object.keys(base) as (keyof typeof base)[]) {
      const changed = { ...base, [field]: field === 'code' ? 'K7QM9XP3' : `${base[field]}!` };
      expect(pairingFingerprint(changed), field).not.toBe(reference);
    }
  });
});

describe('a pairing code', () => {
  it('is read the way a person types it', () => {
    expect(normalisePairingCode('k7qm-9xp2')).toBe('K7QM9XP2');
    expect(normalisePairingCode('ILO0 1234')).toBe('11001234');
    expect(formatPairingCode('k7qm9xp2')).toBe('K7QM-9XP2');
  });

  it('refuses anything else', () => {
    for (const typed of ['', 'K7QM-9XP', 'K7QM-9XP22', 'K7QM-9XPU']) {
      expect(() => normalisePairingCode(typed), typed).toThrow(MalformedPairingCodeError);
    }
  });
});
