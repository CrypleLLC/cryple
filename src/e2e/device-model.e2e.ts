import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ApiError, TokenStore, request } from '@/lib/api';
import {
  completeSignUp,
  deleteAccountWithPhrase,
  draftSignUp,
  enrolThisBrowser,
  readVerifiedChain,
  removeOtherDevices,
  removeThisBrowser,
  unlockWithPin,
  type AccountServices,
} from '@/lib/account';
import { AuthRejectedError } from '@/lib/auth';
import type { AuthedContext } from '@/lib/context';
import { memoryDeviceStore, type DeviceRecordStore } from '@/lib/device/store';
import { bytesToHex } from '@/lib/encoding';
import { deriveRootKeysFromMnemonic, generateMnemonic, zeroRootKeys } from '@/lib/keys';
import {
  applyDeviceBatch,
  buildRotation,
  listDevices,
  wrapKekForRoot,
} from '@/lib/keyrings';
import { createDocumentFromSnapshot, getDocument, openDocumentDek, openUpdate } from '@/lib/documents';
import { downloadFile, uploadFile } from '@/lib/files';
import { createNote, getNote, openNote } from '@/lib/notes';
import { rewrapAfterRotation } from '@/lib/rekey';
import { createSecret, getSecret, openSecret } from '@/lib/secrets';
import { getCredential, openCredential, writeCredential } from '@/lib/credentials';
import { SessionKeystore } from '@/lib/session';
import {
  AlreadyConnectedError,
  acceptInvitation,
  copySharedItem,
  editAddressBook,
  inviteByUsername,
  listConnections,
  listInbox,
  loadAddressBook,
  openSharedFile,
  openSharedItem,
  openSharedText,
  setNickname,
  shareItemById,
  verifyConnection,
  type ConnectionRecord,
} from '@/lib/sharing';
import { getMe } from '@/lib/users';

interface Browser {
  services: AccountServices;
  store: DeviceRecordStore;
}

function newBrowser(): Browser {
  const store = memoryDeviceStore();
  return {
    store,
    services: { session: new SessionKeystore({ idleTimeoutMs: 0 }), tokens: new TokenStore(), store },
  };
}

function context(browser: Browser, paranoid = false): AuthedContext {
  return { session: browser.services.session, tokens: browser.services.tokens, paranoid };
}

async function signUp(pin: string, paranoid = false) {
  const mnemonic = generateMnemonic(12);
  const browser = newBrowser();
  const result = await completeSignUp(browser.services, await draftSignUp(mnemonic), { pin, paranoid });
  return { mnemonic, browser, result, username: (await getMe(context(browser))).username };
}

function smallFile(name: string, text: string) {
  const bytes = new TextEncoder().encode(text);
  return {
    name,
    type: 'text/plain',
    size: bytes.length,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice());
          controller.close();
        },
      }),
  };
}

function documentSnapshot(title: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('meta').set('title', title);
  return Y.encodeStateAsUpdate(doc);
}

function snapshotTitle(update: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return String(doc.getMap('meta').get('title'));
}

async function inboundFrom(ctx: AuthedContext, username: string): Promise<ConnectionRecord> {
  const found = (await listConnections(ctx)).find(
    (connection) => connection.username === username && connection.direction === 'inbound',
  );
  if (found === undefined) {
    throw new Error(`no connection from ${username}`);
  }
  return found;
}

async function outboundTo(ctx: AuthedContext, username: string): Promise<ConnectionRecord> {
  const found = (await listConnections(ctx)).find(
    (connection) => connection.username === username && connection.direction === 'outbound',
  );
  if (found === undefined) {
    throw new Error(`no connection to ${username}`);
  }
  return found;
}

async function statusOf(ctx: AuthedContext): Promise<number> {
  try {
    await getMe(ctx);
    return 200;
  } catch (error) {
    return error instanceof ApiError ? error.status : -1;
  }
}

beforeAll(async () => {
  const health = await request<unknown>({ method: 'GET', path: '/ready' });
  expect(health.status).toBe(200);
});

