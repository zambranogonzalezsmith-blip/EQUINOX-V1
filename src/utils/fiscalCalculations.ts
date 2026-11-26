import type {
  CompanyProfile,
  DocumentoFiscalIVA,
  RetencionISLR,
} from '../types/accounting.js';
import { centsToStr, formatDateShort } from './monetary.js';

export interface Forma30Summary {
  periodo: string;
  ventasExentas: number;
  ventasBase16: number;
  debito16: number;
  ventasBase8: number;
  debito8: number;
  ventasBase31: number;
  debito31: number;
  totalDebitoFiscal: number;
  comprasExentas: number;
  comprasBase16: number;
  credito16: number;
  comprasBase8: number;
  credito8: number;
  comprasBase31: number;
  credito31: number;
  totalCreditoFiscal: number;
  retIvaSufridas: number;
  retIvaAplicadas: number;
  excedenteAnterior: number;
  cuotaAntesRetenciones: number;
  ivaPorPagar: number;
  nuevoExcedenteCredito: number;
  igtfPorPagar: number;
  ventasCount: number;
  comprasCount: number;
}

export function computeForma30Summary(
  documentosFiscales: DocumentoFiscalIVA[],
  periodo: string,
  excedenteIvaAnteriorCentavos = 0
): Forma30Summary {
  const docsPeriodo = (documentosFiscales || []).filter((d) => d.fecha.startsWith(periodo));
  const compras = docsPeriodo.filter((d) => d.tipoLibro === 'COMPRAS');
  const ventas = docsPeriodo.filter((d) => d.tipoLibro === 'VENTAS');

  let ventasExentas = 0;
  let ventasBase16 = 0;
  let debito16 = 0;
  let ventasBase8 = 0;
  let debito8 = 0;
  let ventasBase31 = 0;
  let debito31 = 0;
  let retIvaSufridas = 0;
  let igtfPorPagar = 0;

  for (const v of ventas) {
    const sign = v.tipoTransaccion === '02-Nota Crédito' ? -1 : 1;
    ventasExentas += v.exentoCentavos * sign;
    ventasBase16 += v.base16Centavos * sign;
    debito16 += v.iva16Centavos * sign;
    ventasBase8 += v.base8Centavos * sign;
    debito8 += v.iva8Centavos * sign;
    ventasBase31 += (v.base31Centavos || 0) * sign;
    debito31 += (v.iva31Centavos || 0) * sign;
    retIvaSufridas += v.ivaRetenidoCentavos * sign;
    igtfPorPagar += v.igtfCentavos * sign;
  }

  let comprasExentas = 0;
  let comprasBase16 = 0;
  let credito16 = 0;
  let comprasBase8 = 0;
  let credito8 = 0;
  let comprasBase31 = 0;
  let credito31 = 0;
  let retIvaAplicadas = 0;

  for (const c of compras) {
    const sign = c.tipoTransaccion === '02-Nota Crédito' ? -1 : 1;
    comprasExentas += c.exentoCentavos * sign;
    comprasBase16 += c.base16Centavos * sign;
    credito16 += c.iva16Centavos * sign;
    comprasBase8 += c.base8Centavos * sign;
    credito8 += c.iva8Centavos * sign;
    comprasBase31 += (c.base31Centavos || 0) * sign;
    credito31 += (c.iva31Centavos || 0) * sign;
    retIvaAplicadas += c.ivaRetenidoCentavos * sign;
  }

  const totalDebitoFiscal = debito16 + debito8 + debito31;
  const totalCreditoFiscal = credito16 + credito8 + credito31;
  const cuotaAntesRetenciones =
    totalDebitoFiscal - totalCreditoFiscal - (excedenteIvaAnteriorCentavos || 0);
  const ivaNetoPostRetenciones = cuotaAntesRetenciones - retIvaSufridas;
  const ivaPorPagar = Math.max(0, ivaNetoPostRetenciones);
  const nuevoExcedenteCredito =
    ivaNetoPostRetenciones < 0 ? Math.abs(ivaNetoPostRetenciones) : 0;

  return {
    periodo,
    ventasExentas,
    ventasBase16,
    debito16,
    ventasBase8,
    debito8,
    ventasBase31,
    debito31,
    totalDebitoFiscal,
    comprasExentas,
    comprasBase16,
    credito16,
    comprasBase8,
    credito8,
    comprasBase31,
    credito31,
    totalCreditoFiscal,
    retIvaSufridas,
    retIvaAplicadas,
    excedenteAnterior: excedenteIvaAnteriorCentavos || 0,
    cuotaAntesRetenciones,
    ivaPorPagar,
    nuevoExcedenteCredito,
    igtfPorPagar,
    ventasCount: ventas.length,
    comprasCount: compras.length,
  };
}

