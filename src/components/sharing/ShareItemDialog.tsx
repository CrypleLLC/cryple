'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ConnectionNotTrustedError,
  deleteShare,
  listConnections,
  listItemRecipients,
  shareItemById,
  type ConnectionRecord,
  type ItemRecipientRecord,
  type ItemType,
} from '@/lib/sharing';
import { ITEM_LABELS, sendableConnections, sendRefusal, SHARING_COPY } from '@/lib/app';
import { useAuthedContext, useCryple } from '@/components/session/CrypleProvider';
import { Button, Empty, Notice, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { SharingIcon } from '@/components/ui/icons';

export default function ShareItemDialog({
  itemType,
  itemId,
  onClose,
}: {
  itemType: ItemType;
  itemId: string;
  onClose: () => void;
}) {
  const context = useAuthedContext();
  const { reportError, fullDevice } = useCryple();

  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [recipients, setRecipients] = useState<ItemRecipientRecord[]>([]);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const [all, sent] = await Promise.all([
        listConnections(context),
        listItemRecipients(context, itemType, itemId),
      ]);
      setConnections(sendableConnections(all));
      setRecipients(sent);
    } catch (error) {
      setMessage(reportError(error));
    }
  }, [context, itemType, itemId, reportError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function send() {
    const connection = connections.find((candidate) => candidate.id === chosen);
    if (!connection) {
      return;
    }

    setBusy(true);
    setMessage(undefined);

    try {
      await shareItemById(context, connection, itemType, itemId);
      setChosen('');
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof ConnectionNotTrustedError ? sendRefusal(error.trust) : reportError(error),
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(shareId: string) {
    setBusy(true);
    try {
      await deleteShare(context, shareId);
      await refresh();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  const alreadyShared = new Set(recipients.map((recipient) => recipient.username));
  const choices = connections
    .filter((connection) => !alreadyShared.has(connection.username))
    .map((connection) => ({ value: connection.id, label: connection.username }));

  return (
    <Modal title={`Share this ${ITEM_LABELS[itemType].toLowerCase()}`} onClose={onClose}>
      <div className="space-y-4">
        {message ? (
          <Notice tone="danger" onDismiss={() => setMessage(undefined)}>
            {message}
          </Notice>
        ) : null}

        {connections.length === 0 ? (
          <Empty icon={<SharingIcon />}>{SHARING_COPY.connectionsEmpty}</Empty>
        ) : (
          <div className="space-y-3">
            <Select
              label="Send to"
              value={chosen}
              choices={[{ value: '', label: 'Choose a connection…' }, ...choices]}
              onChange={(event) => setChosen(event.target.value)}
            />
            <Button onClick={send} disabled={busy || chosen === ''}>
              Send
            </Button>
          </div>
        )}

        <div>
          <p className="text-compact font-semibold text-ink-soft">Already sent to</p>
          {recipients.length === 0 ? (
            <p className="mt-1 text-compact text-ink-muted">Nobody yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {recipients.map((recipient) => (
                <li key={recipient.id} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-compact text-ink">{recipient.username}</span>
                  {fullDevice ? (
                    <Button variant="ghost" disabled={busy} onClick={() => revoke(recipient.id)}>
                      Remove
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
