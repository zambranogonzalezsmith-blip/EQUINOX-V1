import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VerifiedFirebaseCaller } from '../api/_lib/firebaseAuth.js';
import { validateAndAuthorizeMutation } from '../api/_lib/mutationValidator.js';
import type {
  CompanyProfile,
  DocumentoFiscalIVA,
  MovimientoInventario,
  ProductoInventario,
  RetencionISLR,
} from '../src/types/accounting.js';
import {
  auditJournalIntegrity,
  buildClosingEntry,
  getLastDayOfMonthISO,
  validateJournalEntryLines,
} from '../src/utils/accountingEngine.js';
import {
  computePayloadSha256Hex,
  validateDriveRestorePayload,
} from '../src/utils/backupSecurity.js';
import {
  autoMatchBankMovements,
  buildBankAdjustmentJournalLines,
  computeBankReconciliationSummary,
  parseBankStatementCsv,
} from '../src/utils/bankReconciliation.js';
import {
  computeForma30Summary,
  computeIslrRetention,
  generateLibroIvaCsv,
  generateSeniatIslrXml,
  generateSeniatRetIvaTxt,
} from '../src/utils/fiscalCalculations.js';
import { computeInventoryValuation } from '../src/utils/inventoryEngine.js';
import { centsToStr, strToCents } from '../src/utils/monetary.js';
import { createEmptyCompanyDataset } from '../src/utils/venezuelaCatalog.js';

function makeBaseCompany(id: string, ownerUid: string): CompanyProfile {
  const now = '2026-11-01T12:00:00.000Z';
  return {
    id,
    ownerUid,
    googleAuthUid: ownerUid,
    googleAuthEmail: 'alice@empresa.com',
    googleVerified: true,
    razonSocial: 'Inversiones Equinox C.A.',
    rif: 'J-30112233-4',
    tipoContribuyente: 'Especial',
    actividadEconomica: 'Comercio y Servicios',
    domicilioFiscal: 'Caracas, Venezuela',
    telefono: '0212-5550000',
    monedaFuncional: 'VES',
    alicuotaIvaGeneral: 16,
    alicuotaIvaReducida: 8,
    agenteRetencionIva: 75,
    agenteRetencionIslr: true,
    sujetoIgtf: true,
    unidadTributariaBs: 9,
    contadorNombre: 'Lic. Pérez',
    cpcNumero: 'CPC-9999',
    periodoFiscalInicio: '2026-01-01',
    createdAt: now,
    updatedAt: now,
  };
}

describe('Prioridad 1: Aritmética, Partida Doble y Auditoría Contable', () => {
  it('parsea correctamente formatos locales/US y negativos en strToCents', () => {
    assert.equal(strToCents('50,000.00'), 5000000);
    assert.equal(strToCents('50.000,00'), 5000000);
    assert.equal(strToCents('1250,45'), 125045);
    assert.equal(strToCents('-250.75'), -25075);
    assert.equal(centsToStr(5000000), '50,000.00');
  });

  it('valida partida doble estricta y rechaza líneas duales, cuentas inexistentes o descuadres', () => {
    const ds = createEmptyCompanyDataset();

    const valid = validateJournalEntryLines(
      [
        { codigo_cuenta: '1102', debitoStr: '1,000.00', creditoStr: '' },
        { codigo_cuenta: '4101', debitoStr: '', creditoStr: '1,000.00' },
      ],
      ds.catalogo
    );
    assert.equal(valid.ok, true);
    assert.equal(valid.totalDebitoCentavos, 100000);
    assert.equal(valid.totalCreditoCentavos, 100000);

    const dualSided = validateJournalEntryLines(
      [
        { codigo_cuenta: '1102', debitoStr: '100', creditoStr: '100' },
        { codigo_cuenta: '4101', debitoStr: '', creditoStr: '100' },
      ],
      ds.catalogo
    );
    assert.equal(dualSided.ok, false);

    const unknownAccount = validateJournalEntryLines(
      [
        { codigo_cuenta: '9999-NOEXISTE', debitoStr: '100', creditoStr: '' },
        { codigo_cuenta: '4101', debitoStr: '', creditoStr: '100' },
      ],
      ds.catalogo
    );
    assert.equal(unknownAccount.ok, false);

    const unbalanced = validateJournalEntryLines(
      [
        { codigo_cuenta: '1102', debitoStr: '500.00', creditoStr: '' },
        { codigo_cuenta: '4101', debitoStr: '', creditoStr: '450.00' },
      ],
      ds.catalogo
    );
    assert.equal(unbalanced.ok, false);
  });

  it('audita integridad del Diario y comprueba ecuación patrimonial', () => {
    const ds = createEmptyCompanyDataset();
    ds.diario = [
      {
        id: 1,
        asiento_num: 1,
        fecha: '2026-11-01',
        concepto: 'Aporte de capital',
        tercero: 'Accionistas',
        codigo_cuenta: '1102',
        debito_centavos: 200000,
        credito_centavos: 0,
        estado: 'ACTIVO',
        exchange_rate_bs: null,
      },
      {
        id: 2,
        asiento_num: 1,
        fecha: '2026-11-01',
        concepto: 'Aporte de capital',
        tercero: 'Accionistas',
        codigo_cuenta: '3101',
        debito_centavos: 0,
        credito_centavos: 200000,
        estado: 'ACTIVO',
        exchange_rate_bs: null,
      },
    ];
    const healthy = auditJournalIntegrity(ds);
    assert.equal(healthy.isHealthy, true);
    assert.equal(healthy.equationDiffCentavos, 0);

    ds.diario.push({
      id: 3,
      asiento_num: 2,
      fecha: '2026-11-02',
      concepto: 'Línea huérfana y descuadrada',
      tercero: 'Tercero',
      codigo_cuenta: '8888-X',
      debito_centavos: 5000,
      credito_centavos: 0,
      estado: 'ACTIVO',
      exchange_rate_bs: null,
    });
    const broken = auditJournalIntegrity(ds);
    assert.equal(broken.isHealthy, false);
    assert.equal(broken.orphanLinesCount, 1);
    assert.equal(broken.unbalancedAsientos.length, 1);
  });
});