export interface IslrCalculationInput {
  montoBaseCentavos: number;
  tipoPersona: RetencionISLR['tipoPersona'];
  porcentajeTabla: number;
  aplicaSustraendoPNR: boolean;
  unidadTributariaBs: number;
}

export interface IslrCalculationOutput {
  porcentajeAplicado: number;
  sustraendoCentavos: number;
  montoRetenidoCentavos: number;
}

export function computeIslrRetention(input: IslrCalculationInput): IslrCalculationOutput {
  const { montoBaseCentavos, tipoPersona, porcentajeTabla, aplicaSustraendoPNR, unidadTributariaBs } =
    input;
  const pct =
    tipoPersona === 'PNNR' || tipoPersona === 'PJND' ? 34 : Math.max(0, porcentajeTabla);
  const sustraendoCentavos =
    tipoPersona === 'PNR' && aplicaSustraendoPNR
      ? Math.round(unidadTributariaBs * 83.3334 * (pct / 100) * 100)
      : 0;
  const bruto = Math.round((Math.max(0, montoBaseCentavos) * pct) / 100);
  const montoRetenidoCentavos = Math.max(0, bruto - sustraendoCentavos);
  return {
    porcentajeAplicado: pct,
    sustraendoCentavos,
    montoRetenidoCentavos,
  };
}

export function generateSeniatRetIvaTxt(
  documentosFiscales: DocumentoFiscalIVA[],
  companyRif: string,
  periodo: string
): { content: string; rowsCount: number } {
  const periodoSeniat = periodo.replace('-', '');
  const rifAgente = companyRif.replace(/-/g, '').toUpperCase();
  const docs = (documentosFiscales || []).filter(
    (d) =>
      d.fecha.startsWith(periodo) &&
      d.tipoLibro === 'COMPRAS' &&
      d.ivaRetenidoCentavos > 0
  );

  const lines = docs.map((d) => {
    const rifProv = d.rifTercero.replace(/-/g, '').toUpperCase();
    const tipoOp = 'C';
    const tipoDoc =
      d.tipoTransaccion === '02-Nota Crédito'
        ? '03'
        : d.tipoTransaccion === '03-Nota Débito'
          ? '02'
          : '01';
    const totalCompra = (
      d.exentoCentavos +
      d.base16Centavos +
      d.iva16Centavos +
      d.base8Centavos +
      d.iva8Centavos +
      (d.base31Centavos || 0) +
      (d.iva31Centavos || 0)
    ) / 100;
    const baseImp = (d.base16Centavos + d.base8Centavos + (d.base31Centavos || 0)) / 100;
    const ret = d.ivaRetenidoCentavos / 100;
    const exento = d.exentoCentavos / 100;
    const docAfec = d.facturaAfectada || '0';
    const alic =
      d.base16Centavos > 0 ? '16.00' : d.base8Centavos > 0 ? '8.00' : (d.base31Centavos || 0) > 0 ? '31.00' : '0.00';
    return [
      rifAgente,
      periodoSeniat,
      d.fecha,
      tipoOp,
      tipoDoc,
      rifProv,
      d.numeroFactura,
      d.numeroControl,
      totalCompra.toFixed(2),
      baseImp.toFixed(2),
      ret.toFixed(2),
      docAfec,
      d.comprobanteRetencion || `${periodoSeniat}00000001`,
      exento.toFixed(2),
      alic,
      '0',
    ].join('\t');
  });

  return {
    content: lines.join('\n'),
    rowsCount: lines.length,
  };
}

