'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { documentRequest } from './client';
import { templateVariables } from '@/lib/documents/templates';
import type { CrmDocument } from '@/lib/documents/types';

export function ReuseDocumentDialog({
  document: doc,
  action,
  onClose,
}: {
  document: CrmDocument;
  action: 'template' | 'instantiate';
  onClose: () => void;
}) {
  const t = useTranslations('Documents');
  const router = useRouter();
  const [title, setTitle] = useState(doc.snapshot.title);
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const variables = templateVariables(doc.snapshot);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await documentRequest(`/api/documents/${doc.id}/reuse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          revision: doc.revision,
          title,
          clientName,
          clientEmail,
          values: {
            ...values,
            nome_cliente: clientName,
            email_cliente: clientEmail,
          },
        }),
      });
      toast.success(
        t(action === 'template' ? 'templateCreated' : 'clientDocumentCreated')
      );
      onClose();
      router.push(`/documents/${result.document.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t(action === 'template' ? 'saveAsTemplate' : 'useTemplate')}
          </DialogTitle>
          <DialogDescription>
            {t(action === 'template' ? 'copyTemplateHelp' : 'useTemplateHelp')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <fieldset disabled={busy} className="space-y-4">
            <label className="block space-y-1 text-sm">
              {t('documentTitle')}
              <Input
                value={title}
                maxLength={160}
                required
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            {action === 'instantiate' && (
              <>
                <label className="block space-y-1 text-sm">
                  {t('clientName')}
                  <Input
                    value={clientName}
                    required
                    maxLength={160}
                    onChange={(event) => setClientName(event.target.value)}
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  {t('clientEmail')}
                  <Input
                    value={clientEmail}
                    type="email"
                    required={variables.includes('email_cliente')}
                    maxLength={254}
                    onChange={(event) => setClientEmail(event.target.value)}
                  />
                </label>
                {variables
                  .filter(
                    (key) => !['nome_cliente', 'email_cliente'].includes(key)
                  )
                  .map((key) => (
                    <label key={key} className="block space-y-1 text-sm">
                      <span className="capitalize">
                        {key.replaceAll('_', ' ')}
                      </span>
                      <Input
                        required
                        maxLength={5000}
                        value={values[key] ?? ''}
                        onChange={(event) =>
                          setValues({ ...values, [key]: event.target.value })
                        }
                      />
                    </label>
                  ))}
                {!variables.length && (
                  <p className="text-muted-foreground text-sm">
                    {t('noTemplateVariables')}
                  </p>
                )}
              </>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              {t('cancel')}
            </Button>
            <Button disabled={busy} type="submit">
              {busy
                ? t('loading')
                : t(
                    action === 'template'
                      ? 'saveAsTemplate'
                      : 'generateDocument'
                  )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
