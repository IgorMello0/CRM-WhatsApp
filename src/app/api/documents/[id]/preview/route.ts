import { requireRole } from '@/lib/auth/account';
import {
  assertDraft,
  documentError,
  getDocument,
  original,
  readJson,
} from '@/lib/documents/server';
import {
  DocumentError,
  object,
  revision,
  validateSnapshot,
} from '@/lib/documents/validation';
import { renderPdf } from '@/lib/documents/pdf';
import { resolveOwnerStamp } from '@/lib/documents/owner-signature';

// A transient render. Does not create a revision or mark content as reviewed.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const doc = await getDocument(ctx, (await params).id);
    const body = object(await readJson(request, 1000000));
    assertDraft(doc, revision(body.revision));
    const snapshot = await resolveOwnerStamp(
      ctx.accountId,
      validateSnapshot(body.snapshot),
      body.snapshot
    );
    if (snapshot.kind !== doc.snapshot.kind)
      throw new DocumentError('Tipo inválido.');
    const bytes = await renderPdf(snapshot, await original(doc));
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return documentError(error);
  }
}
