'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  childrenOf,
  createFolder,
  deleteFolder,
  descendantsOf,
  FolderEditError,
  FolderManifestInvalidError,
  liveFolders,
  moveFolder,
  pathTo,
  placeItem,
  renameFolder,
  type FolderEdit,
  type FolderManifest,
} from '@/lib/folders';
import {
  ConnectionGoneError,
  editSharedFolders,
  loadSharedFolders,
  resetSharedFolders,
  type ConnectionRecord,
} from '@/lib/sharing';
import { sharedFolderEditProblem, sharedTreeFolders, SHARING_COPY } from '@/lib/app';
import { useAuthedContext, useCryple } from '@/components/session/CrypleProvider';
import type { FolderTreeState } from '@/components/folders/FolderBrowser';

export interface SharedFolderTreeState extends FolderTreeState {
  manifest: FolderManifest | undefined;
  reset: () => Promise<void>;
}

function placeAll(ids: readonly string[], target: string | null): FolderEdit {
  return (manifest, rules) => ids.reduce((placed, id) => placeItem(id, target)(placed, rules), manifest);
}

export function useSharedFolderTree(connection: ConnectionRecord): SharedFolderTreeState {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const [manifest, setManifest] = useState<FolderManifest>();
  const [loaded, setLoaded] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const explain = useCallback(
    (error: unknown) => {
      if (error instanceof FolderEditError) {
        return sharedFolderEditProblem(error.problem);
      }
      if (error instanceof ConnectionGoneError) {
        return SHARING_COPY.lostConnection;
      }
      return reportError(error);
    },
    [reportError],
  );

  const accept = useCallback((next: FolderManifest) => {
    setManifest(next);
    setInvalid(false);
    setCurrent((open) => (open !== null && !liveFolders(next).some((folder) => folder.id === open) ? null : open));
  }, []);

  const reload = useCallback(async () => {
    try {
      accept(await loadSharedFolders(context, connection, { fresh: true }));
    } catch (error) {
      if (error instanceof FolderManifestInvalidError) {
        setInvalid(true);
        setManifest(undefined);
        setCurrent(null);
      } else {
        setMessage(explain(error));
      }
    } finally {
      setLoaded(true);
    }
  }, [context, connection, accept, explain]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const edit = useCallback(
    async (change: FolderEdit): Promise<boolean> => {
      setBusy(true);
      try {
        accept(await editSharedFolders(context, connection, change));
        setMessage(undefined);
        return true;
      } catch (error) {
        setMessage(explain(error));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [context, connection, accept, explain],
  );

  const folders = useMemo(
    () => (loaded ? (manifest === undefined ? [] : sharedTreeFolders(manifest)) : undefined),
    [loaded, manifest],
  );
  const path = useMemo(() => pathTo(folders ?? [], current), [folders, current]);
  const children = useMemo(() => childrenOf(folders ?? [], current), [folders, current]);

  return {
    deletes: 'grouping',
    folders,
    current,
    open: setCurrent,
    path,
    children,
    invalid,
    message,
    setMessage,
    busy,
    listing: undefined,
    create: (name) => edit(createFolder({ name, parentId: current })),
    rename: (id, name) => edit(renameFolder(id, name)),
    remove: async (id) => {
      const count = descendantsOf(folders ?? [], id).size;
      return (await edit(deleteFolder(id))) ? { folders: count, items: 0 } : undefined;
    },
    moveFolder: (id, target) => edit(moveFolder(id, { parentId: target })),
    moveItems: (ids, target) => edit(placeAll(ids, target)),
    reload,
    manifest,
    reset: async () => {
      setBusy(true);
      try {
        accept(await resetSharedFolders(context, connection));
        setMessage(undefined);
      } catch (error) {
        setMessage(explain(error));
      } finally {
        setBusy(false);
      }
    },
  };
}
