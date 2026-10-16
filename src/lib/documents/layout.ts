import type { PDFFont } from 'pdf-lib';

export const PAPER = {
  width: 595.28,
  height: 841.89,
  margin: 56,
  contentWidth: 483.28,
  titleSize: 20,
  titleLineHeight: 26,
  firstBaseline: 785,
  lineSpacing: 1.5,
};

// Shared by the on-page editor and PDF export: preserve explicit line breaks,
// repeated spaces and tabs, including the alignment in legacy text documents.
export function textLines(
  text: string,
  measure: (text: string) => number,
  width: number
) {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\t/g, '    ').split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (measure(line + char) > width && line) {
        const space = line.lastIndexOf(' ');
        if (space > line.length / 2 && line[space - 1] !== ' ') {
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
  return lines;
}
export function textDocumentLayout(
  title: string,
  content: string,
  size: number,
  font: PDFFont,
  bold: PDFFont
) {
  const titleLines = textLines(
    title,
    (line) => bold.widthOfTextAtSize(line, PAPER.titleSize),
    PAPER.contentWidth
  );
  const contentLines = textLines(
    content,
    (line) => font.widthOfTextAtSize(line, size),
    PAPER.contentWidth
  );
  const bodyBaseline =
    PAPER.firstBaseline - titleLines.length * PAPER.titleLineHeight - 20;
  const pages: { text: string; y: number }[][] = [[]];
  let y = bodyBaseline;
  for (const text of contentLines) {
    if (y < PAPER.margin) {
      pages.push([]);
      y = PAPER.firstBaseline;
    }
    pages[pages.length - 1].push({ text, y });
    y -= size * PAPER.lineSpacing;
  }
  return { titleLines, pages, bodyBaseline };
}
