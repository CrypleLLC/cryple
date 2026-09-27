import { exactBytesLabel, fileTypeLabel, folderItemsLabel, type FileKind, type FolderContents } from '@/lib/app';
import { Notice, Spinner } from '@/components/ui';
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

export function FileDetails({ file, onClose }: { file: FileDetailsSource; onClose: () => void }) {
  return (
    <SidePanel title="File details" onClose={onClose}>
      <PanelFacts
        facts={[
          { label: 'Name', value: file.fullName },
          { label: 'Type', value: fileTypeLabel(file.kind, file.fullName, file.readable) },
          { label: 'Size', value: exactBytesLabel(file.trueBytes) },
          ...(file.updatedAt === '' ? [] : [{ label: 'Modified', value: new Date(file.updatedAt).toLocaleString() }]),
          ...(file.status === '' ? [] : [{ label: 'Status', value: file.status }]),
        ]}
      />
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
