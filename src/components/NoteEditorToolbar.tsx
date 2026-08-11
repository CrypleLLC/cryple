'use client';

import type { ReactNode } from 'react';
import {
  canGrowNoteFont,
  canShrinkNoteFont,
  type InlineStyle,
  type NoteLineCommand,
  type NoteLineType,
} from '@/lib/note-format';
import { TaskListIcon, TitleIcon, TopicIcon } from './icons';

const LINE_COMMANDS: {
  command: NoteLineCommand;
  label: string;
  hint: string;
  icon: typeof TitleIcon;
}[] = [
  { command: 'title', label: 'Title', hint: 'Turn this line into a title', icon: TitleIcon },
  { command: 'topic', label: 'Topic', hint: 'Turn this line into a topic', icon: TopicIcon },
  {
    command: 'task',
    label: 'Checklist',
    hint: 'Checklist line — press again to tick it, once more to clear it',
    icon: TaskListIcon,
  },
];

export default function NoteEditorToolbar({
  disabled,
  fontSize,
  activeLine,
  onLineType,
  onInlineStyle,
  onFontSize,
}: {
  disabled: boolean;
  fontSize: number;
  activeLine: NoteLineType;
  onLineType: (command: NoteLineCommand) => void;
  onInlineStyle: (style: InlineStyle) => void;
  onFontSize: (direction: 1 | -1) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Formatting">
      {LINE_COMMANDS.map(({ command, label, hint, icon: CommandIcon }) => (
        <ToolButton
          key={command}
          label={label}
          hint={hint}
          pressed={activeLine === command}
          disabled={disabled}
          onClick={() => onLineType(command)}
        >
          <CommandIcon className="h-4 w-4 shrink-0" />
        </ToolButton>
      ))}

      <Divider />

      <ToolButton
        label="Bold"
        hint="Bold the selected text"
        disabled={disabled}
        onClick={() => onInlineStyle('bold')}
      >
        <span className="text-sm font-bold leading-none">B</span>
      </ToolButton>
      <ToolButton
        label="Italic"
        hint="Italicise the selected text"
        disabled={disabled}
        onClick={() => onInlineStyle('italic')}
      >
        <span className="font-serif text-sm italic leading-none">I</span>
      </ToolButton>

      <Divider />

      <ToolButton
        label="Smaller text"
        hint="Smaller text"
        disabled={disabled || !canShrinkNoteFont(fontSize)}
        onClick={() => onFontSize(-1)}
      >
        <span className="text-xs font-semibold leading-none">A−</span>
      </ToolButton>
      <span
        aria-live="polite"
        className="min-w-8 text-center text-xs tabular-nums text-slate-500 dark:text-slate-400"
      >
        {fontSize}
      </span>
      <ToolButton
        label="Larger text"
        hint="Larger text"
        disabled={disabled || !canGrowNoteFont(fontSize)}
        onClick={() => onFontSize(1)}
      >
        <span className="text-base font-semibold leading-none">A+</span>
      </ToolButton>
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />;
}

function ToolButton({
  label,
  hint,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  pressed?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={hint}
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