describe('127.5 sign-up with the genesis, and 127.4 unlocking with the server', () => {
  const pin = '482915';
  let account: Awaited<ReturnType<typeof signUp>>;

  beforeAll(async () => {
    account = await signUp(pin);
  });

  it('creates the account, and its chain verifies client-side from the root key', async () => {
    expect(account.result.created).toBe(true);
    const ctx = context(account.browser);
    const state = await readVerifiedChain(
      ctx,
      { userAddress: ctx.session.userAddress, rootPublicKey: ctx.session.rootPublicKey },
      ctx.session.deviceId,
    );
    expect(state.seq).toBe(3);
    expect((await getMe(ctx)).paranoid).toBe(false);
  });

  it('keeps a device record with no seed, no phrase and no root key in it', async () => {
    const record = await account.browser.store.read();
    expect(record?.device_id).toBe(account.browser.services.session.deviceId);
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(account.mnemonic);
    const root = await deriveRootKeysFromMnemonic(account.mnemonic);
    expect(serialized).not.toContain(bytesToHex(root.signing.privateKey));
    expect(serialized).not.toContain(bytesToHex(root.wrapKey));
    zeroRootKeys(root);
    await expect(crypto.subtle.exportKey('pkcs8', record!.signing_key)).rejects.toThrow();
  });

  it('locks, refuses a wrong PIN with the attempts left, and unlocks with the right one', async () => {
    const { services } = account.browser;
    services.tokens.clear();
    services.session.lock();

    const wrong = await unlockWithPin(services, '999111');
    expect(wrong).toEqual({ status: 'wrong-pin', attemptsRemaining: 9 });

    const right = await unlockWithPin(services, pin);
    expect(right.status).toBe('unlocked');
    expect(services.session.isUnlocked).toBe(true);

    services.session.lock();
    const again = await unlockWithPin(services, '999111');
    expect(again).toEqual({ status: 'wrong-pin', attemptsRemaining: 9 });
    expect((await unlockWithPin(services, pin)).status).toBe('unlocked');
  });
});

