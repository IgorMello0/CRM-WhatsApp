import { getCurrentAccount } from '@/lib/auth/account';
import { DocumentError, revision } from '@/lib/documents/validation';
import { contentHash, renderPdf } from '@/lib/documents/pdf';
import {
  documentError,
  downloadPrivate,
  getDocument,
  original,
} from '@/lib/documents/server';
import type { DocumentSnapshot } from '@/lib/documents/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCurrentAccount();
    const doc = await getDocument(ctx, (await params).id);
    const search = new URL(request.url).searchParams;
    const requested = search.get('revision');
    const requestedRevision =
      requested === null ? doc.revision : revision(Number(requested));
    let snapshot = doc.snapshot;
    let signed = doc.status === 'signed';
    if (requestedRevision !== doc.revision) {
      const { data, error } = await ctx.supabase
        .from('document_versions')
        .select('snapshot,status')
        .eq('document_id', doc.id)
        .eq('account_id', ctx.accountId)
        .eq('revision', requestedRevision)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new DocumentError('Versão não encontrada.', 404);
      snapshot = data.snapshot as DocumentSnapshot;
      signed = data.status === 'signed';
    }
    const bytes =
      signed && doc.signed_path
        ? await downloadPrivate(
            ctx.accountId,
            doc.signed_path,
            doc.signed_sha256
          )
        : await renderPdf(snapshot, await original(doc));
    const filename = `${snapshot.title.replace(/[^a-zA-Z0-9_-]/g, '_')}-v${requestedRevision}.pdf`;
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${search.get('download') === '1' ? 'attachment' : 'inline'}; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Document-Revision': String(requestedRevision),
        'X-Document-Content-Hash': contentHash(snapshot, doc.source_sha256),
      },
    });
  } catch (error) {
    return documentError(error);
  }
}
