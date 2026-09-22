'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  acceptInvitation,
  displayName,
  editAddressBook,
  loadAddressBook,
  setNickname,
  type AddressBook,
  deleteConnection,
  inviteByUsername,
  listConnections,
  UnknownRecipientError,
  verifyConnection,
  type ConnectionRecord,
  type ConnectionTrust,
} from '@/lib/sharing';
import {
  connectionsToVerify,
  groupConnections,
  SHARING_COPY,
  trustAlarm,
  type ConnectionGroups,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import ConnectionInvitation from './ConnectionInvitation';
import { Badge, Button, Card, Empty, Field, Notice } from './ui';
import { SharingIcon } from './icons';

const EMPTY_GROUPS: ConnectionGroups = { awaitingMe: [], awaitingThem: [], accepted: [] };

export default function SharingScreen() {
  const context = useAuthedContext();
  const { reportError, fullDevice } = useCryple();

  const [groups, setGroups] = useState<ConnectionGroups>(EMPTY_GROUPS);
  const [trust, setTrust] = useState<Readonly<Record<string, ConnectionTrust>>>({});
  const [claim, setClaim] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [reviewing, setReviewing] = useState<ConnectionRecord>();
  const [book, setBook] = useState<AddressBook>();
  const latestCheck = useRef(0);

  const checkConnections = useCallback(
    async (connections: readonly ConnectionRecord[]) => {
      const check = ++latestCheck.current;
      const checked = connectionsToVerify(connections);
      const results = await Promise.allSettled(
        checked.map((connection) => verifyConnection(context, connection)),
      );
      if (check !== latestCheck.current) {
        return;
      }

      const next: Record<string, ConnectionTrust> = {};
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          next[checked[index].id] = result.value;
        }
      });
      setTrust(next);
    },
    [context],
  );

  const refresh = useCallback(async () => {
    try {
      const [connections, loadedBook] = await Promise.all([
        listConnections(context),
        loadAddressBook(context),
      ]);
      setBook(loadedBook);
      setGroups(groupConnections(connections));
      void checkConnections(connections);
    } catch (error) {
      setMessage(reportError(error));
    }
  }, [context, reportError, checkConnections]);

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

  async function rename(connection: ConnectionRecord, name: string) {
    try {
      setBook(await editAddressBook(context, setNickname(connection.id, name)));
    } catch (error) {
      setMessage(reportError(error));
    }
  }

  async function accept(connection: ConnectionRecord) {
    try {
      await acceptInvitation(context, connection);
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
              <ConnectionRow
                key={connection.id}
                connection={connection}
                trust={trust[connection.id]}
                nickname={displayName(book?.nicknames[connection.id])}
                onRename={(name) => void rename(connection, name)}
              >
                {fullDevice ? (
                  <Button variant="ghost" onClick={() => disconnect(connection)}>
                    {SHARING_COPY.disconnect}
                  </Button>
                ) : null}
              </ConnectionRow>
            ))}
            {groups.awaitingThem.map((connection) => (
              <ConnectionRow
                key={connection.id}
                connection={connection}
                trust={trust[connection.id]}
                nickname={displayName(book?.nicknames[connection.id])}
                onRename={(name) => void rename(connection, name)}
              >
                <Badge tone="neutral">{SHARING_COPY.pendingOutbound}</Badge>
              </ConnectionRow>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ConnectionRow({
  connection,
  trust,
  nickname,
  onRename,
  children,
}: {
  connection: ConnectionRecord;
  trust: ConnectionTrust | undefined;
  nickname: string | undefined;
  onRename: (name: string) => void;
  children: ReactNode;
}) {
  const alarm = trust === undefined ? undefined : trustAlarm(trust);
  const accepted = connection.status === 'accepted';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nickname ?? '');

  return (
    <li className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {nickname ? (
            <span className={`truncate font-semibold ${accepted ? 'text-ink' : 'text-ink-soft'}`}>
              {nickname}
            </span>
          ) : null}
          <span
            className={`truncate font-mono ${nickname ? 'text-compact text-ink-muted' : accepted ? 'text-ink' : 'text-ink-soft'}`}
          >
            {connection.username}
          </span>
          {alarm?.tone === 'danger' ? (
            <Badge tone="danger">{SHARING_COPY.fingerprintAlarmBadge}</Badge>
          ) : null}
        </span>
        <span className="flex shrink-0 gap-1">
          <Button variant="ghost" onClick={() => setEditing((open) => !open)}>
            {SHARING_COPY.nicknameLabel}
          </Button>
          {children}
        </span>
      </div>
      {editing ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field
            label={SHARING_COPY.nicknameLabel}
            hint={SHARING_COPY.nicknameHint}
            value={draft}
            maxLength={64}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button
            onClick={() => {
              setEditing(false);
              onRename(draft);
            }}
          >
            {SHARING_COPY.nicknameSave}
          </Button>
        </div>
      ) : null}
      {alarm ? <Notice tone={alarm.tone}>{alarm.message}</Notice> : null}
    </li>
  );
}
