'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  buildSetupPayload,
  inviteGuardian,
  listGuardians,
  requiresSoleGuardianWarning,
  revokeGuardian,
  shareCountForGuardians,
  submitRecoverySetup,
  summarizeQuorum,
  toRecipient,
  type Guardian,
  type GuardianRecipient,
} from '@/lib/recovery';
import { unlockSeedVault } from '@/lib/pin';
import { lookupUsername } from '@/lib/users';
import type { RecoveryKitDetails } from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import GuardianInbox from './GuardianInbox';
import RecoveryKitCard from './RecoveryKitCard';
import { Button, Card, Empty, Field, Notice, Spinner } from './ui';

interface KitState {
  share: Uint8Array;
  details: RecoveryKitDetails;
}

export default function GuardiansScreen() {
  const context = useAuthedContext();
  const { account, reportError } = useCryple();

  const [guardians, setGuardians] = useState<Guardian[]>();
  const [threshold, setThreshold] = useState(2);
  const [username, setUsername] = useState('');
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [kit, setKit] = useState<KitState>();

  const load = useCallback(async () => {
    try {
      setGuardians(await listGuardians(context));
      setMessage(undefined);
    } catch (error) {
      setMessage(reportError(error));
      setGuardians([]);
    }
  }, [context, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = (guardians ?? []).filter((guardian) => guardian.status === 'active');
  const summary = summarizeQuorum(guardians ?? [], threshold);
  const totalShares = shareCountForGuardians(active.length);
  const soleGuardianRisk = requiresSoleGuardianWarning({ shares: totalShares, threshold });

  async function invite() {
    setBusy(true);
    try {
      await inviteGuardian(context, username.trim());
      setUsername('');
      setNotice('Invitation sent. They must accept before they count toward your quorum.');
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(guardian: Guardian) {
    setBusy(true);
    try {
      const result = await revokeGuardian(context, guardian.id);
      setNotice(
        result.recovery_setup_stale
          ? 'Guardian removed. Your recovery setup no longer matches your guardians — set it up again.'
          : 'Guardian removed.',
      );
      await load();
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  async function configureRecovery() {
    setBusy(true);
    setMessage(undefined);

    try {
      const opened = await unlockSeedVault(pin);
      if (opened.status !== 'unlocked') {
        setMessage(
          opened.status === 'invalid-pin'
            ? `Wrong PIN. ${opened.attemptsRemaining} attempts left before this device is erased.`
            : 'This device no longer holds your recovery phrase.',
        );
        return;
      }

      const recipients: GuardianRecipient[] = [];
      for (const guardian of active) {
        const entered = addresses[guardian.id] ?? '';
        if (entered.trim().length === 0) {
          setMessage(`Enter the account address for ${guardian.username} before setting up recovery.`);
          return;
        }
        recipients.push(toRecipient(guardian, await resolveGuardianAddress(guardian, entered)));
      }

      const built = await buildSetupPayload({
        seedPhrase: opened.seedPhrase,
        ownerUserAddress: context.session.userAddress,
        ownerX25519PublicKey: context.session.x25519PublicKey,
        ownerMlkemPublicKey: context.session.mlkem768PublicKey,
        guardians: recipients,
        threshold,
      });

      await submitRecoverySetup(context, built.payload);

      setPin('');
      setKit({
        share: built.recoveryKitShare,
        details: {
          username: account?.username ?? '',
          userAddress: context.session.userAddress,
          threshold,
          totalShares,
          guardianUsernames: recipients.map((recipient) => recipient.username),
          createdAt: new Date(),
        },
      });
    } catch (error) {
      setMessage(reportError(error));
    } finally {
      setBusy(false);
    }
  }

  if (kit) {
    return <RecoveryKitCard share={kit.share} details={kit.details} onDone={() => setKit(undefined)} />;
  }

  return (
    <div className="space-y-6">
      {message ? <Notice tone="danger">{message}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <GuardianInbox />

      <Card
        title="Your guardians"
        subtitle={`${summary.activeGuardians} active · ${summary.effectiveQuorum} needed to recover`}
      >
        {summary.raisesBarWithoutParticipant ? (
          <Notice tone="warning">
            You have asked for {summary.configuredThreshold} approvals but only{' '}
            {summary.activeGuardians} guardian
            {summary.activeGuardians === 1 ? '' : 's'} can give one. Until more accept, recovery
            needs {summary.effectiveQuorum}.
          </Notice>
        ) : null}

        {guardians === undefined ? (
          <Spinner />
        ) : guardians.length === 0 ? (
          <Empty>You have not asked anyone to be a guardian yet.</Empty>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
            {guardians.map((guardian) => (
              <li key={guardian.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium">{guardian.username}</p>
                  <p className="text-xs text-slate-500">
                    {guardian.status === 'active'
                      ? guardian.has_share
                        ? 'Active · holds a share'
                        : 'Active · no share yet'
                      : guardian.status === 'pending_invite'
                        ? 'Waiting for them to accept'
                        : 'Revoked'}
                  </p>
                </div>
                {guardian.status !== 'revoked' ? (
                  <Button variant="danger" disabled={busy} onClick={() => void revoke(guardian)}>
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Invite a guardian" subtitle="Enter their Cryple username.">
        <div className="space-y-4">
          <Field
            label="Username"
            value={username}
            autoComplete="off"
            onChange={(event) => setUsername(event.target.value)}
          />
          <Button disabled={busy || username.trim().length === 0} onClick={() => void invite()}>
            Send invitation
          </Button>
        </div>
      </Card>

      <Card
        title="Set up recovery"
        subtitle="Splits a recovery key between you and your guardians. Re-run it whenever your guardians change."
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            You hold one share yourself, so {active.length} active guardian
            {active.length === 1 ? '' : 's'} makes {totalShares} shares in total.
          </p>

          <Field
            label="Approvals needed to recover"
            type="number"
            min={1}
            max={totalShares}
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
          />

          {active.map((guardian) => (
            <Field
              key={guardian.id}
              label={`Account address for ${guardian.username}`}
              value={addresses[guardian.id] ?? ''}
              autoComplete="off"
              spellCheck={false}
              hint="64 hex characters. Their share is wrapped to this address, so it is checked against their username first."
              onChange={(event) =>
                setAddresses((current) => ({ ...current, [guardian.id]: event.target.value }))
              }
            />
          ))}

          {soleGuardianRisk ? (
            <Notice tone="danger">
              This person can recover your vault on their own. Only choose someone you fully trust.
            </Notice>
          ) : null}

          <Field
            label="Confirm your PIN"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            hint="Setting up recovery re-reads your recovery phrase from this device."
            onChange={(event) => setPin(event.target.value)}
          />

          <Button
            disabled={busy || pin.length === 0 || active.length === 0}
            onClick={() => void configureRecovery()}
          >
            {busy ? 'Working…' : 'Set up recovery'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export class GuardianAddressMismatchError extends Error {
  constructor(username: string, resolved: string) {
    super(
      `that address belongs to "${resolved}", not to "${username}" — a share wrapped to it ` +
        'could never be opened',
    );
    this.name = 'GuardianAddressMismatchError';
  }
}

async function resolveGuardianAddress(guardian: Guardian, address: string): Promise<string> {
  const trimmed = address.trim().toLowerCase();
  const resolved = await lookupUsername(trimmed);

  if (resolved !== guardian.username) {
    throw new GuardianAddressMismatchError(guardian.username, resolved);
  }

  return trimmed;
}