describe('127.8 items under keyrings and generations, 127.6 enrolment, 127.10 removal', () => {
  const pin = '573920';
  let account: Awaited<ReturnType<typeof signUp>>;
  let second: Browser;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    account = await signUp(pin);
    const ctx = context(account.browser);
    ids.secret = (await createSecret(ctx, 'router password')).secret.id;
    ids.note = (await createNote(ctx, '# Plan\nbody')).note.id;
    ids.document = (await createDocumentFromSnapshot(ctx, documentSnapshot('Will'))).id;
    ids.file = (await uploadFile(ctx, smallFile('deed.txt', 'the deed'))).id;
    ids.credential = (
      await writeCredential(ctx, '{"site":"bank.example","username":"ada","password":"hunter2"}')
    ).revision.credential_id;
  });

  it('round-trips every item type under generation 1', async () => {
    const ctx = context(account.browser);
    const secret = await getSecret(ctx, ids.secret);
    expect(secret.key_generation).toBe(1);
    expect(await openSecret(ctx, secret)).toBe('router password');
    expect(await openNote(ctx, await getNote(ctx, ids.note))).toBe('# Plan\nbody');
    const document = await getDocument(ctx, ids.document);
    expect(snapshotTitle(await openUpdate(document.snapshot_ciphertext, await openDocumentDek(ctx, document)))).toBe('Will');
    const file = await downloadFile(ctx, ids.file);
    expect(new TextDecoder().decode(file.bytes)).toBe('the deed');
  });

  it('enrols a second browser with the phrase, which reads the first browser’s items, and the first stays signed in', async () => {
    second = newBrowser();
    const outcome = await enrolThisBrowser(second.services, { mnemonic: account.mnemonic, pin: '615243' });
    expect(outcome.paranoid).toBe(false);

    const ctx = context(second);
    expect(await openSecret(ctx, await getSecret(ctx, ids.secret))).toBe('router password');
    expect(new TextDecoder().decode((await downloadFile(ctx, ids.file)).bytes)).toBe('the deed');
    expect(await statusOf(context(account.browser))).toBe(200);
    expect((await listDevices(ctx)).devices).toHaveLength(2);
    expect(JSON.stringify(await second.store.read())).not.toContain(account.mnemonic);
  });

  it('removes the first browser from the second: its token fails at once, everything rotates, and old items still open', async () => {
    const ctx = context(second);
    const first = account.browser.services.session.deviceId;
    await removeOtherDevices(ctx, account.mnemonic, [first]);

    expect(await statusOf(context(account.browser))).toBe(401);
    for (const scope of ['secrets', 'notes', 'documents', 'files', 'sharing'] as const) {
      expect(ctx.session.currentGeneration(scope)).toBe(2);
    }

    expect(await openSecret(ctx, await getSecret(ctx, ids.secret))).toBe('router password');
    const fresh = await createSecret(ctx, 'after the rotation');
    expect(fresh.secret.key_generation).toBe(2);
    expect(await openSecret(ctx, await getSecret(ctx, fresh.secret.id))).toBe('after the rotation');
    expect(await openNote(ctx, await getNote(ctx, ids.note))).toBe('# Plan\nbody');

    expect((await getSecret(ctx, ids.secret)).key_generation).toBe(1);
  });

  it('130: re-wraps what the rotation left behind, without touching a byte of ciphertext', async () => {
    const ctx = context(second);
    const before = await getSecret(ctx, ids.secret);

    const beforeCredential = await getCredential(ctx, ids.credential);

    const outcomes = await rewrapAfterRotation(ctx, [
      'secrets',
      'notes',
      'documents',
      'files',
      'passwords',
      'sharing',
    ]);

    expect(outcomes.map((outcome) => outcome.scope)).toEqual([
      'secrets',
      'notes',
      'documents',
      'files',
      'passwords',
    ]);
    for (const outcome of outcomes) {
      expect(outcome.rekeyed).toBe(outcome.requested);
      expect(outcome.requested).toBeGreaterThan(0);
    }

    const after = await getSecret(ctx, ids.secret);
    expect(after.key_generation).toBe(2);
    expect(after.wrapped_dek).not.toBe(before.wrapped_dek);
    expect(after.ciphertext).toBe(before.ciphertext);
    expect(await openSecret(ctx, after)).toBe('router password');

    expect(await openNote(ctx, await getNote(ctx, ids.note))).toBe('# Plan\nbody');
    const document = await getDocument(ctx, ids.document);
    expect(document.key_generation).toBe(2);
    expect(snapshotTitle(await openUpdate(document.snapshot_ciphertext, await openDocumentDek(ctx, document)))).toBe('Will');
    const file = await downloadFile(ctx, ids.file);
    expect(new TextDecoder().decode(file.bytes)).toBe('the deed');

    const afterCredential = await getCredential(ctx, ids.credential);
    expect(afterCredential.key_generation).toBe(2);
    expect(afterCredential.wrapped_dek).not.toBe(beforeCredential.wrapped_dek);
    expect(afterCredential.ciphertext).toBe(beforeCredential.ciphertext);
    expect(JSON.parse(await openCredential(ctx, afterCredential))).toMatchObject({
      site: 'bank.example',
      password: 'hunter2',
    });

    const second_pass = await rewrapAfterRotation(ctx, [
      'secrets',
      'notes',
      'documents',
      'files',
      'passwords',
    ]);
    expect(second_pass.every((outcome) => outcome.requested === 0)).toBe(true);
  });

  it('sends the removed browser to its phrase at unlock — its PIN registration went with it — and forgets it', async () => {
    const { services } = account.browser;
    services.session.lock();
    const outcome = await unlockWithPin(services, pin);
    expect(outcome.status).toBe('forgotten');
    expect(await account.browser.store.read()).toBeUndefined();
  });

  it('lets a browser remove itself: its token fails and its record is gone', async () => {
    const third = newBrowser();
    await enrolThisBrowser(third.services, { mnemonic: account.mnemonic, pin: '615243' });
    const tokens = third.services.tokens;
    const token = tokens.get()!;
    await removeThisBrowser(third.services);

    tokens.set(token);
    expect(await statusOf({ session: second.services.session, tokens, paranoid: false })).toBe(401);
    expect(await third.store.read()).toBeUndefined();
  });

  it('“I lost my devices” adds this browser and removes every other one in the same root-signed batch', async () => {
    const rescue = newBrowser();
    const outcome = await enrolThisBrowser(rescue.services, {
      mnemonic: account.mnemonic,
      pin: '615243',
      removeDeviceIds: 'all',
    });
    expect(outcome.removed).toContain(second.services.session.deviceId);
    expect(await statusOf(context(second))).toBe(401);

    const ctx = context(rescue);
    expect((await listDevices(ctx)).devices.map((device) => device.id)).toEqual([
      rescue.services.session.deviceId,
    ]);
    expect(ctx.session.currentGeneration('secrets')).toBe(3);
    expect(await openSecret(ctx, await getSecret(ctx, ids.secret))).toBe('router password');
  });
});

