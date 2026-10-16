import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument } from 'pdf-lib';

let fontBytes: Promise<[Buffer, Buffer]> | undefined;
export async function embedDocumentFonts(pdf: PDFDocument) {
  fontBytes ??= Promise.all([
    readFile(
      join(
        process.cwd(),
        'node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff'
      )
    ),
    readFile(
      join(
        process.cwd(),
        'node_modules/@fontsource/roboto/files/roboto-latin-700-normal.woff'
      )
    ),
  ]);
  const [regular, bold] = await fontBytes;
  pdf.registerFontkit(fontkit);
  return Promise.all([
    pdf.embedFont(regular, {
      subset: true,
      features: { kern: false, liga: false },
    }),
    pdf.embedFont(bold, {
      subset: true,
      features: { kern: false, liga: false },
    }),
  ]);
}
