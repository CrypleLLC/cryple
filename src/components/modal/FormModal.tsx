import type { ReactNode } from 'react';
import { Button } from '@/components/ui';
import { Modal } from './Modal';
import { ModalActions } from './ModalActions';

export function FormModal({
  title,
  subtitle,
  submitLabel,
  canSubmit,
  busy,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  subtitle?: string;
  submitLabel: string;
  canSubmit: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <ModalActions busy={busy} onCancel={onClose}>
          <Button disabled={busy || !canSubmit} onClick={onSubmit}>
            {submitLabel}
          </Button>
        </ModalActions>
      }
    >
      {children}
    </Modal>
  );
}
