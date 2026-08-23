import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from './ui.module.css'

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean
  title: string
  description?: string | undefined
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={onClose}
    >
      <header className={styles.dialogHeader}>
        <div>
          <h2 id={titleId}>{title}</h2>
          {description === undefined ? null : <p id={descriptionId}>{description}</p>}
        </div>
        <button type="button" className={styles.iconButton} onClick={onClose} aria-label={`Close ${title}`}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  )
}
