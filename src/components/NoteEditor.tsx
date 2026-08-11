'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteNote, saveNote, type NoteRecord } from '@/lib/notes';
import {
  isNoteEmpty,
  isNoteSavable,
  isNoteWithinLimit,
  noteCharactersLeft,
  noteSaveState,
  noteTitle,
  NOTE_AUTOSAVE_DELAY_MS,
  NOTE_SAVE_LABELS,
  UNTITLED_NOTE,
  type OpenedNote,
} from '@/lib/app';
import {
  changeNoteFontSize,
  cycleBlockType,
  toHtml,
  NOTE_FONT_DEFAULT_PX,
  type InlineStyle,
  type NoteLineCommand,
  type NoteLineType,
} from '@/lib/note-format';
import {
  applyFontSize,
  readBlock,
  readSurface,
  selectedBlocks,
  sizeAtCaret,
  surfaceBlockAt,
} from './note-surface';
import { useAuthedContext, useCryple } from './CrypleProvider';
import NoteEditorToolbar from './NoteEditorToolbar';
import { ArrowLeftIcon, TrashIcon } from './icons';
import { Button, Notice } from './ui';

export default function NoteEditor({
  opened,
  onClose,
  onSaved,
}: {
  opened: OpenedNote | undefined;
  onClose: () => void;
  onSaved: (record: NoteRecord, plaintext: string) => void;
}) {
  const context = useAuthedContext();
  const { reportError } = useCryple();

  const [record, setRecord] = useState(opened?.record);
  const [saved, setSaved] = useState(opened?.plaintext);
  const [draft, setDraft] = useState(opened?.plaintext ?? '');
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [activeLine, setActiveLine] = useState<NoteLineType>('text');
  const [activeSize, setActiveSize] = useState(NOTE_FONT_DEFAULT_PX);

  const [noteId] = useState(() => opened?.record.id ?? crypto.randomUUID());
  const [initialHtml] = useState(() => toHtml(opened?.plaintext ?? ''));
  const inFlight = useRef(false);

  const surface = useRef<HTMLDivElement>(null);

  const unreadable = opened !== undefined && opened.plaintext === undefined;

  useEffect(() => {
    const element = surface.current;
    if (element === null) {
      return;
    }
    element.innerHTML = initialHtml;
    if (!unreadable) {
      element.focus();
    }
  }, [initialHtml, unreadable]);

  const left = noteCharactersLeft(draft);
  const status = noteSaveState({ draft, saved, saving });

  const save = useCallback(
    async (text: string) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      setSaving(true);

      try {
        const stored = await saveNote(context, text, { id: noteId, record });

        setRecord(stored);
        setSaved(text);
        setMessage(undefined);
        onSaved(stored, text);
      } catch (error) {
        setMessage(reportError(error));
      } finally {
        inFlight.current = false;
        setSaving(false);
      }
    },
    [context, noteId, onSaved, record, reportError],
  );

  useEffect(() => {
    if (unreadable || !isNoteSavable(draft, saved)) {
      return;
    }
    const timer = setTimeout(() => void save(draft), NOTE_AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, saved, unreadable, save]);

  const sync = useCallback(() => {
    const element = surface.current;
    if (element === null) {
      return;
    }
    setDraft(readSurface(element));
    setActiveLine(surfaceBlockAt(element)?.dataset.line as NoteLineType | undefined ?? 'text');
    setActiveSize(sizeAtCaret(element));
  }, []);

  function runLineType(command: NoteLineCommand) {
    const element = surface.current;
    if (element === null) {
      return;
    }

    for (const node of selectedBlocks(element)) {
      const next = cycleBlockType(readBlock(node), command);
      node.dataset.line = next.type;
      if (next.type === 'task') {
        node.dataset.checked = String(next.checked);
      } else {
        delete node.dataset.checked;
      }
    }

    sync();
  }

  function runInlineStyle(style: InlineStyle) {
    document.execCommand(style === 'bold' ? 'bold' : 'italic');
    sync();
  }

  function runFontSize(direction: 1 | -1) {
    const element = surface.current;
    if (element === null) {
      return;
    }
    applyFontSize(element, changeNoteFontSize(activeSize, direction));
    sync();
  }

  function onSurfacePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
    sync();
  }

  function onSurfaceClick(event: React.MouseEvent<HTMLDivElement>) {
    const element = surface.current;
    if (element === null || unreadable) {
      return;
    }

    const block = surfaceBlockAt(element, event.target as Node);
    if (block === undefined || block.dataset.line !== 'task') {
      return;
    }

    const gutter = Number.parseFloat(getComputedStyle(block).paddingLeft);
    if (event.clientX - block.getBoundingClientRect().left > gutter) {
      return;
    }

    block.dataset.checked = block.dataset.checked === 'true' ? 'false' : 'true';
    sync();
  }

  function onSurfaceKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const element = surface.current;
    if (element === null || event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    const block = surfaceBlockAt(element);
    if (block === undefined) {
      return;
    }

    const type = block.dataset.line;
    if ((type === 'topic' || type === 'task') && (block.textContent ?? '').trim().length === 0) {
      event.preventDefault();
      block.dataset.line = 'text';
      delete block.dataset.checked;
      sync();
      return;
    }

    requestAnimationFrame(() => {
      const fresh = surfaceBlockAt(element);
      if (fresh?.dataset.line === 'task') {
        fresh.dataset.checked = 'false';
      }
      sync();
    });
  }

  async function close() {
    if (!unreadable && isNoteSavable(draft, saved)) {
      await save(draft);
    }
    onClose();
  }

  async function remove() {
    if (record === undefined) {
      onClose();
      return;
    }

    setBusy(true);
    try {
      await deleteNote(context, record.id);
      onClose();
    } catch (error) {
      setMessage(reportError(error));
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Back to notes"
          title="Back to notes"
          disabled={busy || saving}
          onClick={() => void close()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
        >
          <ArrowLeftIcon />
        </button>

        <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900 dark:text-slate-100">
          {isNoteEmpty(draft) ? UNTITLED_NOTE : noteTitle(draft)}
        </h2>

        <div className="flex shrink-0 items-center gap-3">
          <span
            aria-live="polite"
            className={`hidden text-xs sm:inline ${
              status === 'over-limit'
                ? 'text-red-600 dark:text-red-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {NOTE_SAVE_LABELS[status]}
          </span>
          {record !== undefined ? (
            <Button
              variant="danger"
              disabled={busy || saving}
              title="Delete this note"
              onClick={() => setConfirmingDelete(true)}
            >
              <TrashIcon />
              <span className="hidden sm:inline">Delete</span>
            </Button>
          ) : null}
        </div>
      </div>

      <NoteEditorToolbar
        disabled={unreadable || busy}
        fontSize={activeSize}
        activeLine={activeLine}
        onLineType={runLineType}
        onInlineStyle={runInlineStyle}
        onFontSize={runFontSize}
      />

      {message ? <Notice tone="danger">{message}</Notice> : null}

      {unreadable ? (
        <Notice tone="warning">
          This note cannot be decrypted with this account&apos;s keys. Its contents are not shown,
          and saving is disabled so nothing overwrites them.
        </Notice>
      ) : null}

      {confirmingDelete ? (
        <Notice tone="danger">
          <p>
            Deleting this note is permanent, and it also removes it from anyone who was set to
            inherit it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              Delete note
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmingDelete(false)}>
              Keep it
            </Button>
          </div>
        </Notice>
      ) : null}

      <div
        ref={surface}
        role="textbox"
        aria-multiline="true"
        aria-label="Note body"
        tabIndex={0}
        contentEditable={!unreadable}
        suppressContentEditableWarning
        spellCheck
        data-empty={isNoteEmpty(draft)}
        data-placeholder="Write your note. The first line becomes its name."
        style={{ fontSize: `${NOTE_FONT_DEFAULT_PX}px` }}
        onInput={sync}
        onKeyUp={sync}
        onMouseUp={sync}
        onClick={onSurfaceClick}
        onKeyDown={onSurfaceKeyDown}
        onPaste={onSurfacePaste}
        className="note-surface min-h-[60vh] w-full text-slate-900 dark:text-slate-100"
      />

      <p
        className={`text-xs ${
          isNoteWithinLimit(draft)
            ? 'text-slate-500 dark:text-slate-400'
            : 'text-red-600 dark:text-red-400'
        }`}
      >
        {left >= 0
          ? `${left.toLocaleString()} characters left`
          : `${Math.abs(left).toLocaleString()} characters over the limit`}
        <span className="sm:hidden">
          {NOTE_SAVE_LABELS[status] ? ` · ${NOTE_SAVE_LABELS[status]}` : ''}
        </span>
      </p>
    </div>
  );
}
