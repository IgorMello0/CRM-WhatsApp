import type { DocumentSnapshot, SignaturePlacement, Stroke } from './types';

export class DocumentError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DocumentError('Dados inválidos.');
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new DocumentError('Valor numérico inválido.');
  return value;
}
function string(value: unknown, max: number) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    throw new DocumentError('Texto inválido ou muito longo.');
  return value.replace(/\r\n?/g, '\n');
}
export function revision(value: unknown) {
  const result = number(value, 1, 2147483646);
  if (!Number.isInteger(result)) throw new DocumentError('Versão inválida.');
  return result;
}
export function validateId(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  )
    throw new DocumentError('Documento não encontrado.', 404);
  return value;
}
export function validateSnapshot(input: unknown): DocumentSnapshot {
  const data = object(input);
  const title = string(data.title, 160).trim();
  if (!title || title.includes('\n'))
    throw new DocumentError(
      'Informe um título de até 160 caracteres em uma linha.'
    );
  if (data.kind !== 'text' && data.kind !== 'pdf')
    throw new DocumentError('Tipo de documento inválido.');
  const content = string(data.content, 100000);
  const fontSize = number(data.fontSize, 9, 24);
  if (!Array.isArray(data.annotations) || data.annotations.length > 100)
    throw new DocumentError('Limite de 100 textos por PDF.');
  const annotations = data.annotations.map((item) => {
    const annotation = object(item);
    const page = number(annotation.page, 1, 100);
    if (!Number.isInteger(page)) throw new DocumentError('Página inválida.');
    return {
      id: string(annotation.id, 80),
      page,
      x: number(annotation.x, 0, 0.95),
      y: number(annotation.y, 0, 0.95),
      text: string(annotation.text, 2000),
      size: number(annotation.size, 8, 36),
    };
  });
  const fields: Record<string, string | boolean> = Object.create(null);
  const entries = Object.entries(object(data.fields));
  if (entries.length > 200) throw new DocumentError('Limite de 200 campos.');
  for (const [key, value] of entries) {
    if (
      key.length > 300 ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    )
      throw new DocumentError('Campo inválido.');
    fields[key] = typeof value === 'boolean' ? value : string(value, 5000);
  }
  if (data.kind === 'text' && (annotations.length || entries.length))
    throw new DocumentError('Campos de PDF não são permitidos em textos.');
  if (data.kind === 'pdf' && content)
    throw new DocumentError('Use os campos e textos do PDF.');
  const result: DocumentSnapshot = {
    title,
    kind: data.kind,
    content,
    fontSize,
    annotations,
    fields,
  };
  if (data.layoutVersion !== undefined) {
    if (data.layoutVersion !== 2) throw new DocumentError('Layout inválido.');
    result.layoutVersion = 2;
  }
  if (data.isTemplate !== undefined) {
    if (typeof data.isTemplate !== 'boolean')
      throw new DocumentError('Tipo de modelo inválido.');
    result.isTemplate = data.isTemplate;
  }
  if (data.signing !== undefined) {
    const signing = object(data.signing);
    const clientName = string(signing.clientName, 160).trim();
    const clientEmail = string(signing.clientEmail, 254).trim();
    if (
      clientName.includes('\n') ||
      (clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail))
    )
      throw new DocumentError('Nome ou e-mail do cliente inválido.');
    result.signing = {
      clientName,
      clientEmail,
      clientPlacement:
        signing.clientPlacement == null
          ? null
          : validatePlacement(signing.clientPlacement),
      ownerPlacement:
        signing.ownerPlacement == null
          ? null
          : validatePlacement(signing.ownerPlacement),
      // Always resolved by the server. Never trust reusable ink from a request.
      ownerStamp: null,
    };
  }
  return result;
}
export function validatePlacement(input: unknown): SignaturePlacement {
  const p = object(input);
  const page = number(p.page, 1, 100);
  const x = number(p.x, 0, 1),
    y = number(p.y, 0, 1);
  const width = number(p.width, 0.08, 0.8),
    height = number(p.height, 0.025, 0.4);
  if (!Number.isInteger(page) || x + width > 1.000001 || y + height > 1.000001)
    throw new DocumentError('A assinatura deve ficar dentro da página.');
  return { page, x, y, width, height };
}
export function validateStrokes(input: unknown): Stroke[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100)
    throw new DocumentError('Desenhe sua assinatura.');
  let count = 0;
  let distance = 0;
  const strokes = input.map((stroke) => {
    if (
      !Array.isArray(stroke) ||
      stroke.length < 2 ||
      (count += stroke.length) > 10000
    )
      throw new DocumentError('Assinatura inválida ou muito complexa.');
    const points = stroke.map((p) => {
      const point = object(p);
      return { x: number(point.x, 0, 1), y: number(point.y, 0, 1) };
    });
    for (let i = 1; i < points.length; i++)
      distance += Math.hypot(
        points[i].x - points[i - 1].x,
        points[i].y - points[i - 1].y
      );
    return points;
  });
  if (distance < 0.1)
    throw new DocumentError('Desenhe uma assinatura antes de confirmar.');
  return strokes;
}
