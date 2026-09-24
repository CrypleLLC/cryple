import { describe, expect, it } from 'vitest';
import {
  createFolder,
  deleteFolder,
  emptyFolderManifest,
  HOME_FOLDER_ID,
  placeItem,
  type FolderEdit,
  type FolderManifest,
  type FolderRules,
} from '@/lib/folders';
import {
  activeTabOf,
  buildFolderTabs,
  countOf,
  DOCUMENT_NOUNS,
  FILE_NOUNS,
  folderDeleteConfirmation,
  folderDeleteSummary,
  folderMoveProblem,
  folderNameProblem,
  itemsInTab,
  SECRET_NOUNS,
  tabDeleteConfirmation,
  tabDeleteRefusal,
  tabNameProblem,
} from './folders';

const FLAT: FolderRules = { maxDepth: 1, home: true };
const AT = new Date('2026-09-24T10:00:00Z');

function manifestWith(...edits: FolderEdit[]): FolderManifest {
  return edits.reduce((current, edit) => edit(current, FLAT), emptyFolderManifest(FLAT, AT));
}

const manifest = manifestWith(
  createFolder({ id: 'banks', name: 'Banks' }, AT),
  createFolder({ id: 'sites', name: 'Sites' }, AT),
  placeItem('one', 'banks', AT),
  placeItem('two', 'banks', AT),
);

describe('the tab strip', () => {
  it('puts home first and counts what each tab holds, unplaced items in home', () => {
    expect(buildFolderTabs(manifest, ['one', 'two', 'three'], FLAT)).toEqual([
      { id: HOME_FOLDER_ID, name: 'home', count: 1, home: true },
      { id: 'banks', name: 'Banks', count: 2, home: false },
      { id: 'sites', name: 'Sites', count: 0, home: false },
    ]);
  });

  it('files an item from a deleted tab back into home', () => {
    const deleted = manifestWith(
      createFolder({ id: 'banks', name: 'Banks' }, AT),
      placeItem('one', 'banks', AT),
      deleteFolder('banks', AT),
    );
    expect(buildFolderTabs(deleted, ['one'], FLAT)).toEqual([
      { id: HOME_FOLDER_ID, name: 'home', count: 1, home: true },
    ]);
  });

  it('shows only the active tab’s items', () => {
    expect(itemsInTab(manifest, 'banks', ['one', 'two', 'three'], (id) => id, FLAT)).toEqual(['one', 'two']);
    expect(itemsInTab(manifest, HOME_FOLDER_ID, ['one', 'two', 'three'], (id) => id, FLAT)).toEqual(['three']);
  });

  it('falls back to the first tab when the chosen one is gone', () => {
    const tabs = buildFolderTabs(manifest, [], FLAT);
    expect(activeTabOf(tabs, 'sites')).toBe('sites');
    expect(activeTabOf(tabs, 'gone')).toBe(HOME_FOLDER_ID);
    expect(activeTabOf([], undefined)).toBe(HOME_FOLDER_ID);
  });
});

describe('naming a tab', () => {
  const tabs = buildFolderTabs(manifest, [], FLAT);

  it('refuses an empty name, a name that is too long and a duplicate', () => {
    expect(tabNameProblem('  ', tabs)).toBe('Give the tab a name.');
    expect(tabNameProblem('x'.repeat(121), tabs)).toMatch(/at most 120/);
    expect(tabNameProblem(' banks ', tabs)).toMatch(/already a tab called “Banks”/);
    expect(tabNameProblem('Wallets', tabs)).toBeUndefined();
  });

  it('lets a tab keep its own name when renamed', () => {
    expect(tabNameProblem('BANKS', tabs, 'banks')).toBeUndefined();
  });
});

describe('deleting a tab', () => {
  const [home, banks, sites] = buildFolderTabs(manifest, ['one', 'two'], FLAT);

  it('says the items go with it', () => {
    expect(tabDeleteConfirmation(banks, SECRET_NOUNS)).toBe(
      'Deleting “Banks” also deletes the 2 secrets in it, permanently.',
    );
    expect(tabDeleteConfirmation(sites, SECRET_NOUNS)).toMatch(/empty/);
  });

  it('refuses home, and a non-empty tab on a device that cannot delete', () => {
    expect(tabDeleteRefusal(home, true, SECRET_NOUNS)).toMatch(/cannot be deleted/);
    expect(tabDeleteRefusal(banks, false, SECRET_NOUNS)).toMatch(/Only a full device/);
    expect(tabDeleteRefusal(sites, false, SECRET_NOUNS)).toBeUndefined();
    expect(tabDeleteRefusal(banks, true, SECRET_NOUNS)).toBeUndefined();
  });

  it('counts in the scope’s own words', () => {
    expect(countOf(1, SECRET_NOUNS)).toBe('1 secret');
    expect(countOf(3, SECRET_NOUNS)).toBe('3 secrets');
  });
});

describe('tree folders', () => {
  const siblings = [
    { id: 'a', name: 'Taxes' },
    { id: 'b', name: undefined },
  ];

  it('names a folder like a tab, among its siblings only', () => {
    expect(folderNameProblem('', siblings)).toBe('Give the folder a name.');
    expect(folderNameProblem('taxes', siblings)).toMatch(/already a folder called “Taxes”/);
    expect(folderNameProblem('taxes', siblings, 'a')).toBeUndefined();
    expect(folderNameProblem('Receipts', siblings)).toBeUndefined();
  });

  it('says what a delete takes with it', () => {
    expect(folderDeleteConfirmation('Taxes', 0, FILE_NOUNS)).toBe(
      'Deleting “Taxes” also deletes every file in it, permanently.',
    );
    expect(folderDeleteConfirmation('Taxes', 2, DOCUMENT_NOUNS)).toBe(
      'Deleting “Taxes” also deletes the 2 folders inside it and every document they hold, permanently.',
    );
    expect(folderDeleteSummary({ folders: 3, items: 1 }, FILE_NOUNS)).toBe('Deleted 3 folders and 1 file.');
  });

  it('explains a refused move', () => {
    expect(folderMoveProblem('FOLDER_TOO_DEEP')).toMatch(/8 levels/);
    expect(folderMoveProblem('FOLDER_INTO_ITSELF')).toMatch(/inside itself/);
  });
});
