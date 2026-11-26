import React, { useMemo, useState } from 'react';
import { AsientoLinea, CierreContable, CompanyDataset } from '../types/accounting';
import { getLastDayOfMonthISO } from '../utils/accountingEngine';
import { centsToStr, nicConvertAmountToBs, todayISO } from '../utils/monetary';

interface CierresYTipoCambioModuleProps {
  dataset: CompanyDataset;
  onUpdateDataset: (updater: (prev: CompanyDataset) => CompanyDataset, summary: string) => void;
  onNotify: (msg: string, type: 'success' | 'error') => void;
}

export const CierresYTipoCambioModule: React.FC<CierresYTipoCambioModuleProps> = ({
  dataset,
  onUpdateDataset,
  onNotify,
}) => {
  const [tcFecha, setTcFecha] = useState(todayISO());
  const [tcRate, setTcRate] = useState('');
  const [nicSummary, setNicSummary] = useState<string>('');

  const now = new Date();
  const [cierreMes, setCierreMes] = useState<string>(String(now.getMonth() + 1));
  const [cierreYear, setCierreYear] = useState<string>(String(now.getFullYear()));
  const [cierreYearAnnual, setCierreYearAnnual] = useState<string>(String(now.getFullYear()));

  const handleSaveTC = () => {
    if (!tcFecha) {
      onNotify('Seleccione la fecha del tipo de cambio BCV.', 'error');
      return;
    }
    const rate = parseFloat(tcRate.replace(',', '.'));
    if (isNaN(rate) || rate <= 0) {
      onNotify('Introduzca una tasa BCV válida mayor a cero.', 'error');
      return;
    }
    onUpdateDataset(
      (prev) => ({
        ...prev,
        exchangeRates: { ...(prev.exchangeRates || {}), [tcFecha]: rate },
      }),
      `Tasa BCV ${tcFecha}: Bs ${rate.toFixed(4)}`
    );
    onNotify(`Tipo de cambio BCV Bs ${rate.toFixed(4)} guardado para ${tcFecha}.`, 'success');
  };

  const handleAplicarNIC21 = () => {
    const asientos: Record<number, { fecha: string; deb: number; cred: number }> = {};
    for (const m of dataset.diario) {
      if (m.estado !== 'ACTIVO') continue;
      asientos[m.asiento_num] = asientos[m.asiento_num] || {
        fecha: m.fecha,
        deb: 0,
        cred: 0,
      };
      asientos[m.asiento_num].deb += m.debito_centavos;
      asientos[m.asiento_num].cred += m.credito_centavos;
    }
    const keys = Object.keys(asientos).sort((a, b) => Number(a) - Number(b));
    if (!keys.length) {
      setNicSummary('No hay asientos activos en el Libro Diario para convertir bajo NIC 21.');
      return;
    }
    const lines = keys.map((k) => {
      const a = asientos[Number(k)];
      const rate = dataset.exchangeRates?.[a.fecha];
      if (!rate) return `#${k} (${a.fecha}) · Sin tasa BCV registrada`;
      const debBs = nicConvertAmountToBs(a.deb, rate);
      return `#${k} (${a.fecha}) · Base: ${centsToStr(a.deb)} → Bs ${centsToStr(debBs)} (TC ${rate.toFixed(4)})`;
    });
    setNicSummary(lines.join(' | '));
  };

  const siguienteAsiento = (diario: AsientoLinea[]) => {
    let max = 0;
    for (const m of diario) if (m.asiento_num > max) max = m.asiento_num;
    return max + 1;
  };

  const ejecutarCierre = (tipo: 'MENSUAL' | 'ANUAL', start: string, end: string, periodo: string) => {
    const duplicate = (dataset.cierres || []).some(
      (c) => c.estado === 'ACTIVO' && c.tipo === tipo && c.periodo === periodo
    );
    if (duplicate) {
      onNotify(
        `Ya existe un cierre ${tipo} ACTIVO para el período ${periodo}. Elimine o reverse el existente antes de generarlo nuevamente.`,
        'error'
      );
      return;
    }

    const closingAsientoNums = new Set(
      (dataset.cierres || []).filter((c) => c.estado === 'ACTIVO').map((c) => c.asiento_num)
    );
    const movimientosPeriodo = dataset.diario.filter(
      (m) =>
        m.estado === 'ACTIVO' &&
        !closingAsientoNums.has(m.asiento_num) &&
        m.fecha >= start &&
        m.fecha <= end
    );
    const saldosPorCuenta: Record<string, { deb: number; cred: number }> = {};
    for (const mov of movimientosPeriodo) {
      saldosPorCuenta[mov.codigo_cuenta] = saldosPorCuenta[mov.codigo_cuenta] || {
        deb: 0,
        cred: 0,
      };
      saldosPorCuenta[mov.codigo_cuenta].deb += mov.debito_centavos;
      saldosPorCuenta[mov.codigo_cuenta].cred += mov.credito_centavos;
    }

    const lines: Array<{ codigo: string; debito_centavos: number; credito_centavos: number }> = [];
    let totalIngresos = 0;
    let totalCostos = 0;
    let totalGastos = 0;

    for (const acc of dataset.catalogo) {
      const s = saldosPorCuenta[acc.codigo] || { deb: 0, cred: 0 };
      const saldo = acc.naturaleza === 'Débito' ? s.deb - s.cred : s.cred - s.deb;
      if (acc.tipo_cuenta === 'Ingreso' && saldo > 0) {
        lines.push({ codigo: acc.codigo, debito_centavos: saldo, credito_centavos: 0 });
        totalIngresos += saldo;
      }
      if (
        (acc.tipo_cuenta === 'Costo' ||
          acc.tipo_cuenta === 'Gasto' ||
          acc.tipo_cuenta === 'Egreso') &&
        saldo > 0
      ) {
        lines.push({ codigo: acc.codigo, debito_centavos: 0, credito_centavos: saldo });
        if (acc.tipo_cuenta === 'Costo') totalCostos += saldo;
        else totalGastos += saldo;
      }
    }

    const net = totalIngresos - totalCostos - totalGastos;
    if (net > 0) lines.push({ codigo: '3999', debito_centavos: 0, credito_centavos: net });
    else if (net < 0)
      lines.push({ codigo: '3999', debito_centavos: Math.abs(net), credito_centavos: 0 });

    if (lines.length < 2) {
      onNotify('No se detectaron saldos de ingresos, costos o gastos en el período.', 'error');
      return;
    }

    const tc = dataset.exchangeRates?.[end] ?? null;
    const num = siguienteAsiento(dataset.diario);

    onUpdateDataset((prev) => {
      const has3999 = prev.catalogo.some((c) => c.codigo === '3999');
      const nextIdx =
        prev.catalogo.reduce((m, c) => Math.max(m, Number(c.tipo_indice || 0)), 0) + 1;
      const updatedCatalog = has3999
        ? prev.catalogo
        : [
            ...prev.catalogo,
            {
              codigo: '3999',
              nombre: 'Resultados del Ejercicio',
              tipo_cuenta: 'Patrimonio' as const,
              naturaleza: 'Crédito' as const,
              ubicacion_estado: 'Balance General' as const,
              indicador_libro: 'Ninguno' as const,
              seccion_destino: 'Patrimonio Neto',
              tipo_indice: nextIdx,
              clasificacion_nic: 'Patrimonio' as const,
              partida_monetaria: false,
              norma_nic: 'NIC 1',
            },
          ];

      let nextId = prev.nextId;
      const newDiarioEntries: AsientoLinea[] = lines.map((l) => ({
        id: nextId++,
        asiento_num: num,
        fecha: end,
        concepto: `CIERRE ${tipo} ${periodo}`,
        tercero: `CIERRE ${tipo}`,
        codigo_cuenta: l.codigo,
        debito_centavos: l.debito_centavos,
        credito_centavos: l.credito_centavos,
        estado: 'ACTIVO',
        exchange_rate_bs: tc,
      }));

      const nextCierreId = prev.cierres.length
        ? prev.cierres[prev.cierres.length - 1].id + 1
        : 1;
      const nuevoCierre: CierreContable = {
        id: nextCierreId,
        tipo,
        periodo,
        fecha: end,
        asiento_num: num,
        estado: 'ACTIVO',
        reserva_legal_centavos: net > 0 ? Math.round(net * 0.05) : 0,
      };

      return {
        ...prev,
        catalogo: updatedCatalog,
        diario: [...prev.diario, ...newDiarioEntries],
        nextId,
        cierres: [...prev.cierres, nuevoCierre],
      };
    }, `Cierre ${tipo} período ${periodo} (Asiento #${num})`);

    onNotify(`Cierre ${tipo.toLowerCase()} registrado: Asiento #${num}.`, 'success');
  };

  const handleCierreMensual = () => {
    const m = parseInt(cierreMes, 10);
    const y = parseInt(cierreYear, 10);
    if (!m || !y) {
      onNotify('Seleccione mes y año válidos.', 'error');
      return;
    }
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = getLastDayOfMonthISO(y, m);
    ejecutarCierre('MENSUAL', start, end, `${String(m).padStart(2, '0')}/${y}`);
  };

  const handleCierreAnual = () => {
    const y = parseInt(cierreYearAnnual, 10);
    if (!y) {
      onNotify('Introduzca un año fiscal válido.', 'error');
      return;
    }
    ejecutarCierre('ANUAL', `${y}-01-01`, `${y}-12-31`, String(y));
  };

  const handleEliminarCierre = (cierre: CierreContable) => {
    onUpdateDataset(
      (prev) => ({
        ...prev,
        diario: prev.diario.filter((m) => m.asiento_num !== cierre.asiento_num),
        cierres: prev.cierres.map((c) =>
          c.id === cierre.id ? { ...c, estado: 'ELIMINADO' } : c
        ),
      }),
      `Reverso de cierre ${cierre.tipo} ${cierre.periodo}`
    );
    onNotify(`Cierre ${cierre.periodo} eliminado del Libro Diario.`, 'success');
  };

  const ratesList = useMemo(
    () => Object.entries(dataset.exchangeRates || {}).sort((a, b) => b[0].localeCompare(a[0])),
    [dataset.exchangeRates]
  );

  const sortedCierres = useMemo(
    () => dataset.cierres.slice().sort((a, b) => b.id - a.id),
    [dataset.cierres]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold text-[#e5c178]">
          Tipo de Cambio BCV (NIC 21) y Cierres Contables
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Registro oficial de tasas de cambio BCV para conversión monetaria NIC 21 y generación
          automática de asientos de cierre mensual y anual.
        </p>
      </div>

      {/* Gestor BCV NIC 21 */}
      <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
        <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
          Gestor de Tipo de Cambio Oficial BCV (Bs / USD)
        </h3>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-400">Fecha de Vigencia</label>
            <input
              type="date"
              value={tcFecha}
              onChange={(e) => setTcFecha(e.target.value)}
              className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-400">Tasa BCV (Bs por USD)</label>
            <input
              type="text"
              inputMode="decimal"
              value={tcRate}
              onChange={(e) => setTcRate(e.target.value)}
              placeholder="Ej: 46.8500"
              className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={handleSaveTC}
              className="whitespace-nowrap rounded-md bg-[#c5a059] px-4 py-2 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
            >
              Guardar Tasa BCV
            </button>
            <button
              type="button"
              onClick={handleAplicarNIC21}
              className="whitespace-nowrap rounded-md border border-[#233352] bg-[#16223b] px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-[#1e2e4f]"
            >
              Resumen NIC 21
            </button>
          </div>
        </div>

        {nicSummary && (
          <p className="mt-3 rounded border border-[#233352] bg-[#0a0f1d] p-3 font-mono-tabular text-xs text-sky-300">
            {nicSummary}
          </p>
        )}

        {ratesList.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full max-w-md border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#233352] bg-[#0a0f1d] text-[#c5a059]">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2 text-right">Tasa BCV (Bs / USD)</th>
                </tr>
              </thead>
              <tbody>
                {ratesList.map(([date, rate]) => (
                  <tr key={date} className="border-b border-[#233352]/60">
                    <td className="px-3 py-1.5 font-mono-tabular">{date}</td>
                    <td className="px-3 py-1.5 text-right font-mono-tabular font-semibold text-emerald-400">
                      Bs {Number(rate).toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cierres Mensual y Anual */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
          <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
            Cierre Mensual de Resultados
          </h3>
          <p className="mt-2 text-xs text-slate-400">
            Cancela cuentas temporales de Ingresos, Costos y Gastos del mes en Resultados del
            Ejercicio (3999).
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-400">Mes</label>
              <select
                value={cierreMes}
                onChange={(e) => setCierreMes(e.target.value)}
                className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
              >
                <option value="1">01 - Enero</option>
                <option value="2">02 - Febrero</option>
                <option value="3">03 - Marzo</option>
                <option value="4">04 - Abril</option>
                <option value="5">05 - Mayo</option>
                <option value="6">06 - Junio</option>
                <option value="7">07 - Julio</option>
                <option value="8">08 - Agosto</option>
                <option value="9">09 - Septiembre</option>
                <option value="10">10 - Octubre</option>
                <option value="11">11 - Noviembre</option>
                <option value="12">12 - Diciembre</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-400">Año</label>
              <input
                type="number"
                min={2000}
                value={cierreYear}
                onChange={(e) => setCierreYear(e.target.value)}
                className="w-28 rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
              />
            </div>
            <button
              type="button"
              onClick={handleCierreMensual}
              className="whitespace-nowrap rounded-md bg-[#c5a059] px-4 py-2 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
            >
              Realizar Cierre Mensual
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
          <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
            Cierre Anual del Ejercicio Fiscal
          </h3>
          <p className="mt-2 text-xs text-slate-400">
            Genera asiento de cierre anual para el ejercicio completo con cálculo referencial de
            Reserva Legal (5% Art. 262 C.Com.).
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold text-slate-400">Año Fiscal</label>
              <input
                type="number"
                min={2000}
                value={cierreYearAnnual}
                onChange={(e) => setCierreYearAnnual(e.target.value)}
                className="w-32 rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
              />
            </div>
            <button
              type="button"
              onClick={handleCierreAnual}
              className="whitespace-nowrap rounded-md bg-[#c5a059] px-4 py-2 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
            >
              Realizar Cierre Anual
            </button>
          </div>
        </div>
      </div>

      {/* Historial de Cierres */}
      <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
        <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
          Historial de Cierres Contables
        </h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#2a3b5c] bg-[#0a0f1d] text-[#c5a059]">
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Período</th>
                <th className="px-3 py-2">Asiento N°</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2 text-right">Reserva Legal 5% Est.</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Acción</th>
              </tr>
            </thead>
            <tbody>
              {sortedCierres.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    No hay cierres registrados para esta entidad.
                  </td>
                </tr>
              ) : (
                sortedCierres.map((c) => (
                    <tr key={c.id} className="border-b border-[#233352]/60">
                      <td className="px-3 py-2 font-semibold">{c.tipo}</td>
                      <td className="px-3 py-2 font-mono-tabular">{c.periodo}</td>
                      <td className="px-3 py-2 font-mono-tabular text-sky-400">
                        #{c.asiento_num}
                      </td>
                      <td className="px-3 py-2 font-mono-tabular">{c.fecha}</td>
                      <td className="px-3 py-2 text-right font-mono-tabular">
                        {centsToStr(c.reserva_legal_centavos || 0)}
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        <span
                          className={
                            c.estado === 'ACTIVO' ? 'text-emerald-400' : 'text-slate-500'
                          }
                        >
                          {c.estado}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {c.estado === 'ACTIVO' ? (
                          <button
                            type="button"
                            onClick={() => handleEliminarCierre(c)}
                            className="rounded bg-[#233352] px-2.5 py-1 text-xs text-rose-300 hover:bg-[#2f456e]"
                          >
                            Eliminar
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
