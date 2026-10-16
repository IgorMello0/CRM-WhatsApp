import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  DocumentError,
  object,
  revision,
  validateStrokes,
} from '@/lib/documents/validation';
import { contentHash, renderPdf, sha256 } from '@/lib/documents/pdf';
import {
  assertDraft,
  cleanup,
  documentError,
  getDocument,
  original,
  readJson,
  uploadPrivate,
} from '@/lib/documents/server';
import { SIGNING_CONSENT, type DocumentSignature } from '@/lib/documents/types';
import { assertOwnerAuthorization } from '@/lib/documents/owner-signature';
import { assertReadyDocument } from '@/lib/documents/templates';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const doc = await getDocument(ctx, (await params).id);
    const body = object(await readJson(request, 1000000));
    const expected = revision(body.revision);
    assertDraft(doc, expected);
    assertReadyDocument(doc.snapshot);
    if (body.consent !== SIGNING_CONSENT)
      throw new DocumentError(
        'Confirme a leitura e a assinatura do documento.'
      );
    const hash = contentHash(doc.snapshot, doc.source_sha256);
    if (body.contentHash !== hash)
      throw new DocumentError(
        'Visualize a versão atual antes de assinar.',
        409
      );
    if (doc.snapshot.kind === 'text' && !doc.snapshot.content.trim())
      throw new DocumentError('O documento está vazio.');
    const strokes = validateStrokes(body.strokes);
    const signing = doc.snapshot.signing;
    if (!signing?.clientName.trim() || !signing.clientPlacement)
      throw new DocumentError(
        'Informe o nome do cliente e posicione a assinatura antes de assinar.'
      );
    await assertOwnerAuthorization(ctx.accountId, doc.snapshot);
    const {
      data: { user },
      error: authError,
    } = await ctx.supabase.auth.getUser();
    if (authError || !user || user.id !== ctx.userId || !user.email)
      throw new DocumentError('Entre novamente para assinar.', 401);
    const signature: DocumentSignature = {
      userId: null,
      mode: 'in_person',
      collectedBy: user.id,
      email: signing.clientEmail,
      name: signing.clientName,
      signedAt: new Date().toISOString(),
      revision: expected,
      contentSha256: hash,
      consent: SIGNING_CONSENT,
      strokes,
    };
    const bytes = await renderPdf(
      doc.snapshot,
      await original(doc),
      signature,
      doc.id
    );
    const path = `${ctx.accountId}/${doc.id}/signed-${randomUUID()}.pdf`;
    await uploadPrivate(path, bytes);
    // Compare-and-swap makes edit/sign and sign/sign races resolve atomically.
    // The history trigger runs in the same transaction as this update.
    const { data, error } = await supabaseAdmin()
      .from('documents')
      .update({
        status: 'signed',
        signature,
        signed_path: path,
        signed_sha256: sha256(bytes),
        revision: expected + 1,
        updated_by: ctx.userId,
      })
      .eq('id', doc.id)
      .eq('account_id', ctx.accountId)
      .eq('revision', expected)
      .eq('status', 'draft')
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      await cleanup(path);
      throw new DocumentError(
        'O documento mudou durante a assinatura. Reabra-o e confira a versão atual.',
        409
      );
    }
    return NextResponse.json({ document: data });
  } catch (error) {
    // Never delete the uploaded PDF after an uncertain commit/network error.
    return documentError(error);
  }
}
