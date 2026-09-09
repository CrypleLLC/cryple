'use client';

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { readOutline, type OutlineEntry } from '@/lib/documents';

const OUTLINE_DEBOUNCE_MS = 200;

export function useOutline(editor: Editor | null): OutlineEntry[] {
  const [entries, setEntries] = useState<OutlineEntry[]>([]);

  useEffect(() => {
    if (editor === null) {
      setEntries([]);
      return;
    }

    let timer = 0;
    const read = () => setEntries(readOutline(editor.state.doc));
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, OUTLINE_DEBOUNCE_MS);
    };

    read();
    editor.on('update', schedule);

    return () => {
      window.clearTimeout(timer);
      editor.off('update', schedule);
    };
  }, [editor]);

  return entries;
}

export function goToHeading(editor: Editor, pos: number): void {
  editor.commands.focus(pos + 1, { scrollIntoView: false });

  const dom = editor.view.nodeDOM(pos);
  if (dom instanceof HTMLElement) {
    dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
