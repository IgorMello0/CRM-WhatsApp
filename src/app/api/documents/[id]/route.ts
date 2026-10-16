import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  DocumentError,
  object,
  revision,
  validateSnapshot,
} from '@/lib/documents/validation';
import { inspectPdf, renderPdf } from '@/lib/documents/pdf';
import { resolveOwnerStamp } from '@/lib/documents/owner-signature';
import {
  assertDraft,
  documentError,
  getDocument,
  original,
  readJson,
} from '@/lib/documents/server';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await getCurrentAccount();
    const doc = await getDocument(ctx, (await params).id);
    const source = await original(doc);
    const pdf = source ? await inspectPdf(source) : null;
    const { data: versions, error } = await ctx.supabase
      .from('document_versions')
      .select('revision,status,actor_id,created_at')
      .eq('document_id', doc.id)
      .eq('account_id', ctx.accountId)
      .order('revision', { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ document: doc, pdf, versions });
  } catch (error) {
    return documentError(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await requireRole('agent');
    const doc = await getDocument(ctx, (await params).id);
    const body = object(await readJson(request, 1000000));
    const expected = revision(body.revision);
    assertDraft(doc, expected);
    const snapshot = await resolveOwnerStamp(
      ctx.accountId,
      validateSnapshot(body.snapshot),
      body.snapshot
    );
    if (snapshot.kind !== doc.snapshot.kind)
      throw new DocumentError('O tipo do documento não pode ser alterado.');
    // Validate the exact export before saving an unusable document revision.
    await renderPdf(snapshot, await original(doc));
    const { data, error } = await supabaseAdmin()
      .from('documents')
      .update({ snapshot, revision: expected + 1, updated_by: ctx.userId })
      .eq('id', doc.id)
      .eq('account_id', ctx.accountId)
      .eq('revision', expected)
      .eq('status', 'draft')
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new DocumentError(
        'O documento mudou durante a edição. Reabra-o para continuar.',
        409
      );
    return NextResponse.json({ document: data });
  } catch (error) {
    return documentError(error);
  }
}
