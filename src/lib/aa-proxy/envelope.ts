import { isProxiedMethod } from './allowlist';

export const MAX_BODY_BYTES = 512 * 1024;

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INTERNAL_ERROR = -32603;
export const RATE_LIMITED = -32005;
export const UPSTREAM_UNAUTHORIZED = -32002;

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params: readonly unknown[];
}

export interface EnvelopeAccepted {
  ok: true;
  request: JsonRpcRequest;
}

export interface EnvelopeRejected {
  ok: false;
  status: number;
  code: number;
  message: string;
  id: JsonRpcId;
}

export type EnvelopeResult = EnvelopeAccepted | EnvelopeRejected;

function readId(value: unknown): JsonRpcId {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function reject(status: number, code: number, message: string, id: JsonRpcId): EnvelopeRejected {
  return { ok: false, status, code, message, id };
}

export function parseEnvelope(raw: string): EnvelopeResult {
  if (raw.length > MAX_BODY_BYTES) {
    return reject(413, INVALID_REQUEST, 'Request body too large', null);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return reject(200, PARSE_ERROR, 'Invalid JSON', null);
  }

  if (Array.isArray(parsed)) {
    return reject(200, INVALID_REQUEST, 'Batch requests are not proxied', null);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return reject(200, INVALID_REQUEST, 'Request must be a JSON-RPC object', null);
  }

  const body = parsed as Record<string, unknown>;
  const id = readId(body.id);

  if (body.jsonrpc !== '2.0') {
    return reject(200, INVALID_REQUEST, 'Unsupported jsonrpc version', id);
  }

  if (typeof body.method !== 'string') {
    return reject(200, INVALID_REQUEST, 'Missing method', id);
  }

  if (!isProxiedMethod(body.method)) {
    return reject(200, METHOD_NOT_FOUND, `${body.method} is not proxied`, id);
  }

  const params = body.params === undefined ? [] : body.params;
  if (!Array.isArray(params)) {
    return reject(200, INVALID_REQUEST, 'params must be an array', id);
  }

  return { ok: true, request: { jsonrpc: '2.0', id, method: body.method, params } };
}
