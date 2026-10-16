import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { visiblePointToPdf } from './placement';
import { validatePlacement, validateSnapshot } from './validation';
import { contentHash, inspectPdf, renderPdf, sha256, wrapText } from './pdf';
import {
  SIGNING_CONSENT,
  type DocumentSignature,
  type DocumentSnapshot,
} from './types';

const text: DocumentSnapshot = {
  title: 'Proposta de prestação de serviços',
  kind: 'text',
  content:
    'Cliente: João da Silva\n\nDescrição dos serviços\nDesenvolvimento e acompanhamento do projeto.\n\nCondições\nPrazo: 30 dias. Valor: R$ 1.500,00.\n\nDocumento fictício para teste de software, sem efeito contratual.',
  fontSize: 12,
  annotations: [],
  fields: {},
};
const signature: DocumentSignature = {
  userId: '11111111-1111-4111-8111-111111111111',
  name: 'Usuário de Teste',
  email: 'teste@example.invalid',
  signedAt: '2026-10-15T12:00:00.000Z',
  revision: 2,
  contentSha256: contentHash(text, null),
  consent: SIGNING_CONSENT,
  strokes: [
    [
      { x: 0.1, y: 0.7 },
      { x: 0.2, y: 0.2 },
      { x: 0.15, y: 0.8 },
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.5 },
      { x: 0.85, y: 0.3 },
    ],
  ],
};

