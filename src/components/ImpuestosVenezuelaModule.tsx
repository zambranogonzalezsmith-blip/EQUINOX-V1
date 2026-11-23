import React, { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import {
  CompanyDataset,
  CompanyProfile,
  CuentaNIC,
  DocumentoFiscalIVA,
  RetencionISLR,
} from '../types/accounting';
import { centsToStr, strToCents, todayISO } from '../utils/monetary';
import { CONCEPTOS_ISLR_VENEZUELA } from '../utils/venezuelaCatalog';
import { FiscalCalendar } from './FiscalCalendar';

interface ImpuestosVenezuelaModuleProps {
  company: CompanyProfile;
  dataset: CompanyDataset;
  onUpdateDataset: (updater: (prev: CompanyDataset) => CompanyDataset, summary: string) => void;
  onJumpToEditAsiento: (asientoNum: number) => void;
  onNotify: (msg: string, type: 'success' | 'error') => void;
}

type TaxSubTab = 'libros_iva' | 'forma30' | 'islr' | 'igtf_calendario';

export const ImpuestosVenezuelaModule: React.FC<ImpuestosVenezuelaModuleProps> = ({
  company,
  dataset,
  onUpdateDataset,
  onJumpToEditAsiento,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<TaxSubTab>('libros_iva');
  const [periodoFiltro, setPeriodoFiltro] = useState<string>(todayISO().slice(0, 7)); // YYYY-MM

  // Form state: Documento Fiscal IVA (Libro Compras / Libro Ventas Art. 75/76 RLIVA)
  const [tipoLibro, setTipoLibro] = useState<'COMPRAS' | 'VENTAS'>('COMPRAS');
  const [docFecha, setDocFecha] = useState<string>(todayISO());
  const [rifTercero, setRifTercero] = useState('');
  const [razonTercero, setRazonTercero] = useState('');
  const [numFactura, setNumFactura] = useState('');
  const [numControl, setNumControl] = useState('');
  const [tipoTrans, setTipoTrans] = useState<'01-Registro' | '02-Nota Crédito' | '03-Nota Débito'>(
    '01-Registro'
  );
  const [conceptoDoc, setConceptoDoc] = useState('');
  const [montoExento, setMontoExento] = useState('0.00');
  const [base16, setBase16] = useState('0.00');
  const [base8, setBase8] = useState('0.00');
  const [pctRetIva, setPctRetIva] = useState<0 | 75 | 100>(
    company.agenteRetencionIva || 0
  );
  const [pagadoDivisas, setPagadoDivisas] = useState<boolean>(false);

  // Sincronizar porcentaje de retención IVA si cambia la configuración de la empresa
  useEffect(() => {
    setPctRetIva(company.agenteRetencionIva || 0);
  }, [company.id, company.agenteRetencionIva]);

  // Form state: Retención ISLR (Decreto 1.808)
  const [islrFecha, setIslrFecha] = useState<string>(todayISO());
  const [islrRif, setIslrRif] = useState('');
  const [islrRazon, setIslrRazon] = useState('');
  const [islrTipoPersona, setIslrTipoPersona] = useState<'PNR' | 'PNNR' | 'PJD' | 'PJND'>('PJD');
  const [islrCodConcepto, setIslrCodConcepto] = useState('001');
  const [islrFactura, setIslrFactura] = useState('');
  const [islrControl, setIslrControl] = useState('');
  const [islrBase, setIslrBase] = useState('0.00');

  const cuentaMap = useMemo(
    () => new Map<string, CuentaNIC>(dataset.catalogo.map((c) => [c.codigo, c])),
    [dataset.catalogo]
  );

  // Automatic fiscal entries coming directly from Libro Diario (tagged Libro de Ventas / Libro de Compras)
  const { diarioVentas, diarioCompras } = useMemo(() => {
    const ventas = [];
    const compras = [];
    for (const m of dataset.diario) {
      if (m.estado !== 'ACTIVO') continue;
      const c = cuentaMap.get(m.codigo_cuenta);
      if (!c) continue;
      if (c.indicador_libro === 'Libro de Ventas' && m.credito_centavos > 0) {
        ventas.push(m);
      } else if (c.indicador_libro === 'Libro de Compras' && m.debito_centavos > 0) {
        compras.push(m);
      }
    }
    ventas.sort((a, b) => a.asiento_num - b.asiento_num);
    compras.sort((a, b) => a.asiento_num - b.asiento_num);
    return { diarioVentas: ventas, diarioCompras: compras };
  }, [cuentaMap, dataset.diario]);

  const { docsCompras, docsVentas } = useMemo(() => {
    const compras: DocumentoFiscalIVA[] = [];
    const ventas: DocumentoFiscalIVA[] = [];
    for (const d of dataset.documentosFiscales || []) {
      if (d.tipoLibro === 'COMPRAS') compras.push(d);
      else ventas.push(d);
    }
    return { docsCompras: compras, docsVentas: ventas };
  }, [dataset.documentosFiscales]);

  const handleAddDocumentoFiscal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rifTercero.trim() || !razonTercero.trim() || !numFactura.trim() || !numControl.trim()) {
      onNotify('Complete RIF, Razón Social, N° de Factura y N° de Control SENIAT.', 'error');
      return;
    }

    const exentoCents = strToCents(montoExento);
    const base16Cents = strToCents(base16);
    const base8Cents = strToCents(base8);
    if (exentoCents + base16Cents + base8Cents <= 0) {
      onNotify('Debe ingresar al menos un monto base o exento mayor a cero.', 'error');
      return;
    }

    const signo = tipoTrans === '02-Nota Crédito' ? -1 : 1;
    const iva16Cents = Math.round(base16Cents * (company.alicuotaIvaGeneral / 100)) * signo;
    const iva8Cents = Math.round(base8Cents * (company.alicuotaIvaReducida / 100)) * signo;
    const totalIva = iva16Cents + iva8Cents;
    const retIvaCents =
      pctRetIva > 0 ? Math.round((Math.abs(totalIva) * pctRetIva) / 100) * signo : 0;

    const totalFactura =
      (exentoCents + base16Cents + base8Cents) * signo + iva16Cents + iva8Cents;
    const igtfCents =
      pagadoDivisas && company.sujetoIgtf ? Math.round(Math.abs(totalFactura) * 0.03) : 0;

    const compSeq = String((dataset.documentosFiscales || []).length + 1).padStart(8, '0');
    const compRet =
      retIvaCents !== 0 ? `${docFecha.slice(0, 4)}${docFecha.slice(5, 7)}${compSeq}` : undefined;

    const nuevoDoc: DocumentoFiscalIVA = {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tipoLibro,
      fecha: docFecha,
      rifTercero: rifTercero.trim().toUpperCase(),
      razonSocialTercero: razonTercero.trim(),
      tipoPersona: rifTercero.trim().toUpperCase().startsWith('J') ? 'PJ' : 'PN',
      numeroFactura: numFactura.trim(),
      numeroControl: numControl.trim(),
      tipoTransaccion: tipoTrans,
      concepto: conceptoDoc.trim() || `${tipoLibro === 'COMPRAS' ? 'Compra' : 'Venta'} gravada`,
      exentoCentavos: exentoCents * signo,
      base16Centavos: base16Cents * signo,
      iva16Centavos: iva16Cents,
      base8Centavos: base8Cents * signo,
      iva8Centavos: iva8Cents,
      base31Centavos: 0,
      iva31Centavos: 0,
      porcentajeRetencionIva: pctRetIva,
      ivaRetenidoCentavos: retIvaCents,
      comprobanteRetencion: compRet,
      pagadoEnDivisas: pagadoDivisas,
      igtfCentavos: igtfCents,
    };

    onUpdateDataset(
      (prev) => ({
        ...prev,
        documentosFiscales: [...(prev.documentosFiscales || []), nuevoDoc],
      }),
      `Documento fiscal ${numFactura} en ${tipoLibro === 'COMPRAS' ? 'Libro de Compras' : 'Libro de Ventas'}`
    );

    setNumFactura('');
    setNumControl('');
    setConceptoDoc('');
    setMontoExento('0.00');
    setBase16('0.00');
    setBase8('0.00');
    onNotify(
      `Documento fiscal registrado${compRet ? ` · Comprobante Retención IVA: ${compRet}` : ''}.`,
      'success'
    );
  };

  const handleDeleteDoc = (id: string) => {
    onUpdateDataset(
      (prev) => ({
        ...prev,
        documentosFiscales: (prev.documentosFiscales || []).filter((d) => d.id !== id),
      }),
      'Eliminación de documento fiscal IVA'
    );
    onNotify('Documento fiscal eliminado.', 'success');
  };

  // Cálculo automático Decreto 1.808 Retención ISLR
  const conceptoSelected =
    CONCEPTOS_ISLR_VENEZUELA.find((c) => c.codigo === islrCodConcepto) ||
    CONCEPTOS_ISLR_VENEZUELA[0];
  const islrPct =
    islrTipoPersona === 'PNR'
      ? conceptoSelected.porcentajePNR
      : islrTipoPersona === 'PJD'
        ? conceptoSelected.porcentajePJD
        : islrTipoPersona === 'PNNR'
          ? 34
          : 34;
  const islrBaseCents = strToCents(islrBase);
  // Sustraendo PNR = Valor UT * 83.3334 * (% / 100) en centavos
  const sustraendoCents =
    islrTipoPersona === 'PNR' && conceptoSelected.aplicaSustraendoPNR
      ? Math.round(company.unidadTributariaBs * 83.3334 * (islrPct / 100) * 100)
      : 0;
  const islrBrutoCents = Math.round((islrBaseCents * islrPct) / 100);
  const islrNetoRetenidoCents = Math.max(0, islrBrutoCents - sustraendoCents);

  const handleAddIslr = (e: React.FormEvent) => {
    e.preventDefault();
    if (!islrRif.trim() || !islrRazon.trim() || !islrFactura.trim() || islrBaseCents <= 0) {
      onNotify('Complete los datos del sujeto retenido y base imponible ISLR.', 'error');
      return;
    }

    const compNum = `ISLR-${islrFecha.slice(0, 4)}${islrFecha.slice(5, 7)}-${String(
      (dataset.retencionesIslr || []).length + 1
    ).padStart(5, '0')}`;

    const nuevaRet: RetencionISLR = {
      id: `islr-${Date.now()}`,
      fecha: islrFecha,
      rifSujeto: islrRif.trim().toUpperCase(),
      razonSocial: islrRazon.trim(),
      tipoPersona: islrTipoPersona,
      codigoConcepto: conceptoSelected.codigo,
      concepto: conceptoSelected.descripcion,
      numeroFactura: islrFactura.trim(),
      numeroControl: islrControl.trim() || '00-000000',
      montoBaseCentavos: islrBaseCents,
      porcentajeRetencion: islrPct,
      sustraendoCentavos: sustraendoCents,
      montoRetenidoCentavos: islrNetoRetenidoCents,
      comprobanteNumero: compNum,
    };

    onUpdateDataset(
      (prev) => ({
        ...prev,
        retencionesIslr: [...(prev.retencionesIslr || []), nuevaRet],
      }),
      `Retención ISLR ${compNum} (${islrRif.trim().toUpperCase()})`
    );

    setIslrFactura('');
    setIslrControl('');
    setIslrBase('0.00');
    onNotify(`Comprobante ISLR ${compNum} registrado.`, 'success');
  };

  // Forma 30 IVA & IGTF Calculations memoized for selected period (YYYY-MM)
  const forma30 = useMemo(() => {
    const docsPeriodoVentas = docsVentas.filter((d) => d.fecha.startsWith(periodoFiltro));
    const docsPeriodoCompras = docsCompras.filter((d) => d.fecha.startsWith(periodoFiltro));
    const diarioVentasPeriodo = diarioVentas.filter((m) => m.fecha.startsWith(periodoFiltro));
    const diarioComprasPeriodo = diarioCompras.filter((m) => m.fecha.startsWith(periodoFiltro));

    const ventasBasePeriodo =
      docsPeriodoVentas.reduce((a, d) => a + d.base16Centavos + d.base8Centavos, 0) +
      diarioVentasPeriodo.reduce((a, m) => a + m.credito_centavos, 0);
    const ventasExentasPeriodo = docsPeriodoVentas.reduce((a, d) => a + d.exentoCentavos, 0);
    const debitoFiscalPeriodo =
      docsPeriodoVentas.reduce((a, d) => a + d.iva16Centavos + d.iva8Centavos, 0) +
      Math.round(
        diarioVentasPeriodo.reduce((a, m) => a + m.credito_centavos, 0) *
          (company.alicuotaIvaGeneral / 100)
      );

    const comprasBasePeriodo =
      docsPeriodoCompras.reduce((a, d) => a + d.base16Centavos + d.base8Centavos, 0) +
      diarioComprasPeriodo.reduce((a, m) => a + m.debito_centavos, 0);
    const comprasExentasPeriodo = docsPeriodoCompras.reduce((a, d) => a + d.exentoCentavos, 0);
    const creditoFiscalPeriodo =
      docsPeriodoCompras.reduce((a, d) => a + d.iva16Centavos + d.iva8Centavos, 0) +
      Math.round(
        diarioComprasPeriodo.reduce((a, m) => a + m.debito_centavos, 0) *
          (company.alicuotaIvaGeneral / 100)
      );

    const retencionesIvaSoportadasVentas = docsPeriodoVentas.reduce(
      (a, d) => a + d.ivaRetenidoCentavos,
      0
    );
    const retencionesIvaEnterarCompras = docsPeriodoCompras.reduce(
      (a, d) => a + d.ivaRetenidoCentavos,
      0
    );
    const excedenteAnterior = dataset.excedenteIvaAnteriorCentavos || 0;
    const cuotaTributaria = debitoFiscalPeriodo - creditoFiscalPeriodo - excedenteAnterior;
    const ivaAPagar =
      cuotaTributaria > 0 ? Math.max(0, cuotaTributaria - retencionesIvaSoportadasVentas) : 0;
    const nuevoExcedente = cuotaTributaria < 0 ? Math.abs(cuotaTributaria) : 0;

    const totalIgtfPeriodo =
      docsPeriodoCompras.reduce((a, d) => a + (d.igtfCentavos || 0), 0) +
      docsPeriodoVentas.reduce((a, d) => a + (d.igtfCentavos || 0), 0);

    return {
      docsPeriodoCompras,
      ventasBasePeriodo,
      ventasExentasPeriodo,
      debitoFiscalPeriodo,
      comprasBasePeriodo,
      comprasExentasPeriodo,
      creditoFiscalPeriodo,
      retencionesIvaSoportadasVentas,
      retencionesIvaEnterarCompras,
      excedenteAnterior,
      cuotaTributaria,
      ivaAPagar,
      nuevoExcedente,
      totalIgtfPeriodo,
    };
  }, [
    company.alicuotaIvaGeneral,
    dataset.excedenteIvaAnteriorCentavos,
    diarioCompras,
    diarioVentas,
    docsCompras,
    docsVentas,
    periodoFiltro,
  ]);

  const {
    docsPeriodoCompras,
    ventasBasePeriodo,
    ventasExentasPeriodo,
    debitoFiscalPeriodo,
    comprasBasePeriodo,
    comprasExentasPeriodo,
    creditoFiscalPeriodo,
    retencionesIvaSoportadasVentas,
    retencionesIvaEnterarCompras,
    excedenteAnterior,
    cuotaTributaria,
    ivaAPagar,
    nuevoExcedente,
    totalIgtfPeriodo,
  } = forma30;

  // RIF Terminal digit for SENIAT calendar
  const rifLastDigitMatch = company.rif.match(/(\d)$/);
  const rifTerminal = rifLastDigitMatch ? rifLastDigitMatch[1] : '0';

  const exportRetencionesTXT = () => {
    const lines = docsPeriodoCompras
      .filter((d) => d.ivaRetenidoCentavos !== 0)
      .map((d) => {
        const rifAgente = company.rif.replace(/-/g, '');
        const rifSujeto = d.rifTercero.replace(/-/g, '');
        const periodo = d.fecha.slice(0, 7).replace('-', '');
        const totalDoc =
          d.exentoCentavos + d.base16Centavos + d.iva16Centavos + d.base8Centavos + d.iva8Centavos;
        return [
          rifAgente,
          periodo,
          d.fecha,
          'C',
          d.tipoTransaccion.slice(0, 2),
          rifSujeto,
          d.numeroFactura,
          d.numeroControl,
          (totalDoc / 100).toFixed(2),
          ((d.base16Centavos + d.base8Centavos) / 100).toFixed(2),
          (d.ivaRetenidoCentavos / 100).toFixed(2),
          d.facturaAfectada || '0',
          d.comprobanteRetencion || '0',
          (d.exentoCentavos / 100).toFixed(2),
          company.alicuotaIvaGeneral.toFixed(2),
          '0',
        ].join('\t');
      });

    if (!lines.length) {
      onNotify('No hay retenciones de IVA en compras para el período seleccionado.', 'error');
      return;
    }
    const blob = new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SENIAT_RET_IVA_${company.rif}_${periodoFiltro}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#e5c178]">
            Gestión de Impuestos y Libros Fiscales (SENIAT Venezuela)
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {company.razonSocial} · RIF {company.rif} · Contribuyente {company.tipoContribuyente} ·
            Agente Retención IVA: {company.agenteRetencionIva}% · IGTF 3%:{' '}
            {company.sujetoIgtf ? 'Sujeto Pasivo Especial' : 'No Aplica'}
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-md border border-[#2a3b5c] bg-[#0d1527] px-3 py-1.5">
          <label className="text-xs text-slate-400">Período Fiscal:</label>
          <input
            type="month"
            value={periodoFiltro}
            onChange={(e) => setPeriodoFiltro(e.target.value)}
            className="bg-transparent font-mono-tabular text-xs text-slate-100 focus:outline-none"
          />
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-[#2a3b5c] bg-[#0a0f1d] p-1">
        {(
          [
            ['libros_iva', 'Libros de Compras y Ventas (IVA)'],
            ['forma30', 'Declaración IVA (Forma 30)'],
            ['islr', 'Retenciones ISLR (Decreto 1.808)'],
            ['igtf_calendario', 'IGTF 3% y Calendario Fiscal SENIAT'],
          ] as Array<[TaxSubTab, string]>
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setSubTab(k)}
            className={`whitespace-nowrap rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
              subTab === k
                ? 'bg-[#c5a059] text-[#0a0f1d]'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab !== 'igtf_calendario' && (
        <FiscalCalendar
          compact
          company={company}
          periodo={periodoFiltro}
          onOpenFullCalendar={() => setSubTab('igtf_calendario')}
          onNotify={onNotify}
        />
      )}

      {/* 1. LIBROS AUXILIARES IVA (COMPRAS & VENTAS) */}
      {subTab === 'libros_iva' && (
        <div className="space-y-6">
          {/* Formulario Registro Factura Fiscal SENIAT */}
          <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
            <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
              Registrar Factura / Nota Fiscal (Providencia SNAT/2011/0071)
            </h3>
            <form onSubmit={handleAddDocumentoFiscal} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">Libro Auxiliar</label>
                  <select
                    value={tipoLibro}
                    onChange={(e) => setTipoLibro(e.target.value as 'COMPRAS' | 'VENTAS')}
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
                  >
                    <option value="COMPRAS">Libro de Compras (Art. 75 RLIVA)</option>
                    <option value="VENTAS">Libro de Ventas (Art. 76 RLIVA)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">Fecha Documento</label>
                  <input
                    type="date"
                    value={docFecha}
                    onChange={(e) => setDocFecha(e.target.value)}
                    required
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">RIF Tercero</label>
                  <input
                    type="text"
                    value={rifTercero}
                    onChange={(e) => setRifTercero(e.target.value)}
                    placeholder="J-12345678-9"
                    required
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">
                    Razón Social / Nombre
                  </label>
                  <input
                    type="text"
                    value={razonTercero}
                    onChange={(e) => setRazonTercero(e.target.value)}
                    placeholder="Proveedor o Cliente"
                    required
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">N° Factura</label>
                  <input
                    type="text"
                    value={numFactura}
                    onChange={(e) => setNumFactura(e.target.value)}
                    placeholder="0001452"
                    required
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">
                    N° Control SENIAT
                  </label>
                  <input
                    type="text"
                    value={numControl}
                    onChange={(e) => setNumControl(e.target.value)}
                    placeholder="00-0001452"
                    required
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">Tipo Transacción</label>
                  <select
                    value={tipoTrans}
                    onChange={(e) =>
                      setTipoTrans(
                        e.target.value as '01-Registro' | '02-Nota Crédito' | '03-Nota Débito'
                      )
                    }
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
                  >
                    <option value="01-Registro">01 - Factura / Registro</option>
                    <option value="02-Nota Crédito">02 - Nota de Crédito</option>
                    <option value="03-Nota Débito">03 - Nota de Débito</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">Concepto</label>
                  <input
                    type="text"
                    value={conceptoDoc}
                    onChange={(e) => setConceptoDoc(e.target.value)}
                    placeholder="Descripción operación"
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">
                    Monto Exento / No Gravado
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={montoExento}
                    onChange={(e) => setMontoExento(e.target.value)}
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-right font-mono-tabular text-xs text-slate-100"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">
                    Base Imponible ({company.alicuotaIvaGeneral}%)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={base16}
                    onChange={(e) => setBase16(e.target.value)}
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-right font-mono-tabular text-xs text-slate-100"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">
                    Base Reducida ({company.alicuotaIvaReducida}%)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={base8}
                    onChange={(e) => setBase8(e.target.value)}
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-right font-mono-tabular text-xs text-slate-100"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">Retención IVA (%)</label>
                  <select
                    value={pctRetIva}
                    onChange={(e) => setPctRetIva(Number(e.target.value) as 0 | 75 | 100)}
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
                  >
                    <option value={0}>0% (Sin Retención)</option>
                    <option value={75}>75% (Contribuyente Ordinario)</option>
                    <option value={100}>100% (Contribuyente Especial / Sin RIF)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={pagadoDivisas}
                    onChange={(e) => setPagadoDivisas(e.target.checked)}
                    className="h-4 w-4 accent-[#c5a059]"
                  />
                  Pago efectuado en divisas / moneda extranjera (calcula IGTF 3% si aplica)
                </label>

                <button
                  type="submit"
                  className="rounded-md bg-[#c5a059] px-5 py-2 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
                >
                  Registrar en Libro Fiscal
                </button>
              </div>
            </form>
          </div>

          {/* Libro de Ventas */}
          <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
            <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
              Libro de Ventas (Art. 76 Reglamento Ley de IVA)
            </h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#2a3b5c] bg-[#0a0f1d] text-xs font-semibold text-[#c5a059]">
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Origen / Doc.</th>
                    <th className="px-3 py-2">RIF Cliente</th>
                    <th className="px-3 py-2">Concepto / Razón</th>
                    <th className="px-3 py-2 text-right">Exento</th>
                    <th className="px-3 py-2 text-right">Base Gravada</th>
                    <th className="px-3 py-2 text-right">IVA Débito</th>
                    <th className="px-3 py-2 text-right">IVA Retenido</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {diarioVentas.map((m) => {
                    const ivaEst = Math.round(
                      (m.credito_centavos * company.alicuotaIvaGeneral) / 100
                    );
                    return (
                      <tr key={`dv-${m.id}`} className="border-b border-[#2a3b5c]/60">
                        <td className="px-3 py-2 font-mono-tabular text-xs">
                          {m.mov_fecha || m.fecha}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <button
                            type="button"
                            onClick={() => onJumpToEditAsiento(m.asiento_num)}
                            className="font-mono-tabular text-[#e5c178] hover:underline"
                          >
                            Diario #{m.asiento_num}
                          </button>
                        </td>
                        <td className="px-3 py-2 font-mono-tabular text-xs">
                          {m.mov_tercero || m.tercero || '—'}
                        </td>
                        <td className="px-3 py-2 text-xs">{m.mov_concepto || m.concepto}</td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs">0.00</td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs text-emerald-400">
                          {centsToStr(m.credito_centavos)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs text-slate-200">
                          {centsToStr(ivaEst)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs">0.00</td>
                        <td className="px-3 py-2 text-xs text-slate-500">Auto</td>
                      </tr>
                    );
                  })}
                  {docsVentas.map((d) => (
                    <tr key={d.id} className="border-b border-[#2a3b5c]/60">
                      <td className="px-3 py-2 font-mono-tabular text-xs">{d.fecha}</td>
                      <td className="px-3 py-2 font-mono-tabular text-xs text-sky-400">
                        Fact. {d.numeroFactura} / {d.numeroControl}
                      </td>
                      <td className="px-3 py-2 font-mono-tabular text-xs">{d.rifTercero}</td>
                      <td className="px-3 py-2 text-xs">
                        {d.razonSocialTercero} · {d.concepto}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs">
                        {centsToStr(d.exentoCentavos)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs text-emerald-400">
                        {centsToStr(d.base16Centavos + d.base8Centavos)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs text-slate-200">
                        {centsToStr(d.iva16Centavos + d.iva8Centavos)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs text-amber-300">
                        {centsToStr(d.ivaRetenidoCentavos)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteDoc(d.id)}
                          className="text-xs text-rose-400 hover:underline"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                  {diarioVentas.length === 0 && docsVentas.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400">
                        Sin registros en el Libro de Ventas.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Libro de Compras */}
          <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a3b5c] pb-3">
              <h3 className="text-base font-semibold text-[#c5a059]">
                Libro de Compras (Art. 75 Reglamento Ley de IVA)
              </h3>
              <button
                type="button"
                onClick={exportRetencionesTXT}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#2a3b5c] bg-[#16223b] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-[#1e2e4f]"
              >
                <Download className="h-3.5 w-3.5" />
                Exportar TXT Retenciones SENIAT
              </button>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#2a3b5c] bg-[#0a0f1d] text-xs font-semibold text-[#c5a059]">
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Origen / Factura</th>
                    <th className="px-3 py-2">RIF Proveedor</th>
                    <th className="px-3 py-2">Concepto / Razón</th>
                    <th className="px-3 py-2 text-right">Exento</th>
                    <th className="px-3 py-2 text-right">Base Gravada</th>
                    <th className="px-3 py-2 text-right">IVA Crédito</th>
                    <th className="px-3 py-2 text-right">Ret. IVA / Comprobante</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {diarioCompras.map((m) => {
                    const ivaEst = Math.round(
                      (m.debito_centavos * company.alicuotaIvaGeneral) / 100
                    );
                    return (
                      <tr key={`dc-${m.id}`} className="border-b border-[#2a3b5c]/60">
                        <td className="px-3 py-2 font-mono-tabular text-xs">
                          {m.mov_fecha || m.fecha}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <button
                            type="button"
                            onClick={() => onJumpToEditAsiento(m.asiento_num)}
                            className="font-mono-tabular text-[#e5c178] hover:underline"
                          >
                            Diario #{m.asiento_num}
                          </button>
                        </td>
                        <td className="px-3 py-2 font-mono-tabular text-xs">
                          {m.mov_tercero || m.tercero || '—'}
                        </td>
                        <td className="px-3 py-2 text-xs">{m.mov_concepto || m.concepto}</td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs">0.00</td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs text-rose-400">
                          {centsToStr(m.debito_centavos)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs text-slate-200">
                          {centsToStr(ivaEst)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs">0.00</td>
                        <td className="px-3 py-2 text-xs text-slate-500">Auto</td>
                      </tr>
                    );
                  })}
                  {docsCompras.map((d) => (
                    <tr key={d.id} className="border-b border-[#2a3b5c]/60">
                      <td className="px-3 py-2 font-mono-tabular text-xs">{d.fecha}</td>
                      <td className="px-3 py-2 font-mono-tabular text-xs text-sky-400">
                        Fact. {d.numeroFactura} / {d.numeroControl}
                      </td>
                      <td className="px-3 py-2 font-mono-tabular text-xs">{d.rifTercero}</td>
                      <td className="px-3 py-2 text-xs">
                        {d.razonSocialTercero} · {d.concepto}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs">
                        {centsToStr(d.exentoCentavos)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs text-rose-400">
                        {centsToStr(d.base16Centavos + d.base8Centavos)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs text-slate-200">
                        {centsToStr(d.iva16Centavos + d.iva8Centavos)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs text-amber-300">
                        {centsToStr(d.ivaRetenidoCentavos)}
                        {d.comprobanteRetencion ? ` (${d.comprobanteRetencion})` : ''}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteDoc(d.id)}
                          className="text-xs text-rose-400 hover:underline"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                  {diarioCompras.length === 0 && docsCompras.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400">
                        Sin registros en el Libro de Compras.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 2. DECLARACIÓN IVA FORMA 30 */}
      {subTab === 'forma30' && (
        <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
          <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
            Resumen Autoliquidación IVA — Forma 30 SENIAT ({periodoFiltro})
          </h3>
          <div className="mt-5 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="space-y-2.5 text-sm">
              <div className="text-xs font-bold tracking-wide text-[#e5c178] uppercase">
                1. Débitos Fiscales (Ventas)
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Ventas Internas No Gravadas / Exentas:</span>
                <span className="font-mono-tabular">{centsToStr(ventasExentasPeriodo)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">
                  Ventas Internas Gravadas ({company.alicuotaIvaGeneral}% /{' '}
                  {company.alicuotaIvaReducida}%):
                </span>
                <span className="font-mono-tabular">{centsToStr(ventasBasePeriodo)}</span>
              </div>
              <div className="flex justify-between border-t border-[#2a3b5c] pt-2 font-semibold">
                <span className="text-slate-200">Total Débito Fiscal del Período:</span>
                <span className="font-mono-tabular text-rose-400">
                  {centsToStr(debitoFiscalPeriodo)}
                </span>
              </div>

              <div className="pt-4 text-xs font-bold tracking-wide text-[#e5c178] uppercase">
                2. Créditos Fiscales (Compras)
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Compras No Gravadas / Exentas:</span>
                <span className="font-mono-tabular">{centsToStr(comprasExentasPeriodo)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Compras Internas Gravadas:</span>
                <span className="font-mono-tabular">{centsToStr(comprasBasePeriodo)}</span>
              </div>
              <div className="flex justify-between border-t border-[#2a3b5c] pt-2 font-semibold">
                <span className="text-slate-200">Total Crédito Fiscal Deducible:</span>
                <span className="font-mono-tabular text-emerald-400">
                  {centsToStr(creditoFiscalPeriodo)}
                </span>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-[#2a3b5c] bg-[#0a0f1d] p-5 text-sm">
              <div className="text-xs font-bold tracking-wide text-[#e5c178] uppercase">
                3. Determinación de la Cuota Tributaria
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Excedente Crédito Fiscal Mes Anterior:</span>
                <span className="font-mono-tabular">{centsToStr(excedenteAnterior)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Cuota Tributaria (Débito - Crédito):</span>
                <span className="font-mono-tabular font-semibold">
                  {centsToStr(cuotaTributaria)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">(-) Retenciones de IVA Soportadas (Clientes):</span>
                <span className="font-mono-tabular text-emerald-400">
                  ({centsToStr(retencionesIvaSoportadasVentas)})
                </span>
              </div>
              <div className="flex justify-between border-t border-[#2a3b5c] pt-3 text-base font-bold">
                <span className="text-[#e5c178]">IVA Neto a Pagar (Forma 30):</span>
                <span className="font-mono-tabular text-rose-400">{centsToStr(ivaAPagar)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-400">
                <span>Excedente de Crédito Fiscal para Próximo Período:</span>
                <span className="font-mono-tabular text-emerald-400">
                  {centsToStr(nuevoExcedente)}
                </span>
              </div>
              <div className="mt-3 flex justify-between border-t border-[#2a3b5c] pt-3 text-xs font-semibold">
                <span className="text-amber-300">
                  Retenciones de IVA Practicadas por Enterar (Planilla 99035):
                </span>
                <span className="font-mono-tabular text-amber-300">
                  {centsToStr(retencionesIvaEnterarCompras)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. RETENCIONES DE ISLR (DECRETO 1.808) */}
      {subTab === 'islr' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
            <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
              Cálculo y Registro de Retención ISLR (Decreto 1.808 Venezuela)
            </h3>
            <p className="mt-2 text-xs text-slate-400">
              Valor Unidad Tributaria (UT) configurada para {company.razonSocial}: Bs{' '}
              {company.unidadTributariaBs.toFixed(2)} · Factor Sustraendo PNR: 83.3334 UT
            </p>
            <form onSubmit={handleAddIslr} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">Fecha Pago / Abono</label>
                  <input
                    type="date"
                    value={islrFecha}
                    onChange={(e) => setIslrFecha(e.target.value)}
                    required
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">RIF Sujeto Retenido</label>
                  <input
                    type="text"
                    value={islrRif}
                    onChange={(e) => setIslrRif(e.target.value)}
                    placeholder="V-12345678-0 / J-..."
                    required
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">
                    Nombre / Razón Social
                  </label>
                  <input
                    type="text"
                    value={islrRazon}
                    onChange={(e) => setIslrRazon(e.target.value)}
                    placeholder="Beneficiario del pago"
                    required
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">Tipo de Persona</label>
                  <select
                    value={islrTipoPersona}
                    onChange={(e) =>
                      setIslrTipoPersona(e.target.value as 'PNR' | 'PNNR' | 'PJD' | 'PJND')
                    }
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
                  >
                    <option value="PJD">PJ Domiciliada (Sin Sustraendo)</option>
                    <option value="PNR">PN Residente (Aplica Sustraendo)</option>
                    <option value="PNNR">PN No Residente (34%)</option>
                    <option value="PJND">PJ No Domiciliada (34%)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label className="text-xs font-semibold text-slate-400">
                    Concepto Decreto 1.808
                  </label>
                  <select
                    value={islrCodConcepto}
                    onChange={(e) => setIslrCodConcepto(e.target.value)}
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
                  >
                    {CONCEPTOS_ISLR_VENEZUELA.map((c) => (
                      <option key={c.codigo} value={c.codigo}>
                        [{c.codigo}] {c.descripcion} (PNR {c.porcentajePNR}% / PJD{' '}
                        {c.porcentajePJD}%)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">N° Factura / Control</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={islrFactura}
                      onChange={(e) => setIslrFactura(e.target.value)}
                      placeholder="Factura"
                      required
                      className="w-1/2 rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-2.5 py-2 font-mono-tabular text-xs text-slate-100"
                    />
                    <input
                      type="text"
                      value={islrControl}
                      onChange={(e) => setIslrControl(e.target.value)}
                      placeholder="Control"
                      className="w-1/2 rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-2.5 py-2 font-mono-tabular text-xs text-slate-100"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-400">
                    Base Imponible Sujeta a Retención
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={islrBase}
                    onChange={(e) => setIslrBase(e.target.value)}
                    className="rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-2 text-right font-mono-tabular text-xs text-slate-100"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#2a3b5c] pt-3">
                <div className="flex flex-wrap gap-4 text-xs text-slate-300">
                  <span>
                    Alícuota: <strong className="font-mono-tabular text-[#e5c178]">{islrPct}%</strong>
                  </span>
                  <span>
                    Sustraendo:{' '}
                    <strong className="font-mono-tabular">{centsToStr(sustraendoCents)}</strong>
                  </span>
                  <span>
                    Impuesto a Retener:{' '}
                    <strong className="font-mono-tabular text-emerald-400">
                      {centsToStr(islrNetoRetenidoCents)}
                    </strong>
                  </span>
                </div>
                <button
                  type="submit"
                  className="rounded-md bg-[#c5a059] px-5 py-2 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
                >
                  Emitir Comprobante Retención ISLR
                </button>
              </div>
            </form>
          </div>

          <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
            <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
              Relación Mensual de Retenciones ISLR (XML / AR-CV)
            </h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#2a3b5c] bg-[#0a0f1d] text-xs font-semibold text-[#c5a059]">
                    <th className="px-3 py-2">Comprobante</th>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">RIF Sujeto</th>
                    <th className="px-3 py-2">Concepto</th>
                    <th className="px-3 py-2 text-right">Base</th>
                    <th className="px-3 py-2 text-right">%</th>
                    <th className="px-3 py-2 text-right">Sustraendo</th>
                    <th className="px-3 py-2 text-right">Retenido</th>
                  </tr>
                </thead>
                <tbody>
                  {(dataset.retencionesIslr || []).length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-xs text-slate-400">
                        Sin retenciones de ISLR registradas para esta entidad.
                      </td>
                    </tr>
                  ) : (
                    (dataset.retencionesIslr || []).map((r) => (
                      <tr key={r.id} className="border-b border-[#2a3b5c]/60">
                        <td className="px-3 py-2 font-mono-tabular text-xs text-sky-400">
                          {r.comprobanteNumero}
                        </td>
                        <td className="px-3 py-2 font-mono-tabular text-xs">{r.fecha}</td>
                        <td className="px-3 py-2 font-mono-tabular text-xs">
                          {r.rifSujeto} · {r.razonSocial}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          [{r.codigoConcepto}] {r.concepto}
                        </td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs">
                          {centsToStr(r.montoBaseCentavos)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs">
                          {r.porcentajeRetencion}%
                        </td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs">
                          {centsToStr(r.sustraendoCentavos)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs font-bold text-emerald-400">
                          {centsToStr(r.montoRetenidoCentavos)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 4. IGTF 3% Y CALENDARIO FISCAL SENIAT */}
      {subTab === 'igtf_calendario' && (
        <div className="space-y-6">
          <FiscalCalendar
            company={company}
            periodo={periodoFiltro}
            onNotify={onNotify}
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
              <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
                IGTF 3% — Operaciones en Divisas (G.O. Ext. 6.687)
              </h3>
              <p className="mt-3 text-xs leading-relaxed text-slate-400">
                Aplica para Sujetos Pasivos Especiales sobre pagos efectuados en moneda distinta al
                Bolívar de curso legal o criptoactivos no emitidos por la República.
              </p>
              <div className="mt-5 space-y-3 rounded-md border border-[#2a3b5c] bg-[#0a0f1d] p-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Condición de la Entidad:</span>
                  <span className="font-semibold text-slate-100">
                    {company.sujetoIgtf
                      ? 'Agente de Percepción / Sujeto Pasivo Especial (3%)'
                      : 'Contribuyente Ordinario (No Agente IGTF)'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">IGTF Acumulado en Período ({periodoFiltro}):</span>
                  <span className="font-mono-tabular font-bold text-amber-300">
                    {centsToStr(totalIgtfPeriodo)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
              <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
                Parámetros Tributarios Base (Terminal RIF: {rifTerminal})
              </h3>
              <div className="mt-4 space-y-2.5 text-xs">
                <div className="flex justify-between border-b border-[#2a3b5c]/60 pb-2">
                  <span className="text-slate-300">
                    IVA Forma 30 ({company.tipoContribuyente === 'Especial' ? 'Quincenal' : 'Mensual'}):
                  </span>
                  <span className="font-mono-tabular font-semibold text-[#e5c178]">
                    {company.tipoContribuyente === 'Especial'
                      ? `1ra y 2da Quincena · Terminal ${rifTerminal}`
                      : 'Primeros 15 días hábiles del mes siguiente'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-[#2a3b5c]/60 pb-2">
                  <span className="text-slate-300">Retenciones IVA (Planilla 99035):</span>
                  <span className="font-mono-tabular text-slate-200">
                    {company.agenteRetencionIva > 0
                      ? `Enterar según calendario SPE (Terminal ${rifTerminal})`
                      : 'No designado Agente de Retención'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-[#2a3b5c]/60 pb-2">
                  <span className="text-slate-300">Retenciones ISLR (XML Decreto 1.808):</span>
                  <span className="font-mono-tabular text-slate-200">
                    {company.agenteRetencionIslr
                      ? 'Dentro de los primeros 10 días hábiles siguientes'
                      : 'No aplica'}
                  </span>
                </div>
                <div className="flex justify-between pb-1">
                  <span className="text-slate-300">Declaración Definitiva ISLR (Forma DPJ-99026):</span>
                  <span className="font-mono-tabular text-slate-200">
                    Dentro de los 3 meses siguientes al cierre del ejercicio
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
