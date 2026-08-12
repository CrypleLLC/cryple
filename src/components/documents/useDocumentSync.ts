'use client';

import { useEffect, useMemo, useState } from 'react';
import { DocumentSync, apiTransport, type SyncState } from '@/lib/documents';
import { useAuthedContext, useCryple } from '@/components/CrypleProvider';

export interface DocumentSyncHandle {
  sync?: DocumentSync;
  state: SyncState;
  error?: string;
}

const INITIAL_STATE: SyncState = {
  status: 'loading',
  cursor: 0,
  snapshotSeq: 0,
  revision: 0,
  pending: 0,
  gapDetected: false,
};

export function useDocumentSync(id: string): DocumentSyncHandle {
  const context = useAuthedContext();
  const { reportError } = useCryple();
  const transport = useMemo(() => apiTransport(context), [context]);

  const [sync, setSync] = useState<DocumentSync>();
  const [state, setState] = useState<SyncState>(INITIAL_STATE);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const engine = new DocumentSync(id, transport);

    const unsubscribe = engine.subscribe((next) => {
      if (!cancelled) {
        setState(next);
      }
    });

    engine
      .open()
      .then(() => {
        if (cancelled) {
          return;
        }
        engine.startPolling();
        setSync(engine);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(reportError(cause));
        }
      });

    return () => {
      cancelled = true;
      unsubscribe();
      setSync(undefined);
      setState(INITIAL_STATE);
      void engine.close().catch(() => undefined);
    };
  }, [id, transport, reportError]);

  useEffect(() => {
    if (sync === undefined) {
      return;
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void sync.poll().catch(() => undefined);
      } else {
        void sync.flush().catch(() => undefined);
      }
    };
    const onOnline = () => void sync.flush().catch(() => undefined);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
    };
  }, [sync]);

  return { sync, state, error };
}
