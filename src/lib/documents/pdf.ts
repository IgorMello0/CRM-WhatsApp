import { createHash } from 'node:crypto';
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFSignature,
  StandardFonts,
  rgb,
  type PDFFont,
} from 'pdf-lib';
import type {
  DocumentSnapshot,
  DocumentSignature,
  PdfFieldInfo,
} from './types';
import { DocumentError } from './validation';
import { embedDocumentFonts } from './fonts';
import { PAPER, textDocumentLayout } from './layout';
import { visiblePointToPdf } from './placement';

export const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
export function contentHash(
  snapshot: DocumentSnapshot,
  sourceHash: string | null
) {
  return sha256(
    JSON.stringify({
      snapshot: {
        ...snapshot,
        fields: Object.fromEntries(
          Object.entries(snapshot.fields).sort(([a], [b]) => a.localeCompare(b))
        ),
      },
      sourceHash,
    })
  );
}

async function loadPdf(bytes: Uint8Array) {
  try {
    if (Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-')
      throw new Error('header');
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (pdf.getPageCount() < 1 || pdf.getPageCount() > 100)
      throw new DocumentError('Use PDFs com 1 a 100 páginas.');
    const form = pdf.getForm();
    const knownWidgets = new Set(
      form
        .getFields()
        .flatMap((field) =>
          field.acroField.getWidgets().map((widget) => widget.dict)
        )
    );
    if (form.getFields().length > 200)
      throw new DocumentError('Use PDFs com até 200 campos.');
    for (const page of pdf.getPages()) {
      const annotations = page.node.Annots();
      for (const entry of annotations?.asArray() ?? []) {
        const annotation = pdf.context.lookup(entry);
        if (
          annotation instanceof PDFDict &&
          annotation.get(PDFName.of('Subtype')) === PDFName.of('Widget') &&
          !knownWidgets.has(annotation)
        ) {
          throw new DocumentError(
            'O PDF contém campos desconectados do formulário. Exporte uma cópia corrigida antes de importar.'
          );
        }
      }
    }
    if (form.hasXFA())
      throw new DocumentError('Formulários XFA não são suportados.');
    if (form.getFields().some((field) => field instanceof PDFSignature))
      throw new DocumentError(
        'Este PDF contém campos de assinatura digital. Importe uma cópia original sem assinatura.'
      );
    return pdf;
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError(
      'Não foi possível abrir o PDF. Verifique se o arquivo está íntegro e sem senha.'
    );
  }
}

export async function inspectPdf(
  bytes: Uint8Array
): Promise<{ pages: number; fields: PdfFieldInfo[] }> {
  const pdf = await loadPdf(bytes);
  const fields: PdfFieldInfo[] = [];
  for (const field of pdf.getForm().getFields()) {
    if (field.isReadOnly()) continue;
    const name = field.getName();
    if (field instanceof PDFTextField)
      fields.push({ name, type: 'text', value: field.getText() ?? '' });
    if (field instanceof PDFCheckBox)
      fields.push({ name, type: 'checkbox', value: field.isChecked() });
    if (field instanceof PDFDropdown || field instanceof PDFRadioGroup)
      fields.push({
        name,
        type: 'choice',
        value:
          (field instanceof PDFDropdown
            ? field.getSelected()[0]
            : field.getSelected()) ?? '',
        options: field.getOptions(),
      });
  }
  return { pages: pdf.getPageCount(), fields };
}

// Wrap long unbroken strings as well as ordinary paragraphs. Never silently
// replace unsupported characters in a document the user is about to sign.
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  width: number
): string[] {
  const lines: string[] = [];
  try {
    for (const paragraph of text.replace(/\t/g, '    ').split('\n')) {
      let line = '';
      for (const char of paragraph) {
        if (font.widthOfTextAtSize(line + char, size) > width && line) {
          const space = line.lastIndexOf(' ');
          if (space > line.length / 2) {
            lines.push(line.slice(0, space));
            line = line.slice(space + 1);
          } else {
            lines.push(line);
            line = '';
          }
        }
        line += char;
      }
      lines.push(line);
    }
  } catch {
    throw new DocumentError(
      'O texto contém caracteres não suportados pela fonte do PDF. Remova emojis ou caracteres fora do alfabeto latino.'
    );
  }
  return lines;
}

