import type { ReactNode } from 'react';
import { Button } from '@/components/ui';
import { TrashIcon } from '@/components/ui/icons';
import { Modal } from './Modal';
import { ModalActions } from './ModalActions';

export function ConfirmDeleteModal({
  title,
  subtitle,
  confirmLabel,
  keepLabel = 'Keep it',
  busy,
  onKeep,
  onConfirm,
  children,
}: {
  title: string;
  subtitle?: string;
  confirmLabel: string;
  keepLabel?: string;
  busy: boolean;
  onKeep: () => void;
  onConfirm?: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onKeep}
      footer={
        <ModalActions busy={busy} cancelLabel={keepLabel} onCancel={onKeep}>
          {onConfirm === undefined ? null : (
            <Button variant="danger" disabled={busy} onClick={onConfirm}>
              <TrashIcon />
              {confirmLabel}
            </Button>
          )}
        </ModalActions>
      }
    >
      <p className="text-compact text-ink-soft">{children}</p>
    </Modal>
  );
}
