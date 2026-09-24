import { describe, expect, it } from 'vitest';
import {
  childFolders,
  createFolder,
  deleteFolder,
  emptyFolderManifest,
  folderOf,
  folderPath,
  FolderEditError,
  FolderManifestInvalidError,
  forgetItems,
  HOME_FOLDER_ID,
  itemsIn,
  liveFolders,
  mergeFolderManifests,
  moveFolder,
  parseFolderManifest,
  placeItem,
  renameFolder,
  validateFolderManifest,
  type FolderEdit,
  type FolderManifest,
  type FolderRules,
} from './manifest';

const FLAT: FolderRules = { maxDepth: 1, home: true };
const TREE: FolderRules = { maxDepth: 3, home: false };

const T0 = new Date('2026-09-24T10:00:00Z');
const T1 = new Date('2026-09-24T10:01:00Z');
const T2 = new Date('2026-09-24T10:02:00Z');
const T3 = new Date('2026-09-24T10:03:00Z');

function apply(manifest: FolderManifest, rules: FolderRules, ...edits: FolderEdit[]): FolderManifest {
  return edits.reduce((current, edit) => edit(current, rules), manifest);
}

function problemOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof FolderManifestInvalidError || error instanceof FolderEditError) {
      return error.problem;
    }
    throw error;
  }
  return undefined;
}

function folder(name: string, parentId: string | null, over: Partial<FolderManifest['folders'][string]> = {}) {
  return { name, parent_id: parentId, position: 0, updated_at: T0.toISOString(), ...over };
}

describe('an empty manifest', () => {
  it('holds only home in a flat scope, and nothing in a tree scope', () => {
    expect(Object.keys(emptyFolderManifest(FLAT, T0).folders)).toEqual([HOME_FOLDER_ID]);
    expect(emptyFolderManifest(TREE, T0).folders).toEqual({});
  });

  it('files an unplaced item in home, or at the root of a tree', () => {
    expect(folderOf(emptyFolderManifest(FLAT, T0), 'item', FLAT)).toBe(HOME_FOLDER_ID);
    expect(folderOf(emptyFolderManifest(TREE, T0), 'item', TREE)).toBeNull();
  });
});

