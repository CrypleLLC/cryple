'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ChainNotVerifiedError,
  PhraseMismatchError,
  readVerifiedChain,
  removeOtherDevices,
} from '@/lib/account';
import { listDevices } from '@/lib/keyrings';
import { rewrapAfterRotation } from '@/lib/rekey';
import { editAddressBook, loadAddressBook, setDeviceName } from '@/lib/sharing';
import {
  DEVICES_COPY,
  SECOND_FACTOR_COPY,
  checkMnemonic,
  describeScopes,
  deviceRows,
  mnemonicSentence,
  type DeviceRow,
} from '@/lib/app';
import { useAuthedContext, useCryple } from './CrypleProvider';
import ConnectExtension from './ConnectExtension';
import { Badge, Button, Card, Field, Notice, TextArea } from './ui';

export default function DevicesScreen() {
  const context = useAuthedContext();
  const { fullDevice, holds, reportError } = useCryple();
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [verified, setVerified] = useState<boolean>();
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string }>();
  const [removing, setRemoving] = useState<DeviceRow>();

  const refresh = useCallback(async () => {
    try {
      const [{ devices }, names] = await Promise.all([
        listDevices(context),
        holds('sharing') ? loadAddressBook(context).then((book) => book.devices) : Promise.resolve({}),
      ]);
      setRows(deviceRows(devices, names, context.session.deviceId));
      try {
        await readVerifiedChain(
          context,
          { userAddress: context.session.userAddress, rootPublicKey: context.session.rootPublicKey },
          context.session.deviceId,
        );
        setVerified(true);
      } catch (error) {
        if (error instanceof ChainNotVerifiedError) {
          setVerified(false);
          return;
        }
        throw error;
      }
    } catch (error) {
      setMessage({ tone: 'danger', text: reportError(error) });
    }
  }, [context, holds, reportError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function rename(row: DeviceRow, name: string) {
    try {
      await editAddressBook(context, setDeviceName(row.id, name));
      await refresh();
    } catch (error) {
      setMessage({ tone: 'danger', text: reportError(error) });
    }
  }

  return (
    <div className="space-y-6">
      <Card title={DEVICES_COPY.title} subtitle={DEVICES_COPY.summary}>
        <div className="space-y-4">
          {verified === true ? <Notice tone="success">{DEVICES_COPY.chainVerified}</Notice> : null}
          {verified === false ? <Notice tone="danger">{DEVICES_COPY.chainBroken}</Notice> : null}
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

          <ul className="space-y-4">
            {rows.map((row) => (
              <DeviceItem
                key={row.id}
                row={row}
                canName={holds('sharing')}
                canRemove={fullDevice && !row.isThisDevice && verified === true}
                onRename={(name) => void rename(row, name)}
                onRemove={() => setRemoving(row)}
              />
            ))}
          </ul>
        </div>
      </Card>

      {fullDevice && holds('passwords') ? <ConnectExtension onLinked={() => void refresh()} /> : null}

      {removing ? (
        <RemoveDevice
          row={removing}
          onDone={async (text) => {
            setRemoving(undefined);
            setMessage({ tone: 'success', text });
            await refresh();
          }}
          onCancel={() => setRemoving(undefined)}
        />
      ) : null}
    </div>
  );
}

function DeviceItem({
  row,
  canName,
  canRemove,
  onRename,
  onRemove,
}: {
  row: DeviceRow;
  canName: boolean;
  canRemove: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.name);

  return (
    <li className="space-y-2 rounded-xl border border-line bg-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-ink">{row.name}</span>
          {row.isThisDevice ? <Badge tone="brand">{DEVICES_COPY.thisDevice}</Badge> : null}
          <Badge tone="neutral">{row.full ? DEVICES_COPY.full : DEVICES_COPY.limited}</Badge>
        </span>
        <span className="flex gap-2">
          {canName ? (
            <Button variant="ghost" onClick={() => setEditing((open) => !open)}>
              {DEVICES_COPY.rename}
            </Button>
          ) : null}
          {canRemove ? (
            <Button variant="danger" onClick={onRemove}>
              {DEVICES_COPY.remove}
            </Button>
          ) : null}
        </span>
      </div>
      <p className="text-compact text-ink-muted">
        {describeScopes(row.scopes)} · added {new Date(row.createdAt).toLocaleDateString()}
      </p>
      {editing ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field
            label="Name"
            value={name}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            onClick={() => {
              setEditing(false);
              onRename(name);
            }}
          >
            {DEVICES_COPY.save}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function RemoveDevice({
  row,
  onDone,
  onCancel,
}: {
  row: DeviceRow;
  onDone: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const context = useAuthedContext();
  const { reportError } = useCryple();
  const [mnemonic, setMnemonic] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function remove() {
    const checked = checkMnemonic(mnemonic);
    if (!checked.ok) {
      setMessage(checked.message);
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const rotated = await removeOtherDevices(context, mnemonicSentence(mnemonic), [row.id]);
      setMnemonic('');
      await rewrapAfterRotation(context, rotated);
      await onDone(DEVICES_COPY.removed);
    } catch (error) {
      setMessage(
        error instanceof PhraseMismatchError ? SECOND_FACTOR_COPY.phraseMismatch : reportError(error),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`${DEVICES_COPY.removeTitle}: ${row.name}`} subtitle={DEVICES_COPY.removeWarning}>
      <div className="space-y-4">
        {message ? <Notice tone="danger">{message}</Notice> : null}
        <TextArea
          label="Recovery phrase"
          value={mnemonic}
          autoComplete="off"
          spellCheck={false}
          hint={DEVICES_COPY.removePhrase}
          onChange={(event) => setMnemonic(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" disabled={busy} onClick={() => void remove()}>
            {busy ? DEVICES_COPY.removing : DEVICES_COPY.removeSubmit}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}