function escapeXml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generateSeniatIslrXml(
  retenciones: RetencionISLR[],
  companyRif: string,
  periodo: string
): { content: string; rowsCount: number } {
  const rifAgente = companyRif.replace(/-/g, '').toUpperCase();
  const periodoSeniat = periodo.replace('-', '');
  const list = (retenciones || []).filter((r) => r.fecha.startsWith(periodo));

  const details = list
    .map((r) => {
      const rifRet = r.rifSujeto.replace(/-/g, '').toUpperCase();
      const baseNum = (r.montoBaseCentavos / 100).toFixed(2);
      const pctNum = Number(r.porcentajeRetencion || 0).toFixed(2);
      const fechaDdMmYyyy = (() => {
        const parts = r.fecha.split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : r.fecha;
      })();
      return [
        '  <DetalleRetencion>',
        `    <RifRetenido>${escapeXml(rifRet)}</RifRetenido>`,
        `    <NumeroFactura>${escapeXml(r.numeroFactura || '0')}</NumeroFactura>`,
        `    <NumeroControl>${escapeXml(r.numeroControl || '0')}</NumeroControl>`,
        `    <FechaOperacion>${escapeXml(fechaDdMmYyyy)}</FechaOperacion>`,
        `    <CodigoConcepto>${escapeXml(r.codigoConcepto)}</CodigoConcepto>`,
        `    <MontoOperacion>${baseNum}</MontoOperacion>`,
        `    <PorcentajeRetencion>${pctNum}</PorcentajeRetencion>`,
        '  </DetalleRetencion>',
      ].join('\n');
    })
    .join('\n');

  const xml = [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    `<RelacionRetencionesISLR RifAgente="${escapeXml(rifAgente)}" Periodo="${escapeXml(periodoSeniat)}">`,
    details,
    '</RelacionRetencionesISLR>',
  ]
    .filter(Boolean)
    .join('\n');

  return { content: xml, rowsCount: list.length };
}

export function escapeCsvCell(val: string | number | null | undefined): string {
  const str = String(val ?? '');
  if (/[",\n\r;]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateLibroIvaCsv(
  documentosFiscales: DocumentoFiscalIVA[],
  tipoLibro: 'COMPRAS' | 'VENTAS',
  periodo: string,
  company: Pick<CompanyProfile, 'razonSocial' | 'rif'>
): { content: string; rowsCount: number } {
  const docs = (documentosFiscales || [])
    .filter((d) => d.tipoLibro === tipoLibro && d.fecha.startsWith(periodo))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  const header = [
    'Fecha',
    'RIF',
    'Razón Social / Nombre',
    'Tipo Transacción',
    'Factura',
    'Nro. Control',
    'Factura Afectada',
    'Exento',
    'Base 16%',
    'IVA 16%',
    'Base 8%',
    'IVA 8%',
    'Base 31%',
    'IVA 31%',
    'Total Documento',
    'IVA Retenido',
    'Comprobante Ret.',
    'IGTF 3%',
  ];

  const rows = docs.map((d) => {
    const sign = d.tipoTransaccion === '02-Nota Crédito' ? -1 : 1;
    const total =
      (d.exentoCentavos +
        d.base16Centavos +
        d.iva16Centavos +
        d.base8Centavos +
        d.iva8Centavos +
        (d.base31Centavos || 0) +
        (d.iva31Centavos || 0)) *
      sign;
    return [
      formatDateShort(d.fecha),
      d.rifTercero,
      d.razonSocialTercero,
      d.tipoTransaccion,
      d.numeroFactura,
      d.numeroControl,
      d.facturaAfectada || '',
      centsToStr(d.exentoCentavos * sign),
      centsToStr(d.base16Centavos * sign),
      centsToStr(d.iva16Centavos * sign),
      centsToStr(d.base8Centavos * sign),
      centsToStr(d.iva8Centavos * sign),
      centsToStr((d.base31Centavos || 0) * sign),
      centsToStr((d.iva31Centavos || 0) * sign),
      centsToStr(total),
      centsToStr(d.ivaRetenidoCentavos * sign),
      d.comprobanteRetencion || '',
      centsToStr(d.igtfCentavos * sign),
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  const meta = [
    `${escapeCsvCell(company.razonSocial)},${escapeCsvCell(`RIF: ${company.rif}`)},${escapeCsvCell(
      `LIBRO DE ${tipoLibro} SENIAT - PERÍODO ${periodo}`
    )}`,
    header.map(escapeCsvCell).join(','),
    ...rows,
  ];

  return {
    content: '\uFEFF' + meta.join('\n'),
    rowsCount: docs.length,
  };
}
