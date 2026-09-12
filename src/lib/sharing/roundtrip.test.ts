import { describe, expect, it } from 'vitest';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { buildManifest, openManifest, sealManifest } from '@/lib/files';
import { generateDek, vaultKekDekWrapper } from '@/lib/secrets';
import { openText, sealText } from '@/lib/sealed';
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
  const x25519PrivateKey = x25519.utils.randomSecretKey();
  const kem = ml_kem768.keygen();

  return {
    published: {
      x25519PublicKey: x25519.getPublicKey(x25519PrivateKey),
      mlkemPublicKey: kem.publicKey,
    },
    secrets: { x25519PrivateKey, mlkemSecretKey: kem.secretKey },
    vaultKek: crypto.getRandomValues(new Uint8Array(32)),
  };
}

describe('a file crosses from one account to another', () => {
  it('opens on the far side, exactly as the two screens drive it', async () => {
    const sender = account();
    const recipient = account();

    const connectionKey = createConnectionKey();
    const pqxdhBlob = await sealConnectionKey(
      connectionKey,
      recipient.published,
      senderAddress,
      recipientAddress,
    );
    const senderWrappedKey = await vaultKekDekWrapper(sender.vaultKek).wrapDek(connectionKey);

    const fileDek = generateDek();
    const manifest = buildManifest({ name: 'deed.pdf', mime: 'application/pdf', size: 4096 });
    const sealedManifest = await sealManifest(manifest, fileDek);
    const storedWrappedDek = await vaultKekDekWrapper(sender.vaultKek).wrapDek(fileDek);

    const senderKey = await vaultKekDekWrapper(sender.vaultKek).unwrapDek(senderWrappedKey);
    const dekToShare = await vaultKekDekWrapper(sender.vaultKek).unwrapDek(storedWrappedDek);
    const sharedWrappedDek = await wrapUnderConnection(senderKey, dekToShare);

    const recipientKey = await openConnectionKey(
      pqxdhBlob,
      recipient.secrets,
      senderAddress,
      recipientAddress,
    );
    const openedDek = await unwrapUnderConnection(recipientKey, sharedWrappedDek);
    const opened = await openManifest(sealedManifest, openedDek);

    expect(Array.from(recipientKey)).toEqual(Array.from(connectionKey));
    expect(Array.from(openedDek)).toEqual(Array.from(fileDek));
    expect(opened.name).toBe('deed.pdf');
    expect(opened.size).toBe(4096);
  });

  it('carries a note text across the same way', async () => {
    const recipient = account();

    const connectionKey = createConnectionKey();
    const pqxdhBlob = await sealConnectionKey(
      connectionKey,
      recipient.published,
      senderAddress,
      recipientAddress,
    );

    const noteDek = generateDek();
    const ciphertext = await sealText('# Title\nbody', noteDek);
    const wrapped = await wrapUnderConnection(connectionKey, noteDek);

    const recipientKey = await openConnectionKey(
      pqxdhBlob,
      recipient.secrets,
      senderAddress,
      recipientAddress,
    );
    const openedDek = await unwrapUnderConnection(recipientKey, wrapped);

    expect(await openText(ciphertext, openedDek)).toBe('# Title\nbody');
  });

  it('refuses when the recipient rebuilds the info with the wrong sender', async () => {
    const recipient = account();
    const pqxdhBlob = await sealConnectionKey(
      createConnectionKey(),
      recipient.published,
      senderAddress,
      recipientAddress,
    );

    await expect(
      openConnectionKey(pqxdhBlob, recipient.secrets, recipientAddress, recipientAddress),
    ).rejects.toThrow();
  });
});
