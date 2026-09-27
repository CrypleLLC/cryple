'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { childrenOf, type TreeFolder } from '@/lib/folders';
import { folderNameProblem } from '@/lib/app';
import { Button, Field, Notice } from '@/components/ui';
import { PencilIcon } from '@/components/ui/icons';
import { PanelFacts, SidePanel } from '@/components/shell/SidePanel';
import { folderLabel, type FolderTreeState } from './FolderBrowser';

export function FolderDetailsPanel({
  state,
  folder,
  onClose,
  children,
}: {
  state: FolderTreeState;
  folder: TreeFolder;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState<string>();
  const [failed, setFailed] = useState(false);
  const siblings = useMemo(() => childrenOf(state.folders ?? [], folder.parentId), [state.folders, folder.parentId]);

  const editing = draft !== undefined;
  const problem = editing ? folderNameProblem(draft, siblings, folder.id) : undefined;
  const unchanged = editing && draft.trim() === (folder.name ?? '').trim();

  function startRenaming() {
    setDraft(folder.name ?? '');
    setFailed(false);
  }

  async function saveName() {
    if (draft === undefined || problem !== undefined || unchanged || state.busy) {
      return;
    }
    const renamed = await state.rename(folder.id, draft);
    setFailed(!renamed);
    if (renamed) {
      setDraft(undefined);
    }
  }

  return (
    <SidePanel title="Folder details" onClose={onClose}>
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
              maxLength={120}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setDraft(undefined);
                }
              }}
              hint={draft.trim() === '' ? undefined : problem}
            />
            <p className="text-compact text-ink-muted">The name is encrypted on this device before it is stored.</p>
            <div className="flex gap-2">
              <Button type="submit" disabled={state.busy || problem !== undefined || unchanged}>
                {state.busy ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" variant="secondary" disabled={state.busy} onClick={() => setDraft(undefined)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <PanelFacts facts={[{ label: 'Name', value: folderLabel(folder) }]} />
            <Button variant="secondary" disabled={state.busy} onClick={startRenaming}>
              <PencilIcon className="h-4 w-4 shrink-0" />
              Rename
            </Button>
          </div>
        )}
        {failed && state.message !== undefined ? <Notice tone="danger">{state.message}</Notice> : null}
        {children}
      </div>
    </SidePanel>
  );
}
