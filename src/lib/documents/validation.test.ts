import { describe, expect, it } from 'vitest';
import {
  revision,
  validateId,
  validateSnapshot,
  validateStrokes,
} from './validation';

const snapshot = {
  title: 'Proposta',
  kind: 'text',
  content: 'Olá',
  fontSize: 12,
  annotations: [],
  fields: {},
};
describe('document validation', () => {
  it('normalizes line endings and rejects unsupported payload types', () => {
    expect(validateSnapshot({ ...snapshot, content: 'a\r\nb' }).content).toBe(
      'a\nb'
    );
    for (const value of [
      null,
      [],
      'text',
      { ...snapshot, kind: 'html' },
      { ...snapshot, fontSize: NaN },
      { ...snapshot, title: '' },
    ])
      expect(() => validateSnapshot(value)).toThrow();
  });
  it('limits content, pages, coordinates and prototype-like field names', () => {
    expect(() =>
      validateSnapshot({ ...snapshot, content: 'a'.repeat(100001) })
    ).toThrow();
    const pdf = {
      ...snapshot,
      kind: 'pdf',
      content: '',
      annotations: [
        { id: 'a', page: 1, x: 0.1, y: 0.1, size: 12, text: 'Nome' },
      ],
    };
    expect(validateSnapshot(pdf).annotations).toHaveLength(1);
    for (const edit of [
      { x: -1 },
      { page: 1.5 },
      { page: 101 },
      { size: 100 },
      { y: Infinity },
    ])
      expect(() =>
        validateSnapshot({
          ...pdf,
          annotations: [{ ...pdf.annotations[0], ...edit }],
        })
      ).toThrow();
    expect(() =>
      validateSnapshot({ ...pdf, fields: JSON.parse('{"__proto__":"bad"}') })
    ).toThrow();
    expect(() =>
      validateSnapshot({ ...snapshot, fields: { name: 'text' } })
    ).toThrow();
  });
  it('rejects empty, single-point, out-of-bounds and oversized signatures', () => {
    for (const value of [
      [],
      [[{ x: 0.2, y: 0.2 }]],
      [
        [
          { x: -1, y: 0 },
          { x: 0.4, y: 0.4 },
        ],
      ],
      [Array(10001).fill({ x: 0.2, y: 0.2 })],
      [
        [
          { x: 0.2, y: 0.2 },
          { x: 0.201, y: 0.201 },
        ],
      ],
    ])
      expect(() => validateStrokes(value)).toThrow();
    expect(
      validateStrokes([
        [
          { x: 0.1, y: 0.2 },
          { x: 0.7, y: 0.5 },
        ],
      ])
    ).toHaveLength(1);
  });
  it('rejects malformed ids and revisions', () => {
    expect(() => validateId('../other-account')).toThrow();
    for (const value of [0, -1, 1.5, '1', NaN])
      expect(() => revision(value)).toThrow();
  });
});
