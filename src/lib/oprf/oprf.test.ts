import { describe, expect, it } from 'vitest';
import { ristretto255_oprf } from '@noble/curves/ed25519.js';
import vectors from '@/test/fixtures/test-vectors.json';
import rfc from '@/test/fixtures/rfc9497-ristretto255-sha512-oprf.json';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
} from '@/lib/encoding';
import {
  ARGON2ID_PARAMETERS,
  OPRF_HASH_TO_GROUP_DST,
  blindInputWithScalar,
  blindPin,
  blindPinWithScalar,
  deriveAccountProofKey,
  deriveDevicePinKeys,
  deviceConfirmMessage,
  ed25519PublicKey,
  ed25519Sign,
  finalizePin,
  pinIkm,
  pinLeaf,
  signDeviceConfirmation,
  stretchPin,
} from './pin-keys';

const v = vectors.pin_oprf;
const userAddress = vectors.seed_and_user_address.user_address;

describe('RFC 9497 ristretto255-SHA512 base mode, first', () => {
  it('is the suite and DST this client uses', () => {
    expect(rfc.identifier).toBe('ristretto255-SHA512');
    expect(rfc.mode).toBe(0);
    expect(new TextDecoder().decode(hexToBytes(rfc.groupDST))).toBe(OPRF_HASH_TO_GROUP_DST);
  });

  it('derives the RFC server key from its seed', () => {
    const keys = ristretto255_oprf.oprf.deriveKeyPair(hexToBytes(rfc.seed), hexToBytes(rfc.keyInfo));
    expect(bytesToHex(keys.secretKey)).toBe(rfc.skSm);
  });

  for (const [index, vector] of rfc.vectors.entries()) {
    it(`reproduces vector ${index + 1}: blinded element, evaluation and output`, () => {
      const blinded = blindInputWithScalar(hexToBytes(vector.Input), hexToBytes(vector.Blind));
      expect(bytesToHex(base64ToBytes(blinded.blindedElement))).toBe(vector.BlindedElement);

      const evaluated = ristretto255_oprf.oprf.blindEvaluate(
        hexToBytes(rfc.skSm),
        base64ToBytes(blinded.blindedElement),
      );
      expect(bytesToHex(evaluated)).toBe(vector.EvaluationElement);

      expect(bytesToHex(finalizePin(blinded, bytesToBase64(evaluated)))).toBe(vector.Output);
    });
  }
});

