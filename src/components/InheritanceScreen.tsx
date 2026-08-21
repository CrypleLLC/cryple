'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  anchorForRelease,
  CLAIM_FAILURE_COPY,
  NO_INHERITANCES,
  openInherited,
  unverifiedEditsNotice,
  verifyInherited,
  type ClaimVerdict,
  type MergedDocument,
} from '@/lib/app';
import * as Y from 'yjs';
import { fetchRootAt } from '@/lib/chain';
import { openUpdate, readBodyText } from '@/lib/documents';
import {
  getInheritedAnchor,
  getInheritedContent,
  listInheritances,
  listInheritedAnchors,
  listInheritedItems,
  listInheritedUpdates,
  type Inheritance,
  type InheritedContent,
  type InheritanceShare,
} from '@/lib/succession';
import { pqxdhUnwrap } from '@/lib/pqxdh';
import { openText } from '@/lib/sealed';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { Button, Card, Empty, Notice, Spinner } from './ui';

interface Opened {
  itemId: string;
  verdict: ClaimVerdict;
  text?: string;
  unverifiedEdits: number;
  error?: string;
}

export default function InheritanceScreen() {
  const context = useAuthedContext();
  const { session } = context;
  const { reportError } = useCryple();

  const [inheritances, setInheritances] = useState<Inheritance[]>();
  const [owner, setOwner] = useState<Inheritance>();
  const [items, setItems] = useState<InheritanceShare[]>();
  const [opened, setOpened] = useState<Opened>();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    void (async () => {
      try {
        const rows = await listInheritances(context);
        setInheritances(rows);
        setOwner(rows[0]);
      } catch (error) {
        setMessage(reportError(error));
        setInheritances([]);
      }
    })();
  }, [context, reportError]);

  const loadItems = useCallback(async () => {
    if (owner === undefined) {
      return;
    }

    setItems(undefined);
    setOpened(undefined);
    try {
      setItems(await listInheritedItems(context, owner.owner_user_address));
    } catch (error) {
      setMessage(reportError(error));
      setItems([]);
    }
  }, [context, owner, reportError]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  // The snapshot is what the leaf proves; the deltas are everything the owner
  // wrote after their last save. Both are needed for the document to be current,
  // and only the first is provable — which is why the count comes back with it.
  const mergeDocument = useCallback(
    async (item: InheritedContent, dek: Uint8Array): Promise<MergedDocument> => {
      if (owner === undefined) {
        return { text: '', appliedDeltas: 0 };
      }

      const doc = new Y.Doc();
      try {
        const snapshot = item.snapshot_ciphertext ?? '';
        if (snapshot.length > 0) {
          Y.applyUpdate(doc, await openUpdate(snapshot, dek));
        }

        const deltas = await listInheritedUpdates(
          context,
          owner.owner_user_address,
          item.item_id,
          item.snapshot_seq ?? 0,
        );

        for (const delta of deltas) {
          Y.applyUpdate(doc, await openUpdate(delta.ciphertext, dek));
        }

        return { text: readBodyText(doc), appliedDeltas: deltas.length };
      } finally {
        doc.destroy();
      }
    },
    [context, owner],
  );

  async function open(share: InheritanceShare) {
    if (owner === undefined) {
      return;
    }

    setBusy(share.item_id);
    setOpened(undefined);

    try {
      const content = await getInheritedContent(context, owner.owner_user_address, share.item_id);

      // Which epoch: the newest anchored at or before the release, never the
      // latest. A past epoch is frozen, so that root describes the vault as it
      // stood while the owner was alive.
      const anchor = anchorForRelease(
        await listInheritedAnchors(context, owner.owner_user_address),
        owner.released_at,
      );

      if (anchor === undefined) {
        setOpened({
          itemId: share.item_id,
          verdict: { verified: false, reason: 'no-anchor' },
          unverifiedEdits: 0,
        });

        return;
      }

      const [set, chainRoot] = await Promise.all([
        getInheritedAnchor(context, owner.owner_user_address, anchor.epoch),
        // From the chain. A root handed over by this API would prove nothing,
        // because this API is what the verification exists to be independent of.
        fetchRootAt(owner.smart_account_address, anchor.epoch),
      ]);

      const verdict = verifyInherited({
        content,
        leaves: set.leaves,
        chainRoot,
        epoch: anchor.epoch,
      });

      if (!verdict.verified) {
        setOpened({ itemId: share.item_id, verdict, unverifiedEdits: 0 });

        return;
      }

      const result = await openInherited(content, share.pq_hybrid_encrypted_item_key, verdict, {
        unwrapItemKey: (wrapped) =>
          pqxdhUnwrap(
            wrapped,
            {
              x25519PrivateKey: session.x25519PrivateKey,
              mlkemSecretKey: session.mlkem768SecretKey,
            },
            {
              usage: 'succession-dek',
              senderUserAddress: owner.owner_user_address,
              recipientUserAddress: session.userAddress,
            },
          ),
        openText: (blob, dek) => openText(blob, dek),
        openDocument: (item, dek) => mergeDocument(item, dek),
      });

      setOpened({
        itemId: share.item_id,
        verdict,
        text: result.text,
        unverifiedEdits: result.unverifiedEdits,
      });
    } catch (error) {
      setOpened({
        itemId: share.item_id,
        verdict: { verified: false, reason: 'no-chain-root' },
        unverifiedEdits: 0,
        error: reportError(error),
      });
    } finally {
      setBusy(undefined);
    }
  }

  if (inheritances === undefined) {
    return <Spinner />;
  }

  return (
    <div className="space-y-6">
      {message ? <Notice tone="danger">{message}</Notice> : null}

      {inheritances.length === 0 ? (
        <Card title="Nothing here">
          <Empty>{NO_INHERITANCES}</Empty>
        </Card>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto">
            {inheritances.map((entry) => (
              <button
                key={entry.owner_user_address}
                type="button"
                onClick={() => setOwner(entry)}
                className={`shrink-0 rounded-md border px-3 py-2 text-sm ${
                  entry.owner_user_address === owner?.owner_user_address
                    ? 'border-brand-500 font-medium'
                    : 'border-slate-200 text-slate-500 dark:border-slate-800'
                }`}
              >
                {entry.owner_username}
                <span className="ml-1.5 text-xs text-slate-400">{entry.item_count}</span>
              </button>
            ))}
          </div>

          <Card
            title={owner ? `Left to you by ${owner.owner_username}` : 'Left to you'}
            subtitle="Each item is checked against the blockchain before it is opened."
            flush
          >
            {items === undefined ? (
              <Spinner />
            ) : items.length === 0 ? (
              <Empty>Nothing was assigned to you.</Empty>
            ) : (
              <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                {items.map((share) => (
                  <li key={share.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm">
                        {share.item_type}
                        <span className="ml-2 text-xs text-slate-500">{share.item_id}</span>
                      </p>
                      <Button
                        variant="secondary"
                        disabled={busy !== undefined}
                        onClick={() => void open(share)}
                      >
                        {busy === share.item_id ? 'Checking…' : 'Verify and open'}
                      </Button>
                    </div>

                    {opened?.itemId === share.item_id ? (
                      <div className="mt-3 space-y-2">
                        {opened.verdict.verified ? (
                          <Notice tone="success">
                            Verified against the blockchain — anchored on{' '}
                            {new Date(opened.verdict.epoch * 86_400_000).toLocaleDateString()}.
                          </Notice>
                        ) : (
                          <Notice tone="danger">
                            {opened.error ?? CLAIM_FAILURE_COPY[opened.verdict.reason]}
                          </Notice>
                        )}

                        {opened.unverifiedEdits > 0 ? (
                          <Notice tone="warning">
                            {unverifiedEditsNotice(opened.unverifiedEdits)}
                          </Notice>
                        ) : null}

                        {opened.text === undefined ? null : (
                          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm dark:bg-slate-900">
                            {opened.text}
                          </pre>
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
