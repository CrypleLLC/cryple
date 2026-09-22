import { openTestSession } from '@/test/session';
import { describe, expect, it } from 'vitest';
import {
  HANDOFF_OFFER,
  HANDOFF_REQUEST,
  HandoffServer,
  requestSessionFromOpener,
  type HandoffHost,
  type HandoffMessageEvent,
  type HandoffOffer,
  type HandoffPeer,
} from './handoff';

const ORIGIN = 'https://app.cryple.example';
const DOCUMENT_URL = '/docs/00000000-0000-4000-8000-000000000000';

const OFFER: HandoffOffer = {
  material: (await openTestSession()).context.session.exportForHandoff(),
  token: 'header.payload.signature',
};

interface FakeWindow {
  id: number;
  origin: string;
  closed: boolean;
  opener: HandoffPeer | null;
  listeners: Set<(event: HandoffMessageEvent) => void>;
  host: HandoffHost;
}

function fakeBrowser() {
  let nextId = 0;
  const references = new Map<string, HandoffPeer>();
  const windowsByReference = new Map<HandoffPeer, FakeWindow>();

  function reference(holder: FakeWindow, target: FakeWindow): HandoffPeer {
    const key = `${holder.id}->${target.id}`;
    const existing = references.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const created: HandoffPeer = {
      get closed() {
        return target.closed;
      },
      postMessage(message: unknown, targetOrigin: string) {
        if (targetOrigin !== target.origin) {
          return;
        }
        const event: HandoffMessageEvent = {
          data: structuredClone(message),
          origin: holder.origin,
          source: reference(target, holder),
        };
        setTimeout(() => {
          for (const listener of [...target.listeners]) {
            listener(event);
          }
        }, 0);
      },
    };

    references.set(key, created);
    windowsByReference.set(created, target);
    return created;
  }

  function window(origin: string = ORIGIN): FakeWindow {
    const created: FakeWindow = {
      id: nextId++,
      origin,
      closed: false,
      opener: null,
      listeners: new Set(),
      host: undefined as unknown as HandoffHost,
    };

    created.host = {
      origin,
      get opener() {
        return created.opener;
      },
      open() {
        const child = window(origin);
        child.opener = reference(child, created);
        return reference(created, child);
      },
      addEventListener: (_type, listener) => void created.listeners.add(listener),
      removeEventListener: (_type, listener) => void created.listeners.delete(listener),
    };

    return created;
  }

  function open(server: HandoffServer): FakeWindow {
    const peer = server.open(DOCUMENT_URL);
    const child = peer === undefined ? undefined : windowsByReference.get(peer);
    if (child === undefined) {
      throw new Error('the fake browser did not open a window');
    }
    return child;
  }

  return { window, reference, open };
}

function countingServer(
  host: HandoffHost,
  provide: () => HandoffOffer | undefined = () => OFFER,
) {
  const server = new HandoffServer(host);
  const counter = { asked: 0 };
  const stop = server.serve(() => {
    counter.asked += 1;
    return provide();
  });
  return { server, counter, stop };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('session handoff', () => {
  it('hands the session to a window the unlocked tab opened', async () => {
    const browser = fakeBrowser();
    const parent = browser.window();
    const { server } = countingServer(parent.host);

    const child = browser.open(server);

    await expect(requestSessionFromOpener(child.host, { timeoutMs: 200 })).resolves.toEqual(OFFER);
  });

  it('serves the same window again after it reloads', async () => {
    const browser = fakeBrowser();
    const parent = browser.window();
    const { server, counter } = countingServer(parent.host);

    const child = browser.open(server);
    await requestSessionFromOpener(child.host, { timeoutMs: 200 });

    await expect(requestSessionFromOpener(child.host, { timeoutMs: 200 })).resolves.toEqual(OFFER);
    expect(counter.asked).toBe(2);
  });

  it('answers nothing to a same-origin window it did not open, even one holding a reference to it', async () => {
    const browser = fakeBrowser();
    const parent = browser.window();
    const { counter } = countingServer(parent.host);

    const stranger = browser.window();
    stranger.opener = browser.reference(stranger, parent);

    await expect(requestSessionFromOpener(stranger.host, { timeoutMs: 50 })).resolves.toBeUndefined();
    expect(counter.asked).toBe(0);
  });

  it('ignores a request from an opened window that has left this origin', async () => {
    const browser = fakeBrowser();
    const parent = browser.window();
    const { server, counter } = countingServer(parent.host);

    const child = browser.open(server);
    child.origin = 'https://evil.example';
    browser.reference(child, parent).postMessage({ kind: HANDOFF_REQUEST, nonce: 'n' }, ORIGIN);
    await settle();

    expect(counter.asked).toBe(0);
  });

  it('forgets a window once it is closed', async () => {
    const browser = fakeBrowser();
    const parent = browser.window();
    const { server, counter } = countingServer(parent.host);

    const child = browser.open(server);
    child.closed = true;
    browser.reference(child, parent).postMessage({ kind: HANDOFF_REQUEST, nonce: 'n' }, ORIGIN);
    await settle();

    expect(counter.asked).toBe(0);
  });

  it('gets nothing from an opener that is locked', async () => {
    const browser = fakeBrowser();
    const parent = browser.window();
    const { server, counter } = countingServer(parent.host, () => undefined);

    const child = browser.open(server);

    await expect(requestSessionFromOpener(child.host, { timeoutMs: 50 })).resolves.toBeUndefined();
    expect(counter.asked).toBe(1);
  });

  it('stops answering once serving is stopped', async () => {
    const browser = fakeBrowser();
    const parent = browser.window();
    const { server, stop } = countingServer(parent.host);

    const child = browser.open(server);
    stop();

    await expect(requestSessionFromOpener(child.host, { timeoutMs: 50 })).resolves.toBeUndefined();
  });

  it('refuses an offer carrying a different nonce', async () => {
    const browser = fakeBrowser();
    const parent = browser.window();
    const child = browser.window();
    child.opener = browser.reference(child, parent);

    parent.listeners.add((event) => {
      (event.source as HandoffPeer).postMessage(
        { kind: HANDOFF_OFFER, nonce: 'someone-else', offer: OFFER },
        ORIGIN,
      );
    });

    await expect(requestSessionFromOpener(child.host, { timeoutMs: 50 })).resolves.toBeUndefined();
  });

  it('refuses an offer from a window that is not its opener', async () => {
    const browser = fakeBrowser();
    const parent = browser.window();
    const child = browser.window();
    const stranger = browser.window();
    child.opener = browser.reference(child, parent);

    parent.listeners.add((event) => {
      const nonce = (event.data as { nonce: string }).nonce;
      browser.reference(stranger, child).postMessage({ kind: HANDOFF_OFFER, nonce, offer: OFFER }, ORIGIN);
    });

    await expect(requestSessionFromOpener(child.host, { timeoutMs: 50 })).resolves.toBeUndefined();
  });

  it('asks nobody without an opener, and leaves no listener behind', async () => {
    const browser = fakeBrowser();
    const lone = browser.window();

    await expect(requestSessionFromOpener(lone.host, { timeoutMs: 50 })).resolves.toBeUndefined();
    expect(lone.listeners.size).toBe(0);
  });
});
