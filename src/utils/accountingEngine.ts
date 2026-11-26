import type {
  AsientoLinea,
  CierreContable,
  CompanyDataset,
  CuentaNIC,
} from '../types/accounting.js';
import { centsToStr, strToCents } from './monetary.js';

export interface JournalDraftLineInput {
  codigo_cuenta: string;
  debitoStr?: string;
  creditoStr?: string;
  debito_centavos?: number;
  credito_centavos?: number;
  mov_fecha?: string;
  mov_tercero?: string;
  mov_concepto?: string;
}

export interface ValidatedJournalLine {
  codigo_cuenta: string;
  debito_centavos: number;
  credito_centavos: number;
  mov_fecha?: string;
  mov_tercero?: string;
  mov_concepto?: string;
}

export interface JournalValidationResult {
  ok: boolean;
  error?: string;
  totalDebitoCentavos: number;
  totalCreditoCentavos: number;
  diffCentavos: number;
  validatedLines: ValidatedJournalLine[];
}

export interface JournalAuditIssue {
  asientoNum: number;
  severity: 'ERROR' | 'WARN';
  message: string;
}

export interface JournalIntegrityAuditResult {
  isHealthy: boolean;
  totalActiveLines: number;
  balancedAsientosCount: number;
  unbalancedAsientos: Array<{ asientoNum: number; debCentavos: number; credCentavos: number; diffCentavos: number }>;
  orphanLinesCount: number;
  dualSidedLinesCount: number;
  negativeLinesCount: number;
  activoCentavos: number;
  pasivoCentavos: number;
  patrimonioCentavos: number;
  resultadoCentavos: number;
  equationDiffCentavos: number;
  issues: JournalAuditIssue[];
}

export function validateJournalEntryLines(
  lines: JournalDraftLineInput[],
  catalogo: CuentaNIC[]
): JournalValidationResult {
  const catalogCodes = new Set(catalogo.map((c) => c.codigo));
  const validatedLines: ValidatedJournalLine[] = [];
  let totalDeb = 0;
  let totalCred = 0;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const deb =
      typeof l.debito_centavos === 'number'
        ? Math.trunc(l.debito_centavos)
        : strToCents(l.debitoStr || '');
    const cred =
      typeof l.credito_centavos === 'number'
        ? Math.trunc(l.credito_centavos)
        : strToCents(l.creditoStr || '');

    const hasAccount = Boolean(l.codigo_cuenta && l.codigo_cuenta.trim() !== '');
    if (!hasAccount && deb === 0 && cred === 0) {
      continue;
    }
    if (!hasAccount) {
      return {
        ok: false,
        error: `Línea ${i + 1}: debe seleccionar una cuenta contable válida del catálogo.`,
        totalDebitoCentavos: totalDeb,
        totalCreditoCentavos: totalCred,
        diffCentavos: totalDeb - totalCred,
        validatedLines: [],
      };
    }
    if (!catalogCodes.has(l.codigo_cuenta.trim())) {
      return {
        ok: false,
        error: `Línea ${i + 1}: la cuenta "${l.codigo_cuenta}" no existe en el catálogo contable de esta empresa.`,
        totalDebitoCentavos: totalDeb,
        totalCreditoCentavos: totalCred,
        diffCentavos: totalDeb - totalCred,
        validatedLines: [],
      };
    }
    if (deb < 0 || cred < 0) {
      return {
        ok: false,
        error: `Línea ${i + 1} (${l.codigo_cuenta}): no se permiten montos negativos en el Libro Diario.`,
        totalDebitoCentavos: totalDeb,
        totalCreditoCentavos: totalCred,
        diffCentavos: totalDeb - totalCred,
        validatedLines: [],
      };
    }
    if (deb > 0 && cred > 0) {
      return {
        ok: false,
        error: `Línea ${i + 1} (${l.codigo_cuenta}): una misma línea no puede llevar Débito y Crédito simultáneamente.`,
        totalDebitoCentavos: totalDeb,
        totalCreditoCentavos: totalCred,
        diffCentavos: totalDeb - totalCred,
        validatedLines: [],
      };
    }
    if (deb === 0 && cred === 0) {
      continue;
    }

    totalDeb += deb;
    totalCred += cred;
    validatedLines.push({
      codigo_cuenta: l.codigo_cuenta.trim(),
      debito_centavos: deb,
      credito_centavos: cred,
      mov_fecha: l.mov_fecha,
      mov_tercero: l.mov_tercero,
      mov_concepto: l.mov_concepto,
    });
  }

  if (validatedLines.length < 2) {
    return {
      ok: false,
      error: 'La partida doble exige al menos 2 líneas con movimientos válidos (Débito y Crédito).',
      totalDebitoCentavos: totalDeb,
      totalCreditoCentavos: totalCred,
      diffCentavos: totalDeb - totalCred,
      validatedLines: [],
    };
  }

  if (totalDeb <= 0) {
    return {
      ok: false,
      error: 'El asiento contable debe tener un total mayor que cero.',
      totalDebitoCentavos: totalDeb,
      totalCreditoCentavos: totalCred,
      diffCentavos: totalDeb - totalCred,
      validatedLines: [],
    };
  }

  if (totalDeb !== totalCred) {
    return {
      ok: false,
      error: `Asiento descuadrado: Débitos (${centsToStr(totalDeb)}) != Créditos (${centsToStr(totalCred)}). Diferencia: ${centsToStr(Math.abs(totalDeb - totalCred))}.`,
      totalDebitoCentavos: totalDeb,
      totalCreditoCentavos: totalCred,
      diffCentavos: totalDeb - totalCred,
      validatedLines: [],
    };
  }

  return {
    ok: true,
    totalDebitoCentavos: totalDeb,
    totalCreditoCentavos: totalCred,
    diffCentavos: 0,
    validatedLines,
  };
}

