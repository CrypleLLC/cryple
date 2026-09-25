import type { ReactNode } from 'react';
import { Button } from '@/components/ui';

export function ModalActions({
  busy = false,
  cancelLabel = 'Cancel',
  onCancel,
  children,
}: {
  busy?: boolean;
  cancelLabel?: string;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" disabled={busy} onClick={onCancel}>
        {cancelLabel}
      </Button>
      {children}
    </div>
  );
}