describe('Prioridad 2: Seguridad de Backups Google Drive (SHA-256) y Mutaciones', () => {
  it('valida checksum SHA-256 en restauración, bloquea manipulación y aísla por correo', async () => {
    const company = makeBaseCompany('emp-1', 'uid-alice');
    const dataset = createEmptyCompanyDataset();
    dataset.conciliacionBancaria = {
      movimientosBanco: [
        {
          id: 'bnk-1',
          fecha: '2026-11-10',
          referencia: 'REF001',
          descripcion: 'Transferencia recibida',
          cuentaContable: '1102',
          debitoCentavos: 0,
          creditoCentavos: 150000,
        },
      ],
      conciliacionesPorPeriodo: {},
    };

    const core = {
      kind: 'company-books-backup',
      ownerUid: 'uid-alice',
      ownerEmail: 'alice@empresa.com',
      clientEmail: 'alice@empresa.com',
      company,
      dataset,
    };
    const checksumSha256 = await computePayloadSha256Hex(core);
    const validPayload = {
      platform: 'Equinox-Books',
      ...core,
      checksumSha256,
    };

    const okRes = await validateDriveRestorePayload({
      payload: validPayload,
      callerUid: 'uid-alice',
      callerEmail: 'alice@empresa.com',
      requireValidChecksum: true,
    });
    assert.equal(okRes.valid, true);
    assert.equal(okRes.checksumValid, true);
    assert.equal(okRes.companyData['emp-1'].conciliacionBancaria?.movimientosBanco.length, 1);

    // Manipular monto tras firmar checksum
    const tampered = {
      ...validPayload,
      dataset: { ...dataset, nextId: 999 },
    };
    const tamperedRes = await validateDriveRestorePayload({
      payload: tampered,
      callerUid: 'uid-alice',
      callerEmail: 'alice@empresa.com',
      requireValidChecksum: true,
    });
    assert.equal(tamperedRes.valid, false);
    assert.equal(tamperedRes.checksumValid, false);

    // Aislamiento entre correos para usuarios estándar
    const crossUserRes = await validateDriveRestorePayload({
      payload: validPayload,
      callerUid: 'uid-bob',
      callerEmail: 'bob@otra.com',
      requireValidChecksum: true,
    });
    assert.equal(crossUserRes.valid, false);
  });

  it('permite mutación DATASET_UPDATE con conciliacionBancaria para el dueño legítimo', () => {
    const company = makeBaseCompany('emp-alice', 'uid-alice');
    const ds = createEmptyCompanyDataset();
    ds.conciliacionBancaria = {
      movimientosBanco: [
        {
          id: 'bnk-99',
          fecha: '2026-11-15',
          referencia: 'TRF99',
          descripcion: 'Abono cliente',
          cuentaContable: '1102',
          debitoCentavos: 0,
          creditoCentavos: 25000,
        },
      ],
      conciliacionesPorPeriodo: {
        '2026-11::1102': {
          id: 'conc-1102-2026-11',
          periodo: '2026-11',
          cuentaContable: '1102',
          saldoEstadoCuentaBancoCentavos: 25000,
          saldoLibrosCentavos: 25000,
          diferenciaCentavos: 0,
          conciliada: true,
          fechaConciliacion: '2026-11-30T10:00:00.000Z',
        },
      },
    };
    const caller: VerifiedFirebaseCaller = {
      uid: 'uid-alice',
      email: 'alice@empresa.com',
      emailVerified: true,
      isSuperAdmin: false,
      idToken: 'token',
    };

    const res = validateAndAuthorizeMutation(
      {
        id: 'mut-conc-1',
        timestamp: '2026-11-30T10:00:00.000Z',
        companyId: 'emp-alice',
        companyName: company.razonSocial,
        actionType: 'DATASET_UPDATE',
        summary: 'Guardar conciliación bancaria',
        datasetSnapshot: ds,
      },
      caller,
      company
    );

    assert.equal(res.allowed, true);
    if (res.allowed && res.sanitizedDataset) {
      assert.equal(res.sanitizedDataset.conciliacionBancaria?.movimientosBanco.length, 1);
      assert.ok(res.sanitizedDataset.conciliacionBancaria?.conciliacionesPorPeriodo['2026-11::1102']);
    }
  });
});

