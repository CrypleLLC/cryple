import {
  INTERNAL_ERROR,
  RATE_LIMITED,
  RateLimiter,
  clientKey,
  describeUpstreamRejection,
  parseEnvelope,
  pinSponsorshipPolicy,
  readRequestsPerMinute,
  readSponsorshipPolicyId,
  resolveUpstreamUrl,
  type JsonRpcId,
} from '@/lib/aa-proxy';

export const dynamic = 'force-dynamic';

const UPSTREAM_TIMEOUT_MS = 30_000;

const limiter = new RateLimiter(readRequestsPerMinute(process.env.AA_PROXY_REQUESTS_PER_MINUTE));

function errorResponse(
  status: number,
  id: JsonRpcId,
  code: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export async function POST(request: Request): Promise<Response> {
  const decision = limiter.check(
    clientKey(request.headers.get('x-forwarded-for'), request.headers.get('x-real-ip')),
  );

  if (!decision.allowed) {
    return errorResponse(429, null, RATE_LIMITED, 'Rate limit exceeded', {
      'Retry-After': String(decision.retryAfterSeconds),
    });
  }

  const envelope = parseEnvelope(await request.text());
  if (!envelope.ok) {
    return errorResponse(envelope.status, envelope.id, envelope.code, envelope.message);
  }

  const { id, method, params } = envelope.request;

  const pinnedParams = pinSponsorshipPolicy(
    method,
    params,
    readSponsorshipPolicyId({ SPONSORSHIP_POLICY_ID: process.env.SPONSORSHIP_POLICY_ID }),
  );

  let upstream: Response;
  try {
    upstream = await fetch(
      resolveUpstreamUrl({
        PIMLICO_RPC_URL: process.env.PIMLICO_RPC_URL,
        PIMLICO_API_KEY: process.env.PIMLICO_API_KEY,
      }),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params: pinnedParams }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        cache: 'no-store',
      },
    );
  } catch {
    return errorResponse(502, id, INTERNAL_ERROR, 'Upstream request failed');
  }

  const rejection = describeUpstreamRejection(upstream.status);
  if (rejection) {
    return errorResponse(200, id, rejection.code, rejection.message);
  }

  const body = await upstream.text();

  return new Response(body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
