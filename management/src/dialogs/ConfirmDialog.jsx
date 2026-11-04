import Dialog from '../components/Dialog';
import Button from '../components/Button';

/**
 * Confirmation or preview dialog. Without `onConfirm` it is a read-only preview
 * (receipt, reminder) with a single Close button.
 */
export default function ConfirmDialog({ title, children, confirmLabel = 'Confirm', tone = 'primary', onConfirm, onClose }) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        onConfirm ? (
          <>
            <Button onClick={onClose} icon={false}>
              Keep as is
            </Button>
            <Button
              variant={tone}
              icon={false}
              onClick={() => {
                onConfirm();
                onClose();
              }}
            >
              {confirmLabel}
            </Button>
          </>
        ) : (
          <Button onClick={onClose} variant="primary" icon={false}>
            Close
          </Button>
        )
      }
    >
      {children}
    </Dialog>
  );
}
