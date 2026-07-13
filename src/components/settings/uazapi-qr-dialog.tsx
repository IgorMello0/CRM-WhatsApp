'use client'

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Loader2, ExternalLink, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'

interface UazapiQrDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  qrcodeStr?: string
  pairingCode?: string
  onConnected: () => void
}

export function UazapiQrDialog({
  open,
  onOpenChange,
  qrcodeStr,
  pairingCode,
  onConnected,
}: UazapiQrDialogProps) {
  const t = useTranslations('Settings.whatsapp')
  const [checking, setChecking] = useState(false)

  // Poll status every 3 seconds while open
  useEffect(() => {
    if (!open) return

    let intervalId: NodeJS.Timeout

    const checkStatus = async () => {
      try {
        setChecking(true)
        const res = await fetch('/api/whatsapp/uazapi/status')
        if (res.ok) {
          const data = await res.json()
          if (data.status === 'connected') {
            toast.success('UAZAPI instance connected successfully!')
            onConnected()
            onOpenChange(false)
          }
        }
      } catch (error) {
        console.error('Error polling status:', error)
      } finally {
        setChecking(false)
      }
    }

    intervalId = setInterval(checkStatus, 3000)
    return () => clearInterval(intervalId)
  }, [open, onConnected, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect WhatsApp via UAZAPI</DialogTitle>
          <DialogDescription>
            Open WhatsApp on your phone, go to Linked Devices, and scan this QR code.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center p-6 space-y-6 bg-muted/30 rounded-lg">
          {qrcodeStr ? (
            <div className="bg-white p-4 rounded-xl shadow-sm">
              {qrcodeStr.startsWith('data:image') ? (
                <img src={qrcodeStr} alt="QR Code" width={240} height={240} className="rounded-md" />
              ) : (
                <QRCodeSVG
                  value={qrcodeStr}
                  size={240}
                  level="L"
                  includeMargin={false}
                />
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center py-10 text-muted-foreground">
              <Loader2 className="size-8 animate-spin mb-4" />
              <p>Generating QR Code...</p>
            </div>
          )}

          {pairingCode && (
            <div className="text-center space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Or use pairing code:</p>
              <code className="text-2xl font-bold tracking-widest">{pairingCode}</code>
            </div>
          )}
          
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            <span>Waiting for scan...</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
