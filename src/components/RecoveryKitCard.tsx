'use client';

import { useEffect, useState } from 'react';
import { RECOVERY_KIT_INSTRUCTIONS, renderRecoveryKit, type RecoveryKitDetails } from '@/lib/app';
import { Button, Card, Notice } from './ui';

export default function RecoveryKitCard({
  share,
  details,
  onDone,
}: {
  share: Uint8Array;
  details: RecoveryKitDetails;
  onDone?: () => void;
}) {
  const [kit, setKit] = useState<string>();

  useEffect(() => {
    let live = true;
    void renderRecoveryKit(share, details).then((text) => {
      if (live) {
        setKit(text);
      }
    });
    return () => {
      live = false;
    };
  }, [share, details]);

  return (
    <Card
      title="Your Recovery Kit"
      subtitle="This is your own share. Save it now — it is shown once."
    >
      <div className="space-y-4">
        <Notice tone="warning">
          <ul className="list-disc space-y-1 pl-4">
            {RECOVERY_KIT_INSTRUCTIONS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Notice>

        <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
          {kit ?? 'Preparing…'}
        </pre>

        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" disabled={kit === undefined} onClick={() => window.print()}>
            Print
          </Button>
          <Button
            variant="secondary"
            disabled={kit === undefined}
            onClick={() => void navigator.clipboard?.writeText(kit ?? '')}
          >
            Copy
          </Button>
          {onDone ? <Button onClick={onDone}>I have saved it</Button> : null}
        </div>
      </div>
    </Card>
  );
}
