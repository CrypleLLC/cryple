'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';

const FONT_FAMILIES = [
  { label: 'Sans', value: 'var(--font-sans)' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'var(--font-mono)' },
];

const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '30px', '36px'];
const DEFAULT_FONT_SIZE = '16px';

const LINE_HEIGHTS = [
  { label: 'Single', value: '1.3' },
  { label: 'Normal', value: '1.7' },
  { label: '1.5', value: '2' },
  { label: 'Double', value: '2.6' },
];
const DEFAULT_LINE_HEIGHT = '1.7';

const BLOCK_STYLES = [
  { label: 'Body text', level: 0 },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
] as const;

const HIGHLIGHTS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca'];
const COLORS = ['#0f172a', '#b91c1c', '#1d4ed8', '#15803d', '#a16207'];

const MARKS = ['bold', 'italic', 'underline', 'strike', 'code'] as const;
const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;

type MarkName = (typeof MARKS)[number];

const MARK_BUTTONS: Record<MarkName, { label: string; glyph: ReactNode }> = {
  bold: { label: 'Bold', glyph: <span className="text-sm font-bold leading-none">B</span> },
  italic: {
    label: 'Italic',
    glyph: <span className="font-serif text-sm italic leading-none">I</span>,
  },
  underline: {
    label: 'Underline',
    glyph: <span className="text-sm leading-none underline">U</span>,
  },
  strike: {
    label: 'Strikethrough',
    glyph: <span className="text-sm leading-none line-through">S</span>,
  },
  code: { label: 'Inline code', glyph: <span className="font-mono text-xs leading-none">{'{}'}</span> },
};

