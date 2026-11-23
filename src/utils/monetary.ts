/**
 * Motor Monetario de Precisión Absoluta (CERO FLOAT)
 * Preservado íntegramente de Equinox-Books 6.1
 */

export function strToCents(s: string | number | null | undefined): number {
  if (s === null || s === undefined) return 0;
  let str = String(s).trim().replace(/\s/g, '').replace(',', '.');
  if (str === '') return 0;
  const neg = str.startsWith('-');
  if (neg) str = str.slice(1);
  // Remove thousand commas if user pasted e.g. 1,234.56 (only if multiple dots/commas existed before)
  const m = str.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return 0;
  const intPart = m[1];
  const frac = m[2] || '';
  let cents: number;
  if (frac.length <= 2) {
    cents = parseInt(intPart, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
  } else {
    const third = parseInt(frac[2], 10);
    cents = parseInt(intPart, 10) * 100 + parseInt(frac.slice(0, 2), 10) + (third >= 5 ? 1 : 0);
  }
  return neg ? -cents : cents;
}

export function centsToStr(c: number): string {
  const neg = c < 0;
  const abs = Math.abs(Math.round(c));
  const ent = Math.floor(abs / 100);
  const fr = String(abs % 100).padStart(2, '0');
  const s = ent.toLocaleString('en-US', { minimumFractionDigits: 0 }) + '.' + fr;
  return (neg ? '-' : '') + s;
}

export function nicConvertAmountToBs(amountCentavos: number, rate: number): number {
  const amt = BigInt(Math.trunc(Number(amountCentavos)));
  const scaledRate = BigInt(Math.round(Number(rate) * 1000000));
  const divisor = BigInt(1000000);
  const result = Number((amt * scaledRate + divisor / 2n) / divisor);
  return Math.trunc(result);
}

export function formatDateShort(isoDate: string | undefined | null): string {
  if (!isoDate || typeof isoDate !== 'string') return isoDate || '';
  const parts = isoDate.split('-');
  if (parts.length < 3) return isoDate;
  const yy = parts[0].slice(2);
  return `${parts[2]}/${parts[1]}/${yy}`;
}

export function isValidVenezuelanRIF(rif: string): boolean {
  return /^[JVGECP]-\d{8}-\d$/i.test(rif.trim());
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
