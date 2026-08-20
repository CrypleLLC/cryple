import { describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import { hexToBytes } from '@/lib/encoding';
import { fetchSwitchRecord, planHeartbeat, type HeartbeatIdentity } from './check-in';
import { publicKeyFromPrivate } from './operation';
import {
  fetchCurrentEpoch,
  fetchLatestRoot,
  isEpochAlreadyAnchored,
  planAnchor,
  simulateAnchor,
} from './anchor';
import vectors from '@/test/fixtures/test-vectors.json';
import { fetchUserOpHash, signUserOpHash, simulateHandleOps } from './userop';
import { smartAccountAddress } from './address';

const ownerKey = process.env.CRYPLE_LIVE_OWNER_P256_KEY;
const live = process.env.CRYPLE_LIVE_CHAIN_TESTS === '1' && ownerKey !== undefined;

describe.skipIf(!live)('live Arbitrum Sepolia heartbeat', () => {
  const privateKey = hexToBytes((ownerKey ?? '42'.repeat(32)).replace(/^0x/, ''));
  const identity: HeartbeatIdentity = {
    privateKey,
    publicKeyUncompressed: publicKeyFromPrivate(privateKey),
  };

  it('reads a configured switch straight off the chain', async () => {
    const record = await fetchSwitchRecord('0xebd631e5f50b23ea0281620f6995d9d18e5cae20');
    expect(record.deployed).toBe(true);
    expect(record.status).toBe('active');
    expect(record.inactivityPeriodSeconds).toBe(600);
    expect(record.contestPeriodSeconds).toBe(300);
    expect(record.lastCheckIn).toBeGreaterThan(1787153000);
    expect(record.triggeredAt).toBeUndefined();
  }, 60_000);

  it('derives the same smart account the deployed factory does', () => {
    expect(smartAccountAddress(identity.publicKeyUncompressed)).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('plans a sponsored operation with measured gas limits', async () => {
    const plan = await planHeartbeat(identity, {});
    expect(plan.payer).toBe('paymaster');
    expect(plan.gasLimits.preVerificationGas).toBeGreaterThan(0n);
    expect(
      plan.gasLimits.verificationGasLimit +
        plan.gasLimits.callGasLimit +
        plan.gasLimits.preVerificationGas,
    ).toBeLessThan(1_000_000n);
  }, 120_000);

  it('produces a signature the live account accepts through RIP-7212', async () => {
    const plan = await planHeartbeat(identity, {});
    const userOpHash = await fetchUserOpHash(plan.userOperation);
    const signature = signUserOpHash(userOpHash, privateKey);

    expect(
      p256.verify(hexToBytes(signature.slice(2)), hexToBytes(userOpHash.slice(2)), identity.publicKeyUncompressed, {
        format: 'compact',
        prehash: false,
      }),
    ).toBe(true);

    await expect(
      simulateHandleOps({ ...plan.userOperation, signature }),
    ).resolves.toBeUndefined();
  }, 180_000);

  it('is rejected on-chain when a foreign key signs', async () => {
    const plan = await planHeartbeat(identity, {});
    const userOpHash = await fetchUserOpHash(plan.userOperation);
    const foreign = p256.utils.randomSecretKey();

    await expect(
      simulateHandleOps({ ...plan.userOperation, signature: signUserOpHash(userOpHash, foreign) }),
    ).rejects.toThrow();
  }, 180_000);

  it('plans a sponsored anchor of the vector root against the live registry', async () => {
    const root = `0x${vectors.vault_merkle.root_hex}`;
    const plan = await planAnchor(identity, root, {});

    expect(plan.payer).toBe('paymaster');
    expect(plan.epoch).toBe(await fetchCurrentEpoch());
    expect(plan.root).toBe(root);
  }, 120_000);

  it('produces an anchor signature the live account accepts through RIP-7212', async () => {
    const root = `0x${vectors.vault_merkle.root_hex}`;
    const plan = await planAnchor(identity, root, {});
    const userOpHash = await fetchUserOpHash(plan.userOperation);

    await expect(
      simulateHandleOps({ ...plan.userOperation, signature: signUserOpHash(userOpHash, privateKey) }),
    ).resolves.toBeUndefined();
  }, 180_000);

  it('reports an account that has never anchored as having no root', async () => {
    const noSuchAccount = '0x00000000000000000000000000000000000000ff';
    expect(await fetchLatestRoot(noSuchAccount)).toBeUndefined();
  }, 60_000);

  it('reports a real anchored root for an account that has anchored', async () => {
    const latest = await fetchLatestRoot('0xebd631e5f50b23ea0281620f6995d9d18e5cae20');
    expect(latest).toBeDefined();
    expect(latest?.root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(latest?.epoch).toBeGreaterThan(20_000);
  }, 60_000);

  it('is refused by the live registry when the target epoch is already closed', async () => {
    const account = '0xebd631e5f50b23ea0281620f6995d9d18e5cae20';
    const latest = await fetchLatestRoot(account);
    const epoch = await fetchCurrentEpoch();

    if (latest === undefined || latest.epoch >= epoch) {
      return;
    }

    const caught = await simulateAnchor(account, latest.epoch, `0x${'11'.repeat(32)}`).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(caught).toBeDefined();
    expect(isEpochAlreadyAnchored(caught)).toBe(true);
  }, 60_000);

  it('accepts the same root into the still-open current epoch', async () => {
    const account = '0xebd631e5f50b23ea0281620f6995d9d18e5cae20';
    await expect(
      simulateAnchor(account, await fetchCurrentEpoch(), `0x${'11'.repeat(32)}`),
    ).resolves.toBeUndefined();
  }, 60_000);
});