export function auditJournalIntegrity(dataset: CompanyDataset): JournalIntegrityAuditResult {
  const catalogByCode = new Map<string, CuentaNIC>();
  for (const c of dataset.catalogo || []) {
    catalogByCode.set(c.codigo, c);
  }

  const activeLines = (dataset.diario || []).filter((l) => l.estado !== 'ANULADO');
  const groups = new Map<number, { deb: number; cred: number }>();
  const issues: JournalAuditIssue[] = [];

  let orphanLinesCount = 0;
  let dualSidedLinesCount = 0;
  let negativeLinesCount = 0;

  let activoCentavos = 0;
  let pasivoCentavos = 0;
  let patrimonioCentavos = 0;
  let ingresosCentavos = 0;
  let costosGastosCentavos = 0;

  for (const line of activeLines) {
    const deb = Math.trunc(Number(line.debito_centavos || 0));
    const cred = Math.trunc(Number(line.credito_centavos || 0));

    const prev = groups.get(line.asiento_num) || { deb: 0, cred: 0 };
    prev.deb += deb;
    prev.cred += cred;
    groups.set(line.asiento_num, prev);

    if (deb < 0 || cred < 0) {
      negativeLinesCount++;
      issues.push({
        asientoNum: line.asiento_num,
        severity: 'ERROR',
        message: `Asiento #${line.asiento_num}: línea ID ${line.id} posee importe negativo.`,
      });
    }
    if (deb > 0 && cred > 0) {
      dualSidedLinesCount++;
      issues.push({
        asientoNum: line.asiento_num,
        severity: 'ERROR',
        message: `Asiento #${line.asiento_num}: cuenta ${line.codigo_cuenta} registra Débito y Crédito en la misma línea.`,
      });
    }

    const cta = catalogByCode.get(line.codigo_cuenta);
    if (!cta) {
      orphanLinesCount++;
      issues.push({
        asientoNum: line.asiento_num,
        severity: 'ERROR',
        message: `Asiento #${line.asiento_num}: código de cuenta "${line.codigo_cuenta}" no existe en el catálogo NIC.`,
      });
      continue;
    }

    if (cta.tipo_cuenta === 'Activo') {
      activoCentavos += deb - cred;
    } else if (cta.tipo_cuenta === 'Pasivo') {
      pasivoCentavos += cred - deb;
    } else if (cta.tipo_cuenta === 'Patrimonio') {
      patrimonioCentavos += cred - deb;
    } else if (cta.tipo_cuenta === 'Ingreso') {
      ingresosCentavos += cred - deb;
    } else {
      costosGastosCentavos += deb - cred;
    }
  }

  const unbalancedAsientos: JournalIntegrityAuditResult['unbalancedAsientos'] = [];
  let balancedAsientosCount = 0;
  for (const [asientoNum, sums] of groups.entries()) {
    const diff = sums.deb - sums.cred;
    if (diff !== 0) {
      unbalancedAsientos.push({
        asientoNum,
        debCentavos: sums.deb,
        credCentavos: sums.cred,
        diffCentavos: diff,
      });
      issues.push({
        asientoNum,
        severity: 'ERROR',
        message: `Asiento #${asientoNum} descuadrado por ${centsToStr(Math.abs(diff))}.`,
      });
    } else {
      balancedAsientosCount++;
    }
  }

  const resultadoCentavos = ingresosCentavos - costosGastosCentavos;
  const equationDiffCentavos = activoCentavos - (pasivoCentavos + patrimonioCentavos + resultadoCentavos);

  if (equationDiffCentavos !== 0) {
    issues.push({
      asientoNum: 0,
      severity: 'ERROR',
      message: `Descuadre en Ecuación Patrimonial (Activo vs Pasivo+Patrimonio+Resultado): ${centsToStr(equationDiffCentavos)}.`,
    });
  }

  const isHealthy =
    unbalancedAsientos.length === 0 &&
    orphanLinesCount === 0 &&
    dualSidedLinesCount === 0 &&
    negativeLinesCount === 0 &&
    equationDiffCentavos === 0;

  return {
    isHealthy,
    totalActiveLines: activeLines.length,
    balancedAsientosCount,
    unbalancedAsientos,
    orphanLinesCount,
    dualSidedLinesCount,
    negativeLinesCount,
    activoCentavos,
    pasivoCentavos,
    patrimonioCentavos,
    resultadoCentavos,
    equationDiffCentavos,
    issues,
  };
}

