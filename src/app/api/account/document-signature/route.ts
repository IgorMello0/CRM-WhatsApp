import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { documentError, readJson } from '@/lib/documents/server';
import {
  DocumentError,
  object,
  validateStrokes,
} from '@/lib/documents/validation';
import { getOwnerSignature } from '@/lib/documents/owner-signature';

export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const setting = await getOwnerSignature(ctx.accountId);
    // Disabled ink is only returned to the owner, who can edit/re-enable it.
    return NextResponse.json({
      setting: ctx.role === 'owner' || setting?.enabled ? setting : null,
    });
  } catch (error) {
    return documentError(error);
  }
}
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('owner');
    const body = object(await readJson(request, 1000000));
    if (typeof body.enabled !== 'boolean')
      throw new DocumentError('Confirme a autorização de uso da assinatura.');
    const strokes = validateStrokes(body.strokes);
    const {
      data: { user },
      error: authError,
    } = await ctx.supabase.auth.getUser();
    if (authError || !user?.email || user.id !== ctx.userId)
      throw new DocumentError(
        'Entre novamente para configurar a assinatura.',
        401
      );
    const { data: profile, error: profileError } = await ctx.supabase
      .from('profiles')
      .select('full_name')
      .eq('user_id', ctx.userId)
      .single();
    if (profileError) throw profileError;
    const db = supabaseAdmin();
    const { data: account, error: accountError } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', ctx.accountId)
      .single();
    if (accountError) throw accountError;
    if (account.owner_user_id !== ctx.userId)
      throw new DocumentError(
        'Somente o dono atual pode configurar esta assinatura.',
        403
      );
    const current = await getOwnerSignature(ctx.accountId);
    if ((current?.stamp.version ?? null) !== body.version)
      throw new DocumentError(
        'A configuração mudou. Recarregue antes de salvar.',
        409
      );
    const values = {
      account_id: ctx.accountId,
      owner_user_id: ctx.userId,
      version: randomUUID(),
      name: (profile?.full_name || user.email)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160),
      email: user.email,
      strokes,
      enabled: body.enabled,
      authorized_at: new Date().toISOString(),
    };
    // On ownership transfer the old row may exist but is not reusable. Replace
    // it only after verifying the current owner; concurrent saves still use CAS.
    const { data: existing, error: existingError } = await db
      .from('account_document_signatures')
      .select('version,owner_user_id')
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (
      existing?.owner_user_id === ctx.userId &&
      existing.version !== body.version
    )
      throw new DocumentError(
        'A configuração mudou. Recarregue antes de salvar.',
        409
      );
    const query = existing
      ? db
          .from('account_document_signatures')
          .update(values)
          .eq('account_id', ctx.accountId)
          .eq('version', existing.version)
      : db.from('account_document_signatures').insert(values);
    const { data, error } = await query.select('version').maybeSingle();
    if (error?.code === '23505' || (!error && !data))
      throw new DocumentError(
        'A configuração mudou. Recarregue antes de salvar.',
        409
      );
    if (error) throw error;
    return NextResponse.json({
      setting: {
        enabled: values.enabled,
        stamp: {
          version: values.version,
          userId: values.owner_user_id,
          name: values.name,
          email: values.email,
          strokes,
          authorizedAt: values.authorized_at,
        },
      },
    });
  } catch (error) {
    return documentError(error);
  }
}
