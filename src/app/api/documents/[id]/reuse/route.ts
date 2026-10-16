import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import {
  documentError,
  getDocument,
  original,
  readJson,
} from '@/lib/documents/server';
import { DocumentError, object, revision } from '@/lib/documents/validation';
import { copyAsTemplate, instantiateTemplate } from '@/lib/documents/templates';
import { renderPdf } from '@/lib/documents/pdf';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const source = await getDocument(ctx, (await params).id);
    const body = object(await readJson(request, 1000000));
    if (revision(body.revision) !== source.revision)
      throw new DocumentError(
        'O documento mudou. Reabra a versão atual antes de continuar.',
        409
      );
    if (body.action !== 'template' && body.action !== 'instantiate')
      throw new DocumentError('Operação inválida.');
    const snapshot =
      body.action === 'template'
        ? copyAsTemplate(source.snapshot, body.title as string)
        : instantiateTemplate(source.snapshot, body);
    await renderPdf(snapshot, await original(source));
    const { data, error } = await supabaseAdmin()
      .from('documents')
      .insert({
        id: randomUUID(),
        account_id: ctx.accountId,
        created_by: ctx.userId,
        updated_by: ctx.userId,
        snapshot,
        source_path: source.source_path,
        source_sha256: source.source_sha256,
        // Only the immutable original is shared; signed PDFs are never copied.
      })
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ document: data }, { status: 201 });
  } catch (error) {
    return documentError(error);
  }
}