export async function renderPdf(
  snapshot: DocumentSnapshot,
  source?: Uint8Array,
  signature?: DocumentSignature,
  documentId?: string,
  options: { flattenForms?: boolean } = {}
): Promise<Uint8Array> {
  const pdf =
    snapshot.kind === 'pdf' && source
      ? await loadPdf(source)
      : await PDFDocument.create();
  const [font, bold] =
    snapshot.layoutVersion === 2
      ? await embedDocumentFonts(pdf)
      : await Promise.all([
          pdf.embedFont(StandardFonts.Helvetica),
          pdf.embedFont(StandardFonts.HelveticaBold),
        ]);
  if (snapshot.kind === 'pdf' && !source)
    throw new DocumentError('Original do PDF indisponível.', 500);
  if (snapshot.kind === 'text' && snapshot.layoutVersion === 2) {
    const supported = new Set(font.getCharacterSet());
    if (
      [...(snapshot.title + snapshot.content)].some(
        (char) =>
          !['\n', '\r', '\t'].includes(char) &&
          !supported.has(char.codePointAt(0)!)
      )
    )
      throw new DocumentError(
        'O texto contém caracteres não suportados. Remova emojis ou caracteres fora do alfabeto latino.'
      );
    const layout = textDocumentLayout(
      snapshot.title,
      snapshot.content,
      snapshot.fontSize,
      font,
      bold
    );
    if (layout.pages.length > 100)
      throw new DocumentError('O documento excede 100 páginas.');
    layout.pages.forEach((lines, index) => {
      const page = pdf.addPage([PAPER.width, PAPER.height]);
      if (index === 0)
        layout.titleLines.forEach((line, i) =>
          page.drawText(line, {
            x: PAPER.margin,
            y: PAPER.firstBaseline - i * PAPER.titleLineHeight,
            size: PAPER.titleSize,
            font: bold,
          })
        );
      lines.forEach((line) =>
        page.drawText(line.text, {
          x: PAPER.margin,
          y: line.y,
          size: snapshot.fontSize,
          font,
          color: rgb(0.12, 0.15, 0.2),
        })
      );
    });
  } else if (snapshot.kind === 'text') {
    let page = pdf.addPage([595.28, 841.89]);
    let y = 785;
    for (const line of wrapText(snapshot.title, bold, 20, 483)) {
      page.drawText(line, { x: 56, y, size: 20, font: bold });
      y -= 26;
    }
    y -= 20;
    for (const line of wrapText(
      snapshot.content,
      font,
      snapshot.fontSize,
      483
    )) {
      if (y < 56) {
        page = pdf.addPage([595.28, 841.89]);
        y = 785;
      }
      if (pdf.getPageCount() > 100)
        throw new DocumentError('O documento excede 100 páginas.');
      page.drawText(line, {
        x: 56,
        y,
        size: snapshot.fontSize,
        font,
        color: rgb(0.12, 0.15, 0.2),
      });
      y -= snapshot.fontSize * 1.5;
    }
  } else {
    const form = pdf.getForm();
    for (const [name, value] of Object.entries(snapshot.fields)) {
      const field = form.getFieldMaybe(name);
      if (!field || field.isReadOnly())
        throw new DocumentError(`Campo indisponível: ${name}`);
      try {
        if (field instanceof PDFTextField && typeof value === 'string') {
          wrapText(value, font, 12, 500);
          field.setText(value);
        } else if (field instanceof PDFCheckBox && typeof value === 'boolean') {
          if (value) field.check();
          else field.uncheck();
        } else if (
          (field instanceof PDFDropdown || field instanceof PDFRadioGroup) &&
          typeof value === 'string'
        ) {
          if (!value) field.clear();
          else if (field.getOptions().includes(value)) field.select(value);
          else throw new Error('option');
        } else throw new Error('type');
      } catch (error) {
        if (error instanceof DocumentError) throw error;
        throw new DocumentError(
          `Valor inválido ou muito longo para o campo: ${name}`
        );
      }
    }
    try {
      form.updateFieldAppearances(font);
    } catch {
      throw new DocumentError(
        'Não foi possível atualizar os campos deste PDF. Verifique os caracteres e o formato do formulário.'
      );
    }
    for (const annotation of snapshot.annotations) {
      const page = pdf.getPages()[annotation.page - 1];
      if (!page) throw new DocumentError('Página de anotação inexistente.');
      // Match PDF.js's visible viewport, including cropped pages with a
      // nonzero origin. Pointer coordinates are unrotated by PDF.js first.
      const media = page.getMediaBox();
      const crop = page.getCropBox();
      const left = Math.max(media.x, crop.x);
      const bottom = Math.max(media.y, crop.y);
      const right = Math.min(media.x + media.width, crop.x + crop.width);
      const top = Math.min(media.y + media.height, crop.y + crop.height);
      const x = left + annotation.x * (right - left);
      const y = bottom + (1 - annotation.y) * (top - bottom) - annotation.size;
      const lines = wrapText(
        annotation.text,
        font,
        annotation.size,
        right - x - 8
      );
      if (y - (lines.length - 1) * annotation.size * 1.3 < bottom + 8)
        throw new DocumentError(
          `O texto na página ${annotation.page} ultrapassa o rodapé. Mova-o para cima.`
        );
      lines.forEach((line, i) =>
        page.drawText(line, {
          x,
          y: y - i * annotation.size * 1.3,
          size: annotation.size,
          font,
        })
      );
    }
    // Signed copies and transient browser previews are static. The private
    // original and saved draft history remain editable.
    if (signature || options.flattenForms) {
      const widgets = new Set<string>();
      for (const page of pdf.getPages())
        for (const entry of page.node.Annots()?.asArray() ?? []) {
          const annotation = pdf.context.lookup(entry);
          if (
            annotation instanceof PDFDict &&
            annotation.get(PDFName.of('Subtype')) === PDFName.of('Widget')
          )
            widgets.add(entry.toString());
        }
      form.flatten();
      // pdf-lib 1.17 can leave widget references in Annots after deleting
      // the widget objects. Remove those references, keeping other annotations.
      for (const page of pdf.getPages()) {
        const annotations = page.node.Annots();
        if (annotations)
          for (let i = annotations.size() - 1; i >= 0; i--) {
            if (widgets.has(annotations.get(i).toString()))
              annotations.remove(i);
          }
      }
      pdf.catalog.delete(PDFName.of('AcroForm'));
    }
  }
  for (const role of ['client', 'owner'] as const) {
    const placement = snapshot.signing?.[`${role}Placement`];
    if (!placement) continue;
    const page = pdf.getPages()[placement.page - 1];
    if (!page)
      throw new DocumentError(
        'Página da assinatura inexistente. Reposicione a assinatura.'
      );
    const strokes =
      role === 'owner'
        ? snapshot.signing?.ownerStamp?.strokes
        : signature?.mode === 'in_person'
          ? signature.strokes
          : undefined;
    if (!strokes) continue;
    const media = page.getMediaBox(),
      crop = page.getCropBox();
    const x = Math.max(media.x, crop.x),
      y = Math.max(media.y, crop.y);
    const box = {
      x,
      y,
      width: Math.min(media.x + media.width, crop.x + crop.width) - x,
      height: Math.min(media.y + media.height, crop.y + crop.height) - y,
    };
    const point = (p: { x: number; y: number }) =>
      visiblePointToPdf(
        placement.x + p.x * placement.width,
        placement.y + p.y * placement.height,
        box,
        page.getRotation().angle
      );
    for (const stroke of strokes)
      for (let i = 1; i < stroke.length; i++)
        page.drawLine({
          start: point(stroke[i - 1]),
          end: point(stroke[i]),
          thickness: 1.2,
          color: rgb(0.1, 0.15, 0.25),
        });
  }
  if (signature) {
    const page = pdf.addPage([595.28, 841.89]);
    page.drawText('Registro de assinatura eletrônica', {
      x: 48,
      y: 780,
      size: 20,
      font: bold,
    });
    let y = 742;
    const details = [
      snapshot.title,
      `Documento: ${documentId}`,
      `Versão assinada: ${signature.revision}`,
      `${signature.mode === 'in_person' ? 'Cliente (identificação declarada)' : 'Usuário'}: ${signature.name}`,
      `E-mail: ${signature.email}`,
      signature.mode === 'in_person'
        ? `Coletado presencialmente pelo usuário: ${signature.collectedBy}`
        : `ID do usuário: ${signature.userId}`,
      `Data (UTC): ${signature.signedAt}`,
      '',
      signature.consent,
      '',
      'SHA-256 do conteúdo e referência ao original:',
      signature.contentSha256,
      ...(snapshot.signing?.ownerStamp
        ? [
            `Titular: ${snapshot.signing.ownerStamp.name}`,
            `Assinatura padrão autorizada em: ${snapshot.signing.ownerStamp.authorizedAt}`,
            `Versão da autorização: ${snapshot.signing.ownerStamp.version}`,
          ]
        : []),
    ];
    for (const detail of details)
      for (const line of wrapText(detail, font, 10, 499)) {
        page.drawText(line, { x: 48, y, size: 10, font });
        y -= 17;
      }
    const bottom = y - 140;
    page.drawRectangle({
      x: 48,
      y: bottom,
      width: 440,
      height: 125,
      borderWidth: 0.7,
      borderColor: rgb(0.75, 0.78, 0.82),
    });
    for (const stroke of signature.strokes)
      for (let i = 1; i < stroke.length; i++) {
        page.drawLine({
          start: {
            x: 58 + stroke[i - 1].x * 420,
            y: bottom + 10 + (1 - stroke[i - 1].y) * 105,
          },
          end: {
            x: 58 + stroke[i].x * 420,
            y: bottom + 10 + (1 - stroke[i].y) * 105,
          },
          thickness: 1.6,
          color: rgb(0.1, 0.15, 0.25),
        });
      }
    page.drawText(
      signature.mode === 'in_person'
        ? 'Assinatura presencial do cliente. Sem certificado digital ICP-Brasil.'
        : 'Assinatura da conta autenticada. Sem certificado digital ICP-Brasil.',
      { x: 48, y: bottom - 24, size: 9, font }
    );
  }
  pdf.setTitle(snapshot.title);
  pdf.setProducer('CRM - Documentos');
  pdf.setCreationDate(new Date('2020-01-01T00:00:00Z'));
  pdf.setModificationDate(
    new Date(signature?.signedAt ?? '2020-01-01T00:00:00Z')
  );
  return pdf.save();
}
