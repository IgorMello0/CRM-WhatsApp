import { describe, expect, it } from 'vitest';
import {
  formatPdfFieldValue,
  formatStoredPdfFields,
  pdfFieldFormat,
  pdfFieldInputProps,
} from './field-format';

describe('PDF field formatting', () => {
  it('recognizes common field names', () => {
    expect(pdfFieldFormat('CPF')).toBe('cpf');
    expect(pdfFieldFormat('Telefone')).toBe('phone');
    expect(pdfFieldFormat('Data de nascimento')).toBe('date');
    expect(pdfFieldFormat('Valor da sessão (R$)')).toBe('currency');
    expect(pdfFieldFormat('Sinal/reserva (R$)')).toBe('currency');
    expect(pdfFieldFormat('Profissional')).toBeUndefined();
  });

  it('formats the identification fields while typing', () => {
    expect(formatPdfFieldValue('CPF', '12312312312')).toBe('123.123.123-12');
    expect(formatPdfFieldValue('Telefone', '17988287145')).toBe(
      '(17) 98828-7145'
    );
    expect(formatPdfFieldValue('Data de nascimento', '12122002')).toBe(
      '12/12/2002'
    );
    expect(formatPdfFieldValue('data_atendimento', '17102026')).toBe(
      '17/10/2026'
    );
  });

  it('formats currency and completes cents when leaving the field', () => {
    expect(formatPdfFieldValue('Valor da sessão (R$)', '2000')).toBe(
      'R$ 2.000'
    );
    expect(formatPdfFieldValue('Valor da sessão (R$)', '2000', true)).toBe(
      'R$ 2.000,00'
    );
    expect(formatPdfFieldValue('Sinal/reserva (R$)', '200,5', true)).toBe(
      'R$ 200,50'
    );
  });

  it('normalizes existing saved fields without changing free text', () => {
    expect(
      formatStoredPdfFields({
        CPF: '12312312312',
        Telefone: '17988287145',
        'Valor da sessão (R$)': '2000',
        Profissional: 'Ya',
      })
    ).toEqual({
      CPF: '123.123.123-12',
      Telefone: '(17) 98828-7145',
      'Valor da sessão (R$)': 'R$ 2.000,00',
      Profissional: 'Ya',
    });
  });

  it('provides mobile-friendly input attributes', () => {
    expect(pdfFieldInputProps('Data de nascimento')).toEqual({
      inputMode: 'numeric',
      maxLength: 10,
      placeholder: 'dd/mm/aaaa',
    });
  });
});
