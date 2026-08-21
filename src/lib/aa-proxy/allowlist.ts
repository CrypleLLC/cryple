export const PROXIED_METHODS = [
  'eth_estimateUserOperationGas',
  'eth_sendUserOperation',
  'eth_getUserOperationReceipt',
  'pm_getPaymasterStubData',
  'pm_getPaymasterData',
] as const;

export type ProxiedMethod = (typeof PROXIED_METHODS)[number];

const proxied: ReadonlySet<string> = new Set(PROXIED_METHODS);

export function isProxiedMethod(method: string): method is ProxiedMethod {
  return proxied.has(method);
}
