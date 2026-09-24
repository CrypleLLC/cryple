import { describe, expect, it } from 'vitest';
import { buildManifest, openManifest, sealManifest } from '@/lib/files';
import { deriveShareSubkey, generateSharingKeys } from '@/lib/keyrings/crypto';
import { generateDek } from '@/lib/secrets';
import { openBlob, openText, sealBlob, sealText } from '@/lib/sealed';
import {
  createConnectionKey,
  openConnectionKey,
  sealConnectionKey,
  unwrapUnderConnection,
  wrapUnderConnection,
} from './keys';

const senderAddress = 'a'.repeat(64);
const recipientAddress = 'b'.repeat(64);

function account() {
  const sharing = generateSharingKeys();
  return {
    published: { x25519PublicKey: sharing.x25519PublicKey, mlkemPublicKey: sharing.mlkemPublicKey },
    secrets: { x25519PrivateKey: sharing.x25519PrivateKey, mlkemSecretKey: sharing.mlkemSecretKey },
    sharingKek: crypto.getRandomValues(new Uint8Array(32)),
    filesKek: crypto.getRandomValues(new Uint8Array(32)),
    notesKek: crypto.getRandomValues(new Uint8Array(32)),
  };
}

describe('a file crosses from one account to another under the files sub-key', () => {
  it('opens on the far side, exactly as the two screens drive it', async () => {
    const sender = account();
    const recipient = account();

    const connectionKey = createConnectionKey();
    const pqxdhBlob = await sealConnectionKey(connectionKey, recipient.published, senderAddress, recipientAddress);
    const senderWrappedKey = await sealBlob(connectionKey, sender.sharingKek);

    const senderSubkey = await sealBlob(
      await deriveShareSubkey(await openBlob(senderWrappedKey, sender.sharingKek), 'files'),
      sender.filesKek,
    );

    const fileDek = generateDek();
    const sealedManifest = await sealManifest(
      buildManifest({ name: 'deed.pdf', mime: 'application/pdf', size: 4096 }),
      fileDek,
    );
    const sharedWrappedDek = await wrapUnderConnection(
      await openBlob(senderSubkey, sender.filesKek),
      fileDek,
    );

    const recipientKey = await openConnectionKey(pqxdhBlob, recipient.secrets, senderAddress, recipientAddress);
    const recipientSubkey = await sealBlob(await deriveShareSubkey(recipientKey, 'files'), recipient.filesKek);
    const openedDek = await unwrapUnderConnection(
      await openBlob(recipientSubkey, recipient.filesKek),
      sharedWrappedDek,
    );
    const opened = await openManifest(sealedManifest, openedDek);

    expect(Array.from(openedDek)).toEqual(Array.from(fileDek));
    expect(opened.name).toBe('deed.pdf');
  });
});

describe('sub-keys keep scopes apart', () => {
  it('wraps a share under the sub-key of its item’s scope, which the sub-key of another scope cannot open', async () => {
    const connectionKey = createConnectionKey();
    const noteDek = generateDek();
    const ciphertext = await sealText('# Title\nbody', noteDek);
    const wrapped = await wrapUnderConnection(await deriveShareSubkey(connectionKey, 'notes'), noteDek);

    const opened = await unwrapUnderConnection(await deriveShareSubkey(connectionKey, 'notes'), wrapped);
    expect(await openText(ciphertext, opened)).toBe('# Title\nbody');

    for (const scope of ['secrets', 'documents', 'files']) {
      await expect(
        unwrapUnderConnection(await deriveShareSubkey(connectionKey, scope), wrapped),
      ).rejects.toThrow();
    }
    await expect(unwrapUnderConnection(connectionKey, wrapped)).rejects.toThrow();
  });

  it('draws a fresh IV, so two wraps of one DEK under one sub-key differ', async () => {
    const subkey = await deriveShareSubkey(createConnectionKey(), 'secrets');
    const dek = generateDek();
    expect(await wrapUnderConnection(subkey, dek)).not.toBe(await wrapUnderConnection(subkey, dek));
  });

  it('lets a device that holds only notes open a notes share without ever holding the connection key', async () => {
    const recipient = account();
    const connectionKey = createConnectionKey();
    const stored = await sealBlob(await deriveShareSubkey(connectionKey, 'notes'), recipient.notesKek);
    const dek = generateDek();
    const wrapped = await wrapUnderConnection(await deriveShareSubkey(connectionKey, 'notes'), dek);

    const notesOnlyDevice = { notesKek: recipient.notesKek };
    const opened = await unwrapUnderConnection(await openBlob(stored, notesOnlyDevice.notesKek), wrapped);
    expect(Array.from(opened)).toEqual(Array.from(dek));
    await expect(openBlob(stored, recipient.filesKek)).rejects.toThrow();
  });
});

describe('the connection key', () => {
  it('refuses when the recipient rebuilds the info with the wrong sender', async () => {
    const recipient = account();
    const pqxdhBlob = await sealConnectionKey(createConnectionKey(), recipient.published, senderAddress, recipientAddress);
    await expect(
      openConnectionKey(pqxdhBlob, recipient.secrets, recipientAddress, recipientAddress),
    ).rejects.toThrow();
  });

  it('does not open for a third account that holds the ciphertext', async () => {
    const recipient = account();
    const third = account();
    const pqxdhBlob = await sealConnectionKey(createConnectionKey(), recipient.published, senderAddress, recipientAddress);
    await expect(
      openConnectionKey(pqxdhBlob, third.secrets, senderAddress, recipientAddress),
    ).rejects.toThrow();
  });
});
