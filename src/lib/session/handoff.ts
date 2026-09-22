import { isHandoffMaterial, type SessionHandoffMaterial } from './index';

export const HANDOFF_TIMEOUT_MS = 1200;
export const HANDOFF_REQUEST = 'cryple-session-handoff/request';
export const HANDOFF_OFFER = 'cryple-session-handoff/offer';

export interface HandoffOffer {
  material: SessionHandoffMaterial;
  token?: string;
}

export interface HandoffPeer {
  readonly closed?: boolean;
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface HandoffMessageEvent {
  readonly data: unknown;
  readonly origin: string;
  readonly source: unknown;
}

export type HandoffListener = (event: HandoffMessageEvent) => void;

export interface HandoffHost {
  readonly origin: string;
  readonly opener: HandoffPeer | null;
  open(url: string): HandoffPeer | null;
  addEventListener(type: 'message', listener: HandoffListener): void;
  removeEventListener(type: 'message', listener: HandoffListener): void;
}

interface RequestMessage {
  kind: typeof HANDOFF_REQUEST;
  nonce: string;
}

interface OfferMessage {
  kind: typeof HANDOFF_OFFER;
  nonce: string;
  offer: HandoffOffer;
}

function isRequest(value: unknown): value is RequestMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const message = value as Partial<RequestMessage>;
  return message.kind === HANDOFF_REQUEST && typeof message.nonce === 'string';
}

function isOffer(value: unknown): value is OfferMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const message = value as Partial<OfferMessage>;
  return (
    message.kind === HANDOFF_OFFER &&
    typeof message.nonce === 'string' &&
    isHandoffMaterial(message.offer?.material)
  );
}

export class HandoffServer {
  private readonly host: HandoffHost;
  private readonly children = new Set<HandoffPeer>();

  constructor(host: HandoffHost) {
    this.host = host;
  }

  open(url: string): HandoffPeer | undefined {
    const child = this.host.open(url);
    if (child === null) {
      return undefined;
    }
    this.children.add(child);
    return child;
  }

  serve(provide: () => HandoffOffer | undefined): () => void {
    const listener: HandoffListener = (event) => {
      if (event.origin !== this.host.origin || !isRequest(event.data)) {
        return;
      }

      const child = this.openedChild(event.source);
      if (child === undefined) {
        return;
      }

      const offer = provide();
      if (offer === undefined) {
        return;
      }

      child.postMessage(
        { kind: HANDOFF_OFFER, nonce: event.data.nonce, offer } satisfies OfferMessage,
        this.host.origin,
      );
    };

    this.host.addEventListener('message', listener);
    return () => this.host.removeEventListener('message', listener);
  }

  private openedChild(source: unknown): HandoffPeer | undefined {
    for (const child of this.children) {
      if (child.closed === true) {
        this.children.delete(child);
        continue;
      }
      if (child === source) {
        return child;
      }
    }
    return undefined;
  }
}

export function requestSessionFromOpener(
  host: HandoffHost,
  options: { timeoutMs?: number } = {},
): Promise<HandoffOffer | undefined> {
  const opener = host.opener;
  if (opener === null) {
    return Promise.resolve(undefined);
  }

  const nonce = crypto.randomUUID();
  const timeoutMs = options.timeoutMs ?? HANDOFF_TIMEOUT_MS;

  return new Promise<HandoffOffer | undefined>((resolve) => {
    const listener: HandoffListener = (event) => {
      if (
        event.origin !== host.origin ||
        event.source !== opener ||
        !isOffer(event.data) ||
        event.data.nonce !== nonce
      ) {
        return;
      }
      settle(event.data.offer);
    };

    const settle = (offer?: HandoffOffer) => {
      clearTimeout(timer);
      host.removeEventListener('message', listener);
      resolve(offer);
    };

    host.addEventListener('message', listener);
    const timer = setTimeout(() => settle(undefined), timeoutMs);

    try {
      opener.postMessage({ kind: HANDOFF_REQUEST, nonce } satisfies RequestMessage, host.origin);
    } catch {
      settle(undefined);
    }
  });
}

export function browserHandoffHost(): HandoffHost | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const target = window;
  return {
    origin: target.location.origin,
    get opener() {
      return (target.opener as HandoffPeer | null) ?? null;
    },
    open: (url) => target.open(url, '_blank'),
    addEventListener: (type, listener) => target.addEventListener(type, listener),
    removeEventListener: (type, listener) => target.removeEventListener(type, listener),
  };
}

let browserServer: HandoffServer | undefined;

function sharedServer(): HandoffServer | undefined {
  if (browserServer === undefined) {
    const host = browserHandoffHost();
    browserServer = host === undefined ? undefined : new HandoffServer(host);
  }
  return browserServer;
}

export function openWithSessionHandoff(url: string): boolean {
  return sharedServer()?.open(url) !== undefined;
}

export function serveSession(provide: () => HandoffOffer | undefined): () => void {
  return sharedServer()?.serve(provide) ?? (() => undefined);
}

export function requestSession(
  timeoutMs: number = HANDOFF_TIMEOUT_MS,
): Promise<HandoffOffer | undefined> {
  const host = browserHandoffHost();
  return host === undefined ? Promise.resolve(undefined) : requestSessionFromOpener(host, { timeoutMs });
}
