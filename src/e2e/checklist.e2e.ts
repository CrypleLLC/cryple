import { beforeAll, describe, expect, it } from 'vitest';
import { TokenStore, request } from '@/lib/api';
import { completeSignUp, draftSignUp, type AccountServices } from '@/lib/account';
import type { AuthedContext } from '@/lib/context';
import { getCredential, listCredentials, writeCredential } from '@/lib/credentials';
import { memoryDeviceStore } from '@/lib/device/store';
import { downloadFile, getFileDownload, listFiles, uploadFile, type UploadFile } from '@/lib/files';
import { generateMnemonic } from '@/lib/keys';
import { createSecret, deleteSecret, getSecret, openSecret } from '@/lib/secrets';
import { sealBlob } from '@/lib/sealed';
import { SessionKeystore } from '@/lib/session';
import {
  acceptInvitation,
  copySharedItem,
  createConnection,
  createConnectionKey,
  fetchPublishedCounterparty,
  inviteByUsername,
  listConnections,
  listInbox,
  openConnectionKey,
  openSharedText,
  publishedRecipientKeys,
  rootFingerprint,
  sealConnectionKey,
  shareItemById,
  verifyConnection,
  type ConnectionRecord,
} from '@/lib/sharing';
import { getMe } from '@/lib/users';

interface Account {
  ctx: AuthedContext;
  username: string;
  address: string;
}

async function signUp(pin: string): Promise<Account> {
  const services: AccountServices = {
    session: new SessionKeystore({ idleTimeoutMs: 0 }),
    tokens: new TokenStore(),
    store: memoryDeviceStore(),
  };
  await completeSignUp(services, await draftSignUp(generateMnemonic(12)), { pin, paranoid: false });
  const ctx = { session: services.session, tokens: services.tokens, paranoid: false };
  const me = await getMe(ctx);
  return { ctx, username: me.username, address: me.user_address };
}

async function connectionWith(account: Account, username: string): Promise<ConnectionRecord> {
  const found = (await listConnections(account.ctx)).find((connection) => connection.username === username);
  if (found === undefined) {
    throw new Error(`no connection with ${username}`);
  }
  return found;
}

function bytesFile(name: string, size: number, fill: number): UploadFile {
  const bytes = new Uint8Array(size).fill(fill);
  return {
    name,
    type: 'application/octet-stream',
    size,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  };
}