describe('Prioridad 3: Cierres Contables UTC, Forma 30 IVA, ISLR y Formatos SENIAT', () => {
  it('calcula fin de mes exacto en UTC (febrero bisiesto y común) y evita cierres duplicados', () => {
    assert.equal(getLastDayOfMonthISO(2024, 2), '2024-02-29');
    assert.equal(getLastDayOfMonthISO(2026, 2), '2026-02-28');
    assert.equal(getLastDayOfMonthISO(2026, 11), '2026-11-30');

    const ds = createEmptyCompanyDataset();
    ds.diario = [
      {
        id: 1,
        asiento_num: 1,
        fecha: '2026-11-10',
        concepto: 'Ingreso por servicios',
        tercero: 'Cliente A',
        codigo_cuenta: '4101',
        debito_centavos: 0,
        credito_centavos: 100000,
        estado: 'ACTIVO',
        exchange_rate_bs: null,
      },
      {
        id: 2,
        asiento_num: 1,
        fecha: '2026-11-10',
        concepto: 'Ingreso por servicios',
        tercero: 'Cliente A',
        codigo_cuenta: '1102',
        debito_centavos: 100000,
        credito_centavos: 0,
        estado: 'ACTIVO',
        exchange_rate_bs: null,
      },
    ];

    const annualClose = buildClosingEntry({
      dataset: ds,
      tipo: 'ANUAL',
      periodo: '2026',
      nextAsientoNum: 2,
      firstLineId: 10,
    });
    assert.equal(annualClose.ok, true);
    assert.equal(annualClose.utilidadNetaCentavos, 100000);
    // Art. 262 Código de Comercio: 5% Reserva Legal
    assert.equal(annualClose.reservaLegalCentavos, 5000);
    assert.equal(annualClose.resultadoAcumuladoCentavos, 95000);

    ds.cierres.push(annualClose.cierre);
    const duplicate = buildClosingEntry({
      dataset: ds,
      tipo: 'ANUAL',
      periodo: '2026',
      nextAsientoNum: 3,
      firstLineId: 20,
    });
    assert.equal(duplicate.ok, false);
  });

  it('calcula Forma 30 (incluyendo 31%, NC y Ret IVA), ISLR Decreto 1.808 y genera TXT/XML/CSV SENIAT', () => {
    const docs: DocumentoFiscalIVA[] = [
      {
        id: 'iva-1',
        tipoLibro: 'VENTAS',
        fecha: '2026-11-05',
        rifTercero: 'J-11111111-1',
        razonSocialTercero: 'Cliente VIP',
        tipoPersona: 'PJ',
        numeroFactura: '000101',
        numeroControl: '00-00101',
        tipoTransaccion: '01-Registro',
        concepto: 'Venta gravada 16% y lujo 31%',
        exentoCentavos: 0,
        base16Centavos: 100000,
        iva16Centavos: 16000,
        base8Centavos: 0,
        iva8Centavos: 0,
        base31Centavos: 50000,
        iva31Centavos: 15500,
        porcentajeRetencionIva: 75,
        ivaRetenidoCentavos: 12000,
        pagadoEnDivisas: true,
        igtfCentavos: 3000,
      },
      {
        id: 'iva-2',
        tipoLibro: 'VENTAS',
        fecha: '2026-11-08',
        rifTercero: 'J-11111111-1',
        razonSocialTercero: 'Cliente VIP',
        tipoPersona: 'PJ',
        numeroFactura: 'NC-0001',
        numeroControl: '00-00102',
        tipoTransaccion: '02-Nota Crédito',
        concepto: 'Nota de crédito devolución parcial',
        exentoCentavos: 0,
        base16Centavos: 10000,
        iva16Centavos: 1600,
        base8Centavos: 0,
        iva8Centavos: 0,
        base31Centavos: 0,
        iva31Centavos: 0,
        porcentajeRetencionIva: 0,
        ivaRetenidoCentavos: 0,
        pagadoEnDivisas: false,
        igtfCentavos: 0,
      },
      {
        id: 'iva-3',
        tipoLibro: 'COMPRAS',
        fecha: '2026-11-12',
        rifTercero: 'J-22222222-2',
        razonSocialTercero: 'Proveedor Alfa',
        tipoPersona: 'PJ',
        numeroFactura: 'F-900',
        numeroControl: '00-00900',
        tipoTransaccion: '01-Registro',
        concepto: 'Compra insumos operativos',
        exentoCentavos: 0,
        base16Centavos: 50000,
        iva16Centavos: 8000,
        base8Centavos: 0,
        iva8Centavos: 0,
        base31Centavos: 0,
        iva31Centavos: 0,
        porcentajeRetencionIva: 75,
        ivaRetenidoCentavos: 6000,
        comprobanteRetencion: '20261100000001',
        pagadoEnDivisas: false,
        igtfCentavos: 0,
      },
    ];

    const f30 = computeForma30Summary(docs, '2026-11', 2000);
    // Débito: 16000 + 15500 - 1600 = 29900; Crédito: 8000; Excedente anterior: 2000 => Cuota 19900; Ret sufridas 12000 => IVA a pagar 7900
    assert.equal(f30.totalDebitoFiscal, 29900);
    assert.equal(f30.totalCreditoFiscal, 8000);
    assert.equal(f30.ivaPorPagar, 7900);
    assert.equal(f30.igtfPorPagar, 3000);

    // ISLR PNR con sustraendo (UT 9 Bs * 83.3334 * 3% = 22.50 Bs = 2250 centavos)
    const pnr = computeIslrRetention({
      montoBaseCentavos: 500000, // 5,000.00 Bs -> 3% = 150.00 Bs (15000 centavos)
      tipoPersona: 'PNR',
      porcentajeTabla: 3,
      aplicaSustraendoPNR: true,
      unidadTributariaBs: 9,
    });
    assert.equal(pnr.sustraendoCentavos, 2250);
    assert.equal(pnr.montoRetenidoCentavos, 12750);

    const pnnr = computeIslrRetention({
      montoBaseCentavos: 100000,
      tipoPersona: 'PNNR',
      porcentajeTabla: 5,
      aplicaSustraendoPNR: true,
      unidadTributariaBs: 9,
    });
    assert.equal(pnnr.porcentajeAplicado, 34);
    assert.equal(pnnr.montoRetenidoCentavos, 34000);

    const txt = generateSeniatRetIvaTxt(docs, 'J-30112233-4', '2026-11');
    assert.equal(txt.rowsCount, 1);
    assert.ok(txt.content.includes('J301122334\t202611\t2026-11-12'));

    const retenciones: RetencionISLR[] = [
      {
        id: 'islr-1',
        fecha: '2026-11-15',
        rifSujeto: 'V-12345678-0',
        razonSocial: 'Consultor',
        tipoPersona: 'PNR',
        codigoConcepto: '001',
        concepto: 'Honorarios',
        numeroFactura: '0012',
        numeroControl: '00-012',
        montoBaseCentavos: 500000,
        porcentajeRetencion: 3,
        sustraendoCentavos: 2250,
        montoRetenidoCentavos: 12750,
        comprobanteNumero: '202611-0001',
      },
    ];
    const xml = generateSeniatIslrXml(retenciones, 'J-30112233-4', '2026-11');
    assert.equal(xml.rowsCount, 1);
    assert.ok(xml.content.includes('<RelacionRetencionesISLR RifAgente="J301122334" Periodo="202611">'));
    assert.ok(xml.content.includes('<CodigoConcepto>001</CodigoConcepto>'));

    const csv = generateLibroIvaCsv(docs, 'VENTAS', '2026-11', {
      razonSocial: 'Inversiones Equinox C.A.',
      rif: 'J-30112233-4',
    });
    assert.equal(csv.rowsCount, 2);
    assert.ok(csv.content.includes('Base 31%'));
  });
});

