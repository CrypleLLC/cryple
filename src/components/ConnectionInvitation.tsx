'use client';

import { useEffect, useState } from 'react';
import { base64ToBytes } from '@/lib/encoding';
import { getPublicKeys, resolveUsername } from '@/lib/users';
import { keyFingerprint, ownKeyFingerprint, type ConnectionRecord } from '@/lib/sharing';
import { fingerprintChanged, SHARING_COPY } from '@/lib/app';
import { useAuthedContext } from './CrypleProvider';
import { Button, Card, Notice } from './ui';

const PIN_PREFIX = 'cryple.sharing.fingerprint.';

function readPin(connectionId: string): string | undefined {
  try {
    return window.localStorage.getItem(PIN_PREFIX + connectionId) ?? undefined;
  } catch {
    return undefined;
  }
}

function writePin(connectionId: string, fingerprint: string): void {
  try {
    window.localStorage.setItem(PIN_PREFIX + connectionId, fingerprint);
  } catch {
    return;
  }
}

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
  const [alarm, setAlarm] = useState(false);

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        const resolved = await resolveUsername(context, connection.username);
        if (!resolved) {
          onError(SHARING_COPY.inviteUnknown);
          return;
        }

        const published = await getPublicKeys(context, resolved.uuid);
        const fingerprint = await keyFingerprint({
          x25519PublicKey: base64ToBytes(published.encryption_public_key_x25519),
          mlkemPublicKey: base64ToBytes(published.encryption_public_key_mlkem),
        });
        const own = await ownKeyFingerprint(context);

        if (!live) {
          return;
        }

        setAlarm(fingerprintChanged(readPin(connection.id), fingerprint));
        setTheirs(fingerprint);
        setMine(own);
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      live = false;
    };
  }, [context, connection.id, connection.username, onError]);

  function accept() {
    if (theirs) {
      writePin(connection.id, theirs);
    }
    onAccept();
  }

  return (
    <Card title={SHARING_COPY.fingerprintTitle} subtitle={SHARING_COPY.fingerprintWhy}>
      <div className="space-y-4">
        {alarm ? <Notice tone="danger">{SHARING_COPY.fingerprintChanged}</Notice> : null}

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
          <Button onClick={accept} disabled={theirs === undefined}>
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
