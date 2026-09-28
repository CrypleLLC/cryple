'use client';

import type { DragEvent, ReactNode } from 'react';
import { dateAndTimeLabels } from '@/lib/app';
import { Card, Empty, Notice, Spinner } from '@/components/ui';

const CELL_CLASSES = {
  name: 'truncate text-compact font-semibold text-ink',
  text: 'truncate text-compact text-ink-soft',
  secret: 'truncate font-mono text-compact text-ink-soft',
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
}: {
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  columns: readonly ItemColumn<Row>[];
  actions: (row: Row) => ReactNode;
  actionsHeader?: string;
  onRowDragStart?: (event: DragEvent, row: Row) => void;
}) {
  const draggable = onRowDragStart !== undefined;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-raised text-caption uppercase text-ink-muted">
            {columns.map((column) => (
              <th key={column.header} className="py-3 pr-4 text-left">
                {column.header}
              </th>
            ))}
            <th className="w-px whitespace-nowrap py-3 pl-4 pr-5 text-right">{actionsHeader}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              draggable={draggable}
              onDragStart={draggable ? (event) => onRowDragStart(event, row) : undefined}
              className={`transition-colors hover:bg-brand-50/40 ${
                draggable ? 'cursor-grab active:cursor-grabbing' : ''
              }`}
            >
              {columns.map((column) => (
                <td
                  key={column.header}
                  className={`py-3.5 pr-4 ${column.width ?? ''} ${CELL_CLASSES[column.kind]}`}
                >
                  {column.render(row)}
                </td>
              ))}
              <td className="w-px whitespace-nowrap py-3.5 pl-4 pr-5">
                <div className="flex flex-nowrap justify-end gap-2 *:shrink-0">{actions(row)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
