import { CHAIN_ID } from '@/lib/chain/config';
import { UPSTREAM_UNAUTHORIZED } from './envelope';

export const PUBLIC_PIMLICO_URL = `https://public.pimlico.io/v2/${CHAIN_ID}/rpc`;

export interface UpstreamEnv {
  PIMLICO_RPC_URL?: string;
  PIMLICO_API_KEY?: string;
}

export function resolveUpstreamUrl(env: UpstreamEnv): string {
  const explicit = env.PIMLICO_RPC_URL?.trim();
  if (explicit && explicit.length > 0) {
    return explicit;
  }

  const apiKey = env.PIMLICO_API_KEY?.trim();
  if (apiKey && apiKey.length > 0) {
    return `https://api.pimlico.io/v2/${CHAIN_ID}/rpc?apikey=${encodeURIComponent(apiKey)}`;
  }

  return PUBLIC_PIMLICO_URL;
}

export function isAuthenticatedUpstream(env: UpstreamEnv): boolean {
  return resolveUpstreamUrl(env) !== PUBLIC_PIMLICO_URL;
}

export interface UpstreamRejection {
  code: number;
  message: string;
}

export function describeUpstreamRejection(status: number): UpstreamRejection | undefined {
  if (status === 401) {
    return {
      code: UPSTREAM_UNAUTHORIZED,
      message:
        'Upstream rejected the API key (401) — it is missing, invalid, or revoked. ' +
        'Retrying will not help.',
    };
  }

  if (status === 403) {
    return {
      code: UPSTREAM_UNAUTHORIZED,
      message:
        'Upstream refused this method for the API key (403) — check the methods enabled on the ' +
        'key. Retrying will not help.',
    };
  }

  return undefined;
}
