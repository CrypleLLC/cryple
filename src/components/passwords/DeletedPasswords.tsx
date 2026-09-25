import type { DeletedCredential } from '@/lib/credentials';
import { siteLabel } from '@/lib/app';
import { Button, Card } from '@/components/ui';

export interface DeletedPasswordRow {
  deleted: DeletedCredential;
  site: string;
  username: string;
}

export default function DeletedPasswords({
  rows,
  busy,
  onShow,
  onRestore,
}: {
  rows: readonly DeletedPasswordRow[] | undefined;
  busy: boolean;
  onShow: () => void;
  onRestore: (row: DeletedPasswordRow) => void;
}) {
  return (
    <Card
      title="Recently deleted"
      subtitle="A deleted password keeps its history until it is pruned, so it can be brought back."
      actions={
        rows === undefined ? (
          <Button variant="secondary" onClick={onShow}>
            Show
          </Button>
        ) : null
      }
    >
      {rows === undefined ? null : rows.length === 0 ? (
        <p className="text-compact text-ink-muted">Nothing has been deleted.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.deleted.credentialId} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-compact font-semibold text-ink">{siteLabel(row.site)}</p>
                <p className="truncate text-caption normal-case tracking-normal text-ink-muted">
                  {row.username} · deleted {new Date(row.deleted.deletedAt).toLocaleString()}
                </p>
              </div>
              <Button variant="secondary" disabled={busy} onClick={() => onRestore(row)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
