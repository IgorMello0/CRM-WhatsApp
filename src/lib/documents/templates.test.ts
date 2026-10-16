import { describe, expect, it } from 'vitest';
import type { DocumentSnapshot } from './types';
import {
  assertReadyDocument,
  copyAsTemplate,
  instantiateTemplate,
  templateVariables,
} from './templates';

const template: DocumentSnapshot = {
  title: 'Contrato de {{nome_cliente}}',
  kind: 'text',
  content:
    'Cliente: {{ nome_cliente }}\nCPF: {{cpf}}\nEndereço: {{endereco}}\nCliente novamente: {{nome_cliente}}',
  fontSize: 12,
  fields: {},
  annotations: [],
  isTemplate: true,
};
const input = {
  title: 'Contrato de {{nome_cliente}}',
  clientName: 'Ana',
  clientEmail: 'ana@example.invalid',
  values: {
    nome_cliente: 'Ana',
    cpf: '000.000.000-00',
    endereco: 'Rua de Teste, 1',
  },
};
describe('reusable document templates', () => {
  it('generates independent customer copies, replacing repeated tokens without changing the template', () => {
    const before = JSON.stringify(template);
    expect(templateVariables(template)).toEqual([
      'nome_cliente',
      'cpf',
      'endereco',
    ]);
    const copy = instantiateTemplate(template, input);
    expect(copy.title).toBe('Contrato de Ana');
    expect(copy.content).toBe(
      'Cliente: Ana\nCPF: 000.000.000-00\nEndereço: Rua de Teste, 1\nCliente novamente: Ana'
    );
    expect(copy.isTemplate).toBe(false);
    expect(copy.signing).toMatchObject({
      clientName: 'Ana',
      clientPlacement: null,
      ownerPlacement: null,
      ownerStamp: null,
    });
    expect(JSON.stringify(template)).toBe(before);
    expect(() => assertReadyDocument(copy)).not.toThrow();
  });
  it('does not carry signer identity or authorization into templates', () => {
    const source = {
      ...template,
      isTemplate: false,
      signing: {
        clientName: 'Previous client',
        clientEmail: 'old@example.invalid',
        clientPlacement: null,
        ownerPlacement: null,
        ownerStamp: {
          version: 'v',
          userId: 'owner',
          name: 'Owner',
          email: 'owner@example.invalid',
          authorizedAt: 'date',
          strokes: [],
        },
      },
    };
    const copy = copyAsTemplate(source, 'Modelo');
    expect(copy.signing).toBeUndefined();
    expect(copy.isTemplate).toBe(true);
    expect(source.signing.clientName).toBe('Previous client');
  });
  it('rejects incomplete input, nested placeholders, invalid expanded text and signing templates', () => {
    expect(() =>
      instantiateTemplate(template, { ...input, values: {} })
    ).toThrow('Preencha');
    expect(() =>
      instantiateTemplate(template, {
        ...input,
        values: { ...input.values, cpf: '{{outro}}' },
      })
    ).toThrow('não preenchidos');
    expect(() =>
      instantiateTemplate(template, {
        ...input,
        values: { ...input.values, nome_cliente: 'A'.repeat(161) },
      })
    ).toThrow();
    expect(() => assertReadyDocument(template)).toThrow('modelo');
    expect(() =>
      assertReadyDocument({
        ...template,
        isTemplate: false,
        content: 'Campo: {{cpf-cliente}}',
      })
    ).toThrow('Preencha');
    expect(() =>
      assertReadyDocument({ ...template, isTemplate: false })
    ).toThrow('Preencha');
  });
  it('substitutes PDF text annotations and form values without altering field names or boolean values', () => {
    const pdf: DocumentSnapshot = {
      ...template,
      kind: 'pdf',
      content: '',
      fields: { Nome: '{{nome_cliente}}', Confirmacao: true },
      annotations: [
        { id: 'a', page: 1, x: 0.1, y: 0.1, size: 12, text: 'CPF: {{cpf}}' },
      ],
    };
    const copy = instantiateTemplate(pdf, input);
    expect(copy.fields).toEqual({ Nome: 'Ana', Confirmacao: true });
    expect(copy.annotations[0].text).toBe('CPF: 000.000.000-00');
    expect(pdf.fields.Nome).toBe('{{nome_cliente}}');
  });
});
