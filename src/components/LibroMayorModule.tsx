import React, { useState } from 'react';
import { CompanyDataset } from '../types/accounting';
import { centsToStr } from '../utils/monetary';

interface LibroMayorModuleProps {
  dataset: CompanyDataset;
  onJumpToEditAsiento: (asientoNum: number) => void;
}

/**
 * LIBRO MAYOR Y SALDOS ACUMULADOS (EXCLUSIVO DEL LIBRO DIARIO)
 * Preservado íntegramente: se alimenta exclusivamente de las transacciones
 * activas registradas en el Libro Diario. Si no hay asientos activos, permanece vacío.
 */
export const LibroMayorModule: React.FC<LibroMayorModuleProps> = ({
  dataset,
  onJumpToEditAsiento,
}) => {
  const [vista, setVista] = useState<'resumido' | 'detallado'>('resumido');
  const [selectedCodigo, setSelectedCodigo] = useState<string>('');

  const cuentaByCodigo = (cod: string) => dataset.catalogo.find((c) => c.codigo === cod);

  const asientosPorCuenta: Record<string, Set<number>> = {};
  const codigosConMovimientos: string[] = [];

  for (const entry of dataset.diario) {
    if (entry.estado !== 'ACTIVO') continue;
    asientosPorCuenta[entry.codigo_cuenta] =
      asientosPorCuenta[entry.codigo_cuenta] || new Set<number>();
    asientosPorCuenta[entry.codigo_cuenta].add(entry.asiento_num);
    if (!codigosConMovimientos.includes(entry.codigo_cuenta)) {
      codigosConMovimientos.push(entry.codigo_cuenta);
    }
  }

  const mayor = codigosConMovimientos
    .map((codigo) => {
      const c = cuentaByCodigo(codigo);
      if (!c) return null;
      let deb = 0;
      let cred = 0;
      for (const m of dataset.diario) {
        if (m.estado === 'ACTIVO' && m.codigo_cuenta === c.codigo) {
          deb += m.debito_centavos;
          cred += m.credito_centavos;
        }
      }
      const saldo = c.naturaleza === 'Débito' ? deb - cred : cred - deb;
      return { ...c, deb, cred, saldo };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const selectedCuenta = selectedCodigo ? cuentaByCodigo(selectedCodigo) : null;
  const detailedMovs = selectedCodigo
    ? dataset.diario
        .filter((m) => m.codigo_cuenta === selectedCodigo && m.estado === 'ACTIVO')
        .sort((a, b) =>
          a.fecha === b.fecha ? a.asiento_num - b.asiento_num : a.fecha < b.fecha ? -1 : 1
        )
    : [];

  let saldoProgresivo = 0;
  let totalDebDet = 0;
  let totalCredDet = 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold text-[#e5c178]">
          Libro Mayor y Saldos Acumulados (Exclusivo del Libro Diario)
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Se alimenta exclusivamente de las transacciones registradas en el Libro Diario. Si no hay
          asientos activos, este libro permanecerá vacío.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-[#233352] bg-[#0a0f1d] p-1">
          <button
            type="button"
            onClick={() => setVista('resumido')}
            className={`whitespace-nowrap rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
              vista === 'resumido'
                ? 'bg-[#c5a059] text-[#0a0f1d]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Vista Resumida
          </button>
          <button
            type="button"
            onClick={() => setVista('detallado')}
            className={`whitespace-nowrap rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
              vista === 'detallado'
                ? 'bg-[#c5a059] text-[#0a0f1d]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Vista Detallada por Cuenta
          </button>
        </div>

        {vista === 'detallado' && (
          <select
            value={selectedCodigo}
            onChange={(e) => setSelectedCodigo(e.target.value)}
            className="max-w-sm flex-1 rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
          >
            <option value="">-- Seleccionar Cuenta con Movimientos --</option>
            {codigosConMovimientos.map((cod) => {
              const c = cuentaByCodigo(cod);
              if (!c) return null;
              return (
                <option key={c.codigo} value={c.codigo}>
                  {c.codigo} - {c.nombre} ({c.tipo_cuenta})
                </option>
              );
            })}
          </select>
        )}
      </div>

      {vista === 'resumido' ? (
        <div className="rounded-lg border border-[#233352] bg-[#0d1527] p-6">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#233352] bg-[#0a0f1d] text-xs font-semibold text-[#c5a059]">
                  <th className="px-3 py-2.5">Código</th>
                  <th className="px-3 py-2.5">Cuenta</th>
                  <th className="px-3 py-2.5">Tipo</th>
                  <th className="px-3 py-2.5">Naturaleza</th>
                  <th className="px-3 py-2.5 text-right">Total Débitos</th>
                  <th className="px-3 py-2.5 text-right">Total Créditos</th>
                  <th className="px-3 py-2.5 text-right">Saldo Actual</th>
                  <th className="px-3 py-2.5">Acción</th>
                </tr>
              </thead>
              <tbody>
                {mayor.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-xs text-slate-400">
                      El Libro Diario no tiene asientos activos. El Libro Mayor se alimenta
                      exclusivamente de este y se encuentra vacío.
                    </td>
                  </tr>
                ) : (
                  mayor.map((m) => (
                    <tr
                      key={m.codigo}
                      className="border-b border-[#233352]/60 transition-colors hover:bg-[#16223b]"
                    >
                      <td className="px-3 py-2.5 font-mono-tabular text-xs text-sky-400">
                        {m.codigo}
                      </td>
                      <td className="px-3 py-2.5 text-xs font-medium text-slate-100">{m.nombre}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-300">{m.tipo_cuenta}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-300">{m.naturaleza}</td>
                      <td className="px-3 py-2.5 text-right font-mono-tabular text-xs text-emerald-400">
                        {centsToStr(m.deb)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-tabular text-xs text-rose-400">
                        {centsToStr(m.cred)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-tabular text-xs font-bold text-slate-100">
                        {centsToStr(m.saldo)}
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCodigo(m.codigo);
                            setVista('detallado');
                          }}
                          className="text-xs font-semibold text-[#e5c178] underline-offset-2 hover:underline"
                        >
                          Ver Mayor
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-[#233352] bg-[#0d1527] p-6">
          {!selectedCuenta ? (
            <p className="py-6 text-center text-xs text-slate-400">
              Seleccione una cuenta contable con movimientos activos en el selector superior para
              desplegar su libro mayor detallado.
            </p>
          ) : (
            <div>
              <h3 className="text-base font-semibold text-[#c5a059]">
                {selectedCuenta.codigo} - {selectedCuenta.nombre}
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Tipo: <strong className="text-slate-200">{selectedCuenta.tipo_cuenta}</strong> ·
                Naturaleza: <strong className="text-slate-200">{selectedCuenta.naturaleza}</strong>{' '}
                · Ubicación NIC:{' '}
                <strong className="text-slate-200">{selectedCuenta.ubicacion_estado}</strong>
              </p>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#233352] bg-[#0a0f1d] text-xs font-semibold text-[#c5a059]">
                      <th className="px-3 py-2.5">Fecha</th>
                      <th className="px-3 py-2.5">Asiento</th>
                      <th className="px-3 py-2.5">Concepto</th>
                      <th className="px-3 py-2.5">Tercero</th>
                      <th className="px-3 py-2.5 text-right">Débito</th>
                      <th className="px-3 py-2.5 text-right">Crédito</th>
                      <th className="px-3 py-2.5 text-right">Saldo Progresivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailedMovs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-xs text-slate-400">
                          No hay movimientos registrados para esta cuenta.
                        </td>
                      </tr>
                    ) : (
                      detailedMovs.map((m) => {
                        const d = m.debito_centavos;
                        const cr = m.credito_centavos;
                        totalDebDet += d;
                        totalCredDet += cr;
                        const delta = selectedCuenta.naturaleza === 'Débito' ? d - cr : cr - d;
                        saldoProgresivo += delta;

                        return (
                          <tr
                            key={m.id}
                            className="border-b border-[#233352]/60 transition-colors hover:bg-[#16223b]"
                          >
                            <td className="px-3 py-2 font-mono-tabular text-xs text-slate-300">
                              {m.mov_fecha || m.fecha}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => onJumpToEditAsiento(m.asiento_num)}
                                className="font-mono-tabular text-xs font-semibold text-[#e5c178] underline-offset-2 hover:underline"
                              >
                                #{m.asiento_num}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-200">
                              {m.mov_concepto || m.concepto || ''}
                            </td>
                            <td className="px-3 py-2 font-mono-tabular text-xs text-slate-300">
                              {m.mov_tercero || m.tercero || ''}
                            </td>
                            <td className="px-3 py-2 text-right font-mono-tabular text-xs text-emerald-400">
                              {centsToStr(d)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono-tabular text-xs text-rose-400">
                              {centsToStr(cr)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono-tabular text-xs font-bold text-slate-100">
                              {centsToStr(saldoProgresivo)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[#233352] bg-[#0a0f1d] text-xs font-bold">
                      <td colSpan={4} className="px-3 py-3 text-right text-slate-300">
                        Totales y Saldo Final:
                      </td>
                      <td className="px-3 py-3 text-right font-mono-tabular text-emerald-400">
                        {centsToStr(totalDebDet)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono-tabular text-rose-400">
                        {centsToStr(totalCredDet)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono-tabular text-[#e5c178]">
                        {centsToStr(saldoProgresivo)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
