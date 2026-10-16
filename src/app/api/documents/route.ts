import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { MAX_PDF_BYTES } from '@/lib/documents/types';
import { DocumentError, validateSnapshot } from '@/lib/documents/validation';
import { inspectPdf, renderPdf, sha256 } from '@/lib/documents/pdf';
import { resolveOwnerStamp } from '@/lib/documents/owner-signature';
import { documentError, readJson, uploadPrivate } from '@/lib/documents/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const search = new URL(request.url).searchParams;
    const page = Math.floor(
      Math.max(0, Math.min(100000, Number(search.get('page')) || 0))
    );
    let query = ctx.supabase
      .from('documents')
      .select(
        'id,title:snapshot->>title,kind:snapshot->>kind,is_template:snapshot->>isTemplate,status,revision,updated_at',
        { count: 'exact' }
      )
      .eq('account_id', ctx.accountId);
    if (search.get('category') === 'templates')
      query = query.eq('snapshot->>isTemplate', 'true');
    else if (search.get('category') === 'documents')
      query = query.or(
        'snapshot->>isTemplate.is.null,snapshot->>isTemplate.eq.false'
      );
    const term = (search.get('search') ?? '')
      .slice(0, 160)
      .replace(/[\\%_]/g, '\\$&');
    if (term) query = query.ilike('snapshot->>title', `%${term}%`);
    const { data, count, error } = await query
      .order('updated_at', { ascending: false })
      .range(page * 30, page * 30 + 29);
    if (error) throw error;
    return NextResponse.json({ documents: data, total: count });
  } catch (error) {
    return documentError(error);
  }
}

export async function POST(request: Request) {
  let uploaded: string | undefined;
  try {
    const ctx = await requireRole('agent');
    const id = randomUUID();
    let sourceHash: string | null = null;
    let snapshot;
    if (request.headers.get('content-type')?.includes('multipart/form-data')) {
      // Bound the actual stream, including chunked uploads, before multipart parsing.
      const reader = request.body?.getReader();
      if (!reader) throw new DocumentError('Envie um PDF.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_PDF_BYTES + 65536) {
            await reader.cancel();
            throw new DocumentError('Limite de 10 MB por PDF.', 413);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const form = await new Response(Buffer.concat(chunks), {
        headers: { 'Content-Type': request.headers.get('content-type')! },
      }).formData();
      const file = form.get('file');
      if (!(file instanceof File) || !file.size || file.size > MAX_PDF_BYTES)
        throw new DocumentError('Envie um PDF de até 10 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      await inspectPdf(bytes);
      snapshot = validateSnapshot({
        title: file.name.replace(/\.pdf$/i, '').slice(0, 160),
        kind: 'pdf',
        isTemplate: form.get('isTemplate') === 'true',
        content: '',
        fontSize: 12,
        annotations: [],
        fields: {},
      });
      await renderPdf(snapshot, bytes);
      const path = `${ctx.accountId}/${id}/original-${randomUUID()}.pdf`;
      await uploadPrivate(path, bytes);
      uploaded = path;
      sourceHash = sha256(bytes);
    } else {
      const input = await readJson(request, 1000000);
      snapshot = await resolveOwnerStamp(
        ctx.accountId,
        { ...validateSnapshot(input), layoutVersion: 2 },
        input
      );
      if (snapshot.kind !== 'text')
        throw new DocumentError('Importe um arquivo para criar um PDF.');
      await renderPdf(snapshot);
    }
    const { data, error } = await supabaseAdmin()
      .from('documents')
      .insert({
        id,
        account_id: ctx.accountId,
        created_by: ctx.userId,
        updated_by: ctx.userId,
        snapshot,
        source_path: uploaded ?? null,
        source_sha256: sourceHash,
      })
      .select('*')
      .single();
    if (error) throw error;
    return NextResponse.json({ document: data }, { status: 201 });
  } catch (error) {
    // An uncertain database response can still mean the INSERT committed.
    // Retain the private object rather than risk deleting a referenced original.
    return documentError(error);
  }
}