describe('Prioridad 4: Conciliación Bancaria e Inventario NIC 2', () => {
  it('parsea CSV bancario, empareja automáticamente y concilia diferencia a cero', () => {
    const csv = [
      'fecha,referencia,descripcion,debito,credito',
      '2026-11-05,TRF-100,Cobro factura cliente,0,1000.00',
      '2026-11-10,COM-01,Comision mantenimiento cuenta,50.00,0',
    ].join('\n');

    const parsed = parseBankStatementCsv(csv, '1102');
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.movements.length, 2);

    const diario = [
      {
        id: 1,
        asiento_num: 1,
        fecha: '2026-11-05',
        concepto: 'Cobro factura TRF-100',
        tercero: 'Cliente A',
        codigo_cuenta: '1102',
        debito_centavos: 100000,
        credito_centavos: 0,
        estado: 'ACTIVO' as const,
        exchange_rate_bs: null,
      },
    ];

    const matched = autoMatchBankMovements(parsed.movements, diario, '1102', '2026-11');
    assert.equal(matched[0].conciliadoConAsientoId, 1);
    assert.equal(matched[1].conciliadoConAsientoId, undefined);

    // Saldo real banco = 1000 - 50 = 950.00 (95000 centavos)
    const summary = computeBankReconciliationSummary({
      bankMovs: matched,
      diario,
      cuentaContable: '1102',
      periodo: '2026-11',
      saldoEstadoCuentaBancoCentavos: 95000,
    });
    // Saldo libros = 1000.00 - Nota débito no reg (50.00) = 950.00 => diferencia = 0
    assert.equal(summary.diferenciaCentavos, 0);
    assert.equal(summary.conciliado, true);

    const ajusteLines = buildBankAdjustmentJournalLines({
      bankMovement: matched[1],
      contraCuentaCodigo: '6104',
      nextAsientoNum: 2,
      firstLineId: 10,
    });
    assert.equal(ajusteLines.length, 2);
    assert.equal(ajusteLines[0].debito_centavos, 5000);
    assert.equal(ajusteLines[1].credito_centavos, 5000);
  });

  it('calcula Costo Promedio Ponderado Móvil NIC 2 con ENTRADA, SALIDA, AJUSTE MERMA/INCREMENTO y deterioro VNR', () => {
    const productos: ProductoInventario[] = [
      {
        codigo: 'SKU-01',
        nombre: 'Producto Test',
        unidad: 'UND',
        stock_minimo: 5,
        categoria_nic: 'Mercancías',
        vnr_centavos: 1100, // VNR 11.00 Bs
      },
    ];

    const movimientos: MovimientoInventario[] = [
      {
        id: 1,
        fecha: '2026-11-01',
        tipo: 'ENTRADA',
        producto: 'SKU-01',
        concepto: 'Compra lote 1',
        cantidad: 10,
        costo_unitario: '10.00',
      },
      {
        id: 2,
        fecha: '2026-11-02',
        tipo: 'ENTRADA',
        producto: 'SKU-01',
        concepto: 'Compra lote 2',
        cantidad: 10,
        costo_unitario: '20.00',
      },
      {
        id: 3,
        fecha: '2026-11-03',
        tipo: 'SALIDA',
        producto: 'SKU-01',
        concepto: 'Venta 5 unidades',
        cantidad: 5,
        costo_unitario: '15.00',
      },
      {
        id: 4,
        fecha: '2026-11-04',
        tipo: 'AJUSTE',
        direccion: 'MERMA',
        producto: 'SKU-01',
        concepto: 'Merma física',
        cantidad: 3,
        costo_unitario: '15.00',
      },
      {
        id: 5,
        fecha: '2026-11-05',
        tipo: 'AJUSTE',
        direccion: 'INCREMENTO',
        producto: 'SKU-01',
        concepto: 'Sobrante inventario',
        cantidad: 2,
        costo_unitario: '15.00',
      },
    ];

    const val = computeInventoryValuation(productos, movimientos);
    const stat = val.stats[0];
    // Stock: 10 + 10 - 5 - 3 + 2 = 14 unidades; costo promedio 15.00 (1500 centavos) => costo total 21000
    assert.equal(stat.stock, 14);
    assert.equal(stat.costoUnitarioCentavos, 1500);
    assert.equal(stat.valorCostoCentavos, 21000);
    // VNR = 1100 => deterioro unitario 400 * 14 = 5600; valor en libros = 21000 - 5600 = 15400
    assert.equal(stat.deterioroCentavos, 5600);
    assert.equal(stat.valorEnLibrosNic2Centavos, 15400);
  });
});
