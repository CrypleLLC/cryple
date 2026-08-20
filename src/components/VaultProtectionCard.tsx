'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  anchorVaultRoot,
  deriveSmartAccount,
  fetchCurrentEpoch,
  fetchLatestRoot,
  type AnchorResult,
  type OperationStage,
} from '@/lib/chain';
import {
  allVerified,
  buildProtectionView,
  NothingToAnchorError,
  runAnchorPass,
  vaultAnchorState,
  verifyVaultAgainstRoot,
  type LeafCacheKey,
  type VaultAnchorState,
  type VaultSources,
} from '@/lib/app';
import { compactForAnchor } from '@/lib/documents';
import type { VaultItem } from '@/lib/vaultmerkle';
import { useAuthedContext, useCryple } from './CrypleProvider';
import { Button, Card, Notice, Spinner } from './ui';

const BUSY_LABELS: Record<OperationStage['name'] | 'collecting', string> = {
  collecting: 'Checking what needs protecting…',
  deriving: 'Preparing…',
  measuring: 'Preparing…',
  sponsoring: 'Preparing…',
  'self-funding': 'Preparing…',
  signing: 'Confirming it is you…',
  submitting: 'Sending…',
  waiting: 'Waiting for confirmation…',
};

export default function VaultProtectionCard({ sources }: { sources: VaultSources }) {
  const context = useAuthedContext();
  const { session } = context;
  const { reportError } = useCryple();

  const [anchorState, setAnchorState] = useState<VaultAnchorState>();
  const [pending, setPending] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState<keyof typeof BUSY_LABELS>();
  const [message, setMessage] = useState<string>();
  const [cache, setCache] = useState<Map<LeafCacheKey, VaultItem>>(new Map());
  const [verified, setVerified] = useState<boolean>();

  const identity = useCallback(
    () => ({
      privateKey: session.identityPrivateKey,
      publicKeyUncompressed: session.identityPublicKeyUncompressed,
    }),
    [session],
  );

  const readChain = useCallback(async () => {
    try {
      const latest = await fetchLatestRoot(deriveSmartAccount(identity()));
      setAnchorState(
        latest === undefined
          ? { state: 'never', currentRoot: '0x' }
          : { state: 'unverified', anchoredEpoch: latest.epoch },
      );
    } catch {
      setAnchorState(undefined);
    }
  }, [identity]);

  useEffect(() => {
    void readChain();
  }, [readChain]);

  const protect = useCallback(async () => {
    setMessage(undefined);
    setBusy('collecting');

    try {
      const pass = await runAnchorPass(sources, {
        cache,
        compactDocument: (id) => compactForAnchor(context, id),
      });
      setCache(pass.cache);
      setPending(pass.pendingDocuments);
      setExcluded(pass.excludedDocuments);

      const address = deriveSmartAccount(identity());
      const [epoch, latest] = await Promise.all([fetchCurrentEpoch(), fetchLatestRoot(address)]);

      const state = vaultAnchorState(pass.root, latest, epoch);
      if (state.state === 'anchored') {
        setVerified(allVerified(verifyVaultAgainstRoot(pass.items, latest?.root ?? pass.root)));
        setAnchorState(state);
        return;
      }

      const result: AnchorResult = await anchorVaultRoot(identity(), pass.root, {
        reportedSmartAccountAddress: address,
        onStage: (stage) => setBusy(stage.name),
      });

      const readBack = await fetchLatestRoot(address);
      setVerified(
        readBack !== undefined && allVerified(verifyVaultAgainstRoot(pass.items, readBack.root)),
      );
      setAnchorState({ state: 'anchored', epoch: result.epoch, root: result.root });
    } catch (cause) {
      setMessage(
        cause instanceof NothingToAnchorError ? cause.message : reportError(cause),
      );
    } finally {
      setBusy(undefined);
    }
  }, [sources, cache, identity, reportError, context]);

  const view = useMemo(
    () => (anchorState ? buildProtectionView(anchorState, pending, excluded) : undefined),
    [anchorState, pending, excluded],
  );

  return (
    <Card title="Protection" subtitle="Proof your heirs can check, without trusting Cryple.">
      <div className="space-y-4">
        {view ? (
          <Notice tone={view.tone === 'ok' ? 'success' : 'warning'}>{view.headline}</Notice>
        ) : (
          <Notice tone="info">Checking your vault…</Notice>
        )}

        {view?.detail ? <p className="text-sm text-slate-600 dark:text-slate-400">{view.detail}</p> : null}

        {busy ? (
          <div>
            <Spinner />
            <p className="text-center text-sm text-slate-500">{BUSY_LABELS[busy]}</p>
          </div>
        ) : (
          <Button disabled={busy !== undefined} onClick={() => void protect()}>
            {view?.actionLabel ?? 'Protect my vault'}
          </Button>
        )}

        {verified === false ? (
          <Notice tone="danger">
            Your vault was saved, but this device could not confirm every item against it. Try
            protecting again.
          </Notice>
        ) : null}

        {message ? <Notice tone="danger">{message}</Notice> : null}
      </div>
    </Card>
  );
}
