'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { SignaturePad } from '@/components/documents/signature-pad';
import { documentRequest } from '@/components/documents/client';
import type { Stroke } from '@/lib/documents/types';

export function DocumentSignatureSettings() {
  const t = useTranslations('Documents');
  const { accountRole, profile } = useAuth();
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [version, setVersion] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError('');
    void documentRequest('/api/account/document-signature', {
      signal: controller.signal,
    })
      .then(({ setting }) => {
        setStrokes(setting?.stamp.strokes ?? []);
        setVersion(setting?.stamp.version ?? null);
        setEnabled(setting?.enabled ?? false);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [retry]);
  async function save() {
    setBusy(true);
    try {
      const { setting } = await documentRequest(
        '/api/account/document-signature',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled, strokes, version }),
        }
      );
      setVersion(setting.stamp.version);
      toast.success(t('ownerSaved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="bg-card max-w-3xl space-y-5 rounded-xl border p-6">
      <h2 className="text-lg font-semibold">{t('ownerSettings')}</h2>
      <p className="text-muted-foreground text-sm">{t('ownerSettingsHelp')}</p>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <Button variant="outline" onClick={() => setRetry(retry + 1)}>
            {t('retry')}
          </Button>
        </div>
      ) : accountRole !== 'owner' ? (
        <p>{t('ownerOnly')}</p>
      ) : (
        <>
          <p className="text-sm">
            {profile?.full_name} · {profile?.email}
          </p>
          <fieldset
            disabled={busy}
            className={busy ? 'pointer-events-none opacity-50' : ''}
          >
            <SignaturePad
              key={version ?? 'new'}
              value={strokes}
              onChange={setStrokes}
            />
            <label className="mt-4 flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              {t('ownerAuthorization')}
            </label>
          </fieldset>
          <p className="text-muted-foreground text-xs">
            {t('ownerRevocation')}
          </p>
          <Button
            disabled={busy || !strokes.length}
            onClick={() => void save()}
          >
            {busy ? t('loading') : t('saveOwner')}
          </Button>
        </>
      )}
    </section>
  );
}
