'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Doc as YDoc } from 'yjs';
import Image from 'next/image';
import Link from 'next/link';
import { EditorContent, useEditor } from '@tiptap/react';
import { META_MAP, readTitle, writeTitle, type SyncState } from '@/lib/documents';
import { saveStatusLabel, UNTITLED_DOCUMENT } from '@/lib/app';
import { Notice, Spinner } from '@/components/ui';
import { documentExtensions } from './extensions';
import DocumentToolbar from './DocumentToolbar';
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
          <Link href="/" className="text-brand-700 hover:underline dark:text-brand-300">
            Back to your vault
          </Link>
        </p>
      </main>
    );
  }

  if (sync === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-slate-950">
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

  return (
    <main className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
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
        </div>
        <DocumentToolbar editor={editor} />
      </header>

      <div className="px-4 py-8">
        <div className="mx-auto max-w-[816px] rounded-sm bg-white px-[72px] py-[80px] shadow-[0_1px_3px_rgba(15,23,42,0.12),0_8px_24px_rgba(15,23,42,0.08)] dark:bg-slate-900">
          <EditorContent editor={editor} />
        </div>
      </div>
    </main>
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
      className="w-full max-w-md truncate rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-lg font-medium text-slate-900 transition placeholder:text-slate-400 hover:border-slate-300 focus-visible:border-brand-500 focus-visible:outline-none dark:text-slate-100 dark:hover:border-slate-600"
    />
  );
}

function SaveStatus({ label, gapDetected }: { label: string; gapDetected: boolean }) {
  return (
    <p
      aria-live="polite"
      className={`px-1 text-xs ${
        gapDetected ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'
      }`}
    >
      {gapDetected ? 'Some updates are missing — this document will not be compacted' : label}
    </p>
  );
}
