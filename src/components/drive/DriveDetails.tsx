import { useState } from 'react';
import {
  exactBytesLabel,
  extensionChangeNote,
  FILE_NAME_LIMIT,
  fileNameProblem,
  fileTypeLabel,
  folderItemsLabel,
  type FileKind,
  type FolderContents,
} from '@/lib/app';
import { Button, Field, Notice, Spinner } from '@/components/ui';
import { PencilIcon } from '@/components/ui/icons';
import { PanelFacts, SidePanel } from '@/components/shell/SidePanel';
import type { TreeFolder } from '@/lib/folders';
import type { FolderTreeState } from '@/components/folders/FolderBrowser';
import { FolderDetailsPanel } from '@/components/folders/FolderDetailsPanel';

export type DriveDetailsTarget = { kind: 'file'; id: string } | { kind: 'folder'; id: string };

export interface FileDetailsSource {
  fullName: string;
  kind: FileKind;
  readable: boolean;
  trueBytes: number;
  status: string;
  updatedAt: string;
}

export function FileDetails({
  file,
  onRename,
  onClose,
}: {
  file: FileDetailsSource;
  onRename?: (name: string) => Promise<string | undefined>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string>();

  const editing = draft !== undefined;
  const problem = editing ? fileNameProblem(draft) : undefined;
  const unchanged = editing && draft.trim() === file.fullName.trim();
  const note = editing ? extensionChangeNote(file.fullName, draft) : undefined;

  async function saveName() {
    if (onRename === undefined || draft === undefined || problem !== undefined || unchanged || saving) {
      return;
    }
    setSaving(true);
    const failed = await onRename(draft.trim());
    setSaving(false);
    setFailure(failed);
    if (failed === undefined) {
      setDraft(undefined);
    }
  }

  const facts = [
    { label: 'Type', value: fileTypeLabel(file.kind, file.fullName, file.readable) },
    { label: 'Size', value: exactBytesLabel(file.trueBytes) },
    ...(file.updatedAt === '' ? [] : [{ label: 'Modified', value: new Date(file.updatedAt).toLocaleString() }]),
    ...(file.status === '' ? [] : [{ label: 'Status', value: file.status }]),
  ];

  return (
    <SidePanel title="File details" onClose={onClose}>
      <div className="space-y-4">
        {editing ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
          >
            <Field
              label="Name"
              value={draft}
              autoFocus
              autoComplete="off"
              maxLength={FILE_NAME_LIMIT}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setDraft(undefined);
                }
              }}
              hint={draft.trim() === '' ? undefined : (problem ?? note)}
            />
            <p className="text-compact text-ink-muted">The name is encrypted on this device before it is stored.</p>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving || problem !== undefined || unchanged}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setDraft(undefined)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <PanelFacts facts={[{ label: 'Name', value: file.fullName }]} />
            {onRename !== undefined ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setDraft(file.fullName);
                  setFailure(undefined);
                }}
              >
                <PencilIcon className="h-4 w-4 shrink-0" />
                Rename
              </Button>
            ) : null}
          </div>
        )}
        {failure !== undefined ? <Notice tone="danger">{failure}</Notice> : null}
        <PanelFacts facts={facts} />
      </div>
    </SidePanel>
  );
}

export function FolderDetails({
  state,
  folder,
  contents,
  error,
  onClose,
}: {
  state: FolderTreeState;
  folder: TreeFolder;
  contents: FolderContents | undefined;
  error: string | undefined;
  onClose: () => void;
}) {
  return (
    <FolderDetailsPanel state={state} folder={folder} onClose={onClose}>
      <div className="space-y-4">
        {error !== undefined ? (
          <Notice tone="danger">{error}</Notice>
        ) : contents === undefined ? (
          <Spinner />
        ) : (
          <>
            <PanelFacts
              facts={[
                { label: 'Items', value: folderItemsLabel(contents) },
                { label: 'Total size', value: exactBytesLabel(contents.bytes) },
              ]}
            />
            {contents.folders > 0 ? (
              <p className="text-compact text-ink-muted">Counts and sizes include everything in its subfolders.</p>
            ) : null}
          </>
        )}
      </div>
    </FolderDetailsPanel>
  );
}
