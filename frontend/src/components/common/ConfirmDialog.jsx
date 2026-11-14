import Modal from './Modal.jsx'
import Button from './Button.jsx'

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  loading,
  confirmLabel = 'Delete',
  loadingLabel = 'Deleting...',
  variant = 'danger',
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={message}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={loading}>
            {loading ? loadingLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-500">This action cannot be undone.</p>
    </Modal>
  )
}