/**
 * Calcula el último día del mes en UTC para evitar desplazamientos de zona horaria (ej. UTC-4 Venezuela).
 */
export function getLastDayOfMonthISO(year: number, month1to12: number): string {
  const safeMonth = Math.min(12, Math.max(1, Math.trunc(month1to12)));
  return new Date(Date.UTC(Math.trunc(year), safeMonth, 0)).toISOString().slice(0, 10);
}

export interface BuildClosingResult {
  ok: boolean;
  error?: string;
  fechaCierre: string;
  utilidadNetaCentavos: number;
  reservaLegalCentavos: number;
  resultadoAcumuladoCentavos: number;
  asientoNum: number;
  lines: AsientoLinea[];
  cierre: CierreContable;
}

export function buildClosingEntry(params: {
  dataset: CompanyDataset;
  tipo: 'MENSUAL' | 'ANUAL';
  periodo: string; // YYYY-MM or YYYY
  nextAsientoNum: number;
  firstLineId: number;
}): BuildClosingResult {
  const { dataset, tipo, periodo, nextAsientoNum, firstLineId } = params;

  const isDuplicate = (dataset.cierres || []).some(
    (c) => c.estado === 'ACTIVO' && c.tipo === tipo && c.periodo === periodo
  );
  if (isDuplicate) {
    return {
      ok: false,
      error: `Ya existe un cierre ${tipo} ACTIVO para el período ${periodo}. Anule o reverse el cierre existente antes de regenerarlo.`,
      fechaCierre: '',
      utilidadNetaCentavos: 0,
      reservaLegalCentavos: 0,
      resultadoAcumuladoCentavos: 0,
      asientoNum: 0,
      lines: [],
      cierre: {} as CierreContable,
    };
  }

  let dateFrom = '';
  let dateTo = '';
  if (tipo === 'MENSUAL') {
    const match = periodo.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return {
        ok: false,
        error: 'Formato de período mensual inválido. Use YYYY-MM.',
        fechaCierre: '',
        utilidadNetaCentavos: 0,
        reservaLegalCentavos: 0,
        resultadoAcumuladoCentavos: 0,
        asientoNum: 0,
        lines: [],
        cierre: {} as CierreContable,
      };
    }
    const y = Number(match[1]);
    const m = Number(match[2]);
    dateFrom = `${match[1]}-${match[2]}-01`;
    dateTo = getLastDayOfMonthISO(y, m);
  } else {
    if (!/^\d{4}$/.test(periodo)) {
      return {
        ok: false,
        error: 'Formato de ejercicio anual inválido. Use YYYY.',
        fechaCierre: '',
        utilidadNetaCentavos: 0,
        reservaLegalCentavos: 0,
        resultadoAcumuladoCentavos: 0,
        asientoNum: 0,
        lines: [],
        cierre: {} as CierreContable,
      };
    }
    dateFrom = `${periodo}-01-01`;
    dateTo = `${periodo}-12-31`;
  }

  const cuentasMap = new Map(dataset.catalogo.map((c) => [c.codigo, c]));
  const saldos = new Map<string, number>();

  for (const m of dataset.diario) {
    if (m.estado === 'ANULADO') continue;
    const f = m.mov_fecha || m.fecha;
    if (f < dateFrom || f > dateTo) continue;
    const cta = cuentasMap.get(m.codigo_cuenta);
    if (!cta) continue;
    if (
      cta.tipo_cuenta !== 'Ingreso' &&
      cta.tipo_cuenta !== 'Costo' &&
      cta.tipo_cuenta !== 'Gasto' &&
      cta.tipo_cuenta !== 'Egreso'
    ) {
      continue;
    }
    const prev = saldos.get(cta.codigo) || 0;
    const neto =
      cta.naturaleza === 'Crédito'
        ? m.credito_centavos - m.debito_centavos
        : m.debito_centavos - m.credito_centavos;
    saldos.set(cta.codigo, prev + neto);
  }

  let totalIngresos = 0;
  let totalCostosGastos = 0;
  const newLines: AsientoLinea[] = [];
  let lineId = firstLineId;
  const concepto = `Cierre Contable ${tipo} Período ${periodo} (NIC 1)`;

  for (const [codigo, saldo] of saldos.entries()) {
    if (saldo === 0) continue;
    const cta = cuentasMap.get(codigo);
    if (!cta) continue;

    if (cta.tipo_cuenta === 'Ingreso') {
      totalIngresos += saldo;
      newLines.push({
        id: lineId++,
        asiento_num: nextAsientoNum,
        fecha: dateTo,
        concepto,
        tercero: 'Cierre de Ejercicio',
        codigo_cuenta: codigo,
        debito_centavos: saldo > 0 ? saldo : 0,
        credito_centavos: saldo < 0 ? Math.abs(saldo) : 0,
        estado: 'ACTIVO',
        exchange_rate_bs: null,
      });
    } else {
      totalCostosGastos += saldo;
      newLines.push({
        id: lineId++,
        asiento_num: nextAsientoNum,
        fecha: dateTo,
        concepto,
        tercero: 'Cierre de Ejercicio',
        codigo_cuenta: codigo,
        debito_centavos: saldo < 0 ? Math.abs(saldo) : 0,
        credito_centavos: saldo > 0 ? saldo : 0,
        estado: 'ACTIVO',
        exchange_rate_bs: null,
      });
    }
  }

  const utilidad = totalIngresos - totalCostosGastos;
  if (newLines.length === 0 || (utilidad === 0 && totalIngresos === 0 && totalCostosGastos === 0)) {
    return {
      ok: false,
      error: `No hay saldos de Ingresos, Costos o Gastos abiertos en el período ${periodo} (${dateFrom} a ${dateTo}).`,
      fechaCierre: dateTo,
      utilidadNetaCentavos: 0,
      reservaLegalCentavos: 0,
      resultadoAcumuladoCentavos: 0,
      asientoNum: 0,
      lines: [],
      cierre: {} as CierreContable,
    };
  }

  const reservaCuenta =
    cuentasMap.get('3102')?.codigo ||
    dataset.catalogo.find((c) => c.tipo_cuenta === 'Patrimonio')?.codigo ||
    '3101';
  const resultadoCuenta =
    cuentasMap.get('3103')?.codigo ||
    dataset.catalogo.find((c) => c.tipo_cuenta === 'Patrimonio')?.codigo ||
    '3101';

  let reservaLegalCentavos = 0;
  let resultadoAcumuladoCentavos = utilidad;

  if (utilidad > 0 && tipo === 'ANUAL') {
    reservaLegalCentavos = Math.round(utilidad * 0.05);
    resultadoAcumuladoCentavos = utilidad - reservaLegalCentavos;
    if (reservaLegalCentavos > 0) {
      newLines.push({
        id: lineId++,
        asiento_num: nextAsientoNum,
        fecha: dateTo,
        concepto: `Reserva Legal 5% Art. 262 C.Com. (${periodo})`,
        tercero: 'Patrimonio / Reserva Legal',
        codigo_cuenta: reservaCuenta,
        debito_centavos: 0,
        credito_centavos: reservaLegalCentavos,
        estado: 'ACTIVO',
        exchange_rate_bs: null,
      });
    }
  }

  if (resultadoAcumuladoCentavos !== 0) {
    newLines.push({
      id: lineId++,
      asiento_num: nextAsientoNum,
      fecha: dateTo,
      concepto,
      tercero: 'Resultado del Ejercicio',
      codigo_cuenta: resultadoCuenta,
      debito_centavos: resultadoAcumuladoCentavos < 0 ? Math.abs(resultadoAcumuladoCentavos) : 0,
      credito_centavos: resultadoAcumuladoCentavos > 0 ? resultadoAcumuladoCentavos : 0,
      estado: 'ACTIVO',
      exchange_rate_bs: null,
    });
  }

  const cierre: CierreContable = {
    id: (dataset.cierres[dataset.cierres.length - 1]?.id || 0) + 1,
    tipo,
    periodo,
    fecha: dateTo,
    asiento_num: nextAsientoNum,
    estado: 'ACTIVO',
    reserva_legal_centavos: reservaLegalCentavos,
  };

  return {
    ok: true,
    fechaCierre: dateTo,
    utilidadNetaCentavos: utilidad,
    reservaLegalCentavos,
    resultadoAcumuladoCentavos,
    asientoNum: nextAsientoNum,
    lines: newLines,
    cierre,
  };
}
