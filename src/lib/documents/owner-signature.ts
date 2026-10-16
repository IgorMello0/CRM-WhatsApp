import { supabaseAdmin } from '@/lib/automations/admin-client';
import type { DocumentSnapshot, OwnerSignature } from './types';
import { DocumentError, object } from './validation';

export type OwnerSignatureSetting = { stamp: OwnerSignature; enabled: boolean };
export async function getOwnerSignature(
  accountId: string
): Promise<OwnerSignatureSetting | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('account_document_signatures')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205')
      throw new DocumentError(
        'Aplique a migração 040_document_owner_signature.sql para configurar a assinatura padrão.',
        503
      );
    throw error;
  }
  if (!data) return null;
  const { data: account, error: accountError } = await db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .single();
  if (accountError) throw accountError;
  if (account.owner_user_id !== data.owner_user_id) return null;
  return {
    enabled: data.enabled,
    stamp: {
      version: data.version,
      userId: data.owner_user_id,
      name: data.name,
      email: data.email,
      strokes: data.strokes,
      authorizedAt: data.authorized_at,
    },
  };
}

export async function resolveOwnerStamp(
  accountId: string,
  snapshot: DocumentSnapshot,
  input: unknown
) {
  if (!snapshot.signing?.ownerPlacement) return snapshot;
  const setting = await getOwnerSignature(accountId);
  if (!setting?.enabled)
    throw new DocumentError(
      'O dono da conta precisa autorizar uma assinatura padrão nas configurações.',
      409
    );
  const requested = object(object(input).signing);
  const requestedVersion = requested.ownerStamp
    ? object(requested.ownerStamp).version
    : undefined;
  if (requestedVersion !== setting.stamp.version)
    throw new DocumentError(
      'A assinatura padrão mudou. Recarregue a assinatura do dono e confira a prévia.',
      409
    );
  return {
    ...snapshot,
    signing: { ...snapshot.signing, ownerStamp: setting.stamp },
  };
}

export async function assertOwnerAuthorization(
  accountId: string,
  snapshot: DocumentSnapshot
) {
  if (!snapshot.signing?.ownerPlacement) return;
  const setting = await getOwnerSignature(accountId);
  if (
    !setting?.enabled ||
    !snapshot.signing.ownerStamp ||
    setting.stamp.version !== snapshot.signing.ownerStamp.version
  )
    throw new DocumentError(
      'A assinatura padrão foi alterada ou desativada. Atualize o documento antes de assinar.',
      409
    );
}
