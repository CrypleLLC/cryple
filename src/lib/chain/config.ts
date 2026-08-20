export const CHAIN_ID = 421614;

export const ENTRY_POINT_ADDRESS = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
export const FACTORY_ADDRESS = '0xa2Cd247C12f087450f4991c92e6FBc7cE015a527';
export const IMPLEMENTATION_ADDRESS = '0xc667F4D5997a40AeB4D6C0D45059e3Ecb610a9cF';
export const DEAD_MAN_SWITCH_ADDRESS = '0x6951a65CDc706A2D23E1015d35B8353F18A569a9';
export const PROOF_REGISTRY_ADDRESS = '0xd344197975C4D47f97dDB1d26b91a96be6e83930';

export const EPOCH_SECONDS = 86_400;

export const DEFAULT_RPC_URL = 'https://sepolia-rollup.arbitrum.io/rpc';
export const DEFAULT_BUNDLER_URL = `https://public.pimlico.io/v2/${CHAIN_ID}/rpc`;

export const MVP_GUARDIAN_ROOT = `0x${'00'.repeat(32)}`;
export const MVP_GUARDIAN_THRESHOLD = 0;
export const MVP_RECOVERY_DELAY = 0;
export const MVP_SALT = `0x${'00'.repeat(32)}`;

export const PROBE_VERIFICATION_GAS_LIMIT = 2_000_000n;
export const PROBE_CALL_GAS_LIMIT = 1_000_000n;
export const PROBE_PRE_VERIFICATION_GAS = 300_000n;

export const MIN_VERIFICATION_GAS_LIMIT = 50_000n;
export const MIN_CALL_GAS_LIMIT = 10_000n;
export const MIN_PRE_VERIFICATION_GAS = 21_000n;

export const EXECUTION_GAS_HEADROOM_PERCENT = 125n;
export const PRE_VERIFICATION_GAS_HEADROOM_PERCENT = 115n;

export const MAX_PRIORITY_FEE_PER_GAS = 100_000_000n;
export const MAX_FEE_PER_GAS = 200_000_000n;

export const RECEIPT_POLL_ATTEMPTS = 40;
export const RECEIPT_POLL_INTERVAL_MS = 3_000;

export function getRpcUrl(): string {
  const configured = process.env.NEXT_PUBLIC_CHAIN_RPC_URL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_RPC_URL;
}

export function getBundlerUrl(): string {
  const configured = process.env.NEXT_PUBLIC_BUNDLER_URL?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }

  return getPaymasterUrl() ?? DEFAULT_BUNDLER_URL;
}

export function getPaymasterUrl(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_PAYMASTER_URL?.trim();
  return configured && configured.length > 0 ? configured : undefined;
}

export function getSponsorshipPolicyId(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_SPONSORSHIP_POLICY_ID?.trim();
  return configured && configured.length > 0 ? configured : undefined;
}
