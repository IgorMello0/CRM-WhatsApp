'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { documentRequest } from './client';
import type { SigningSetup } from '@/lib/documents/types';

export const emptySigning: SigningSetup = {
  clientName: '',
  clientEmail: '',
  clientPlacement: null,
  ownerPlacement: null,
  ownerStamp: null,
};
export function SigningControls({
  value,
  disabled,
  placing,
  onPlace,
  onChange,
}: {
  value: SigningSetup;
  disabled: boolean;
  placing: 'client' | 'owner' | null;
  onPlace: (role: 'client' | 'owner' | null) => void;
  onChange: (value: SigningSetup) => void;
}) {
  const t = useTranslations('Documents');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function includeOwner() {
    setLoading(true);
    setError('');
    try {
      const { setting } = await documentRequest(
        '/api/account/document-signature'
      );
      if (!setting?.enabled) {
        setError(t('noOwnerSignature'));
        return;
      }
      onChange({
        ...value,
        ownerStamp: setting.stamp,
        ownerPlacement: value.ownerPlacement ?? {
          page: 1,
          x: 0.1,
          y: 0.8,
          width: 0.28,
          height: 0.07,
        },
      });
      onPlace('owner');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'));
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="space-y-3 border-t pt-5">
      <h2 className="font-medium">{t('signers')}</h2>
      <p className="text-muted-foreground text-xs">{t('onsiteHelp')}</p>
      <label className="block space-y-1 text-sm">
        {t('clientName')}
        <Input
          value={value.clientName}
          disabled={disabled}
          maxLength={160}
          onChange={(event) =>
            onChange({ ...value, clientName: event.target.value })
          }
        />
      </label>
      <label className="block space-y-1 text-sm">
        {t('clientEmail')}
        <Input
          type="email"
          value={value.clientEmail}
          disabled={disabled}
          maxLength={254}
          onChange={(event) =>
            onChange({ ...value, clientEmail: event.target.value })
          }
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={placing === 'client' ? 'default' : 'outline'}
          size="sm"
          disabled={disabled}
          onClick={() => onPlace(placing === 'client' ? null : 'client')}
        >
          {t('placeClient')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || loading}
          onClick={() => void includeOwner()}
        >
          {loading ? t('loading') : t('includeOwner')}
        </Button>
      </div>
      {value.clientPlacement && (
        <p className="text-xs">
          {t('clientSignature')} · {t('page')} {value.clientPlacement.page}
        </p>
      )}
      {value.ownerStamp && (
        <div className="bg-muted space-y-2 rounded-lg p-3 text-xs">
          <p>
            {t('ownerSignature')}: {value.ownerStamp.name} · {t('page')}{' '}
            {value.ownerPlacement?.page}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={placing === 'owner' ? 'default' : 'outline'}
              disabled={disabled}
              onClick={() => onPlace(placing === 'owner' ? null : 'owner')}
            >
              {t('placeOwner')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                onPlace(null);
                onChange({ ...value, ownerPlacement: null, ownerStamp: null });
              }}
            >
              {t('removeOwner')}
            </Button>
          </div>
        </div>
      )}
      {placing && (
        <p role="status" className="rounded-md bg-blue-500/10 p-3 text-sm">
          {t('clickSignature', {
            signer: t(
              placing === 'client' ? 'clientSignature' : 'ownerSignature'
            ),
          })}
        </p>
      )}
      <p className="text-muted-foreground text-xs">{t('dragSignature')}</p>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Link className="text-xs underline" href="/settings?tab=signature">
        {t('ownerSettings')}
      </Link>
    </div>
  );
}
