import { dateAndTimeLabels, RECENTLY_DELETED_SUBTITLE, type DeletedVaultRow } from '@/lib/app';
import { Button, HintedIconButton, Notice, Spinner } from '@/components/ui';
import { TrashIcon } from '@/components/ui/icons';
import { SidePanel } from '@/components/shell/SidePanel';

export default function DeletedSecrets({
  rows,
  error,
  busy,
  canPurge,
  onRestore,
  onPurge,
  onClose,
}: {
  rows: readonly DeletedVaultRow[] | undefined;
  error: string | undefined;
  busy: boolean;
  canPurge: boolean;
  onRestore: (row: DeletedVaultRow) => void;
  onPurge: (ids: string[]) => void;
  onClose: () => void;
}) {
  return (
    <SidePanel title="Recently deleted" subtitle={RECENTLY_DELETED_SUBTITLE} onClose={onClose}>
      {error !== undefined ? (
        <Notice tone="danger">{error}</Notice>
      ) : rows === undefined ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <p className="text-compact text-ink-muted">Nothing has been deleted.</p>
      ) : (
        <div className="space-y-4">
          <ul className="-my-3 divide-y divide-line">
            {rows.map((row) => {
              const { date, time } = dateAndTimeLabels(row.deletedAt);

              return (
                <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p
                      className={`truncate text-compact font-semibold ${
                        row.readable ? 'text-ink' : 'italic text-ink-muted'
                      }`}
                    >
                      {row.name}
                    </p>
                    <p className="truncate text-caption tracking-normal text-ink-muted normal-case">
                      Deleted {date} {time}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="secondary" disabled={busy} onClick={() => onRestore(row)}>
                      Restore
                    </Button>
                    {canPurge ? (
                      <HintedIconButton
                        hint="Delete permanently"
                        aria-label={`Delete ${row.name} permanently`}
                        placement="left"
                        tone="danger"
                        disabled={busy}
                        onClick={() => onPurge([row.id])}
                      >
                        <TrashIcon className="h-4 w-4 shrink-0" />
                      </HintedIconButton>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {canPurge && rows.length > 1 ? (
            <div className="border-t border-line pt-4">
              <Button variant="danger" disabled={busy} onClick={() => onPurge(rows.map((row) => row.id))}>
                <TrashIcon className="h-4 w-4 shrink-0" />
                Delete all permanently
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </SidePanel>
  );
}