describe('the pin_oprf vectors', () => {
  it('reproduces the server test key', () => {
    const keys = ristretto255_oprf.oprf.deriveKeyPair(
      hexToBytes(v.server.seed_hex),
      utf8ToBytes(v.server.info),
    );
    expect(bytesToHex(keys.secretKey)).toBe(v.server.private_key_hex);
  });

  it('reproduces the blinded element, the evaluation and the OPRF output', () => {
    const blinded = blindPinWithScalar(v.pin, hexToBytes(v.blind.blind_hex));
    expect(blinded.blindedElement).toBe(v.blind.blinded_element);
    const evaluated = ristretto255_oprf.oprf.blindEvaluate(
      hexToBytes(v.server.private_key_hex),
      base64ToBytes(blinded.blindedElement),
    );
    expect(bytesToBase64(evaluated)).toBe(v.evaluation.evaluated_element);
    expect(bytesToHex(finalizePin(blinded, v.evaluation.evaluated_element))).toBe(
      v.evaluation.oprf_output_hex,
    );
  });

  it('uses the recorded Argon2id parameters', () => {
    expect(v.argon2id.parameters).toBe(
      `m=${ARGON2ID_PARAMETERS.m} KiB, t=${ARGON2ID_PARAMETERS.t}, p=${ARGON2ID_PARAMETERS.p}, length=${ARGON2ID_PARAMETERS.dkLen}`,
    );
  });

  it('reproduces both Argon2id outputs, both ikm values and every leaf', async () => {
    const output = hexToBytes(v.evaluation.oprf_output_hex);

    const deviceArgon = await stretchPin(v.pin, hexToBytes(v.argon2id.device_salt_hex));
    expect(bytesToHex(deviceArgon)).toBe(v.argon2id.device_output_hex);
    const deviceIkm = pinIkm(output, deviceArgon);
    expect(bytesToHex(deviceIkm)).toBe(v.device_registration.ikm_hex);
    expect(bytesToHex(await pinLeaf(deviceIkm, 'device-wrap'))).toBe(
      v.device_registration.device_wrap_key_hex,
    );
    expect(bytesToHex(await pinLeaf(deviceIkm, 'device-confirm'))).toBe(
      v.device_registration.device_confirm_seed_hex,
    );

    const accountArgon = await stretchPin(v.pin, utf8ToBytes(userAddress));
    expect(bytesToHex(accountArgon)).toBe(v.argon2id.account_output_hex);
    const accountIkm = pinIkm(output, accountArgon);
    expect(bytesToHex(accountIkm)).toBe(v.account_registration.ikm_hex);
    expect(bytesToHex(await pinLeaf(accountIkm, 'account-proof'))).toBe(
      v.account_registration.account_proof_seed_hex,
    );
  }, 60_000);

  it('reproduces the device confirmation byte for byte', async () => {
    const keys = await deriveDevicePinKeys(
      hexToBytes(v.evaluation.oprf_output_hex),
      v.pin,
      hexToBytes(v.argon2id.device_salt_hex),
    );
    expect(keys.confirmPublicKey).toBe(v.device_registration.confirm_public_key_base64);
    expect(
      deviceConfirmMessage(v.device_registration.registration_id, v.device_registration.attempt_id),
    ).toBe(v.device_registration.confirm_message);
    expect(
      signDeviceConfirmation(
        keys.confirmSeed,
        v.device_registration.registration_id,
        v.device_registration.attempt_id,
      ),
    ).toBe(v.device_registration.confirm_signature_base64);
  }, 60_000);

  it('reproduces the account proof byte for byte, over the digest of the action payload', async () => {
    const key = await deriveAccountProofKey(
      hexToBytes(v.evaluation.oprf_output_hex),
      v.pin,
      userAddress,
    );
    expect(key.publicKey).toBe(v.account_registration.proof_public_key_base64);
    const { sha256 } = await import('@noble/hashes/sha2.js');
    const digest = sha256(utf8ToBytes(v.account_registration.example_action_payload));
    expect(bytesToHex(digest)).toBe(v.account_registration.example_action_digest);
    expect(bytesToBase64(ed25519Sign(key.seed, digest))).toBe(
      v.account_registration.pin_proof_base64,
    );
    expect(ed25519PublicKey(hexToBytes(v.account_registration.account_proof_seed_hex))).toBe(
      v.account_registration.proof_public_key_base64,
    );
  }, 60_000);
});

describe('blinding in production', () => {
  it('uses a fresh blind every time, so two blindings of one PIN differ', () => {
    expect(blindPin('428193').blindedElement).not.toBe(blindPin('428193').blindedElement);
  });

  it('unblinds a random blind to the same output as the fixed one', () => {
    const secretKey = hexToBytes(v.server.private_key_hex);
    const blinded = blindPin(v.pin);
    const evaluated = ristretto255_oprf.oprf.blindEvaluate(secretKey, base64ToBytes(blinded.blindedElement));
    expect(bytesToHex(finalizePin(blinded, bytesToBase64(evaluated)))).toBe(
      v.evaluation.oprf_output_hex,
    );
  });

  it('refuses an evaluated element that is not a ristretto255 encoding', () => {
    expect(() => finalizePin(blindPin(v.pin), bytesToBase64(new Uint8Array(32).fill(0xff)))).toThrow(
      /ristretto255/,
    );
    expect(() => finalizePin(blindPin(v.pin), 'AAAA')).toThrow(/ristretto255/);
  });
});
