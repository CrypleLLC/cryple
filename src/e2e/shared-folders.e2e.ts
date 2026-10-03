import { beforeAll, describe, expect, it } from 'vitest';
import { TokenStore, request } from '@/lib/api';
import { completeSignUp, draftSignUp, readVerifiedChain, type AccountServices } from '@/lib/account';
import type { AuthedContext } from '@/lib/context';
import { memoryDeviceStore } from '@/lib/device/store';
import {
  createFolder,
  deleteFolder,
  folderOf,
  liveFolders,
  placeItem,
} from '@/lib/folders';
import { deriveRootKeysFromMnemonic, generateMnemonic, zeroRootKeys } from '@/lib/keys';
import { applyDeviceBatch, buildRotation, wrapKekForRoot } from '@/lib/keyrings';
import { createNote } from '@/lib/notes';
import { createSecret } from '@/lib/secrets';
import { SessionKeystore } from '@/lib/session';
import {
  acceptInvitation,
  describeSent,
  editSharedFolders,
  forgetPublishedCounterparties,
  inviteByUsername,
  listConnectionShares,
  listConnections,
  listInbox,
  loadSharedFolders,
  reestablishConnection,
  SHARED_FOLDER_RULES,
  shareItemById,
  type ConnectionRecord,
} from '@/lib/sharing';
import { getMe } from '@/lib/users';

interface Account {
  ctx: AuthedContext;
  mnemonic: string;
  username: string;
}

async function signUp(pin: string): Promise<Account> {
  const mnemonic = generateMnemonic(12);
  const services: AccountServices = {
    session: new SessionKeystore({ idleTimeoutMs: 0 }),
    tokens: new TokenStore(),
    store: memoryDeviceStore(),
  };
  await completeSignUp(services, await draftSignUp(mnemonic), { pin, paranoid: false });
  const ctx = { session: services.session, tokens: services.tokens, paranoid: false };
  return { ctx, mnemonic, username: (await getMe(ctx)).username };
}

async function connectionWith(account: Account, username: string): Promise<ConnectionRecord> {
  const found = (await listConnections(account.ctx)).find((connection) => connection.username === username);
  if (found === undefined) {
    throw new Error(`no connection with ${username}`);
  }
  return found;
}

const view = (plaintext: string) => ({ name: plaintext, body: plaintext });

