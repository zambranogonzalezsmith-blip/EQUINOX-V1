import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Printer, Download } from 'lucide-react';
import { CompanyDataset, CompanyProfile, CuentaNIC } from '../types/accounting';
import { centsToStr, nicConvertAmountToBs, todayISO } from '../utils/monetary';

interface EstadosFinancierosModuleProps {
  company: CompanyProfile;
  dataset: CompanyDataset;
  onShowAccountDetails: (codigo: string) => void;
}

interface MayorAccount extends CuentaNIC {
  deb: number;
  cred: number;
  saldo: number;
}

type ReportSubTab = 'balance' | 'resultados' | 'comprobacion' | 'flujo' | 'patrimonio';

const isCorriente = (item: MayorAccount) => {
  if (item.clasificacion_nic === 'Corriente') return true;
  if (item.clasificacion_nic === 'No Corriente') return false;
  return item.seccion_destino
    ? /corriente/i.test(item.seccion_destino) && !/no corriente/i.test(item.seccion_destino)
    : true;
};

const sumSaldo = (arr: MayorAccount[]) => arr.reduce((a, m) => a + m.saldo, 0);

const signedBalanceSaldo = (acc: MayorAccount) => {
  if (acc.tipo_cuenta === 'Activo' && acc.naturaleza === 'Crédito') return -acc.saldo;
  if (acc.tipo_cuenta === 'Pasivo' && acc.naturaleza === 'Débito') return -acc.saldo;
  if (acc.tipo_cuenta === 'Patrimonio' && acc.naturaleza === 'Débito') return -acc.saldo;
  return acc.saldo;
};

const sumSigned = (arr: MayorAccount[]) => arr.reduce((a, m) => a + signedBalanceSaldo(m), 0);