async function formFixture() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  page.drawText('Formulario de teste', { x: 50, y: 760, size: 20 });
  const field = pdf.getForm().createTextField('Nome');
  field.setText('Original');
  field.addToPage(page, { x: 50, y: 680, width: 300, height: 35 });
  const checkbox = pdf.getForm().createCheckBox('Aceite');
  checkbox.addToPage(page, { x: 50, y: 620, width: 20, height: 20 });
  const choice = pdf.getForm().createDropdown('Plano');
  choice.addOptions(['Basico', 'Completo']);
  choice.addToPage(page, { x: 50, y: 570, width: 200, height: 30 });
  return pdf.save();
}
describe('document PDF output', () => {
  it('embeds the shared editor font and stamps both signatures on the content page', async () => {
    const snapshot: DocumentSnapshot = {
      ...text,
      layoutVersion: 2,
      signing: {
        clientName: 'Cliente fictício',
        clientEmail: '',
        clientPlacement: { page: 1, x: 0.55, y: 0.7, width: 0.3, height: 0.08 },
        ownerPlacement: { page: 1, x: 0.1, y: 0.7, width: 0.3, height: 0.08 },
        ownerStamp: {
          version: 'test-version',
          userId: 'test-owner',
          name: 'Titular fictício',
          email: 'owner@example.invalid',
          strokes: signature.strokes,
          authorizedAt: '2026-10-16T12:00:00Z',
        },
      },
    };
    const draft = await renderPdf(snapshot);
    expect(sha256(await renderPdf(snapshot))).toBe(sha256(draft));
    const signed = await renderPdf(
      snapshot,
      undefined,
      {
        ...signature,
        mode: 'in_person',
        userId: null,
        collectedBy: 'test-collector',
      },
      'test-only'
    );
    const result = await PDFDocument.load(signed);
    expect(result.getPageCount()).toBe(2);
    expect(result.getPages()[0].node.Contents()).toBeDefined();
    await expect(
      renderPdf({ ...snapshot, content: 'Emoji 😀' })
    ).rejects.toThrow('caracteres');
    await expect(
      renderPdf({
        ...snapshot,
        signing: {
          ...snapshot.signing!,
          clientPlacement: { ...snapshot.signing!.clientPlacement!, page: 2 },
        },
      })
    ).rejects.toThrow('Página');
    if (process.env.DOCUMENTS_VISUAL_QA_DIR) {
      await mkdir(process.env.DOCUMENTS_VISUAL_QA_DIR, { recursive: true });
      await writeFile(
        join(process.env.DOCUMENTS_VISUAL_QA_DIR, 'positioned-signatures.pdf'),
        signed
      );
    }
  });
  it('maps visible page positions correctly for cropped and rotated PDFs', () => {
    const box = { x: 20, y: 30, width: 400, height: 600 };
    expect(visiblePointToPdf(0.25, 0.75, box, 0)).toEqual({ x: 120, y: 180 });
    expect(visiblePointToPdf(0.25, 0.75, box, 90)).toEqual({ x: 320, y: 180 });
    expect(visiblePointToPdf(0.25, 0.75, box, 180)).toEqual({ x: 320, y: 480 });
    expect(visiblePointToPdf(0.25, 0.75, box, 270)).toEqual({ x: 120, y: 480 });
    expect(() =>
      validatePlacement({ page: 1, x: 0.9, y: 0, width: 0.3, height: 0.1 })
    ).toThrow('dentro');
    expect(() =>
      validatePlacement({ page: 1.5, x: 0, y: 0, width: 0.3, height: 0.1 })
    ).toThrow();
    const checked = validateSnapshot({
      ...text,
      signing: {
        clientName: 'Cliente',
        clientEmail: '',
        clientPlacement: null,
        ownerPlacement: null,
        ownerStamp: { strokes: 'forged' },
      },
    });
    expect(checked.signing?.ownerStamp).toBeNull();
  });
  it('exports Portuguese text and a signature appendix; repeated drafts are stable', async () => {
    const draft = await renderPdf(text);
    expect(sha256(await renderPdf(text))).toBe(sha256(draft));
    expect((await PDFDocument.load(draft)).getPageCount()).toBe(1);
    const signed = await renderPdf(text, undefined, signature, 'test-document');
    expect((await PDFDocument.load(signed)).getPageCount()).toBe(2);
    expect(sha256(signed)).not.toBe(sha256(draft));
    if (process.env.DOCUMENTS_VISUAL_QA_DIR) {
      await mkdir(process.env.DOCUMENTS_VISUAL_QA_DIR, { recursive: true });
      await writeFile(
        join(process.env.DOCUMENTS_VISUAL_QA_DIR, 'signed-text.pdf'),
        signed
      );
    }
  });
  it('paginates and wraps long words without losing text', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const lines = wrapText('x'.repeat(2000), font, 12, 483);
    expect(lines.join('')).toBe('x'.repeat(2000));
    expect(lines.every((line) => font.widthOfTextAtSize(line, 12) <= 483)).toBe(
      true
    );
    const bytes = await renderPdf({
      ...text,
      content: 'Linha de teste\n'.repeat(200),
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(3);
    await expect(renderPdf({ ...text, content: 'Emoji 😀' })).rejects.toThrow(
      'caracteres'
    );
  });
  it('preserves form values in drafts, flattens only the signed copy, preserves the original', async () => {
    const source = await formFixture();
    const originalHash = sha256(source);
    expect((await inspectPdf(source)).fields).toHaveLength(3);
    const snapshot: DocumentSnapshot = {
      ...text,
      kind: 'pdf',
      content: '',
      fields: { Nome: 'João da Silva', Aceite: true, Plano: 'Completo' },
      annotations: [
        {
          id: 'a',
          text: 'Observação adicionada',
          page: 1,
          x: 0.1,
          y: 0.5,
          size: 12,
        },
      ],
    };
    const draft = await PDFDocument.load(await renderPdf(snapshot, source));
    expect(draft.getForm().getTextField('Nome').getText()).toBe(
      'João da Silva'
    );
    expect(draft.getForm().getCheckBox('Aceite').isChecked()).toBe(true);
    expect(draft.getForm().getDropdown('Plano').getSelected()).toEqual([
      'Completo',
    ]);
    const signed = await renderPdf(snapshot, source, signature, 'test-pdf');
    const final = await PDFDocument.load(signed);
    expect(final.catalog.has(PDFName.of('AcroForm'))).toBe(false);
    expect(final.getPages()[0].node.Annots()?.size() ?? 0).toBe(0);
    expect(final.getForm().getFields()).toHaveLength(0);
    expect(final.getPageCount()).toBe(2);
    expect(sha256(source)).toBe(originalHash);
    expect(
      (await PDFDocument.load(source)).getForm().getTextField('Nome').getText()
    ).toBe('Original');
    if (process.env.DOCUMENTS_VISUAL_QA_DIR)
      await writeFile(
        join(process.env.DOCUMENTS_VISUAL_QA_DIR, 'signed-form.pdf'),
        signed
      );
  });
  it('rejects bad files, wrong fields, nonexistent pages, footer overflow and digital signature fields', async () => {
    await expect(inspectPdf(new Uint8Array([1, 2, 3]))).rejects.toThrow('PDF');
    const source = await formFixture();
    const snapshot: DocumentSnapshot = { ...text, kind: 'pdf', content: '' };
    await expect(
      renderPdf({ ...snapshot, fields: { missing: 'value' } }, source)
    ).rejects.toThrow('Campo');
    await expect(
      renderPdf(
        {
          ...snapshot,
          annotations: [
            { id: 'a', page: 2, x: 0.1, y: 0.1, text: 'Hello', size: 12 },
          ],
        },
        source
      )
    ).rejects.toThrow('Página');
    await expect(
      renderPdf(
        {
          ...snapshot,
          annotations: [
            {
              id: 'a',
              page: 1,
              x: 0.1,
              y: 0.95,
              text: 'Line\n'.repeat(10),
              size: 24,
            },
          ],
        },
        source
      )
    ).rejects.toThrow('rodapé');
    const signedFieldPdf = await PDFDocument.load(source);
    signedFieldPdf
      .getForm()
      .getTextField('Nome')
      .acroField.dict.set(PDFName.of('FT'), PDFName.of('Sig'));
    await expect(
      inspectPdf(await signedFieldPdf.save({ updateFieldAppearances: false }))
    ).rejects.toThrow('assinatura digital');
  });
  it('binds the content hash to edits and original bytes, independent of field ordering', () => {
    const first = { ...text, fields: { a: '1', b: '2' } };
    expect(contentHash(first, 'original')).toBe(
      contentHash({ ...text, fields: { b: '2', a: '1' } }, 'original')
    );
    expect(contentHash(first, 'other')).not.toBe(
      contentHash(first, 'original')
    );
    expect(contentHash({ ...text, content: 'changed' }, null)).not.toBe(
      contentHash(text, null)
    );
  });
});
