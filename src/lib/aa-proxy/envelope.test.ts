import { describe, expect, it } from 'vitest';
import {
  INVALID_REQUEST,
  MAX_BODY_BYTES,
  METHOD_NOT_FOUND,
  PARSE_ERROR,
  parseEnvelope,
} from './envelope';
import { PROXIED_METHODS } from './allowlist';

function body(method: string, params: unknown = []): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
}

describe('parseEnvelope', () => {
  it('accepts every proxied method', () => {
    for (const method of PROXIED_METHODS) {
      const result = parseEnvelope(body(method));
      expect(result.ok, method).toBe(true);
    }
  });

  it('rejects node methods that must never carry the key', () => {
    for (const method of ['eth_call', 'eth_getBalance', 'eth_getCode', 'eth_sendRawTransaction']) {
      const result = parseEnvelope(body(method));
      expect(result.ok, method).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(METHOD_NOT_FOUND);
      }
    }
  });

  it('rejects pimlico account and sponsorship management methods', () => {
    for (const method of ['pimlico_getUserOperationGasPrice', 'pm_sponsorUserOperation']) {
      expect(parseEnvelope(body(method)).ok, method).toBe(false);
    }
  });

  it('rejects batches so one request cannot smuggle a denied method', () => {
    const result = parseEnvelope(
      JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'eth_sendUserOperation', params: [] },
        { jsonrpc: '2.0', id: 2, method: 'eth_call', params: [] },
      ]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(INVALID_REQUEST);
    }
  });

  it('rejects malformed json with a parse error', () => {
    const result = parseEnvelope('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(PARSE_ERROR);
    }
  });

  it('rejects a wrong jsonrpc version', () => {
    const result = parseEnvelope(JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'eth_sendUserOperation' }));
    expect(result.ok).toBe(false);
  });

  it('rejects non-array params', () => {
    const result = parseEnvelope(body('eth_sendUserOperation', { sender: '0x' }));
    expect(result.ok).toBe(false);
  });

  it('defaults omitted params to an empty array', () => {
    const result = parseEnvelope(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'eth_sendUserOperation' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.params).toEqual([]);
    }
  });

  it('rejects an oversized body with 413 before parsing', () => {
    const result = parseEnvelope('x'.repeat(MAX_BODY_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(413);
    }
  });

  it('preserves the request id so the client can correlate the reply', () => {
    const result = parseEnvelope(JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'pm_getPaymasterData', params: [] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.id).toBe(42);
    }
  });
});
