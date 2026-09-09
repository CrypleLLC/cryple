import type * as Y from 'yjs';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import { Color, FontFamily, FontSize, LineHeight, TextStyle } from '@tiptap/extension-text-style';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { CharacterCount, Placeholder, Selection } from '@tiptap/extensions';
import { BODY_FRAGMENT } from '@/lib/documents';
import { PageBreak } from './pageBreak';
import { Pagination } from './pagination';

export const BODY_PLACEHOLDER = 'Start writing…';

export function documentExtensions(doc: Y.Doc) {
  return [
    StarterKit.configure({
      undoRedo: false,
      link: { openOnClick: false, autolink: true },
    }),
    Collaboration.configure({ document: doc, field: BODY_FRAGMENT }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    LineHeight.configure({ types: ['heading', 'paragraph'] }),
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    PageBreak,
    Pagination,
    CharacterCount,
    Selection,
    Placeholder.configure({ placeholder: BODY_PLACEHOLDER }),
  ];
}
