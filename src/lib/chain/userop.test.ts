import { describe, expect, it } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import { hexToBytes } from '@/lib/encoding';
import { encodeCall, toBytes } from './abi';
import { checkInCallData } from './calldata';
import {
  declared,
  HALF_CURVE_ORDER,
  ImplausibleGasEstimateError,
  packGas,
  packUserOperation,
  paymasterAndDataOf,
  initCodeOf,
  requiredPrefund,
  signUserOpHash,
  type UserOperation,
} from './userop';

const operation: UserOperation = {
  sender: '0xaE7E393F8782da9062fb086a0D492dC71E737DEe',
  nonce: '0x7',
  callData: checkInCallData(),
  verificationGasLimit: '0x1bd8d',
  callGasLimit: '0x57ab',
  preVerificationGas: '0x1f46f',
  maxPriorityFeePerGas: '0x5f5e100',
  maxFeePerGas: '0xbebc200',
  signature: '0x',
};

const castCalldata =
  '0x22cdde4c0000000000000000000000000000000000000000000000000000000000000020' +
  '000000000000000000000000ae7e393f8782da9062fb086a0d492dc71e737dee' +
  '0000000000000000000000000000000000000000000000000000000000000007' +
  '0000000000000000000000000000000000000000000000000000000000000120' +
  '0000000000000000000000000000000000000000000000000000000000000140' +
  '0000000000000000000000000001bd8d000000000000000000000000000057ab' +
  '000000000000000000000000000000000000000000000000000000000001f46f' +
  '00000000000000000000000005f5e1000000000000000000000000000bebc200' +
  '00000000000000000000000000000000000000000000000000000000000002e0' +
  '0000000000000000000000000000000000000000000000000000000000000300';

const privateKey = hexToBytes('42'.repeat(32));
const publicKey = p256.getPublicKey(privateKey, false);

describe('packed user operation', () => {
  it('packs the two gas words the way the EntryPoint reads them', () => {
    expect(packGas(114061n, 22443n)).toBe(
      '0x0000000000000000000000000001bd8d000000000000000000000000000057ab',
    );
  });

  it('encodes getUserOpHash calldata byte for byte with cast', () => {
    const encoded = encodeCall(
      'getUserOpHash((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes))',
      [packUserOperation(operation)],
    );
    expect(encoded.startsWith(castCalldata)).toBe(true);
  });

  it('leaves initCode and paymasterAndData empty when neither is used', () => {
    expect(initCodeOf(operation)).toBe('0x');
    expect(paymasterAndDataOf(operation)).toBe('0x');
  });

  it('concatenates the factory and its calldata into initCode', () => {
    expect(
      initCodeOf({ ...operation, factory: '0xAAbb', factoryData: '0xccdd' }),
    ).toBe('0xaabbccdd');
  });

  it('packs the paymaster gas limits into the 20+16+16 layout', () => {
    const packed = paymasterAndDataOf({
      ...operation,
      paymaster: '0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402',
      paymasterData: '0xbeef',
      paymasterVerificationGasLimit: '0x30d40',
      paymasterPostOpGasLimit: '0x1',
    });
    expect(packed).toBe(
      '0x888888888888ec68a58ab8094cc1ad20ba3d2402' +
        '00000000000000000000000000030d40' +
        '00000000000000000000000000000001' +
        'beef',
    );
  });

  it('prices the prefund off the declared limits, not the estimate', () => {
    expect(
      requiredPrefund(
        { verificationGasLimit: 114061n, callGasLimit: 22443n, preVerificationGas: 128111n },
        200_000_000n,
      ),
    ).toBe(52_923_000_000_000n);
  });
});

describe('user operation signature', () => {
  const userOpHash = '0x7014881aa72029bc1e17e3098eae7abffb233b95e298ebbf12e94ac8cf477afd';

  it('signs the userOpHash itself, never a hash of it', () => {
    const signature = toBytes(signUserOpHash(userOpHash, privateKey));
    expect(
      p256.verify(signature, toBytes(userOpHash), publicKey, {
        format: 'compact',
        prehash: false,
      }),
    ).toBe(true);
  });

  it('would fail on-chain if the digest were hashed again', () => {
    const signature = toBytes(signUserOpHash(userOpHash, privateKey));
    expect(
      p256.verify(signature, toBytes(userOpHash), publicKey, {
        format: 'compact',
        prehash: true,
      }),
    ).toBe(false);
  });

  it('emits a 64-byte low-s signature the account will accept', () => {
    const signature = toBytes(signUserOpHash(userOpHash, privateKey));
    expect(signature.length).toBe(64);
    const s = BigInt(`0x${Buffer.from(signature.slice(32)).toString('hex')}`);
    expect(s <= HALF_CURVE_ORDER).toBe(true);
  });
});

describe('a degenerate gas estimate must not become a declared limit', () => {
  it('refuses a zero, which a rate-limited public bundler really does return', () => {
    expect(() => declared('verificationGasLimit', '0x0', 125n, 50_000n)).toThrow(
      ImplausibleGasEstimateError,
    );
  });

  it('refuses a missing field', () => {
    expect(() => declared('verificationGasLimit', undefined, 125n, 50_000n)).toThrow(
      ImplausibleGasEstimateError,
    );
  });

  it('refuses an implausibly small estimate', () => {
    expect(() => declared('verificationGasLimit', '0x64', 125n, 50_000n)).toThrow(
      ImplausibleGasEstimateError,
    );
  });

  it('does not paper over it with a ceiling the paymaster would refuse', () => {
    try {
      declared('verificationGasLimit', '0x0', 125n, 50_000n);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('retry');
    }
  });

  it('uses the estimate plus headroom when it is sane', () => {
    expect(declared('verificationGasLimit', '0x16471', 125n, 50_000n)).toBe(114_061n);
  });

  it('keeps a value sitting exactly on the floor', () => {
    expect(declared('verificationGasLimit', '0x9c40', 125n, 50_000n)).toBe(50_000n);
  });
});
