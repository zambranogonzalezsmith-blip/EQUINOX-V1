import type {
  AsientoLinea,
  MovimientoEstadoCuentaBanco,
} from '../types/accounting.js';
import { centsToStr, strToCents } from './monetary.js';

export interface BookBankMovement {
  asientoLineId: number;
  asientoNum: number;
  fecha: string;
  concepto: string;
  tercero: string;
  debitoCentavos: number;
  creditoCentavos: number;
  netoCentavos: number; // + entrada a banco (debe), - salida de banco (haber)
  matchedBankId?: string;
}

export interface BankReconciliationSummary {
  cuentaContable: string;
  periodo: string;
  saldoLibrosInicialYCierreCentavos: number;
  saldoEstadoCuentaBancoCentavos: number;
  depositosEnTransitoCentavos: number; // en libros (+), no vistos en banco
  chequesEnTransitoCentavos: number; // en libros (-), no cobrados en banco
  notasCreditoBancoNoRegCentavos: number; // en banco (+), no en libros
  notasDebitoBancoNoRegCentavos: number; // en banco (-), no en libros
  saldoLibrosAjustadoCentavos: number;
  saldoBancoConciliadoCentavos: number;
  diferenciaCentavos: number;
  conciliado: boolean;
  bookMovements: BookBankMovement[];
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeDateIso(raw: string): string | null {
  const clean = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const dmy = clean.match(/^(\d{2})[/\-](\d{2})[/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return null;
}

/**
 * Parsea un estado de cuenta bancario CSV con columnas flexibles:
 * fecha,referencia,descripcion,debito,credito  ó  fecha,referencia,descripcion,monto
 */
export function parseBankStatementCsv(
  csvText: string,
  cuentaContable: string
): { movements: MovimientoEstadoCuentaBanco[]; errors: string[] } {
  const rawLines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (rawLines.length === 0) {
    return { movements: [], errors: ['El archivo CSV está vacío.'] };
  }

  const firstLine = rawLines[0];
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const headerCells = parseCsvLine(firstLine, delimiter).map((h) => h.toLowerCase());
  const looksLikeHeader =
    headerCells.some((h) => h.includes('fecha') || h.includes('date') || h.includes('referencia'));

  const startIdx = looksLikeHeader ? 1 : 0;
  const colIndex = {
    fecha: looksLikeHeader ? headerCells.findIndex((h) => h.includes('fecha') || h.includes('date')) : 0,
    referencia: looksLikeHeader ? headerCells.findIndex((h) => h.includes('ref')) : 1,
    descripcion: looksLikeHeader
      ? headerCells.findIndex((h) => h.includes('desc') || h.includes('conc'))
      : 2,
    debito: looksLikeHeader ? headerCells.findIndex((h) => h.includes('deb') || h.includes('cargo')) : 3,
    credito: looksLikeHeader ? headerCells.findIndex((h) => h.includes('cred') || h.includes('abono')) : 4,
    monto: looksLikeHeader ? headerCells.findIndex((h) => h.includes('monto') || h.includes('imp')) : -1,
  };

  const movements: MovimientoEstadoCuentaBanco[] = [];
  const errors: string[] = [];

  for (let i = startIdx; i < rawLines.length; i++) {
    const cells = parseCsvLine(rawLines[i], delimiter);
    const fechaRaw = cells[colIndex.fecha >= 0 ? colIndex.fecha : 0] || '';
    const fecha = normalizeDateIso(fechaRaw);
    if (!fecha) {
      errors.push(`Fila ${i + 1}: fecha inválida "${fechaRaw}" (use YYYY-MM-DD o DD/MM/YYYY).`);
      continue;
    }

    const referencia = cells[colIndex.referencia >= 0 ? colIndex.referencia : 1] || `REF-${i}`;
    const descripcion = cells[colIndex.descripcion >= 0 ? colIndex.descripcion : 2] || 'Movimiento Bancario';

    let debitoCentavos = 0;
    let creditoCentavos = 0;

    if (colIndex.monto >= 0 && colIndex.debito < 0 && colIndex.credito < 0) {
      const signed = strToCents(cells[colIndex.monto]);
      if (signed >= 0) creditoCentavos = signed;
      else debitoCentavos = Math.abs(signed);
    } else {
      debitoCentavos = Math.max(0, strToCents(cells[colIndex.debito >= 0 ? colIndex.debito : 3]));
      creditoCentavos = Math.max(0, strToCents(cells[colIndex.credito >= 0 ? colIndex.credito : 4]));
    }

    if (debitoCentavos === 0 && creditoCentavos === 0) {
      continue;
    }

    movements.push({
      id: `bnk-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      fecha,
      referencia: referencia.slice(0, 48),
      descripcion: descripcion.slice(0, 140),
      cuentaContable,
      debitoCentavos,
      creditoCentavos,
    });
  }

  return { movements, errors };
}

export function extractBookBankMovements(
  diario: AsientoLinea[],
  cuentaContable: string,
  periodo: string
): { periodMovements: BookBankMovement[]; endingBookBalanceCentavos: number } {
  const periodEnd = `${periodo}-31`;
  let endingBookBalanceCentavos = 0;
  const periodMovements: BookBankMovement[] = [];

  for (const m of diario || []) {
    if (m.estado === 'ANULADO') continue;
    if (m.codigo_cuenta !== cuentaContable) continue;
    const f = m.mov_fecha || m.fecha;
    const neto = m.debito_centavos - m.credito_centavos;
    if (f <= periodEnd) {
      endingBookBalanceCentavos += neto;
    }
    if (f.startsWith(periodo)) {
      periodMovements.push({
        asientoLineId: m.id,
        asientoNum: m.asiento_num,
        fecha: f,
        concepto: m.mov_concepto || m.concepto,
        tercero: m.mov_tercero || m.tercero,
        debitoCentavos: m.debito_centavos,
        creditoCentavos: m.credito_centavos,
        netoCentavos: neto,
      });
    }
  }

  periodMovements.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { periodMovements, endingBookBalanceCentavos };
}

/**
 * Empareja automáticamente movimientos del estado de cuenta bancario contra el Libro Mayor
 * de la cuenta bancaria por monto exacto y cercanía de fecha (<= 5 días) o coincidencia en referencia.
 * Nota de signo contable:
 *   En Libros de la empresa (Activo): Débito (+), Crédito (-).
 *   En Estado de Cuenta del Banco: Crédito/Abono al cliente (+), Débito/Cargo al cliente (-).
 */
export function autoMatchBankMovements(
  bankMovs: MovimientoEstadoCuentaBanco[],
  diario: AsientoLinea[],
  cuentaContable: string,
  periodo: string
): MovimientoEstadoCuentaBanco[] {
  const { periodMovements } = extractBookBankMovements(diario, cuentaContable, periodo);
  const usedBookIds = new Set<number>(
    bankMovs
      .filter((b) => b.cuentaContable === cuentaContable && b.fecha.startsWith(periodo) && b.conciliadoConAsientoId)
      .map((b) => b.conciliadoConAsientoId as number)
  );

  return bankMovs.map((bm) => {
    if (bm.cuentaContable !== cuentaContable || !bm.fecha.startsWith(periodo)) {
      return bm;
    }
    if (bm.conciliadoConAsientoId) return bm;

    // En banco, abono/crédito (+ dinero) equivale a Débito en libros de empresa (+).
    // Cargo/débito banco (- dinero) equivale a Crédito en libros de empresa (-).
    const bankNet = bm.creditoCentavos - bm.debitoCentavos;
    const bankTime = Date.parse(bm.fecha);
    const refLower = bm.referencia.trim().toLowerCase();

    let bestMatch: BookBankMovement | null = null;
    let bestScore = -1;

    for (const book of periodMovements) {
      if (usedBookIds.has(book.asientoLineId)) continue;
      if (book.netoCentavos !== bankNet) continue;

      const diffDays = Math.abs((Date.parse(book.fecha) - bankTime) / (1000 * 60 * 60 * 24));
      if (diffDays > 7) continue;

      let score = 100 - diffDays * 10;
      if (refLower && (book.concepto.toLowerCase().includes(refLower) || book.tercero.toLowerCase().includes(refLower))) {
        score += 50;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = book;
      }
    }

    if (bestMatch) {
      usedBookIds.add(bestMatch.asientoLineId);
      return {
        ...bm,
        conciliadoConAsientoId: bestMatch.asientoLineId,
        tipoPartida: 'CONCILIADA',
      };
    }

    return {
      ...bm,
      tipoPartida: 'NO_REGISTRADA_LIBROS',
    };
  });
}

export function computeBankReconciliationSummary(params: {
  bankMovs: MovimientoEstadoCuentaBanco[];
  diario: AsientoLinea[];
  cuentaContable: string;
  periodo: string;
  saldoEstadoCuentaBancoCentavos: number;
}): BankReconciliationSummary {
  const { bankMovs, diario, cuentaContable, periodo, saldoEstadoCuentaBancoCentavos } = params;
  const { periodMovements, endingBookBalanceCentavos } = extractBookBankMovements(
    diario,
    cuentaContable,
    periodo
  );

  const periodBankMovs = (bankMovs || []).filter(
    (b) => b.cuentaContable === cuentaContable && b.fecha.startsWith(periodo)
  );
  const matchedBookMap = new Map<number, string>();
  for (const bm of periodBankMovs) {
    if (bm.conciliadoConAsientoId) {
      matchedBookMap.set(bm.conciliadoConAsientoId, bm.id);
    }
  }

  let depositosEnTransitoCentavos = 0;
  let chequesEnTransitoCentavos = 0;

  const bookMovements: BookBankMovement[] = periodMovements.map((pm) => {
    const matchedBankId = matchedBookMap.get(pm.asientoLineId);
    if (!matchedBankId) {
      if (pm.debitoCentavos > 0) depositosEnTransitoCentavos += pm.debitoCentavos;
      if (pm.creditoCentavos > 0) chequesEnTransitoCentavos += pm.creditoCentavos;
    }
    return {
      ...pm,
      matchedBankId,
    };
  });

  let notasCreditoBancoNoRegCentavos = 0;
  let notasDebitoBancoNoRegCentavos = 0;

  for (const bm of periodBankMovs) {
    if (!bm.conciliadoConAsientoId) {
      notasCreditoBancoNoRegCentavos += bm.creditoCentavos;
      notasDebitoBancoNoRegCentavos += bm.debitoCentavos;
    }
  }

  const saldoBancoConciliadoCentavos =
    saldoEstadoCuentaBancoCentavos + depositosEnTransitoCentavos - chequesEnTransitoCentavos;
  const saldoLibrosAjustadoCentavos =
    endingBookBalanceCentavos + notasCreditoBancoNoRegCentavos - notasDebitoBancoNoRegCentavos;

  const diferenciaCentavos = saldoBancoConciliadoCentavos - saldoLibrosAjustadoCentavos;

  return {
    cuentaContable,
    periodo,
    saldoLibrosInicialYCierreCentavos: endingBookBalanceCentavos,
    saldoEstadoCuentaBancoCentavos,
    depositosEnTransitoCentavos,
    chequesEnTransitoCentavos,
    notasCreditoBancoNoRegCentavos,
    notasDebitoBancoNoRegCentavos,
    saldoLibrosAjustadoCentavos,
    saldoBancoConciliadoCentavos,
    diferenciaCentavos,
    conciliado: diferenciaCentavos === 0,
    bookMovements,
  };
}

export function buildBankAdjustmentJournalLines(params: {
  bankMovement: MovimientoEstadoCuentaBanco;
  contraCuentaCodigo: string;
  nextAsientoNum: number;
  firstLineId: number;
}): AsientoLinea[] {
  const { bankMovement, contraCuentaCodigo, nextAsientoNum, firstLineId } = params;
  const isCargoBanco = bankMovement.debitoCentavos > 0;
  const amount = isCargoBanco ? bankMovement.debitoCentavos : bankMovement.creditoCentavos;
  const concepto = `Ajuste Conciliación Bancaria (${bankMovement.referencia}): ${bankMovement.descripcion}`;

  if (isCargoBanco) {
    // Cargo bancario (comisión / nota de débito): Gasto al Debe, Banco al Haber
    return [
      {
        id: firstLineId,
        asiento_num: nextAsientoNum,
        fecha: bankMovement.fecha,
        concepto,
        tercero: 'Entidad Bancaria',
        codigo_cuenta: contraCuentaCodigo,
        debito_centavos: amount,
        credito_centavos: 0,
        estado: 'ACTIVO',
        exchange_rate_bs: null,
      },
      {
        id: firstLineId + 1,
        asiento_num: nextAsientoNum,
        fecha: bankMovement.fecha,
        concepto,
        tercero: 'Entidad Bancaria',
        codigo_cuenta: bankMovement.cuentaContable,
        debito_centavos: 0,
        credito_centavos: amount,
        estado: 'ACTIVO',
        exchange_rate_bs: null,
      },
    ];
  }

  // Abono bancario (nota de crédito / depósito directo): Banco al Debe, Contrapartida al Haber
  return [
    {
      id: firstLineId,
      asiento_num: nextAsientoNum,
      fecha: bankMovement.fecha,
      concepto,
      tercero: 'Entidad Bancaria',
      codigo_cuenta: bankMovement.cuentaContable,
      debito_centavos: amount,
      credito_centavos: 0,
      estado: 'ACTIVO',
      exchange_rate_bs: null,
    },
    {
      id: firstLineId + 1,
      asiento_num: nextAsientoNum,
      fecha: bankMovement.fecha,
      concepto,
      tercero: 'Entidad Bancaria',
      codigo_cuenta: contraCuentaCodigo,
      debito_centavos: 0,
      credito_centavos: amount,
      estado: 'ACTIVO',
      exchange_rate_bs: null,
    },
  ];
}

export function generateBankReconciliationCsv(
  summary: BankReconciliationSummary,
  companyName: string
): string {
  const rows = [
    `"${companyName.replace(/"/g, '""')}","CONCILIACIÓN BANCARIA ${summary.periodo}","CUENTA ${summary.cuentaContable}"`,
    'Concepto,Monto',
    `"Saldo según Estado de Cuenta Bancario","${centsToStr(summary.saldoEstadoCuentaBancoCentavos)}"`,
    `"Más: Depósitos en Tránsito","${centsToStr(summary.depositosEnTransitoCentavos)}"`,
    `"Menos: Cheques / Cargos en Tránsito","${centsToStr(summary.chequesEnTransitoCentavos)}"`,
    `"Saldo Bancario Conciliado","${centsToStr(summary.saldoBancoConciliadoCentavos)}"`,
    `"Saldo según Libros Contables","${centsToStr(summary.saldoLibrosInicialYCierreCentavos)}"`,
    `"Más: Notas de Crédito Bancarias sin Registrar","${centsToStr(summary.notasCreditoBancoNoRegCentavos)}"`,
    `"Menos: Notas de Débito / Comisiones sin Registrar","${centsToStr(summary.notasDebitoBancoNoRegCentavos)}"`,
    `"Saldo en Libros Ajustado","${centsToStr(summary.saldoLibrosAjustadoCentavos)}"`,
    `"Diferencia Neta","${centsToStr(summary.diferenciaCentavos)}"`,
  ];
  return '\uFEFF' + rows.join('\n');
}
