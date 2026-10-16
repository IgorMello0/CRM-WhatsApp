import type { DocumentSnapshot } from './types';
import { DocumentError, object, validateSnapshot } from './validation';

// Plain text replacement only. Tokens are never evaluated as code or HTML.
const marker = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]{0,59})\s*\}\}/g;
const pendingMarker = /\{\{[^{}]*\}\}/;
function texts(snapshot: DocumentSnapshot) {
  return [
    snapshot.title,
    snapshot.content,
    ...snapshot.annotations.map((item) => item.text),
    ...Object.values(snapshot.fields).filter(
      (value): value is string => typeof value === 'string'
    ),
  ];
}
export function templateVariables(snapshot: DocumentSnapshot): string[] {
  return [
    ...new Set(
      texts(snapshot).flatMap((text) =>
        [...text.matchAll(marker)].map((match) => match[1])
      )
    ),
  ];
}
export function assertReadyDocument(snapshot: DocumentSnapshot) {
  if (snapshot.isTemplate)
    throw new DocumentError(
      'Gere um documento para o cliente antes de assinar este modelo.'
    );
  if (texts(snapshot).some((text) => pendingMarker.test(text)))
    throw new DocumentError(
      'Preencha todos os campos do modelo antes de apresentar e assinar.'
    );
  if (snapshot.kind === 'text' && !snapshot.content.trim())
    throw new DocumentError('O documento está vazio.');
}
export function copyAsTemplate(
  snapshot: DocumentSnapshot,
  title: string
): DocumentSnapshot {
  // Client identity, authorization and drawn signatures never become defaults.
  return validateSnapshot({
    ...snapshot,
    title,
    isTemplate: true,
    signing: undefined,
  });
}
export function instantiateTemplate(
  snapshot: DocumentSnapshot,
  input: unknown
): DocumentSnapshot {
  if (!snapshot.isTemplate)
    throw new DocumentError('Selecione um modelo de documento.');
  const data = object(input),
    values = object(data.values);
  const required = templateVariables(snapshot);
  if (required.length > 60)
    throw new DocumentError('Use no máximo 60 campos por modelo.');
  for (const key of required) {
    if (
      typeof values[key] !== 'string' ||
      !(values[key] as string).trim() ||
      (values[key] as string).length > 5000
    )
      throw new DocumentError(
        `Preencha o campo ${key} com até 5.000 caracteres.`
      );
  }
  const replace = (text: string) =>
    text.replace(marker, (_, key: string) => (values[key] as string).trim());
  const result = validateSnapshot({
    ...snapshot,
    isTemplate: false,
    title: data.title,
    content: replace(snapshot.content),
    annotations: snapshot.annotations.map((item) => ({
      ...item,
      text: replace(item.text),
    })),
    fields: Object.fromEntries(
      Object.entries(snapshot.fields).map(([key, value]) => [
        key,
        typeof value === 'string' ? replace(value) : value,
      ])
    ),
    signing: {
      clientName: data.clientName,
      clientEmail: data.clientEmail,
      clientPlacement: null,
      ownerPlacement: null,
      ownerStamp: null,
    },
  });
  // Title is independently editable for the copy, but supports the same tokens.
  result.title = replace(result.title);
  const validated = validateSnapshot(result);
  if (texts(validated).some((text) => pendingMarker.test(text)))
    throw new DocumentError(
      'Os dados informados ainda contêm campos de modelo não preenchidos.'
    );
  if (!validated.signing?.clientName)
    throw new DocumentError('Informe o nome do cliente.');
  return validated;
}
