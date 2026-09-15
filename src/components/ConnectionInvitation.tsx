'use client';

import { useEffect, useState } from 'react';
import {
  fingerprintPinOptions,
  ownKeyFingerprint,
  pinFingerprint,
  verifyConnection,
  type ConnectionRecord,
} from '@/lib/sharing';
import { SHARING_COPY, trustAlarm, type TrustAlarm } from '@/lib/app';
import { useAuthedContext } from './CrypleProvider';
import { Button, Card, Notice } from './ui';

export default function ConnectionInvitation({
  connection,
  onAccept,
  onDecline,
  onError,
}: {
  connection: ConnectionRecord;
  onAccept: () => void;
  onDecline: () => void;
  onError: (message: string) => void;
}) {
  const context = useAuthedContext();

  const [theirs, setTheirs] = useState<string>();
  const [mine, setMine] = useState<string>();
  const [alarm, setAlarm] = useState<TrustAlarm>();

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        const trust = await verifyConnection(context, connection);
        const own = await ownKeyFingerprint(context);

        if (!live) {
          return;
        }

        setAlarm(trustAlarm(trust));
        setTheirs('fingerprint' in trust ? trust.fingerprint : undefined);
        setMine(own);
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      live = false;
    };
  }, [context, connection, onError]);

  async function accept() {
    if (theirs === undefined || alarm !== undefined) {
      return;
    }

    const standing = await pinFingerprint(connection.id, theirs, fingerprintPinOptions(context)).catch(
      () => theirs,
    );
    if (standing !== theirs) {
      setAlarm({ tone: 'danger', message: SHARING_COPY.fingerprintChanged });
      return;
    }
    onAccept();
  }

  return (
    <Card title={SHARING_COPY.fingerprintTitle} subtitle={SHARING_COPY.fingerprintWhy}>
      <div className="space-y-4">
        {alarm ? <Notice tone={alarm.tone}>{alarm.message}</Notice> : null}

        <div>
          <p className="text-compact font-semibold text-ink-soft">
            {connection.username}&rsquo;s fingerprint
          </p>
          <p className="mt-1 font-mono text-title tracking-wide text-ink">{theirs ?? '…'}</p>
        </div>

        <div>
          <p className="text-compact font-semibold text-ink-soft">Yours, to read back to them</p>
          <p className="mt-1 font-mono text-ink-soft">{mine ?? '…'}</p>
        </div>

        <div className="flex gap-3">
          <Button onClick={() => void accept()} disabled={theirs === undefined || alarm !== undefined}>
            {SHARING_COPY.fingerprintConfirm}
          </Button>
          <Button variant="ghost" onClick={onDecline}>
            {SHARING_COPY.fingerprintDecline}
          </Button>
        </div>
      </div>
    </Card>
  );
}