describe('127.4 the last attempt ends in re-enrolment', () => {
  it('forgets the account after the server’s last attempt, and the phrase brings the browser back', async () => {
    const account = await signUp('408263');
    const { services } = account.browser;
    services.session.lock();
    services.tokens.clear();

    let outcome = await unlockWithPin(services, '111222');
    while (outcome.status === 'wrong-pin') {
      outcome = await unlockWithPin(services, '111222');
    }
    expect(outcome.status).toBe('forgotten');
    expect(await account.browser.store.read()).toBeUndefined();

    const back = newBrowser();
    await enrolThisBrowser(back.services, { mnemonic: account.mnemonic, pin: '408263' });
    expect(back.services.session.isUnlocked).toBe(true);
  }, 600_000);
});

describe('127.9 Paranoid over the OPRF', () => {
  let account: Awaited<ReturnType<typeof signUp>>;

  beforeAll(async () => {
    account = await signUp('730418', true);
  });

  it('is Paranoid from sign-up, and enrolment needs the account PIN', async () => {
    expect(account.result.paranoid).toBe(true);
    expect((await getMe(context(account.browser))).paranoid).toBe(true);

    await expect(
      enrolThisBrowser(newBrowser().services, { mnemonic: account.mnemonic, pin: '185274' }),
    ).rejects.toBeInstanceOf(AuthRejectedError);

    const browser = newBrowser();
    const outcome = await enrolThisBrowser(browser.services, { mnemonic: account.mnemonic, pin: '730418' });
    expect(outcome.paranoid).toBe(true);
  });

  it('deletes the account only with the phrase and the account PIN', async () => {
    const ctx = context(account.browser, true);
    await expect(
      deleteAccountWithPhrase(account.browser.services, ctx, { mnemonic: account.mnemonic, accountPin: '185274' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    await deleteAccountWithPhrase(account.browser.services, ctx, {
      mnemonic: account.mnemonic,
      accountPin: '730418',
    });
    expect(await account.browser.store.read()).toBeUndefined();
  });
});

describe('127.11 sharing under the device model, 104.4 copies and 104.5 the address book', () => {
  let owner: Awaited<ReturnType<typeof signUp>>;
  let recipient: Awaited<ReturnType<typeof signUp>>;
  let stranger: Awaited<ReturnType<typeof signUp>>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    [owner, recipient, stranger] = await Promise.all([signUp('529173'), signUp('638204'), signUp('749315')]);
    const ctx = context(owner.browser);
    ids.secret = (await createSecret(ctx, 'shared secret value')).secret.id;
    ids.note = (await createNote(ctx, '# Shared note')).note.id;
    ids.document = (await createDocumentFromSnapshot(ctx, documentSnapshot('Shared doc'))).id;
    ids.file = (await uploadFile(ctx, smallFile('shared.txt', 'shared bytes'))).id;
  });

  it('exchanges one item of each type between two accounts', async () => {
    const ownerCtx = context(owner.browser);
    const recipientCtx = context(recipient.browser);

    const draft = await inviteByUsername(ownerCtx, recipient.username);
    expect(draft.connection.recipient_key_generation).toBe(1);
    expect(draft.connection.keys.map((key) => key.scope).sort()).toEqual(['documents', 'files', 'notes', 'secrets']);

    const inbound = await inboundFrom(recipientCtx, owner.username);
    expect((await verifyConnection(recipientCtx, inbound)).status).toBe('unpinned');
    await acceptInvitation(recipientCtx, inbound);

    const outbound = await outboundTo(ownerCtx, recipient.username);
    expect((await verifyConnection(ownerCtx, outbound)).status).toBe('trusted');
    for (const [type, id] of Object.entries(ids)) {
      await shareItemById(ownerCtx, outbound, type as 'secret', id);
    }

    const connection = await inboundFrom(recipientCtx, owner.username);
    expect((await verifyConnection(recipientCtx, connection)).status).toBe('trusted');
    const inbox = await listInbox(recipientCtx);
    const byType = Object.fromEntries(inbox.map((share) => [share.item_type, share]));
    expect(Object.keys(byType).sort()).toEqual(['document', 'file', 'note', 'secret']);

    expect(await openSharedText(recipientCtx, connection, byType.secret.id)).toBe('shared secret value');
    expect(await openSharedText(recipientCtx, connection, byType.note.id)).toBe('# Shared note');
    const document = await openSharedItem(recipientCtx, connection, byType.document.id);
    expect(snapshotTitle(await openUpdate(document.ciphertext, document.dek))).toBe('Shared doc');
    const file = await openSharedFile(recipientCtx, connection, byType.file.id);
    expect(new TextDecoder().decode(file.bytes)).toBe('shared bytes');
  });

  it('lets the invitee share back over the same connection, and refuses a second invitation', async () => {
    const ownerCtx = context(owner.browser);
    const recipientCtx = context(recipient.browser);

    await expect(inviteByUsername(recipientCtx, owner.username)).rejects.toBeInstanceOf(AlreadyConnectedError);

    const backwards = await inboundFrom(recipientCtx, owner.username);
    const { note } = await createNote(recipientCtx, '# From the invitee');
    await shareItemById(recipientCtx, backwards, 'note', note.id);

    const connection = await outboundTo(ownerCtx, recipient.username);
    const arrived = (await listInbox(ownerCtx)).find((share) => share.item_id === note.id);
    expect(arrived?.sender_username).toBe(recipient.username);
    expect(await openSharedText(ownerCtx, connection, arrived!.id)).toBe('# From the invitee');
    expect((await listConnections(ownerCtx)).filter((c) => c.username === recipient.username)).toHaveLength(1);
  });

  it('gives a third account holding the ciphertext nothing it can open', async () => {
    const recipientCtx = context(recipient.browser);
    const strangerCtx = context(stranger.browser);
    const connection = await inboundFrom(recipientCtx, owner.username);
    const [share] = await listInbox(recipientCtx);

    await expect(request({ method: 'GET', path: `/shares/${share.id}`, token: strangerCtx.tokens.get() })).rejects.toMatchObject({ status: 404 });
    await expect(openSharedText(strangerCtx, connection, share.id)).rejects.toThrow();
  });

  it('copies a shared item under a fresh DEK of the recipient’s own, at the current generation, and it survives the original', async () => {
    const recipientCtx = context(recipient.browser);
    const ownerCtx = context(owner.browser);
    const connection = await inboundFrom(recipientCtx, owner.username);
    const inbox = await listInbox(recipientCtx);
    const secretShare = inbox.find((share) => share.item_type === 'secret')!;
    const fileShare = inbox.find((share) => share.item_type === 'file')!;

    const copiedSecret = await copySharedItem(recipientCtx, connection, secretShare);
    const copiedFile = await copySharedItem(recipientCtx, connection, fileShare);

    const copy = await getSecret(recipientCtx, copiedSecret.id);
    expect(copy.key_generation).toBe(recipientCtx.session.currentGeneration('secrets'));
    const original = await getSecret(ownerCtx, ids.secret);
    expect(copy.wrapped_dek).not.toBe(original.wrapped_dek);
    await expect(openSecret(ownerCtx, copy)).rejects.toThrow();

    const { deleteSecret } = await import('@/lib/secrets');
    const { deleteFile } = await import('@/lib/files');
    await deleteSecret(ownerCtx, ids.secret);
    await deleteFile(ownerCtx, ids.file);

    expect(await openSecret(recipientCtx, await getSecret(recipientCtx, copiedSecret.id))).toBe('shared secret value');
    expect(new TextDecoder().decode((await downloadFile(recipientCtx, copiedFile.id)).bytes)).toBe('shared bytes');
  });

  it('stays green after the recipient rotates its sharing keys, and new invitations go to the new generation', async () => {
    const recipientCtx = context(recipient.browser);
    const ownerCtx = context(owner.browser);
    const root = await deriveRootKeysFromMnemonic(recipient.mnemonic);
    try {
      const state = await readVerifiedChain(
        recipientCtx,
        { userAddress: recipientCtx.session.userAddress, rootPublicKey: recipientCtx.session.rootPublicKey },
        recipientCtx.session.deviceId,
      );
      const built = await buildRotation({
        state,
        author: { name: recipientCtx.session.deviceId, signer: recipientCtx.session.signer() },
        wrapForRoot: (kek) => wrapKekForRoot(root.wrapKey, kek),
        scopes: ['sharing'],
      });
      await applyDeviceBatch(recipientCtx, built.batch);
      recipientCtx.session.addKeyrings(
        [{ scope: 'sharing', generation: 2, kek: built.created[0].kek, sealedMaterial: built.batch.materials[0].sealed_material }],
        { sharing: 2 },
      );
    } finally {
      zeroRootKeys(root);
    }

    const outbound = await outboundTo(ownerCtx, recipient.username);
    const { forgetPublishedCounterparties } = await import('@/lib/sharing');
    forgetPublishedCounterparties(ownerCtx.session);
    expect((await verifyConnection(ownerCtx, outbound)).status).toBe('trusted');

    const { note } = await createNote(ownerCtx, '# After rotation');
    await shareItemById(ownerCtx, outbound, 'note', note.id);
    const connection = await inboundFrom(recipientCtx, owner.username);
    const share = (await listInbox(recipientCtx)).find((entry) => entry.item_id === note.id)!;
    expect(await openSharedText(recipientCtx, connection, share.id)).toBe('# After rotation');

    const newcomer = await signUp('851629');
    const invitation = await inviteByUsername(context(newcomer.browser), recipient.username);
    expect(invitation.connection.recipient_key_generation).toBe(2);
    const inbound = await inboundFrom(recipientCtx, newcomer.username);
    await acceptInvitation(recipientCtx, inbound);
  });

  it('131: re-establishes the existing connection onto the new sharing keys, keeping every share open', async () => {
    const ownerCtx = context(owner.browser);
    const recipientCtx = context(recipient.browser);

    const before = await outboundTo(ownerCtx, recipient.username);
    expect(before.recipient_key_generation).toBe(1);

    const { secret } = await createSecret(ownerCtx, 'before the re-exchange');
    await shareItemById(ownerCtx, before, 'secret', secret.id);

    const { forgetPublishedCounterparties, reestablishConnection } = await import('@/lib/sharing');
    forgetPublishedCounterparties(ownerCtx.session);

    const outcome = await reestablishConnection(ownerCtx, before);
    expect(outcome.reestablished).toBe(true);
    expect(outcome.shares).toBeGreaterThan(0);

    const after = await outboundTo(ownerCtx, recipient.username);
    expect(after.recipient_key_generation).toBe(2);
    expect(after.pqxdh_blob).not.toBe(before.pqxdh_blob);

    const inbound = await inboundFrom(recipientCtx, owner.username);
    const arrived = (await listInbox(recipientCtx)).find((entry) => entry.item_id === secret.id)!;
    expect(await openSharedText(recipientCtx, inbound, arrived.id)).toBe('before the re-exchange');

    const { note } = await createNote(ownerCtx, '# After the re-exchange');
    await shareItemById(ownerCtx, after, 'note', note.id);
    const fresh = (await listInbox(recipientCtx)).find((entry) => entry.item_id === note.id)!;
    expect(await openSharedText(recipientCtx, inbound, fresh.id)).toBe('# After the re-exchange');

    forgetPublishedCounterparties(ownerCtx.session);
    expect((await reestablishConnection(ownerCtx, after)).reestablished).toBe(false);
  });

  it('shares nicknames and root pins between two devices of one account, and merges concurrent edits', async () => {
    const recipientCtx = context(recipient.browser);
    const other = newBrowser();
    await enrolThisBrowser(other.services, { mnemonic: recipient.mnemonic, pin: '962730' });
    const otherCtx = context(other);
    const connection = await inboundFrom(recipientCtx, owner.username);

    await loadAddressBook(recipientCtx, { fresh: true });
    await loadAddressBook(otherCtx, { fresh: true });
    await editAddressBook(recipientCtx, setNickname(connection.id, 'Owner'));
    const merged = await editAddressBook(otherCtx, setNickname('someone-else', 'Other'));

    expect(merged.nicknames[connection.id].name).toBe('Owner');
    expect(merged.nicknames['someone-else'].name).toBe('Other');
    const seenByOther = await loadAddressBook(otherCtx, { fresh: true });
    expect(seenByOther.pins[connection.user_address]).toBeDefined();
    expect((await verifyConnection(otherCtx, connection)).status).toBe('trusted');
  });
});
