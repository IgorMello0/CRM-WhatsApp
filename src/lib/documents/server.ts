import { NextResponse } from 'next/server';
import { toErrorResponse, type AccountContext } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import type { CrmDocument } from './types';
import { DocumentError, validateId } from './validation';
import { sha256 } from './pdf';

export function documentError(error: unknown) {
  if (error instanceof DocumentError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  const code =
    error && typeof error === 'object' && 'code' in error ? error.code : '';
  if (code === 'P0409')
    return NextResponse.json(
      {
        error:
          'A autorização da assinatura do dono mudou. Atualize o documento.',
      },
      { status: 409 }
    );
  if (code === '42P01' || code === 'PGRST205')
    return NextResponse.json(
      {
        error:
          'O módulo Documentos precisa da migração 039_documents.sql no Supabase.',
      },
      { status: 503 }
    );
  return toErrorResponse(error);
}
export async function readJson(request: Request, limit = 500000) {
  if (Number(request.headers.get('content-length')) > limit)
    throw new DocumentError('Dados muito grandes.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DocumentError('Corpo vazio.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new DocumentError('Dados muito grandes.', 413);
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new DocumentError('JSON inválido.');
    }
  } finally {
    reader.releaseLock();
  }
}
export async function getDocument(
  ctx: AccountContext,
  id: string
): Promise<CrmDocument> {
  validateId(id);
  const { data, error } = await ctx.supabase
    .from('documents')
    .select('*')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new DocumentError('Documento não encontrado.', 404);
  return data as CrmDocument;
}
export async function downloadPrivate(
  accountId: string,
  path: string,
  expectedHash: string | null
) {
  if (!path.startsWith(`${accountId}/`) || path.includes('..'))
    throw new DocumentError('Arquivo indisponível.', 404);
  const { data, error } = await supabaseAdmin()
    .storage.from('documents')
    .download(path);
  if (error || !data)
    throw new DocumentError('Não foi possível carregar o arquivo.', 500);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!expectedHash || sha256(bytes) !== expectedHash)
    throw new DocumentError(
      'A integridade do arquivo não pôde ser confirmada.',
      409
    );
  return bytes;
}
export async function original(doc: CrmDocument) {
  return doc.source_path
    ? downloadPrivate(doc.account_id, doc.source_path, doc.source_sha256)
    : undefined;
}
export function assertDraft(doc: CrmDocument, expected: number) {
  if (doc.status !== 'draft')
    throw new DocumentError(
      'Documento assinado: esta versão não pode ser alterada.',
      409
    );
  if (doc.revision !== expected)
    throw new DocumentError(
      'Este documento mudou. Reabra-o para carregar a versão atual.',
      409
    );
}
export async function uploadPrivate(path: string, bytes: Uint8Array) {
  const { error } = await supabaseAdmin()
    .storage.from('documents')
    .upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (error)
    throw new DocumentError(
      'Não foi possível guardar o PDF. Verifique o bucket privado documents e a migração 039.',
      500
    );
}
export async function cleanup(path: string) {
  const { error } = await supabaseAdmin()
    .storage.from('documents')
    .remove([path]);
  if (error) console.error('[documents] orphan cleanup failed', error.message);
}