describe('parsing', () => {
  it('round-trips through JSON', () => {
    const manifest = apply(
      emptyFolderManifest(FLAT, T0),
      FLAT,
      createFolder({ id: 'banks', name: 'Banks' }, T1),
      placeItem('item', 'banks', T1),
    );
    expect(parseFolderManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('refuses another version, a malformed entry and an empty name', () => {
    expect(problemOf(() => parseFolderManifest('{"v":2,"folders":{},"items":{}}'))).toBe('unknown-version');
    expect(problemOf(() => parseFolderManifest('not json'))).toBe('malformed');
    expect(
      problemOf(() => parseFolderManifest(JSON.stringify({ v: 1, folders: { a: { name: 'A' } }, items: {} }))),
    ).toBe('malformed');
    expect(
      problemOf(() =>
        parseFolderManifest(JSON.stringify({ v: 1, folders: { a: folder('  ', null) }, items: {} })),
      ),
    ).toBe('bad-name');
  });
});

describe('validation', () => {
  it('refuses a cycle instead of rendering it', () => {
    const manifest: FolderManifest = {
      v: 1,
      folders: { a: folder('A', 'b'), b: folder('B', 'a') },
      items: {},
    };
    expect(problemOf(() => validateFolderManifest(manifest, TREE))).toBe('cycle');
  });

  it('refuses a folder that is its own parent', () => {
    const manifest: FolderManifest = { v: 1, folders: { a: folder('A', 'a') }, items: {} };
    expect(problemOf(() => validateFolderManifest(manifest, TREE))).toBe('cycle');
  });

  it('refuses a parent that does not exist', () => {
    const manifest: FolderManifest = { v: 1, folders: { a: folder('A', 'ghost') }, items: {} };
    expect(problemOf(() => validateFolderManifest(manifest, TREE))).toBe('unknown-parent');
  });

  it('refuses a tree deeper than the scope allows', () => {
    const manifest: FolderManifest = {
      v: 1,
      folders: { a: folder('A', null), b: folder('B', 'a'), c: folder('C', 'b'), d: folder('D', 'c') },
      items: {},
    };
    expect(problemOf(() => validateFolderManifest(manifest, TREE))).toBe('too-deep');
  });

  it('refuses nesting in a flat scope', () => {
    const manifest = {
      ...emptyFolderManifest(FLAT, T0),
      folders: { ...emptyFolderManifest(FLAT, T0).folders, a: folder('A', HOME_FOLDER_ID) },
    };
    expect(problemOf(() => validateFolderManifest(manifest, FLAT))).toBe('too-deep');
  });

  it('refuses a flat scope without home', () => {
    expect(problemOf(() => validateFolderManifest({ v: 1, folders: {}, items: {} }, FLAT))).toBe('missing-home');
  });

  it('refuses a live folder under a deleted one', () => {
    const manifest: FolderManifest = {
      v: 1,
      folders: { a: folder('A', null, { deleted_at: T0.toISOString() }), b: folder('B', 'a') },
      items: {},
    };
    expect(problemOf(() => validateFolderManifest(manifest, TREE))).toBe('deleted-parent');
  });

  it('refuses an item placed in a folder that never existed', () => {
    const manifest: FolderManifest = {
      v: 1,
      folders: {},
      items: { item: { folder_id: 'ghost', updated_at: T0.toISOString() } },
    };
    expect(problemOf(() => validateFolderManifest(manifest, TREE))).toBe('unknown-folder');
  });
});

describe('edits', () => {
  it('creates tabs in order and renames them', () => {
    const manifest = apply(
      emptyFolderManifest(FLAT, T0),
      FLAT,
      createFolder({ id: 'banks', name: ' Banks ' }, T1),
      createFolder({ id: 'sites', name: 'Sites' }, T1),
      renameFolder(HOME_FOLDER_ID, 'Everything', T2),
    );
    expect(liveFolders(manifest).map((entry) => [entry.id, entry.name])).toEqual([
      [HOME_FOLDER_ID, 'Everything'],
      ['banks', 'Banks'],
      ['sites', 'Sites'],
    ]);
  });

  it('mints an id when none is given, once per edit', () => {
    const edit = createFolder({ name: 'Books' }, T1);
    const first = edit(emptyFolderManifest(FLAT, T0), FLAT);
    const again = edit(emptyFolderManifest(FLAT, T0), FLAT);
    expect(Object.keys(first.folders)).toEqual(Object.keys(again.folders));
  });

  it('never nests in a flat scope', () => {
    const manifest = apply(emptyFolderManifest(FLAT, T0), FLAT, createFolder({ id: 'banks', name: 'Banks' }, T1));
    expect(problemOf(() => createFolder({ id: 'x', name: 'X', parentId: 'banks' })(manifest, FLAT))).toBe('too-deep');
    expect(problemOf(() => moveFolder('banks', { parentId: HOME_FOLDER_ID })(manifest, FLAT))).toBe('too-deep');
  });

  it('keeps home: it cannot be deleted or moved', () => {
    const manifest = emptyFolderManifest(FLAT, T0);
    expect(problemOf(() => deleteFolder(HOME_FOLDER_ID)(manifest, FLAT))).toBe('home-is-fixed');
    expect(problemOf(() => moveFolder(HOME_FOLDER_ID, { parentId: 'banks' })(manifest, FLAT))).toBe('home-is-fixed');
  });

  it('refuses a duplicate id, an empty name and a name that is too long', () => {
    const manifest = emptyFolderManifest(FLAT, T0);
    expect(problemOf(() => createFolder({ id: HOME_FOLDER_ID, name: 'Again' })(manifest, FLAT))).toBe(
      'folder-exists',
    );
    expect(problemOf(() => createFolder({ id: 'a', name: '   ' })(manifest, FLAT))).toBe('bad-name');
    expect(problemOf(() => createFolder({ id: 'a', name: 'x'.repeat(121) })(manifest, FLAT))).toBe('bad-name');
  });

  it('refuses to move a folder into its own subtree', () => {
    const manifest = apply(
      emptyFolderManifest(TREE, T0),
      TREE,
      createFolder({ id: 'a', name: 'A' }, T1),
      createFolder({ id: 'b', name: 'B', parentId: 'a' }, T1),
    );
    expect(problemOf(() => moveFolder('a', { parentId: 'b' })(manifest, TREE))).toBe('into-itself');
    expect(problemOf(() => moveFolder('a', { parentId: 'a' })(manifest, TREE))).toBe('into-itself');
  });

  it('refuses a move that would carry a subtree past the depth limit', () => {
    const manifest = apply(
      emptyFolderManifest(TREE, T0),
      TREE,
      createFolder({ id: 'a', name: 'A' }, T1),
      createFolder({ id: 'b', name: 'B', parentId: 'a' }, T1),
      createFolder({ id: 'x', name: 'X' }, T1),
      createFolder({ id: 'y', name: 'Y', parentId: 'x' }, T1),
    );
    expect(problemOf(() => moveFolder('x', { parentId: 'b' })(manifest, TREE))).toBe('too-deep');
    expect(folderPath(apply(manifest, TREE, moveFolder('x', { parentId: 'a' }, T2)), 'y').map((f) => f.id)).toEqual([
      'a',
      'x',
      'y',
    ]);
  });

  it('deletes a whole subtree, and its items fall back to home or the root', () => {
    const tree = apply(
      emptyFolderManifest(TREE, T0),
      TREE,
      createFolder({ id: 'a', name: 'A' }, T1),
      createFolder({ id: 'b', name: 'B', parentId: 'a' }, T1),
      placeItem('item', 'b', T1),
      deleteFolder('a', T2),
    );
    expect(liveFolders(tree)).toEqual([]);
    expect(folderOf(tree, 'item', TREE)).toBeNull();
    expect(validateFolderManifest(tree, TREE)).toBe(tree);

    const flat = apply(
      emptyFolderManifest(FLAT, T0),
      FLAT,
      createFolder({ id: 'banks', name: 'Banks' }, T1),
      placeItem('item', 'banks', T1),
      deleteFolder('banks', T2),
    );
    expect(folderOf(flat, 'item', FLAT)).toBe(HOME_FOLDER_ID);
  });

  it('places items, lists a folder, and forgets items that are gone', () => {
    const manifest = apply(
      emptyFolderManifest(FLAT, T0),
      FLAT,
      createFolder({ id: 'banks', name: 'Banks' }, T1),
      placeItem('one', 'banks', T1),
      placeItem('two', 'banks', T1),
    );
    expect(itemsIn(manifest, 'banks', ['one', 'two', 'three'], FLAT)).toEqual(['one', 'two']);
    expect(itemsIn(manifest, HOME_FOLDER_ID, ['one', 'two', 'three'], FLAT)).toEqual(['three']);
    expect(Object.keys(apply(manifest, FLAT, forgetItems(['one'])).items)).toEqual(['two']);
  });

  it('returns the same manifest when nothing changes', () => {
    const manifest = apply(emptyFolderManifest(FLAT, T0), FLAT, placeItem('one', HOME_FOLDER_ID, T1));
    expect(placeItem('one', HOME_FOLDER_ID, T2)(manifest, FLAT)).toBe(manifest);
    expect(renameFolder(HOME_FOLDER_ID, 'home', T2)(manifest, FLAT)).toBe(manifest);
    expect(forgetItems(['absent'])(manifest, FLAT)).toBe(manifest);
  });

  it('refuses to place an item in a deleted folder', () => {
    const manifest = apply(
      emptyFolderManifest(FLAT, T0),
      FLAT,
      createFolder({ id: 'banks', name: 'Banks' }, T1),
      deleteFolder('banks', T2),
    );
    expect(problemOf(() => placeItem('one', 'banks')(manifest, FLAT))).toBe('unknown-folder');
  });
});

describe('merging two manifests', () => {
  const base = apply(emptyFolderManifest(TREE, T0), TREE, createFolder({ id: 'a', name: 'A' }, T0));

  it('keeps both sides’ new folders and takes the later write per folder id', () => {
    const stored = apply(base, TREE, createFolder({ id: 'b', name: 'B' }, T1), renameFolder('a', 'Stored', T2));
    const local = apply(base, TREE, createFolder({ id: 'c', name: 'C' }, T1), renameFolder('a', 'Local', T1));

    const merged = mergeFolderManifests(stored, local, TREE);
    expect(Object.keys(merged.folders).sort()).toEqual(['a', 'b', 'c']);
    expect(merged.folders.a.name).toBe('Stored');
  });

  it('keeps a deletion against an older rename', () => {
    const stored = apply(base, TREE, renameFolder('a', 'Renamed', T1));
    const local = apply(base, TREE, deleteFolder('a', T2));
    expect(liveFolders(mergeFolderManifests(stored, local, TREE))).toEqual([]);
  });

  it('breaks the cycle two concurrent moves produce, by lifting the later move to the root', () => {
    const tree = apply(base, TREE, createFolder({ id: 'b', name: 'B' }, T0));
    const stored = apply(tree, TREE, moveFolder('a', { parentId: 'b' }, T1));
    const local = apply(tree, TREE, moveFolder('b', { parentId: 'a' }, T2));

    const merged = mergeFolderManifests(stored, local, TREE);
    expect(merged.folders.b.parent_id).toBeNull();
    expect(merged.folders.a.parent_id).toBe('b');
    expect(validateFolderManifest(merged, TREE)).toBe(merged);
  });

  it('deletes a folder created on one side inside a folder deleted on the other', () => {
    const stored = apply(base, TREE, deleteFolder('a', T1));
    const local = apply(base, TREE, createFolder({ id: 'child', name: 'Child', parentId: 'a' }, T2));

    const merged = mergeFolderManifests(stored, local, TREE);
    expect(liveFolders(merged)).toEqual([]);
  });

  it('lifts a subtree that two concurrent moves carried past the depth limit', () => {
    const tree = apply(
      base,
      TREE,
      createFolder({ id: 'b', name: 'B', parentId: 'a' }, T0),
      createFolder({ id: 'x', name: 'X' }, T0),
      createFolder({ id: 'y', name: 'Y', parentId: 'x' }, T0),
    );
    const stored = apply(tree, TREE, moveFolder('x', { parentId: 'a' }, T1));
    const local = apply(tree, TREE, createFolder({ id: 'z', name: 'Z', parentId: 'y' }, T2));

    const merged = mergeFolderManifests(stored, local, TREE);
    expect(validateFolderManifest(merged, TREE)).toBe(merged);
    expect(childFolders(merged, null).map((entry) => entry.id)).toContain('z');
  });

  it('takes the later placement of an item', () => {
    const tree = apply(base, TREE, createFolder({ id: 'b', name: 'B' }, T0));
    const stored = apply(tree, TREE, placeItem('item', 'a', T3));
    const local = apply(tree, TREE, placeItem('item', 'b', T1));
    expect(mergeFolderManifests(stored, local, TREE).items.item.folder_id).toBe('a');
  });

  it('puts home back if a manifest arrives without it', () => {
    const merged = mergeFolderManifests({ v: 1, folders: {}, items: {} }, { v: 1, folders: {}, items: {} }, FLAT, T0);
    expect(liveFolders(merged).map((entry) => entry.id)).toEqual([HOME_FOLDER_ID]);
  });
});
