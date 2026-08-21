const SPONSORSHIP_METHODS: ReadonlySet<string> = new Set([
  'pm_getPaymasterStubData',
  'pm_getPaymasterData',
]);

const CONTEXT_INDEX = 3;
const POLICY_FIELD = 'sponsorshipPolicyId';

export interface SponsorshipEnv {
  SPONSORSHIP_POLICY_ID?: string;
}

export function readSponsorshipPolicyId(env: SponsorshipEnv): string | undefined {
  const configured = env.SPONSORSHIP_POLICY_ID?.trim();
  return configured && configured.length > 0 ? configured : undefined;
}

export function pinSponsorshipPolicy(
  method: string,
  params: readonly unknown[],
  policyId: string | undefined,
): readonly unknown[] {
  if (!SPONSORSHIP_METHODS.has(method)) {
    return params;
  }

  const supplied = params[CONTEXT_INDEX];
  const context =
    typeof supplied === 'object' && supplied !== null && !Array.isArray(supplied)
      ? { ...(supplied as Record<string, unknown>) }
      : {};

  if (policyId) {
    context[POLICY_FIELD] = policyId;
  } else {
    delete context[POLICY_FIELD];
  }

  const pinned = [...params];
  while (pinned.length < CONTEXT_INDEX) {
    pinned.push(null);
  }
  pinned[CONTEXT_INDEX] = context;

  return pinned;
}
