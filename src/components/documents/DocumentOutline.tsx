'use client';

import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { activeHeadingPos, outlineTree, type OutlineNode } from '@/lib/documents';
import { UNTITLED_HEADING } from '@/lib/app';
import { goToHeading, useOutline } from './useOutline';

export default function DocumentOutline({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const entries = useOutline(editor);
  const cursor = useEditorState({
    editor,
    selector: () => editor?.state.selection.$from.pos ?? 0,
  });
  const active = activeHeadingPos(entries, cursor ?? 0);

  return (
    <div className="cryple-no-print lg:sticky lg:top-[calc(var(--staging-banner-h)+var(--doc-chrome-h,8rem)+1.5rem)] lg:w-60 lg:shrink-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className="mb-2 flex h-8 w-full items-center justify-between rounded-lg border border-line px-3 text-caption text-ink-soft transition-colors hover:bg-raised lg:hidden"
      >
        Outline
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      <nav
        aria-label="Document outline"
        className={`${open ? 'block' : 'hidden'} max-h-[calc(100vh-var(--staging-banner-h)-var(--doc-chrome-h,8rem)-3rem)] overflow-y-auto rounded-xl border border-line bg-surface p-2 lg:block`}
      >
        {entries.length === 0 ? (
          <p className="px-2 py-3 text-caption normal-case tracking-normal text-ink-muted">
            Headings you add appear here.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {outlineTree(entries).map((node) => (
              <OutlineRow
                key={node.pos}
                node={node}
                depth={0}
                active={active}
                onSelect={(pos) => editor !== null && goToHeading(editor, pos)}
              />
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}

function OutlineRow({
  node,
  depth,
  active,
  onSelect,
}: {
  node: OutlineNode;
  depth: number;
  active: number | undefined;
  onSelect: (pos: number) => void;
}) {
  const current = node.pos === active;
  const named = node.text.trim().length > 0;

  return (
    <li>
      <button
        type="button"
        aria-current={current ? 'location' : undefined}
        onClick={() => onSelect(node.pos)}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
        className={`block w-full truncate rounded-md py-1 pr-2 text-left text-sm transition-colors ${
          current ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-raised hover:text-ink'
        } ${named ? '' : 'italic text-ink-faint'}`}
      >
        {named ? node.text : UNTITLED_HEADING}
      </button>
      {node.children.length > 0 && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <OutlineRow
              key={child.pos}
              node={child}
              depth={depth + 1}
              active={active}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