export default function DocumentToolbar({ editor }: { editor: Editor | null }) {
  const state = useEditorState({
    editor,
    selector: () => {
      const active = editor;
      if (active === null) {
        return undefined;
      }

      return {
        canUndo: active.can().undo(),
        canRedo: active.can().redo(),
        headingLevel: headingLevel(active),
        fontFamily: (active.getAttributes('textStyle').fontFamily as string | undefined) ?? null,
        fontSize: (active.getAttributes('textStyle').fontSize as string | undefined) ?? null,
        lineHeight:
          (active.getAttributes('paragraph').lineHeight as string | undefined) ??
          (active.getAttributes('heading').lineHeight as string | undefined) ??
          null,
        marks: Object.fromEntries(
          MARKS.map((mark) => [mark, active.isActive(mark)]),
        ) as Record<MarkName, boolean>,
        alignments: Object.fromEntries(
          ALIGNMENTS.map((alignment) => [alignment, active.isActive({ textAlign: alignment })]),
        ) as Record<(typeof ALIGNMENTS)[number], boolean>,
        bulletList: active.isActive('bulletList'),
        orderedList: active.isActive('orderedList'),
        taskList: active.isActive('taskList'),
        blockquote: active.isActive('blockquote'),
        codeBlock: active.isActive('codeBlock'),
        link: active.isActive('link'),
        linkHref: (active.getAttributes('link').href as string | undefined) ?? '',
        canLink: active.isActive('link') || !active.state.selection.empty,
        inTable: active.isActive('table'),
      };
    },
  });

  if (editor === null || state === undefined || state === null) {
    return <div className="h-12" />;
  }

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="cryple-no-print flex flex-wrap items-center gap-1 px-3 py-1.5"
    >
      <ToolButton
        label="Undo"
        disabled={!state.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <UndoGlyph />
      </ToolButton>
      <ToolButton
        label="Redo"
        disabled={!state.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <UndoGlyph flipped />
      </ToolButton>

      <Divider />

      <Select
        label="Paragraph style"
        value={String(state.headingLevel)}
        onChange={(value) => applyBlockStyle(editor, Number(value))}
        options={BLOCK_STYLES.map((style) => ({
          label: style.label,
          value: String(style.level),
        }))}
        width="w-32"
      />

      <Select
        label="Font"
        value={state.fontFamily ?? FONT_FAMILIES[0].value}
        onChange={(value) => editor.chain().focus().setFontFamily(value).run()}
        options={FONT_FAMILIES}
        width="w-24"
      />

      <Select
        label="Font size"
        value={state.fontSize ?? DEFAULT_FONT_SIZE}
        onChange={(value) => editor.chain().focus().setFontSize(value).run()}
        options={FONT_SIZES.map((size) => ({ label: size.replace('px', ''), value: size }))}
        width="w-16"
      />

      <Select
        label="Line spacing"
        value={state.lineHeight ?? DEFAULT_LINE_HEIGHT}
        onChange={(value) => editor.chain().focus().setLineHeight(value).run()}
        options={LINE_HEIGHTS}
        width="w-24"
      />

      <Divider />

      {MARKS.map((mark) => (
        <ToolButton
          key={mark}
          label={MARK_BUTTONS[mark].label}
          pressed={state.marks[mark]}
          onClick={() => editor.chain().focus().toggleMark(mark).run()}
        >
          {MARK_BUTTONS[mark].glyph}
        </ToolButton>
      ))}

      <Swatches
        label="Text colour"
        colors={COLORS}
        onPick={(color) => editor.chain().focus().setColor(color).run()}
        onClear={() => editor.chain().focus().unsetColor().run()}
      >
        <span className="text-sm font-semibold leading-none">A</span>
      </Swatches>
      <Swatches
        label="Highlight"
        colors={HIGHLIGHTS}
        onPick={(color) => editor.chain().focus().toggleHighlight({ color }).run()}
        onClear={() => editor.chain().focus().unsetHighlight().run()}
      >
        <HighlightGlyph />
      </Swatches>

      <Divider />

      {ALIGNMENTS.map((alignment) => (
        <ToolButton
          key={alignment}
          label={`Align ${alignment}`}
          pressed={state.alignments[alignment]}
          onClick={() => editor.chain().focus().setTextAlign(alignment).run()}
        >
          <AlignGlyph alignment={alignment} />
        </ToolButton>
      ))}

      <Divider />

      <ToolButton
        label="Bulleted list"
        pressed={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <ListGlyph ordered={false} />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        pressed={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListGlyph ordered />
      </ToolButton>
      <ToolButton
        label="Checklist"
        pressed={state.taskList}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <CheckGlyph />
      </ToolButton>
      <ToolButton
        label="Quote"
        pressed={state.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <span className="font-serif text-base leading-none">&ldquo;</span>
      </ToolButton>
      <ToolButton
        label="Code block"
        pressed={state.codeBlock}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <span className="font-mono text-xs leading-none">&lt;/&gt;</span>
      </ToolButton>

      <Divider />

      <LinkControl editor={editor} active={state.link} href={state.linkHref} enabled={state.canLink} />

      {state.inTable ? (
        <>
          <ToolButton
            label="Add row"
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            <span className="text-xs leading-none">+R</span>
          </ToolButton>
          <ToolButton
            label="Add column"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            <span className="text-xs leading-none">+C</span>
          </ToolButton>
          <ToolButton
            label="Delete table"
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            <span className="text-xs leading-none">×T</span>
          </ToolButton>
        </>
      ) : (
        <ToolButton
          label="Insert table"
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          <TableGlyph />
        </ToolButton>
      )}

      <ToolButton
        label="Page break"
        onClick={() => editor.chain().focus().setPageBreak().run()}
      >
        <PageBreakGlyph />
      </ToolButton>
      <ToolButton
        label="Horizontal rule"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <span className="text-sm leading-none">—</span>
      </ToolButton>
      <ToolButton
        label="Clear formatting"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <ClearGlyph />
      </ToolButton>

      <Divider />

      <ToolButton label="Print or save as PDF" onClick={() => window.print()}>
        <PrintGlyph />
      </ToolButton>
    </div>
  );
}

function headingLevel(editor: Editor): number {
  for (const style of BLOCK_STYLES) {
    if (style.level > 0 && editor.isActive('heading', { level: style.level })) {
      return style.level;
    }
  }
  return 0;
}

function applyBlockStyle(editor: Editor, level: number): void {
  if (level === 0) {
    editor.chain().focus().setParagraph().run();
    return;
  }
  editor
    .chain()
    .focus()
    .setHeading({ level: level as 1 | 2 | 3 })
    .run();
}

function LinkControl({
  editor,
  active,
  href,
  enabled,
}: {
  editor: Editor;
  active: boolean;
  href: string;
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(href);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(href);
    input.current?.focus();
    input.current?.select();

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        close();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, href, close]);

  const apply = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
    close();
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    close();
  };

  return (
    <div className="relative" ref={container}>
      <ToolButton
        label={active ? 'Edit link' : 'Add link'}
        pressed={active}
        disabled={!enabled}
        onClick={() => setOpen((previous) => !previous)}
      >
        <LinkGlyph />
      </ToolButton>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 flex items-center gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-lift">
          <input
            ref={input}
            aria-label="Link address"
            type="url"
            inputMode="url"
            placeholder="https://example.com"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                apply();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
                editor.commands.focus();
              }
            }}
            className="h-8 w-56 rounded-md border border-line bg-transparent px-2 text-sm text-ink placeholder:text-ink-faint focus-visible:border-brand-500 focus-visible:outline-none"
          />
          <button
            type="button"
            onClick={apply}
            className="h-8 rounded-md bg-brand-600 px-2.5 text-sm text-white transition-colors hover:bg-brand-700"
          >
            Apply
          </button>
          {active && (
            <button
              type="button"
              onClick={remove}
              className="h-8 rounded-md px-2.5 text-sm text-ink-soft transition-colors hover:bg-raised"
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />;
}

function ToolButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 disabled:cursor-not-allowed disabled:opacity-40 ${
        pressed
          ? 'bg-brand-50 text-brand-700'
          : 'text-ink-soft hover:bg-raised hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
  width,
}: {
  label: string;
  value: string;
  options: readonly { label: string; value: string }[];
  onChange: (value: string) => void;
  width: string;
}) {
  return (
    <select
      aria-label={label}
      title={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`${width} h-8 rounded-md border border-transparent bg-transparent px-1 text-sm text-ink-soft transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function Swatches({
  label,
  colors,
  onPick,
  onClear,
  children,
}: {
  label: string;
  colors: readonly string[];
  onPick: (color: string) => void;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group relative">
      <ToolButton label={label} onClick={onClear}>
        {children}
      </ToolButton>
      <div className="invisible absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-lift group-hover:visible group-focus-within:visible">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`${label} ${color}`}
            title={color}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(color)}
            style={{ backgroundColor: color }}
            className="h-5 w-5 rounded border border-line-strong"
          />
        ))}
      </div>
    </div>
  );
}

function UndoGlyph({ flipped }: { flipped?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-4 w-4 ${flipped ? '-scale-x-100' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 8H12.5a3.5 3.5 0 0 1 0 7H9" />
      <path d="M9.5 5.5 6.5 8l3 2.5" />
    </svg>
  );
}

function AlignGlyph({ alignment }: { alignment: 'left' | 'center' | 'right' | 'justify' }) {
  const insets: Record<typeof alignment, [number, number]> = {
    left: [3, 12],
    center: [5, 10],
    right: [8, 12],
    justify: [3, 14],
  };
  const [start, length] = insets[alignment];

  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 6h14" />
      <path d={`M${start} 10h${length}`} />
      <path d="M3 14h14" />
    </svg>
  );
}

function ListGlyph({ ordered }: { ordered: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
      aria-hidden="true"
    >
      <path d="M8 6h9M8 10h9M8 14h9" />
      {ordered ? (
        <text x="2" y="8" fontSize="6" fill="currentColor" stroke="none">
          1
        </text>
      ) : (
        <>
          <circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="4" cy="10" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="4" cy="14" r="1.2" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      aria-hidden="true"
    >
      <rect x="2.5" y="4" width="5" height="5" rx="1" />
      <path d="M3.5 14.5 5 16l2.5-3" />
      <path d="M10 6.5h7M10 14.5h7" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
      aria-hidden="true"
    >
      <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2-2a3 3 0 1 0-4.2-4.2l-.8.8" />
      <path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 1 0 4.2 4.2l.8-.8" />
    </svg>
  );
}

function TableGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.4"
      fill="none"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <path d="M3 8h14M8 8v8M13 8v8" />
    </svg>
  );
}

function HighlightGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M5 12.5 11.5 6l2.5 2.5L7.5 15H5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M3.5 17.5h13" stroke="#facc15" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function ClearGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
      aria-hidden="true"
    >
      <path d="M7 5h9M10.5 5 8 15" />
      <path d="M3.5 9.5 8 14M8 9.5 3.5 14" />
    </svg>
  );
}

function PageBreakGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 7.5V3.5h8V7.5" />
      <path d="M6 12.5v4h8v-4" />
      <path d="M3 10h3M8.5 10h3M14 10h3" strokeDasharray="0.1 3.4" strokeWidth="1.6" />
    </svg>
  );
}

function PrintGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 8V3.5h8V8" />
      <rect x="3" y="8" width="14" height="6" rx="1.5" />
      <rect x="6" y="12" width="8" height="4.5" rx="1" />
    </svg>
  );
}
