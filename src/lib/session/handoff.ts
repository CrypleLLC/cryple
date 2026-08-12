import type { SessionHandoffMaterial } from './index';

export const HANDOFF_CHANNEL = 'cryple-session-handoff';
export const HANDOFF_TIMEOUT_MS = 1200;

export interface HandoffOffer {
  material: SessionHandoffMaterial;
  token?: string;
}

interface RequestMessage {
  kind: 'request';
  nonce: string;
}

interface OfferMessage {
  kind: 'offer';
  nonce: string;
  offer: HandoffOffer;
}

type HandoffMessage = RequestMessage | OfferMessage;

function channelsAvailable(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

function isHandoffMessage(value: unknown): value is HandoffMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'nonce' in value &&
    typeof (value as { nonce: unknown }).nonce === 'string'
  );
}

export function serveSession(provide: () => HandoffOffer | undefined): () => void {
  if (!channelsAvailable()) {
    return () => undefined;
  }

  const channel = new BroadcastChannel(HANDOFF_CHANNEL);

  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!isHandoffMessage(message) || message.kind !== 'request') {
      return;
    }

    const offer = provide();
    if (offer === undefined) {
      return;
    }

    channel.postMessage({ kind: 'offer', nonce: message.nonce, offer } satisfies OfferMessage);
  };

  return () => channel.close();
}

export async function requestSession(
  timeoutMs: number = HANDOFF_TIMEOUT_MS,
): Promise<HandoffOffer | undefined> {
  if (!channelsAvailable()) {
    return undefined;
  }

  const channel = new BroadcastChannel(HANDOFF_CHANNEL);
  const nonce = crypto.randomUUID();

  return new Promise<HandoffOffer | undefined>((resolve) => {
    const settle = (offer?: HandoffOffer) => {
      clearTimeout(timer);
      channel.close();
      resolve(offer);
    };

    const timer = setTimeout(() => settle(undefined), timeoutMs);

    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!isHandoffMessage(message) || message.kind !== 'offer' || message.nonce !== nonce) {
        return;
      }
      settle(message.offer);
    };

    channel.postMessage({ kind: 'request', nonce } satisfies RequestMessage);
  });
}
