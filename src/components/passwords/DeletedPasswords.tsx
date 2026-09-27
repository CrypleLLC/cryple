import type { DeletedCredential } from '@/lib/credentials';
import { siteLabel } from '@/lib/app';
import { Button, Notice, Spinner } from '@/components/ui';
import { SidePanel } from '@/components/shell/SidePanel';

export interface DeletedPasswordRow {
  deleted: DeletedCredential;
  site: string;
  username: string;
}

export default function DeletedPasswords({
  rows,
  error,
  busy,
  onRestore,
  onClose,
}: {
  rows: readonly DeletedPasswordRow[] | undefined;
  error: string | undefined;
  busy: boolean;
  onRestore: (row: DeletedPasswordRow) => void;
  onClose: () => void;
}) {
  return (
    <SidePanel
      title="Recently deleted"
      subtitle="A deleted password keeps its history until it is pruned, so it can be brought back."
      onClose={onClose}
    >
      {error !== undefined ? (
        <Notice tone="danger">{error}</Notice>
      ) : rows === undefined ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="text-compact text-ink-muted">Nothing has been deleted.</p>
      ) : (
        <ul className="-my-3 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.deleted.credentialId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-compact font-semibold text-ink">{siteLabel(row.site)}</p>
                {row.username !== '' ? <p className="truncate text-compact text-ink-soft">{row.username}</p> : null}
                <p className="truncate text-caption tracking-normal text-ink-muted normal-case">
                  Deleted {new Date(row.deleted.deletedAt).toLocaleString()}
                </p>
              </div>
              <Button variant="secondary" disabled={busy} onClick={() => onRestore(row)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SidePanel>
  );
}
