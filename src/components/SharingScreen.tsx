'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  acceptConnection,
  deleteConnection,
  inviteByUsername,
  listConnections,
  UnknownRecipientError,
  type ConnectionRecord,
} from '@/lib/sharing';
import {
  groupConnections,
  SHARING_COPY,
  type ConnectionGroups,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import ConnectionInvitation from './ConnectionInvitation';
import { Badge, Button, Card, Empty, Field, Notice } from './ui';
import { SharingIcon } from './icons';

const EMPTY_GROUPS: ConnectionGroups = { awaitingMe: [], awaitingThem: [], accepted: [] };

export default function SharingScreen() {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const [groups, setGroups] = useState<ConnectionGroups>(EMPTY_GROUPS);
  const [claim, setClaim] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [reviewing, setReviewing] = useState<ConnectionRecord>();

  const refresh = useCallback(async () => {
    try {
      setGroups(groupConnections(await listConnections(context)));
    } catch (error) {
      setMessage(reportError(error));
    }
  }, [context, reportError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function invite() {
    setBusy(true);
    setMessage(undefined);
    setNotice(undefined);

    try {
      const draft = await inviteByUsername(context, claim);
      setClaim('');
      setNotice(SHARING_COPY.inviteSent(draft.connection.username));
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof UnknownRecipientError ? SHARING_COPY.inviteUnknown : reportError(error),
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(connection: ConnectionRecord) {
    try {
      await deleteConnection(context, connection.id);
      await refresh();
    } catch (error) {
      setMessage(reportError(error));
    }
  }

  async function accept(connection: ConnectionRecord) {
    try {
      await acceptConnection(context, connection.id);
      setReviewing(undefined);
      await refresh();
    } catch (error) {
      setMessage(reportError(error));
    }
  }

  return (
    <div className="space-y-8">
      {message ? <Notice tone="danger">{message}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <Card title={SHARING_COPY.inviteTitle} subtitle={SHARING_COPY.inviteHint}>
        <div className="space-y-4">
          <Field
            label={SHARING_COPY.inviteLabel}
            value={claim}
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            onChange={(event) => setClaim(event.target.value)}
          />
          <Button onClick={invite} disabled={busy || claim.trim() === ''}>
            {busy ? SHARING_COPY.inviteSending : SHARING_COPY.inviteSubmit}
          </Button>
          <Notice tone="warning">{SHARING_COPY.reshareWarning}</Notice>
        </div>
      </Card>

      {groups.awaitingMe.length > 0 ? (
        <Card title={SHARING_COPY.pendingInbound}>
          <ul className="space-y-3">
            {groups.awaitingMe.map((connection) => (
              <li key={connection.id} className="flex items-center justify-between gap-3">
                <span className="font-mono text-ink">{connection.username}</span>
                <Button onClick={() => setReviewing(connection)}>Review</Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {reviewing ? (
        <ConnectionInvitation
          connection={reviewing}
          onAccept={() => accept(reviewing)}
          onDecline={() => {
            void disconnect(reviewing);
            setReviewing(undefined);
          }}
          onError={setMessage}
        />
      ) : null}

      <Card title={SHARING_COPY.connected} subtitle={SHARING_COPY.disconnectWarning}>
        {groups.accepted.length === 0 && groups.awaitingThem.length === 0 ? (
          <Empty icon={<SharingIcon />}>{SHARING_COPY.connectionsEmpty}</Empty>
        ) : (
          <ul className="space-y-3">
            {groups.accepted.map((connection) => (
              <li key={connection.id} className="flex items-center justify-between gap-3">
                <span className="font-mono text-ink">{connection.username}</span>
                <Button variant="ghost" onClick={() => disconnect(connection)}>
                  {SHARING_COPY.disconnect}
                </Button>
              </li>
            ))}
            {groups.awaitingThem.map((connection) => (
              <li key={connection.id} className="flex items-center justify-between gap-3">
                <span className="font-mono text-ink-soft">{connection.username}</span>
                <Badge tone="neutral">{SHARING_COPY.pendingOutbound}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