describe('133.4 the Shared space: one folder per friendship, organised by both sides', () => {
  let inviter: Account;
  let invitee: Account;
  let outsider: Account;
  const trips = crypto.randomUUID();
  const lisbon = crypto.randomUUID();
  const shares: Record<string, string> = {};

  beforeAll(async () => {
    [inviter, invitee, outsider] = await Promise.all([signUp('529173'), signUp('638204'), signUp('749315')]);
  });

  it('has nothing for a pending invitation, and an empty space once it is accepted', async () => {
    await inviteByUsername(inviter.ctx, invitee.username);
    const pending = await connectionWith(invitee, inviter.username);

    await expect(
      editSharedFolders(invitee.ctx, pending, createFolder({ id: trips, name: 'Trips' })),
    ).rejects.toMatchObject({ status: 404 });

    await acceptInvitation(invitee.ctx, pending);
    const accepted = await connectionWith(invitee, inviter.username);
    expect(liveFolders(await loadSharedFolders(invitee.ctx, accepted, { fresh: true }))).toEqual([]);
  });

  it('lets each side create folders inside the other’s, and file what either of them sent', async () => {
    const fromInviter = await connectionWith(inviter, invitee.username);
    const fromInvitee = await connectionWith(invitee, inviter.username);

    await editSharedFolders(inviter.ctx, fromInviter, createFolder({ id: trips, name: 'Trips' }));
    await editSharedFolders(invitee.ctx, fromInvitee, createFolder({ id: lisbon, name: 'Lisbon', parentId: trips }));

    const { secret } = await createSecret(inviter.ctx, JSON.stringify({ name: 'Flight code', value: 'XK42' }));
    shares.secret = (await shareItemById(inviter.ctx, fromInviter, 'secret', secret.id)).id;
    const { note } = await createNote(invitee.ctx, '# Hotel booking');
    shares.note = (await shareItemById(invitee.ctx, fromInvitee, 'note', note.id)).id;

    await editSharedFolders(invitee.ctx, fromInvitee, placeItem(shares.secret, lisbon));
    await editSharedFolders(inviter.ctx, fromInviter, placeItem(shares.note, trips));

    const seen = await loadSharedFolders(inviter.ctx, fromInviter, { fresh: true });
    expect(seen.folders[lisbon].name).toBe('Lisbon');
    expect(seen.folders[lisbon].parent_id).toBe(trips);
    expect(folderOf(seen, shares.secret, SHARED_FOLDER_RULES)).toBe(lisbon);
    expect(folderOf(seen, shares.note, SHARED_FOLDER_RULES)).toBe(trips);
  });

  it('shows each side both directions, and names what it sent from its own copy', async () => {
    const fromInviter = await connectionWith(inviter, invitee.username);
    const listed = await listConnectionShares(inviter.ctx, fromInviter.id);

    expect(Object.fromEntries(listed.map((share) => [share.id, share.direction]))).toEqual({
      [shares.secret]: 'outbound',
      [shares.note]: 'inbound',
    });

    const sent = listed.find((share) => share.id === shares.secret)!;
    const described = await describeSent(inviter.ctx, sent, fromInviter, view, view);
    expect(described.readable).toBe(true);
    expect(described.text).toContain('XK42');
  });

  it('keeps the folders from everyone outside the friendship', async () => {
    const fromInviter = await connectionWith(inviter, invitee.username);

    await expect(
      request({ method: 'GET', path: `/connections/${fromInviter.id}/folders`, token: outsider.ctx.tokens.get() }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('carries the folders through a re-establishment after the invitee rotates its sharing keys', async () => {
    const root = await deriveRootKeysFromMnemonic(invitee.mnemonic);
    try {
      const state = await readVerifiedChain(
        invitee.ctx,
        { userAddress: invitee.ctx.session.userAddress, rootPublicKey: invitee.ctx.session.rootPublicKey },
        invitee.ctx.session.deviceId,
      );
      const built = await buildRotation({
        state,
        author: { name: invitee.ctx.session.deviceId, signer: invitee.ctx.session.signer() },
        wrapForRoot: (kek) => wrapKekForRoot(root.wrapKey, kek),
        scopes: ['sharing'],
      });
      await applyDeviceBatch(invitee.ctx, built.batch);
      invitee.ctx.session.addKeyrings(
        [{ scope: 'sharing', generation: 2, kek: built.created[0].kek, sealedMaterial: built.batch.materials[0].sealed_material }],
        { sharing: 2 },
      );
    } finally {
      zeroRootKeys(root);
    }

    const staleOnTheInviteeSide = await connectionWith(invitee, inviter.username);
    forgetPublishedCounterparties(inviter.ctx.session);
    const outcome = await reestablishConnection(inviter.ctx, await connectionWith(inviter, invitee.username));
    expect(outcome.reestablished).toBe(true);

    const reopened = await loadSharedFolders(invitee.ctx, staleOnTheInviteeSide, { fresh: true });
    expect(staleOnTheInviteeSide.recipient_key_generation).toBe(2);
    expect(reopened.folders[trips].name).toBe('Trips');
    expect(folderOf(reopened, shares.secret, SHARED_FOLDER_RULES)).toBe(lisbon);
  });

  it('deletes a folder as a grouping only: what was filed falls to the top, still shared', async () => {
    const fromInvitee = await connectionWith(invitee, inviter.username);

    const after = await editSharedFolders(invitee.ctx, fromInvitee, deleteFolder(trips));

    expect(liveFolders(after)).toEqual([]);
    expect(folderOf(after, shares.secret, SHARED_FOLDER_RULES)).toBeNull();
    expect(folderOf(after, shares.note, SHARED_FOLDER_RULES)).toBeNull();
    expect((await listInbox(invitee.ctx)).map((share) => share.id)).toContain(shares.secret);
  });
});
