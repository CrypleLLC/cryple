'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Doc as YDoc } from 'yjs';
import Image from 'next/image';
import Link from 'next/link';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { META_MAP, readTitle, writeTitle, type SyncState } from '@/lib/documents';
import { documentCountsLabel, saveStatusLabel, UNTITLED_DOCUMENT } from '@/lib/app';
import { Notice, Spinner } from '@/components/ui';
import { documentExtensions } from './extensions';
import { pageCountOf } from './pagination';
import DocumentToolbar from './DocumentToolbar';
import DocumentOutline from './DocumentOutline';
import { useDocumentSync } from './useDocumentSync';

const TITLE_ORIGIN = Symbol('cryple/documents/title-input');

export default function DocumentWorkspace({ id }: { id: string }) {
  const { sync, state, error } = useDocumentSync(id);

  if (error !== undefined) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <Notice tone="danger">
          <strong className="font-medium">This document could not be opened.</strong> {error}
        </Notice>
        <p className="mt-6 text-sm">
          <Link href="/" className="text-brand-700 hover:underline">
            Back to your vault
          </Link>
        </p>
      </main>
    );
  }

  if (sync === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ground">
        <Spinner />
      </main>
    );
  }

  return <DocumentSurface doc={sync.doc} state={state} />;
}

function DocumentSurface({ doc, state }: { doc: YDoc; state: SyncState }) {
  const editor = useEditor({
    extensions: documentExtensions(doc),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'cryple-prose focus:outline-none',
        spellcheck: 'true',
      },
    },
  });
  const chrome = useChromeHeight();
  const pages = usePageCount(editor);

  return (
    <main className="min-h-screen bg-ground">
      <header
        ref={chrome}
        className="cryple-no-print sticky top-[var(--staging-banner-h)] z-10 border-b border-line bg-surface/90 backdrop-blur"
      >
        <div className="flex items-center gap-3 px-3 pt-2.5">
          <Link href="/" aria-label="Back to your vault" className="shrink-0">
            <Image src="/cryple-logo.png" alt="Cryple" width={28} height={28} priority />
          </Link>
          <div className="min-w-0 flex-1">
            <TitleInput doc={doc} />
            <SaveStatus
              label={saveStatusLabel(state.status, state.pending)}
              gapDetected={state.gapDetected}
            />
          </div>
          <DocumentCounts editor={editor} pages={pages} />
        </div>
        <DocumentToolbar editor={editor} />
      </header>

      <div className="cryple-page-frame mx-auto flex max-w-[1180px] items-start gap-6 px-4 py-8">
        <DocumentOutline editor={editor} />
        <div className="min-w-0 flex-1 lg:flex lg:justify-center">
          <div
            className="cryple-page-stack"
            style={{ '--page-count': pages } as CSSProperties}
          >
            <div aria-hidden="true" className="cryple-page-sheets">
              {Array.from({ length: pages }, (_, page) => (
                <div key={page} className="cryple-sheet" />
              ))}
            </div>
            <div className="cryple-page">
              <EditorContent editor={editor} className="cryple-page-body" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function useChromeHeight() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = ref.current;
    if (header === null) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty(
        '--doc-chrome-h',
        `${entry.contentRect.height}px`,
      );
    });

    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--doc-chrome-h');
    };
  }, []);

  return ref;
}

function usePageCount(editor: Editor | null): number {
  return (
    useEditorState({
      editor,
      selector: () => pageCountOf(editor),
    }) ?? 1
  );
}

const COUNTS_DEBOUNCE_MS = 400;

interface DocumentCountsValue {
  words: number;
  characters: number;
}

function useDocumentCounts(editor: Editor | null): DocumentCountsValue | undefined {
  const [counts, setCounts] = useState<DocumentCountsValue>();

  useEffect(() => {
    if (editor === null) {
      setCounts(undefined);
      return;
    }

    let timer = 0;
    const read = () =>
      setCounts({
        words: editor.storage.characterCount.words() as number,
        characters: editor.storage.characterCount.characters() as number,
      });
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, COUNTS_DEBOUNCE_MS);
    };

    read();
    editor.on('update', schedule);

    return () => {
      window.clearTimeout(timer);
      editor.off('update', schedule);
    };
  }, [editor]);

  return counts;
}

function DocumentCounts({ editor, pages }: { editor: Editor | null; pages: number }) {
  const counts = useDocumentCounts(editor);

  if (counts === undefined) {
    return null;
  }

  return (
    <p className="hidden shrink-0 text-caption normal-case tracking-normal text-ink-muted sm:block">
      {documentCountsLabel(counts.words, counts.characters, pages)}
    </p>
  );
}

function TitleInput({ doc }: { doc: YDoc }) {
  const [title, setTitle] = useState(() => readTitle(doc));

  useEffect(() => {
    setTitle(readTitle(doc));

    const meta = doc.getMap(META_MAP);
    const observer = (_event: unknown, transaction: { origin: unknown }) => {
      if (transaction.origin !== TITLE_ORIGIN) {
        setTitle(readTitle(doc));
      }
    };

    meta.observe(observer);
    return () => meta.unobserve(observer);
  }, [doc]);

  useEffect(() => {
    document.title = title.trim().length > 0 ? `${title} — Cryple` : `${UNTITLED_DOCUMENT} — Cryple`;
  }, [title]);

  const onChange = useCallback(
    (next: string) => {
      setTitle(next);
      writeTitle(doc, next, TITLE_ORIGIN);
    },
    [doc],
  );

  return (
    <input
      aria-label="Document title"
      value={title}
      placeholder={UNTITLED_DOCUMENT}
      onChange={(event) => onChange(event.target.value)}
      className="w-full max-w-md truncate rounded-lg border border-transparent bg-transparent px-2 py-1 text-headline text-ink transition-colors placeholder:text-ink-faint hover:border-line-strong focus-visible:border-brand-500 focus-visible:outline-none"
    />
  );
}

function SaveStatus({ label, gapDetected }: { label: string; gapDetected: boolean }) {
  return (
    <p
      aria-live="polite"
      className={`px-1 text-caption normal-case tracking-normal ${
        gapDetected ? 'text-warning' : 'text-ink-muted'
      }`}
    >
      {gapDetected ? 'Some updates are missing — this document will not be compacted' : label}
    </p>
  );
}
