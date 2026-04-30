import * as React from 'react'
import { cn } from '../../lib/utils'

export interface DialogProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
}

/** Minimal modal — overlay + centered card, click-outside or Escape to close. */
export function Dialog({ open, onClose, children, className }: DialogProps): JSX.Element | null {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'bg-background rounded-lg shadow-2xl border max-w-md w-full mx-4 p-6 animate-in zoom-in-95',
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}
