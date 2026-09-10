import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useRegisterModal } from '@/context/ModalContext'

interface DeleteSessionConfirmationDialogProps {
  sessionName: string | null
  onConfirm: () => void
  onCancel: () => void
}

/** App-styled, localized confirmation for permanently deleting a session. */
export function DeleteSessionConfirmationDialog({
  sessionName,
  onConfirm,
  onCancel,
}: DeleteSessionConfirmationDialogProps) {
  const { t } = useTranslation()
  const open = sessionName !== null

  useRegisterModal(open, onCancel)

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && onCancel()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" />
            {t('dialog.deleteSession.title')}
          </DialogTitle>
          <DialogDescription className="pt-1 text-left">
            {t('dialog.deleteSessionConfirmation', { name: sessionName ?? '' })}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-muted-foreground">
          {t('dialog.deleteSession.warning')}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
