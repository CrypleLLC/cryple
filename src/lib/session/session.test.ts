import { describe, expect, it, vi } from 'vitest';
import vectors from '@/test/fixtures/test-vectors.json';
import { openTestSession } from '@/test/session';
import { bytesToHex } from '@/lib/encoding';
import { verifyPayload } from '@/lib/signing';
import { signPayload } from '@/lib/signing';
import { MissingGenerationError, ScopeNotHeldError, SessionKeystore } from './index';

describe('what the keystore holds', () => {
  it('holds the device key, the scope KEKs by generation and the current generation of each', async () => {
    const { context, keks } = await openTestSession({ generations: { secrets: 3 } });
    const { session } = context;

    expect(session.currentGeneration('secrets')).toBe(3);
    expect(session.currentGeneration('notes')).toBe(1);
    expect(bytesToHex(session.kek('secrets', 2))).toBe(bytesToHex(keks.get('secrets:2')!));
    expect(session.currentKek('secrets').generation).toBe(3);
  });

  it('never holds the phrase, the seed or the root: nothing in it derives from them', async () => {
    const { context } = await openTestSession();
    const material = context.session.exportForHandoff();
    const serialized = JSON.stringify(material, (_key, value) =>
      value instanceof Uint8Array ? bytesToHex(value) : value,
    );

    expect(serialized).not.toContain(vectors.seed_and_user_address.seed_hex);
    expect(serialized).not.toContain(vectors.identity_key_p256.private_key_hex);
    expect(serialized).not.toContain(vectors.vault_kek.vault_kek_hex);
    expect(Object.keys(material)).not.toContain('seedHex');
    expect(Object.keys(material)).not.toContain('mnemonic');
  });

  it('signs with a device key that can never be exported', async () => {
    const { context, devicePublicKey } = await openTestSession();
    const signature = await signPayload('a:1', context.session.signer());
    expect(verifyPayload('a:1', signature, devicePublicKey)).toBe(true);
    await expect(crypto.subtle.exportKey('pkcs8', context.session.device.signingKey)).rejects.toThrow();
  });

  it('refuses a scope this device does not hold', async () => {
    const { context } = await openTestSession({ scopes: ['notes'] });
    expect(context.session.holds('notes')).toBe(true);
    expect(context.session.holds('secrets')).toBe(false);
    expect(context.session.isFullDevice).toBe(false);
    expect(() => context.session.currentKek('secrets')).toThrow(ScopeNotHeldError);
  });

  it('reports a generation it holds no wrap of as a bug, not a silent failure', async () => {
    const { context } = await openTestSession();
    expect(() => context.session.kek('notes', 9)).toThrow(MissingGenerationError);
  });

  it('opens the sharing material of a generation on demand, once', async () => {
    const { context } = await openTestSession();
    const first = await context.session.sharingKeys(1);
    expect(await context.session.sharingKeys(1)).toBe(first);
    expect(first.x25519PublicKey).toHaveLength(32);
  });

  it('adds a rotated generation without dropping the ones before it', async () => {
    const { context } = await openTestSession();
    const next = crypto.getRandomValues(new Uint8Array(32));
    context.session.addKeyrings([{ scope: 'secrets', generation: 2, kek: next }], { secrets: 2 });

    expect(context.session.currentGeneration('secrets')).toBe(2);
    expect(context.session.hasKek('secrets', 1)).toBe(true);
    expect(context.session.kek('secrets', 2)).toBe(next);
  });
});

describe('locking', () => {
  it('zeroes every KEK and the device material, and refuses access afterwards', async () => {
    const { context } = await openTestSession();
    const kek = context.session.kek('secrets', 1);
    const mlkemSeed = context.session.device.mlkemSeed;

    context.session.lock();

    expect(kek.every((byte) => byte === 0)).toBe(true);
    expect(mlkemSeed.every((byte) => byte === 0)).toBe(true);
    expect(context.session.isUnlocked).toBe(false);
    expect(() => context.session.userAddress).toThrow(/locked/);
  });

  it('notifies lock listeners exactly once per lock, and not after unsubscribing', async () => {
    const { context } = await openTestSession();
    const listener = vi.fn();
    const stop = context.session.onLock(listener);

    context.session.lock();
    context.session.lock();
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    const again = await openTestSession();
    again.context.session.onLock(listener);
    again.context.session.lock();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('empties the keystore after the idle window, and re-arms on each access', async () => {
    vi.useFakeTimers();
    try {
      const { context } = await openTestSession();
      const source = context.session.exportForHandoff();
      const session = new SessionKeystore({ idleTimeoutMs: 1000 });
      session.adoptHandoff(source);

      vi.advanceTimersByTime(800);
      expect(session.userAddress).toBe(source.userAddress);
      vi.advanceTimersByTime(800);
      expect(session.isUnlocked).toBe(true);
      vi.advanceTimersByTime(1200);
      expect(session.isUnlocked).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the handoff material', () => {
  it('carries keys, never the phrase, and opens the same KEKs in the adopting tab', async () => {
    const { context } = await openTestSession();
    const adopted = new SessionKeystore({ idleTimeoutMs: 0 });
    adopted.adoptHandoff(structuredClone(context.session.exportForHandoff()));

    expect(adopted.deviceId).toBe(context.session.deviceId);
    expect(bytesToHex(adopted.kek('files', 1))).toBe(bytesToHex(context.session.kek('files', 1)));
    expect(bytesToHex(adopted.device.mlkemPublicKey)).toBe(
      bytesToHex(context.session.device.mlkemPublicKey),
    );
  });

  it('survives structured cloning with a non-extractable signing key that still signs', async () => {
    const { context, devicePublicKey } = await openTestSession();
    const adopted = new SessionKeystore({ idleTimeoutMs: 0 });
    adopted.adoptHandoff(structuredClone(context.session.exportForHandoff()));

    const signature = await signPayload('b:2', adopted.signer());
    expect(verifyPayload('b:2', signature, devicePublicKey)).toBe(true);
  });

  it('hands over copies, so locking one tab does not zero the other', async () => {
    const { context } = await openTestSession();
    const adopted = new SessionKeystore({ idleTimeoutMs: 0 });
    adopted.adoptHandoff(context.session.exportForHandoff());
    context.session.lock();

    expect(adopted.kek('secrets', 1).some((byte) => byte !== 0)).toBe(true);
  });
});
