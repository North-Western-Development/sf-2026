import { useState, type FormEvent } from 'react';
import { Button, Input, Modal } from '@subspace/ui';
import { closeDialog as closeModal, toast } from '../../app/ui';

export function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      closeModal();
    } catch (err) {
      toast((err as Error).message || 'Something went wrong', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      isOpen
      onClose={closeModal}
      title={title}
      maxWidth="md"
      footer={
        <>
          <Button variant="link" className="text-fg" onClick={closeModal}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={run} isLoading={busy} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-fg-muted">{body}</p>
    </Modal>
  );
}

export function PromptModal({
  title,
  label,
  initial = '',
  maxLength,
  confirmLabel = 'Save',
  onSubmit,
}: {
  title: string;
  label: string;
  initial?: string;
  maxLength?: number;
  confirmLabel?: string;
  onSubmit: (v: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit(value.trim());
      closeModal();
    } catch (err) {
      toast((err as Error).message || 'Could not save', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={closeModal} title={title} maxWidth="md">
      <form onSubmit={submit}>
        <Input label={label} value={value} maxLength={maxLength} onChange={(e) => setValue(e.target.value)} data-autofocus autoFocus />
        <div className="-mx-6 -mb-4 mt-6 flex justify-end gap-3 bg-raised px-6 py-4">
          <Button variant="link" className="text-fg" onClick={closeModal}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
