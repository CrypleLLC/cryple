'use client';

import type { Editor } from '@tiptap/react';
import { useCurrentEditor } from '@tiptap/react';
import type { ReactNode } from 'react';

const FONT_FAMILIES = [
  { label: 'Sans', value: 'var(--font-geist-sans)' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'var(--font-geist-mono)' },
];

const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '30px', '36px'];

const BLOCK_STYLES = [
  { label: 'Body text', level: 0 },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
] as const;

const HIGHLIGHTS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca'];
const COLORS = ['#0f172a', '#b91c1c', '#1d4ed8', '#15803d', '#a16207'];

export default function DocumentToolbar({ editor }: { editor: Editor | null }) {
  const { editor: contextEditor } = useCurrentEditor();
  const active = editor ?? contextEditor;

  if (active === null || active === undefined) {
    return <div className="h-12" />;
  }

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-1 px-3 py-1.5"
    >
      <ToolButton
        label="Undo"
        disabled={!active.can().undo()}
        onClick={() => active.chain().focus().undo().run()}
      >
        <UndoGlyph />
      </ToolButton>
      <ToolButton
        label="Redo"
        disabled={!active.can().redo()}
        onClick={() => active.chain().focus().redo().run()}
      >
        <UndoGlyph flipped />
      </ToolButton>

      <Divider />

      <Select
        label="Paragraph style"
        value={String(headingLevel(active))}
        onChange={(value) => applyBlockStyle(active, Number(value))}
        options={BLOCK_STYLES.map((style) => ({
          label: style.label,
          value: String(style.level),
        }))}
        width="w-32"
      />

      <Select
        label="Font"
        value={active.getAttributes('textStyle').fontFamily ?? FONT_FAMILIES[0].value}
        onChange={(value) => active.chain().focus().setFontFamily(value).run()}
        options={FONT_FAMILIES}
        width="w-24"
      />

      <Select
        label="Font size"
        value={active.getAttributes('textStyle').fontSize ?? '16px'}
        onChange={(value) => active.chain().focus().setFontSize(value).run()}
        options={FONT_SIZES.map((size) => ({ label: size.replace('px', ''), value: size }))}
        width="w-16"
      />

      <Divider />

      <ToolButton
        label="Bold"
        pressed={active.isActive('bold')}
        onClick={() => active.chain().focus().toggleBold().run()}
      >
        <span className="text-sm font-bold leading-none">B</span>
      </ToolButton>
      <ToolButton
        label="Italic"
        pressed={active.isActive('italic')}
        onClick={() => active.chain().focus().toggleItalic().run()}
      >
        <span className="font-serif text-sm italic leading-none">I</span>
      </ToolButton>
      <ToolButton
        label="Underline"
        pressed={active.isActive('underline')}
        onClick={() => active.chain().focus().toggleUnderline().run()}
      >
        <span className="text-sm leading-none underline">U</span>
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        pressed={active.isActive('strike')}
        onClick={() => active.chain().focus().toggleStrike().run()}
      >
        <span className="text-sm leading-none line-through">S</span>
      </ToolButton>
      <ToolButton
        label="Inline code"
        pressed={active.isActive('code')}
        onClick={() => active.chain().focus().toggleCode().run()}
      >
        <span className="font-mono text-xs leading-none">{'{}'}</span>
      </ToolButton>

      <Swatches
        label="Text colour"
        colors={COLORS}
        onPick={(color) => active.chain().focus().setColor(color).run()}
        onClear={() => active.chain().focus().unsetColor().run()}
      >
        <span className="text-sm font-semibold leading-none">A</span>
      </Swatches>
      <Swatches
        label="Highlight"
        colors={HIGHLIGHTS}
        onPick={(color) => active.chain().focus().toggleHighlight({ color }).run()}
        onClear={() => active.chain().focus().unsetHighlight().run()}
      >
        <HighlightGlyph />
      </Swatches>

      <Divider />

      {(['left', 'center', 'right', 'justify'] as const).map((alignment) => (
        <ToolButton
          key={alignment}
          label={`Align ${alignment}`}
          pressed={active.isActive({ textAlign: alignment })}
          onClick={() => active.chain().focus().setTextAlign(alignment).run()}
        >
          <AlignGlyph alignment={alignment} />
        </ToolButton>
      ))}

      <Divider />

      <ToolButton
        label="Bulleted list"
        pressed={active.isActive('bulletList')}
        onClick={() => active.chain().focus().toggleBulletList().run()}
      >
        <ListGlyph ordered={false} />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        pressed={active.isActive('orderedList')}
        onClick={() => active.chain().focus().toggleOrderedList().run()}
      >
        <ListGlyph ordered />
      </ToolButton>
      <ToolButton
        label="Checklist"
        pressed={active.isActive('taskList')}
        onClick={() => active.chain().focus().toggleTaskList().run()}
      >
        <CheckGlyph />
      </ToolButton>
      <ToolButton
        label="Quote"
        pressed={active.isActive('blockquote')}
        onClick={() => active.chain().focus().toggleBlockquote().run()}
      >
        <span className="font-serif text-base leading-none">&ldquo;</span>
      </ToolButton>
      <ToolButton
        label="Code block"
        pressed={active.isActive('codeBlock')}
        onClick={() => active.chain().focus().toggleCodeBlock().run()}
      >
        <span className="font-mono text-xs leading-none">&lt;/&gt;</span>
      </ToolButton>

      <Divider />

      <ToolButton label="Link" pressed={active.isActive('link')} onClick={() => toggleLink(active)}>
        <LinkGlyph />
      </ToolButton>
      <ToolButton
        label="Insert table"
        onClick={() =>
          active.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <TableGlyph />
      </ToolButton>
      <ToolButton
        label="Horizontal rule"
        onClick={() => active.chain().focus().setHorizontalRule().run()}
      >
        <span className="text-sm leading-none">—</span>
      </ToolButton>
      <ToolButton
        label="Clear formatting"
        onClick={() => active.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <ClearGlyph />
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
    .toggleHeading({ level: level as 1 | 2 | 3 })
    .run();
}

function toggleLink(editor: Editor): void {
  if (editor.isActive('link')) {
    editor.chain().focus().unsetLink().run();
    return;
  }

  const href = window.prompt('Link address');
  if (href === null || href.trim().length === 0) {
    return;
  }
  editor.chain().focus().setLink({ href: href.trim() }).run();
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />;
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
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
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
      className={`${width} h-8 rounded-md border border-transparent bg-transparent px-1 text-sm text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 dark:text-slate-300 dark:hover:bg-slate-800`}
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
      <div className="invisible absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-md border border-slate-200 bg-white p-1.5 shadow-lg group-hover:visible group-focus-within:visible dark:border-slate-700 dark:bg-slate-900">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`${label} ${color}`}
            title={color}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(color)}
            style={{ backgroundColor: color }}
            className="h-5 w-5 rounded border border-slate-300 dark:border-slate-600"
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