export const EstadosFinancierosModule: React.FC<EstadosFinancierosModuleProps> = ({
  company,
  dataset,
  onShowAccountDetails,
}) => {
  const [subTab, setSubTab] = useState<ReportSubTab>('balance');
  const [fechaCorte, setFechaCorte] = useState<string>(todayISO());
  const [mostrarEquivalenteBs, setMostrarEquivalenteBs] = useState<boolean>(false);
  const [showPrintPreview, setShowPrintPreview] = useState<boolean>(false);

  useEffect(() => {
    if (!showPrintPreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowPrintPreview(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPrintPreview]);

  const activeRate = useMemo(() => {
    const rates = dataset.exchangeRates;
    if (!rates) return null;
    if (rates[fechaCorte]) return rates[fechaCorte];
    const sorted = Object.keys(rates).sort();
    return sorted.length ? rates[sorted[sorted.length - 1]] : null;
  }, [dataset.exchangeRates, fechaCorte]);

  const formatMoney = useCallback(
    (cents: number): string => {
      if (mostrarEquivalenteBs && activeRate && company.monedaFuncional === 'USD') {
        return `Bs ${centsToStr(nicConvertAmountToBs(cents, activeRate))}`;
      }
      const prefix = company.monedaFuncional === 'USD' ? 'USD ' : 'Bs ';
      return `${prefix}${centsToStr(cents)}`;
    },
    [activeRate, company.monedaFuncional, mostrarEquivalenteBs]
  );

  // O(N + M) single-pass aggregation from active journal entries up to fechaCorte
  const reports = useMemo(() => {
    const catalogMap = new Map<string, CuentaNIC>(dataset.catalogo.map((c) => [c.codigo, c]));
    const sumsByCode = new Map<string, { deb: number; cred: number }>();

    for (const m of dataset.diario) {
      if (m.estado !== 'ACTIVO' || m.fecha > fechaCorte) continue;
      let bucket = sumsByCode.get(m.codigo_cuenta);
      if (!bucket) {
        bucket = { deb: 0, cred: 0 };
        sumsByCode.set(m.codigo_cuenta, bucket);
      }
      bucket.deb += m.debito_centavos;
      bucket.cred += m.credito_centavos;
    }

    const mayor: MayorAccount[] = [];
    for (const [codigo, sums] of sumsByCode.entries()) {
      const c = catalogMap.get(codigo);
      if (!c) continue;
      const saldo = c.naturaleza === 'Débito' ? sums.deb - sums.cred : sums.cred - sums.deb;
      mayor.push({ ...c, deb: sums.deb, cred: sums.cred, saldo });
    }
    mayor.sort((a, b) => a.tipo_indice - b.tipo_indice);

    const ingresosAccounts = mayor.filter((m) => m.tipo_cuenta === 'Ingreso');
    const costosAccounts = mayor.filter((m) => m.tipo_cuenta === 'Costo');
    const gastosAccounts = mayor.filter(
      (m) => m.tipo_cuenta === 'Gasto' || m.tipo_cuenta === 'Egreso'
    );

    const totalIngresos = sumSaldo(ingresosAccounts);
    const totalCostos = sumSaldo(costosAccounts);
    const utilidadBruta = totalIngresos - totalCostos;
    const totalGastos = sumSaldo(gastosAccounts);
    const utilidadAntesImpuestos = utilidadBruta - totalGastos;

    const capitalSocialCents = sumSaldo(
      mayor.filter((m) => m.codigo === '3101' || /capital/i.test(m.nombre))
    );
    const reservaExistenteCents = sumSaldo(
      mayor.filter((m) => m.codigo === '3102' || /reserva legal/i.test(m.nombre))
    );
    const topeReservaLegal = Math.round(capitalSocialCents * 0.1);
    const reservaRequerida =
      utilidadAntesImpuestos > 0 && reservaExistenteCents < topeReservaLegal
        ? Math.min(Math.round(utilidadAntesImpuestos * 0.05), topeReservaLegal - reservaExistenteCents)
        : 0;
    const utilidadEjercicio = utilidadAntesImpuestos;

    const activos = mayor.filter((m) => m.tipo_cuenta === 'Activo');
    const pasivos = mayor.filter((m) => m.tipo_cuenta === 'Pasivo');
    const patrimonio = mayor.filter((m) => m.tipo_cuenta === 'Patrimonio');

    const activosCorrientes = activos.filter(isCorriente);
    const activosNoCorrientes = activos.filter((a) => !isCorriente(a));
    const pasivosCorrientes = pasivos.filter(isCorriente);
    const pasivosNoCorrientes = pasivos.filter((p) => !isCorriente(p));

    const totalActivosCorr = sumSigned(activosCorrientes);
    const totalActivosNoCorr = sumSigned(activosNoCorrientes);
    const totalActivos = totalActivosCorr + totalActivosNoCorr;

    const totalPasivosCorr = sumSigned(pasivosCorrientes);
    const totalPasivosNoCorr = sumSigned(pasivosNoCorrientes);
    const totalPasivos = totalPasivosCorr + totalPasivosNoCorr;

    const totalPatrimonioCuentas = sumSigned(patrimonio);
    const totalPatrimonio = totalPatrimonioCuentas + utilidadEjercicio;
    const pasivoMasPatrimonio = totalPasivos + totalPatrimonio;
    const balanceCuadrado = totalActivos === pasivoMasPatrimonio;

    let totalDebComprobacion = 0;
    let totalCredComprobacion = 0;
    let totalDeudorComprobacion = 0;
    let totalAcreedorComprobacion = 0;
    for (const m of mayor) {
      totalDebComprobacion += m.deb;
      totalCredComprobacion += m.cred;
      if (m.deb > m.cred) totalDeudorComprobacion += m.deb - m.cred;
      else if (m.cred > m.deb) totalAcreedorComprobacion += m.cred - m.deb;
    }

    const efectivoTotal = sumSigned(
      mayor.filter(
        (m) =>
          m.tipo_cuenta === 'Activo' &&
          (m.codigo.startsWith('1101') || m.codigo.startsWith('1102') || m.codigo.startsWith('1103'))
      )
    );
    const depreciacionPeriodo = sumSaldo(mayor.filter((m) => m.codigo === '1202'));
    const variacionCxC = -sumSigned(mayor.filter((m) => m.codigo === '1104'));
    const variacionInventarios = -sumSigned(mayor.filter((m) => m.codigo === '1108'));
    const variacionCxPyFiscales = sumSigned(
      pasivosCorrientes.filter((m) => !m.codigo.startsWith('22'))
    );
    const flujoOperacion =
      utilidadEjercicio +
      depreciacionPeriodo +
      variacionCxC +
      variacionInventarios +
      variacionCxPyFiscales;
    const flujoInversion = -sumSigned(
      activosNoCorrientes.filter((m) => m.naturaleza === 'Débito')
    );
    const flujoFinanciamiento = totalPasivosNoCorr + totalPatrimonioCuentas;

    return {
      mayor,
      ingresosAccounts,
      costosAccounts,
      gastosAccounts,
      totalIngresos,
      totalCostos,
      utilidadBruta,
      totalGastos,
      capitalSocialCents,
      reservaExistenteCents,
      reservaRequerida,
      utilidadEjercicio,
      activos,
      pasivos,
      patrimonio,
      activosCorrientes,
      activosNoCorrientes,
      pasivosCorrientes,
      pasivosNoCorrientes,
      totalActivosCorr,
      totalActivosNoCorr,
      totalActivos,
      totalPasivosCorr,
      totalPasivosNoCorr,
      totalPasivos,
      totalPatrimonioCuentas,
      totalPatrimonio,
      pasivoMasPatrimonio,
      balanceCuadrado,
      totalDebComprobacion,
      totalCredComprobacion,
      totalDeudorComprobacion,
      totalAcreedorComprobacion,
      efectivoTotal,
      depreciacionPeriodo,
      variacionCxC,
      variacionInventarios,
      variacionCxPyFiscales,
      flujoOperacion,
      flujoInversion,
      flujoFinanciamiento,
    };
  }, [dataset.catalogo, dataset.diario, fechaCorte]);

  const {
    mayor,
    ingresosAccounts,
    costosAccounts,
    gastosAccounts,
    totalIngresos,
    totalCostos,
    utilidadBruta,
    totalGastos,
    capitalSocialCents,
    reservaExistenteCents,
    reservaRequerida,
    utilidadEjercicio,
    activos,
    pasivos,
    patrimonio,
    activosCorrientes,
    activosNoCorrientes,
    pasivosCorrientes,
    pasivosNoCorrientes,
    totalActivosCorr,
    totalActivosNoCorr,
    totalActivos,
    totalPasivosCorr,
    totalPasivosNoCorr,
    totalPasivos,
    totalPatrimonioCuentas,
    totalPatrimonio,
    pasivoMasPatrimonio,
    balanceCuadrado,
    totalDebComprobacion,
    totalCredComprobacion,
    totalDeudorComprobacion,
    totalAcreedorComprobacion,
    efectivoTotal,
    depreciacionPeriodo,
    variacionCxC,
    variacionInventarios,
    variacionCxPyFiscales,
    flujoOperacion,
    flujoInversion,
    flujoFinanciamiento,
  } = reports;

  const exportCSV = () => {
    const rows: string[][] = [
      ['EQUINOX-BOOKS · REPORTE FINANCIERO NIC / VEN-NIF'],
      ['Entidad', company.razonSocial, 'RIF', company.rif],
      ['Fecha de Corte', fechaCorte, 'Moneda', mostrarEquivalenteBs ? 'VES (BCV)' : company.monedaFuncional],
      [],
      ['Codigo', 'Cuenta', 'Seccion NIC', 'Debitos', 'Creditos', 'Saldo'],
      ...mayor.map((m) => [
        m.codigo,
        m.nombre,
        m.seccion_destino,
        centsToStr(m.deb),
        centsToStr(m.cred),
        centsToStr(signedBalanceSaldo(m)),
      ]),
      [],
      ['Total Activos', centsToStr(totalActivos)],
      ['Total Pasivos', centsToStr(totalPasivos)],
      ['Patrimonio + Resultado', centsToStr(totalPatrimonio)],
      ['Utilidad / Perdida del Ejercicio', centsToStr(utilidadEjercicio)],
    ];

    const csv = rows
      .map((r) =>
        r
          .map((cell) => {
            const s = String(cell ?? '');
            return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(',')
      )
      .join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Estados_Financieros_${company.rif}_${fechaCorte}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const renderSectionTable = (title: string, items: MayorAccount[], subtotal: number) => (
    <div className="mb-5">
      <h4 className="mb-2 text-xs font-bold tracking-wide text-[#e5c178] uppercase">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#233352] bg-[#0a0f1d] text-xs font-semibold text-slate-400">
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Cuenta Contable</th>
              <th className="px-3 py-2">Norma</th>
              <th className="px-3 py-2 text-right">Débitos</th>
              <th className="px-3 py-2 text-right">Créditos</th>
              <th className="px-3 py-2 text-right">Saldo</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-3 text-xs text-slate-500">
                  Sin cuentas con movimientos en esta sección.
                </td>
              </tr>
            ) : (
              items.map((c) => (
                <tr
                  key={c.codigo}
                  className="border-b border-[#233352]/50 transition-colors hover:bg-[#16223b]"
                >
                  <td className="px-3 py-2 font-mono-tabular text-xs text-sky-400">{c.codigo}</td>
                  <td className="px-3 py-2 text-xs font-medium text-slate-100">{c.nombre}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{c.norma_nic || 'NIC 1'}</td>
                  <td className="px-3 py-2 text-right font-mono-tabular text-xs text-emerald-400">
                    {formatMoney(c.deb)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono-tabular text-xs text-rose-400">
                    {formatMoney(c.cred)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono-tabular text-xs font-semibold text-slate-100">
                    {formatMoney(signedBalanceSaldo(c))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onShowAccountDetails(c.codigo)}
                      className="rounded bg-[#233352] px-2 py-1 text-xs font-medium text-slate-200 hover:bg-[#2f456e]"
                    >
                      Ver Movs
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-[#233352] bg-[#0a0f1d]/70 text-xs font-bold">
              <td colSpan={5} className="px-3 py-2 text-right text-slate-300">
                Subtotal {title}:
              </td>
              <td className="px-3 py-2 text-right font-mono-tabular text-[#e5c178]">
                {formatMoney(subtotal)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-[#e5c178]">
            Reportes Financieros Automáticos (NIC / VEN-NIF)
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {company.razonSocial} · RIF {company.rif} · Contador: {company.contadorNombre} (
            {company.cpcNumero})
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 rounded-md border border-[#233352] bg-[#0d1527] px-3 py-1.5">
            <label className="text-xs text-slate-400">Corte:</label>
            <input
              type="date"
              value={fechaCorte}
              onChange={(e) => setFechaCorte(e.target.value)}
              className="bg-transparent font-mono-tabular text-xs text-slate-100 focus:outline-none"
            />
          </div>

          {company.monedaFuncional === 'USD' && (
            <button
              type="button"
              onClick={() => setMostrarEquivalenteBs((v) => !v)}
              className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                mostrarEquivalenteBs
                  ? 'border-[#c5a059] bg-[#c5a059]/15 text-[#e5c178]'
                  : 'border-[#233352] bg-[#0d1527] text-slate-300 hover:border-[#c5a059]/50'
              }`}
            >
              {mostrarEquivalenteBs
                ? `Mostrando Bs (BCV ${activeRate ? activeRate.toFixed(4) : 'N/D'})`
                : 'Convertir a Bs (NIC 21)'}
            </button>
          )}

          <button
            type="button"
            onClick={exportCSV}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#233352] bg-[#16223b] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-[#1e2e4f]"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </button>

          <button
            type="button"
            onClick={() => setShowPrintPreview(true)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-[#c5a059] px-3.5 py-1.5 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
          >
            <Printer className="h-3.5 w-3.5" />
            Informe Oficial / PDF
          </button>
        </div>
      </div>

      {/* Sub-navegación de Estados Financieros NIC */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-[#233352] bg-[#0a0f1d] p-1">
        {(
          [
            ['balance', 'Balance General (NIC 1)'],
            ['resultados', 'Estado de Resultados (NIC 1)'],
            ['comprobacion', 'Balance de Comprobación'],
            ['flujo', 'Flujos de Efectivo (NIC 7)'],
            ['patrimonio', 'Cambios en el Patrimonio'],
          ] as Array<[ReportSubTab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSubTab(key)}
            className={`whitespace-nowrap rounded-md px-3.5 py-2 text-xs font-semibold transition-colors ${
              subTab === key
                ? 'bg-[#c5a059] text-[#0a0f1d]'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 1. Balance General (NIC 1) */}
      {subTab === 'balance' && (
        <div className="rounded-lg border border-[#233352] bg-[#0d1527] p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-[#233352] pb-3">
            <div>
              <h3 className="text-base font-semibold text-[#c5a059]">
                Estado de Situación Financiera (NIC 1 · VEN-NIF)
              </h3>
              <p className="text-xs text-slate-400">
                Al {fechaCorte} · Clasificación Corriente y No Corriente
              </p>
            </div>
            <div
              className={`rounded-md border px-3 py-1.5 text-xs font-bold ${
                balanceCuadrado
                  ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-400'
                  : 'border-rose-500/40 bg-rose-950/30 text-rose-400'
              }`}
            >
              {balanceCuadrado
                ? '✔ Ecuación Patrimonial Cuadrada (Activo = Pasivo + Patrimonio)'
                : '✖ Desbalance Detectado en Auditoría'}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              {renderSectionTable('Activos Corrientes', activosCorrientes, totalActivosCorr)}
              {renderSectionTable('Activos No Corrientes', activosNoCorrientes, totalActivosNoCorr)}
              <div className="flex items-center justify-between border-t-2 border-[#c5a059]/60 pt-3 text-sm font-bold">
                <span className="text-slate-200">TOTAL ACTIVOS</span>
                <span className="font-mono-tabular text-emerald-400">
                  {formatMoney(totalActivos)}
                </span>
              </div>
            </div>

            <div>
              {renderSectionTable('Pasivos Corrientes', pasivosCorrientes, totalPasivosCorr)}
              {renderSectionTable('Pasivos No Corrientes', pasivosNoCorrientes, totalPasivosNoCorr)}
              {renderSectionTable('Patrimonio Neto', patrimonio, totalPatrimonioCuentas)}

              <div className="space-y-2 border-t-2 border-[#c5a059]/60 pt-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Pasivos:</span>
                  <span className="font-mono-tabular font-semibold text-rose-400">
                    {formatMoney(totalPasivos)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Resultado del Ejercicio Actual:</span>
                  <span className="font-mono-tabular font-semibold text-slate-100">
                    {formatMoney(utilidadEjercicio)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Patrimonio (Capital + Resultados):</span>
                  <span className="font-mono-tabular font-semibold text-slate-100">
                    {formatMoney(totalPatrimonio)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-[#233352] pt-2 text-sm font-bold">
                  <span className="text-slate-200">TOTAL PASIVO + PATRIMONIO</span>
                  <span className="font-mono-tabular text-[#e5c178]">
                    {formatMoney(pasivoMasPatrimonio)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Estado de Resultados Integral (NIC 1) */}
      {subTab === 'resultados' && (
        <div className="rounded-lg border border-[#233352] bg-[#0d1527] p-6">
          <div className="mb-5 border-b border-[#233352] pb-3">
            <h3 className="text-base font-semibold text-[#c5a059]">
              Estado de Resultados Integral — Método de Función de los Gastos (NIC 1)
            </h3>
            <p className="text-xs text-slate-400">
              Periodo acumulado hasta {fechaCorte} · Incluye cálculo referencial de Reserva Legal
              (Art. 262 Código de Comercio Venezuela)
            </p>
          </div>

          {renderSectionTable('Ingresos de Actividades Ordinarias', ingresosAccounts, totalIngresos)}
          {renderSectionTable('Costos de Ventas y Operación', costosAccounts, totalCostos)}
          {renderSectionTable('Gastos Operacionales y Tributarios', gastosAccounts, totalGastos)}

          <div className="mt-4 max-w-xl space-y-2 border-t border-[#233352] pt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-300">Ingresos Operacionales Totales:</span>
              <span className="font-mono-tabular font-semibold text-emerald-400">
                {formatMoney(totalIngresos)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">(-) Costos Operacionales:</span>
              <span className="font-mono-tabular text-rose-400">({formatMoney(totalCostos)})</span>
            </div>
            <div className="flex justify-between border-t border-[#233352]/60 pt-2 font-semibold">
              <span className="text-slate-200">Utilidad / Pérdida Bruta:</span>
              <span className="font-mono-tabular text-slate-100">{formatMoney(utilidadBruta)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">(-) Gastos Administrativos, Ventas y Tributos:</span>
              <span className="font-mono-tabular text-rose-400">({formatMoney(totalGastos)})</span>
            </div>
            <div className="flex justify-between border-t-2 border-[#c5a059] pt-2 text-base font-bold">
              <span className="text-[#e5c178]">Utilidad / Pérdida Neta del Ejercicio:</span>
              <span
                className={`font-mono-tabular ${
                  utilidadEjercicio >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatMoney(utilidadEjercicio)}
              </span>
            </div>
            <div className="flex justify-between pt-2 text-xs text-slate-400">
              <span>Apartado Referencial Reserva Legal (5% Art. 262 C.Com.):</span>
              <span className="font-mono-tabular">{formatMoney(reservaRequerida)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 3. Balance de Comprobación de Sumas y Saldos */}
      {subTab === 'comprobacion' && (
        <div className="rounded-lg border border-[#233352] bg-[#0d1527] p-6">
          <h3 className="border-b border-[#233352] pb-3 text-base font-semibold text-[#c5a059]">
            Balance de Comprobación de Sumas y Saldos
          </h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#233352] bg-[#0a0f1d] text-xs font-semibold text-[#c5a059]">
                  <th className="px-3 py-2.5">Código</th>
                  <th className="px-3 py-2.5">Cuenta</th>
                  <th className="px-3 py-2.5">Tipo</th>
                  <th className="px-3 py-2.5 text-right">Suma Débitos</th>
                  <th className="px-3 py-2.5 text-right">Suma Créditos</th>
                  <th className="px-3 py-2.5 text-right">Saldo Deudor</th>
                  <th className="px-3 py-2.5 text-right">Saldo Acreedor</th>
                </tr>
              </thead>
              <tbody>
                {mayor.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-400">
                      No existen movimientos en el Libro Diario hasta {fechaCorte}.
                    </td>
                  </tr>
                ) : (
                  mayor.map((m) => {
                    const saldoDeudor = m.deb > m.cred ? m.deb - m.cred : 0;
                    const saldoAcreedor = m.cred > m.deb ? m.cred - m.deb : 0;
                    return (
                      <tr
                        key={m.codigo}
                        className="border-b border-[#233352]/60 hover:bg-[#16223b]"
                      >
                        <td className="px-3 py-2 font-mono-tabular text-xs text-sky-400">
                          {m.codigo}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-100">{m.nombre}</td>
                        <td className="px-3 py-2 text-xs text-slate-400">{m.tipo_cuenta}</td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs text-emerald-400">
                          {formatMoney(m.deb)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs text-rose-400">
                          {formatMoney(m.cred)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs text-slate-100">
                          {saldoDeudor > 0 ? formatMoney(saldoDeudor) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono-tabular text-xs text-slate-100">
                          {saldoAcreedor > 0 ? formatMoney(saldoAcreedor) : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#c5a059] bg-[#0a0f1d] text-xs font-bold">
                  <td colSpan={3} className="px-3 py-3 text-right text-slate-200">
                    Sumas Iguales de Comprobación:
                  </td>
                  <td className="px-3 py-3 text-right font-mono-tabular text-emerald-400">
                    {formatMoney(totalDebComprobacion)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono-tabular text-rose-400">
                    {formatMoney(totalCredComprobacion)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono-tabular text-[#e5c178]">
                    {formatMoney(totalDeudorComprobacion)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono-tabular text-[#e5c178]">
                    {formatMoney(totalAcreedorComprobacion)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* 4. Flujo de Efectivo (NIC 7) */}
      {subTab === 'flujo' && (
        <div className="rounded-lg border border-[#233352] bg-[#0d1527] p-6">
          <h3 className="border-b border-[#233352] pb-3 text-base font-semibold text-[#c5a059]">
            Estado de Flujos de Efectivo — Método Indirecto (NIC 7)
          </h3>
          <div className="mt-4 max-w-2xl space-y-3 text-sm">
            <div className="text-xs font-bold tracking-wide text-[#e5c178] uppercase">
              Actividades de Operación
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">Resultado Neto del Ejercicio</span>
              <span className="font-mono-tabular">{formatMoney(utilidadEjercicio)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">
                (+) Depreciación y Amortización (Partida sin salida de efectivo)
              </span>
              <span className="font-mono-tabular">{formatMoney(depreciacionPeriodo)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Variación en Cuentas por Cobrar Comerciales</span>
              <span className="font-mono-tabular">{formatMoney(variacionCxC)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Variación en Inventarios (NIC 2)</span>
              <span className="font-mono-tabular">{formatMoney(variacionInventarios)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">
                Variación en Cuentas por Pagar y Obligaciones Fiscales
              </span>
              <span className="font-mono-tabular">{formatMoney(variacionCxPyFiscales)}</span>
            </div>
            <div className="flex justify-between border-t border-[#233352] pt-2 font-semibold">
              <span className="text-slate-200">Flujo Neto Proveniente de Operación:</span>
              <span className="font-mono-tabular text-emerald-400">
                {formatMoney(flujoOperacion)}
              </span>
            </div>

            <div className="pt-3 text-xs font-bold tracking-wide text-[#e5c178] uppercase">
              Actividades de Inversión y Financiamiento
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">
                Adquisición de Propiedad, Planta y Equipo (Inversión)
              </span>
              <span className="font-mono-tabular">{formatMoney(flujoInversion)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">
                Aportes de Capital y Obligaciones Financieras LP (Financiamiento)
              </span>
              <span className="font-mono-tabular">{formatMoney(flujoFinanciamiento)}</span>
            </div>
            <div className="flex justify-between border-t-2 border-[#c5a059] pt-3 text-base font-bold">
              <span className="text-[#e5c178]">Efectivo y Equivalentes al Cierre (Caja + Bancos):</span>
              <span className="font-mono-tabular text-emerald-400">
                {formatMoney(efectivoTotal)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 5. Estado de Cambios en el Patrimonio (NIC 1) */}
      {subTab === 'patrimonio' && (
        <div className="rounded-lg border border-[#233352] bg-[#0d1527] p-6">
          <h3 className="border-b border-[#233352] pb-3 text-base font-semibold text-[#c5a059]">
            Estado de Cambios en el Patrimonio (NIC 1)
          </h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#233352] bg-[#0a0f1d] text-xs font-semibold text-[#c5a059]">
                  <th className="px-3 py-2.5">Concepto Patrimonial</th>
                  <th className="px-3 py-2.5 text-right">Capital Social</th>
                  <th className="px-3 py-2.5 text-right">Reserva Legal (Art. 262)</th>
                  <th className="px-3 py-2.5 text-right">Resultados Acumulados / Ejercicio</th>
                  <th className="px-3 py-2.5 text-right">Total Patrimonio</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[#233352]/60">
                  <td className="px-3 py-2.5 text-xs text-slate-200">
                    Movimientos de Capital y Reservas Registradas
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular text-xs">
                    {formatMoney(capitalSocialCents)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular text-xs">
                    {formatMoney(reservaExistenteCents)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular text-xs">
                    {formatMoney(totalPatrimonioCuentas - capitalSocialCents - reservaExistenteCents)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular text-xs font-semibold">
                    {formatMoney(totalPatrimonioCuentas)}
                  </td>
                </tr>
                <tr className="border-b border-[#233352]/60">
                  <td className="px-3 py-2.5 text-xs text-slate-200">
                    Resultado Integral del Ejercicio (al {fechaCorte})
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular text-xs">—</td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular text-xs">
                    {formatMoney(reservaRequerida)} (est.)
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular text-xs">
                    {formatMoney(utilidadEjercicio)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular text-xs font-semibold">
                    {formatMoney(utilidadEjercicio)}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#c5a059] bg-[#0a0f1d] text-xs font-bold">
                  <td className="px-3 py-3 text-slate-200">Patrimonio Neto al Cierre:</td>
                  <td className="px-3 py-3 text-right font-mono-tabular text-[#e5c178]">
                    {formatMoney(capitalSocialCents)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono-tabular text-[#e5c178]">
                    {formatMoney(reservaExistenteCents)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono-tabular text-[#e5c178]">
                    {formatMoney(
                      totalPatrimonio - capitalSocialCents - reservaExistenteCents
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-mono-tabular text-emerald-400">
                    {formatMoney(totalPatrimonio)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Impresión Oficial (sin window.open) */}
      {showPrintPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg bg-white p-8 text-slate-900 shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-300 pb-4">
              <div>
                <h2 className="font-display text-2xl font-bold text-slate-900">
                  {company.razonSocial}
                </h2>
                <p className="text-xs text-slate-600">
                  RIF: {company.rif} · {company.domicilioFiscal}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-700">
                  Estados Financieros bajo Normas Internacionales de Contabilidad (VEN-NIF / NIC 1)
                  · Corte al {fechaCorte}
                </p>
              </div>
              <div className="flex gap-2 print:hidden">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Imprimir / Guardar PDF
                </button>
                <button
                  type="button"
                  onClick={() => setShowPrintPreview(false)}
                  className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cerrar
                </button>
              </div>
            </div>

            <div className="mt-6 space-y-6 text-xs">
              <div>
                <h3 className="mb-2 text-sm font-bold uppercase text-slate-800">
                  1. Balance General (Estado de Situación Financiera)
                </h3>
                <table className="w-full border-collapse border border-slate-300">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-slate-300 px-2 py-1.5 text-left">Código</th>
                      <th className="border border-slate-300 px-2 py-1.5 text-left">Cuenta</th>
                      <th className="border border-slate-300 px-2 py-1.5 text-left">Sección</th>
                      <th className="border border-slate-300 px-2 py-1.5 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...activos, ...pasivos, ...patrimonio].map((c) => (
                      <tr key={c.codigo}>
                        <td className="border border-slate-300 px-2 py-1 font-mono">{c.codigo}</td>
                        <td className="border border-slate-300 px-2 py-1">{c.nombre}</td>
                        <td className="border border-slate-300 px-2 py-1">{c.seccion_destino}</td>
                        <td className="border border-slate-300 px-2 py-1 text-right font-mono">
                          {formatMoney(signedBalanceSaldo(c))}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-bold">
                      <td colSpan={3} className="border border-slate-300 px-2 py-1.5">
                        TOTAL ACTIVOS / TOTAL PASIVO + PATRIMONIO
                      </td>
                      <td className="border border-slate-300 px-2 py-1.5 text-right font-mono">
                        {formatMoney(totalActivos)} / {formatMoney(pasivoMasPatrimonio)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-bold uppercase text-slate-800">
                  2. Estado de Resultados Integral
                </h3>
                <table className="w-full border-collapse border border-slate-300">
                  <tbody>
                    <tr>
                      <td className="border border-slate-300 px-2 py-1.5">Ingresos Totales</td>
                      <td className="border border-slate-300 px-2 py-1.5 text-right font-mono">
                        {formatMoney(totalIngresos)}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-slate-300 px-2 py-1.5">Costos Operacionales</td>
                      <td className="border border-slate-300 px-2 py-1.5 text-right font-mono">
                        ({formatMoney(totalCostos)})
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-slate-300 px-2 py-1.5">Gastos Operacionales</td>
                      <td className="border border-slate-300 px-2 py-1.5 text-right font-mono">
                        ({formatMoney(totalGastos)})
                      </td>
                    </tr>
                    <tr className="bg-slate-50 font-bold">
                      <td className="border border-slate-300 px-2 py-1.5">
                        Utilidad / Pérdida del Ejercicio
                      </td>
                      <td className="border border-slate-300 px-2 py-1.5 text-right font-mono">
                        {formatMoney(utilidadEjercicio)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-10 grid grid-cols-2 gap-12 pt-8 text-center">
                <div className="border-t border-slate-400 pt-2">
                  <p className="font-bold">{company.razonSocial}</p>
                  <p className="text-slate-600">Representante Legal · RIF {company.rif}</p>
                </div>
                <div className="border-t border-slate-400 pt-2">
                  <p className="font-bold">{company.contadorNombre}</p>
                  <p className="text-slate-600">Contador Público Colegiado · {company.cpcNumero}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
