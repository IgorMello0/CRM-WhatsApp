export type PdfFieldFormat = 'cpf' | 'phone' | 'date' | 'currency';

function normalizedName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function pdfFieldFormat(name: string): PdfFieldFormat | undefined {
  const normalized = normalizedName(name);

  if (/\bcpf\b/.test(normalized)) return 'cpf';
  if (/telefone|celular|whatsapp|phone|\bfone\b/.test(normalized)) {
    return 'phone';
  }
  if (/nascimento|birth|\bdata\b|\bdate\b/.test(normalized)) return 'date';
  if (
    /valor|preco|price|amount|sinal|reserva|deposito|total/.test(normalized)
  ) {
    return 'currency';
  }

  return undefined;
}

function digits(value: string, limit: number) {
  return value.replace(/\D/g, '').slice(0, limit);
}

function formatCpf(value: string) {
  const valueDigits = digits(value, 11);
  return valueDigits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

function formatPhone(value: string) {
  const valueDigits = digits(value, 11);
  if (valueDigits.length <= 2) {
    return valueDigits ? `(${valueDigits}` : '';
  }

  const areaCode = valueDigits.slice(0, 2);
  const number = valueDigits.slice(2);
  const prefixLength = number.length > 8 ? 5 : 4;
  const prefix = number.slice(0, prefixLength);
  const suffix = number.slice(prefixLength);
  return `(${areaCode}) ${prefix}${suffix ? `-${suffix}` : ''}`;
}

function formatDate(value: string) {
  const valueDigits = digits(value, 8);
  if (valueDigits.length <= 2) return valueDigits;
  if (valueDigits.length <= 4) {
    return `${valueDigits.slice(0, 2)}/${valueDigits.slice(2)}`;
  }
  return `${valueDigits.slice(0, 2)}/${valueDigits.slice(2, 4)}/${valueDigits.slice(4)}`;
}

function groupThousands(value: string) {
  const normalized = value.replace(/^0+(?=\d)/, '') || '0';
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatCurrency(value: string, complete: boolean) {
  const withoutPrefix = value.replace(/r\$/gi, '').trim();
  if (!withoutPrefix) return '';

  const commaIndex = withoutPrefix.lastIndexOf(',');
  const hasDecimals = commaIndex >= 0;
  const integerSource = hasDecimals
    ? withoutPrefix.slice(0, commaIndex)
    : withoutPrefix;
  const integerDigits = integerSource.replace(/\D/g, '').slice(0, 15);
  if (!integerDigits && !hasDecimals) return '';

  const decimalDigits = hasDecimals
    ? withoutPrefix
        .slice(commaIndex + 1)
        .replace(/\D/g, '')
        .slice(0, 2)
    : '';
  const integer = groupThousands(integerDigits || '0');
  const decimals = complete
    ? `,${decimalDigits.padEnd(2, '0')}`
    : hasDecimals
      ? `,${decimalDigits}`
      : '';
  return `R$ ${integer}${decimals}`;
}

export function formatPdfFieldValue(
  name: string,
  value: string,
  complete = false
) {
  switch (pdfFieldFormat(name)) {
    case 'cpf':
      return formatCpf(value);
    case 'phone':
      return formatPhone(value);
    case 'date':
      return formatDate(value);
    case 'currency':
      return formatCurrency(value, complete);
    default:
      return value;
  }
}

export function formatStoredPdfFields(
  fields: Record<string, string | boolean>
) {
  return Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [
      name,
      typeof value === 'string'
        ? formatPdfFieldValue(name, value, true)
        : value,
    ])
  );
}

export function pdfFieldInputProps(name: string) {
  switch (pdfFieldFormat(name)) {
    case 'cpf':
      return { inputMode: 'numeric' as const, maxLength: 14 };
    case 'phone':
      return { inputMode: 'tel' as const, maxLength: 15 };
    case 'date':
      return {
        inputMode: 'numeric' as const,
        maxLength: 10,
        placeholder: 'dd/mm/aaaa',
      };
    case 'currency':
      return {
        inputMode: 'decimal' as const,
        maxLength: 24,
        placeholder: 'R$ 0,00',
      };
    default:
      return { maxLength: 5000 };
  }
}
