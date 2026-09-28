'use client';

import type { DragEvent, ReactNode } from 'react';
import { dateAndTimeLabels } from '@/lib/app';
import { Card, Empty, Notice, Spinner } from '@/components/ui';
import { GripIcon } from '@/components/ui/icons';

const CELL_CLASSES = {
  name: 'whitespace-pre-wrap [overflow-wrap:anywhere] text-compact font-semibold text-ink',
  text: 'whitespace-pre-wrap [overflow-wrap:anywhere] text-compact text-ink-soft',
  secret:
    'max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-mono text-compact text-ink-soft',
  meta: 'whitespace-nowrap text-caption normal-case tracking-normal text-ink-muted',
} as const;

export type ItemColumnKind = keyof typeof CELL_CLASSES;

export function DateTimeCell({ at }: { at: string }) {
  const { date, time } = dateAndTimeLabels(at);

  return (
    <span className="block leading-tight">
      <span className="block">{date}</span>
      <span className="block text-ink-faint">{time}</span>
    </span>
  );
}

export interface ItemColumn<Row> {
  header: string;
  kind: ItemColumnKind;
  width?: string;
  render: (row: Row) => ReactNode;
}

export function ItemList<Row>({
  message,
  onDismissMessage,
  rows,
  rowKey,
  columns,
  actions,
  actionsHeader,
  emptyIcon,
  emptyText,
  onRowDragStart,
  dragHandleLabel,
}: {
  message?: string;
  onDismissMessage?: () => void;
  rows: readonly Row[] | undefined;
  rowKey: (row: Row) => string;
  columns: readonly ItemColumn<Row>[];
  actions: (row: Row) => ReactNode;
  actionsHeader?: string;
  emptyIcon: ReactNode;
  emptyText: ReactNode;
  onRowDragStart?: (event: DragEvent, row: Row) => void;
  dragHandleLabel?: string;
}) {
  return (
    <Card>
      {message ? (
        <div className="px-5 pt-4">
          <Notice tone="danger" onDismiss={onDismissMessage}>
            {message}
          </Notice>
        </div>
      ) : null}

      {rows === undefined ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty icon={emptyIcon}>{emptyText}</Empty>
      ) : (
        <ItemTable
          rows={rows}
          rowKey={rowKey}
          columns={columns}
          actions={actions}
          actionsHeader={actionsHeader}
          onRowDragStart={onRowDragStart}
          dragHandleLabel={dragHandleLabel}
        />
      )}
    </Card>
  );
}

export function ItemTable<Row>({
  rows,
  rowKey,
  columns,
  actions,
  actionsHeader = 'Actions',
  onRowDragStart,
  dragHandleLabel = 'Drag to move',
}: {
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  columns: readonly ItemColumn<Row>[];
  actions: (row: Row) => ReactNode;
  actionsHeader?: string;
  onRowDragStart?: (event: DragEvent, row: Row) => void;
  dragHandleLabel?: string;
}) {
  const draggable = onRowDragStart !== undefined;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-raised text-caption uppercase text-ink-muted">
            {draggable ? <th aria-hidden="true" className="w-px py-3 pr-2" /> : null}
            {columns.map((column) => (
              <th key={column.header} className="py-3 pr-4 text-left">
                {column.header}
              </th>
            ))}
            <th className="w-px whitespace-nowrap py-3 pl-4 pr-5 text-right">{actionsHeader}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line select-text">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="transition-colors hover:bg-brand-50/40">
              {draggable ? (
                <td className="w-px py-3.5 pr-2 align-top">
                  <span
                    draggable
                    title={dragHandleLabel}
                    aria-label={dragHandleLabel}
                    onDragStart={(event) => {
                      const line = event.currentTarget.closest('tr');
                      if (line !== null) {
                        event.dataTransfer.setDragImage(line, 16, 16);
                      }
                      onRowDragStart(event, row);
                    }}
                    className="flex h-5 w-4 cursor-grab touch-none items-center justify-center text-ink-faint transition-colors select-none hover:text-ink-soft active:cursor-grabbing"
                  >
                    <GripIcon className="h-4 w-4 shrink-0" />
                  </span>
                </td>
              ) : null}
              {columns.map((column) => (
                <td key={column.header} className="py-3.5 pr-4 align-top">
                  <div className={`${column.width ?? ''} ${CELL_CLASSES[column.kind]}`}>{column.render(row)}</div>
                </td>
              ))}
              <td className="w-px whitespace-nowrap py-3.5 pl-4 pr-5 align-top">
                <div className="flex flex-nowrap justify-end gap-2 *:shrink-0">{actions(row)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
