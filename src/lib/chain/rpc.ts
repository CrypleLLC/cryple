import { getBundlerUrl, getRpcUrl } from './config';

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export class JsonRpcError extends Error {
  readonly code: number;
  readonly method: string;
  readonly data?: unknown;

  constructor(method: string, body: JsonRpcErrorBody) {
    super(`${method} failed: ${body.message}`);
    this.name = 'JsonRpcError';
    this.code = body.code;
    this.method = method;
    this.data = body.data;
  }
}

export class ChainUnreachableError extends Error {
  readonly method: string;

  constructor(method: string, cause: unknown) {
    super(`${method} could not reach the network`);
    this.name = 'ChainUnreachableError';
    this.method = method;
    this.cause = cause;
  }
}

let requestId = 0;

export async function jsonRpc<T>(
  url: string,
  method: string,
  params: readonly unknown[],
  signal?: AbortSignal,
): Promise<T> {
  requestId += 1;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      signal,
    });
  } catch (cause) {
    throw new ChainUnreachableError(method, cause);
  }

  if (!response.ok) {
    throw new ChainUnreachableError(method, new Error(`HTTP ${response.status}`));
  }

  const body = (await response.json()) as { result?: T; error?: JsonRpcErrorBody };
  if (body.error) {
    throw new JsonRpcError(method, body.error);
  }

  return body.result as T;
}

export function nodeCall<T>(
  method: string,
  params: readonly unknown[],
  signal?: AbortSignal,
): Promise<T> {
  return jsonRpc<T>(getRpcUrl(), method, params, signal);
}

export function bundlerCall<T>(
  method: string,
  params: readonly unknown[],
  signal?: AbortSignal,
): Promise<T> {
  return jsonRpc<T>(getBundlerUrl(), method, params, signal);
}

export function ethCall(
  to: string,
  data: string,
  signal?: AbortSignal,
): Promise<string> {
  return nodeCall<string>('eth_call', [{ to, data }, 'latest'], signal);
}

export function ethCallFrom(
  from: string,
  to: string,
  data: string,
  signal?: AbortSignal,
): Promise<string> {
  return nodeCall<string>('eth_call', [{ from, to, data }, 'latest'], signal);
}

export async function getCode(address: string, signal?: AbortSignal): Promise<string> {
  return nodeCall<string>('eth_getCode', [address, 'latest'], signal);
}

export async function isDeployed(address: string, signal?: AbortSignal): Promise<boolean> {
  const code = await getCode(address, signal);
  return code !== '0x' && code !== '0x0' && code.length > 2;
}
