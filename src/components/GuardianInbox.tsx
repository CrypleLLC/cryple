'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  acceptGuardianship,
  contributeShare,
  listGuardianships,
  listPendingPinResets,
  listPendingSessions,
  voteOnPinReset,
  type Guardianship,
} from '@/lib/recovery';
import {
  actionableCount,
  buildInbox,
  hasExpired,
  INBOX_ACTION_LABELS,
  INBOX_POLL_INTERVAL_MS,
  type InboxItem,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { Button, Card, Empty, Notice, Spinner } from './ui';

export default function GuardianInbox() {
  const context = useAuthedContext();
  const { account, reportError } = useCryple();

  const [items, setItems] = useState<InboxItem[]>();
  const [guardianships, setGuardianships] = useState<Guardianship[]>([]);
  const [message, setMessage] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busyId, setBusyId] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [pendingSessions, pendingResets, rows] = await Promise.all([
        listPendingSessions(context),
        listPendingPinResets(context),
        listGuardianships(context),
      ]);
      setGuardianships(rows);
      setItems(buildInbox(pendingSessions, pendingResets, rows));
      setMessage(undefined);
    } catch (error) {
      setMessage(reportError(error));
      setItems([]);
    }
  }, [context, reportError]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), INBOX_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function act(item: InboxItem) {
    setBusyId(item.id);
    setNotice(undefined);
    try {
      if (item.kind === 'guardian-invite') {
        await acceptGuardianship(context, item.id);
        setNotice(
          `You are now a guardian for ${item.ownerUsername}. They can ask you to help them back in.`,
        );
      } else if (item.kind === 'pin-reset') {
        await voteOnPinReset(context, item.id, account?.username ?? '');
      } else {
        const row = guardianships.find(
          (candidate) =>
            candidate.owner_username === item.ownerUsername && candidate.status === 'active',
        );
        if (row?.owner_user_address === undefined) {
          throw new Error(
            'cannot find the active guardianship for that account, so the share cannot be unwrapped',
          );
        }

        await contributeShare(context, item.id, {
          ownerUserAddress: row.owner_user_address,
          guardianUserAddress: context.session.userAddress,
          x25519PrivateKey: context.session.x25519PrivateKey,
          mlkemSecretKey: context.session.mlkem768SecretKey,
        });
      }
      await load();
      setMessage(undefined);
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusyId(undefined);
    }
  }

  const waiting = items === undefined ? 0 : actionableCount(items);

  return (
    <Card
      title="Guardian requests"
      subtitle={
        items === undefined
          ? 'Checking…'
          : waiting === 0
            ? 'Nothing needs you right now. This refreshes every minute.'
            : `${waiting} request${waiting === 1 ? '' : 's'} waiting on you.`
      }
    >
      {message ? <Notice tone="danger">{message}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {items === undefined ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty>Nobody has asked for your help.</Empty>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {items.map((item) => {
            const expired = hasExpired(item);

            return (
              <li key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {item.headline}
                  </p>
                  <p className="text-xs text-slate-500">
                    {expired ? 'This request expired before it could be completed.' : item.detail}
                  </p>
                </div>

                {item.actionable && !expired ? (
                  <Button disabled={busyId === item.id} onClick={() => void act(item)}>
                    {busyId === item.id
                      ? INBOX_ACTION_LABELS[item.kind].busy
                      : INBOX_ACTION_LABELS[item.kind].idle}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