async function status(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
    return 200;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

const SECRET = JSON.stringify({ name: 'Locker', value: 'combination 4-8-15' });
const NINE_MIB = 9 * 1024 * 1024;

describe('the v1 testing checklist, against a live API', () => {
  let owner: Account;
  let recipient: Account;
  let stranger: Account;
  let target: Account;
  let secretId: string;
  let shareId: string;

  beforeAll(async () => {
    [owner, recipient, stranger, target] = await Promise.all([
      signUp('529173'),
      signUp('638204'),
      signUp('749315'),
      signUp('851629'),
    ]);
    secretId = (await createSecret(owner.ctx, SECRET)).secret.id;
  });

  it('shows the recipient the inviter’s own root fingerprint to compare before accepting', async () => {
    await inviteByUsername(owner.ctx, recipient.username);
    const inbound = await connectionWith(recipient, owner.username);

    const trust = await verifyConnection(recipient.ctx, inbound);
    expect(trust.status).toBe('unpinned');
    expect((trust as { fingerprint: string }).fingerprint).toBe(await rootFingerprint(owner.ctx.session.rootPublicKey));

    await acceptInvitation(recipient.ctx, inbound);
    expect((await verifyConnection(recipient.ctx, await connectionWith(recipient, owner.username))).status).toBe(
      'trusted',
    );
  });

  it('fails acceptance loudly when the invitation was sealed to substituted keys', async () => {
    const attacker = await fetchPublishedCounterparty(owner.ctx, stranger.username);
    const connectionKey = createConnectionKey();
    const { generation, kek } = owner.ctx.session.currentKek('sharing');
    await createConnection(owner.ctx, {
      recipientUsername: target.username,
      pqxdhBlob: await sealConnectionKey(
        connectionKey,
        publishedRecipientKeys(attacker!.sharingKeys),
        owner.address,
        target.address,
      ),
      senderWrappedKey: await sealBlob(connectionKey, kek),
      senderKeyGeneration: generation,
      recipientKeyGeneration: attacker!.sharingKeys.generation,
    });

    const invitation = await connectionWith(target, owner.username);
    await expect(acceptInvitation(target.ctx, invitation)).rejects.toThrow();
    expect((await connectionWith(target, owner.username)).status).toBe('pending');
  });

  it('opens a share for its recipient and for nobody else, even an account holding the ciphertext', async () => {
    await shareItemById(owner.ctx, await connectionWith(owner, recipient.username), 'secret', secretId);
    const arrived = (await listInbox(recipient.ctx)).find((share) => share.item_id === secretId)!;
    shareId = arrived.id;
    const connection = await connectionWith(recipient, owner.username);

    expect(await openSharedText(recipient.ctx, connection, shareId)).toBe(SECRET);

    expect(await status(request({ method: 'GET', path: `/shares/${shareId}`, token: stranger.ctx.tokens.get() }))).toBe(404);
    const sharing = await stranger.ctx.session.sharingKeys(stranger.ctx.session.currentKek('sharing').generation);
    await expect(
      openConnectionKey(
        connection.pqxdh_blob!,
        { x25519PrivateKey: sharing.x25519PrivateKey, mlkemSecretKey: sharing.mlkemSecretKey },
        owner.address,
        recipient.address,
      ),
    ).rejects.toThrow();
    await expect(openSharedText(stranger.ctx, connection, shareId)).rejects.toThrow();
  });

  it('keeps a password, a file and a share invisible to a second account', async () => {
    const credential = (await writeCredential(owner.ctx, '{"site":"bank.example","username":"ada","password":"hunter2"}'))
      .revision.credential_id;
    const file = await uploadFile(owner.ctx, bytesFile('deed.txt', 1000, 0x61));

    expect(await status(getCredential(stranger.ctx, credential))).toBe(404);
    expect((await listCredentials(stranger.ctx)).map((entry) => entry.credential_id)).not.toContain(credential);
    expect(await status(getFileDownload(stranger.ctx, file.id))).toBe(404);
    expect((await listFiles(stranger.ctx)).map((entry) => entry.id)).not.toContain(file.id);
    expect(await status(getSecret(stranger.ctx, secretId))).toBe(404);
    expect((await listInbox(stranger.ctx)).map((share) => share.id)).not.toContain(shareId);
  });

  it('turns a retried upload of the same file into one row that opens', { timeout: 120_000 }, async () => {
    const id = crypto.randomUUID();
    const source = bytesFile('retried.bin', NINE_MIB, 0x7a);

    let sent = 0;
    await expect(
      uploadFile(owner.ctx, source, {
        id,
        concurrency: 1,
        put: async (part, body) => {
          if (sent >= 1) {
            throw new TypeError('Failed to fetch');
          }
          const response = await fetch(part.url, { method: 'PUT', body: body as unknown as BodyInit });
          expect(response.ok).toBe(true);
          sent += 1;
        },
      }),
    ).rejects.toThrow();

    const retried = await uploadFile(owner.ctx, source, { id });
    expect(retried.r2_state).toBe('ok');
    expect(await uploadFile(owner.ctx, source, { id })).toMatchObject({ id, r2_state: 'ok' });

    expect((await listFiles(owner.ctx)).filter((file) => file.id === id)).toHaveLength(1);
    const downloaded = await downloadFile(owner.ctx, id);
    expect(downloaded.bytes.length).toBe(NINE_MIB);
    expect(downloaded.bytes.every((byte) => byte === 0x7a)).toBe(true);
  });

  it('copies a share under the recipient’s own key, closed to the owner, and keeps it after the original goes', async () => {
    const connection = await connectionWith(recipient, owner.username);
    const copy = await copySharedItem(recipient.ctx, connection, { id: shareId, item_type: 'secret' });

    expect(await status(getSecret(owner.ctx, copy.id))).toBe(404);
    const copied = await getSecret(recipient.ctx, copy.id);
    await expect(openSecret(owner.ctx, copied)).rejects.toThrow();

    await deleteSecret(owner.ctx, secretId);
    expect(await openSecret(recipient.ctx, await getSecret(recipient.ctx, copy.id))).toBe(SECRET);
  });
});
