import React, { useEffect, useMemo, useState } from 'react';
import { Download, ShieldAlert, ShieldCheck } from 'lucide-react';
import { AsientoLinea, CompanyDataset } from '../types/accounting';
import { auditJournalIntegrity, validateJournalEntryLines } from '../utils/accountingEngine';
import { escapeCsvCell } from '../utils/fiscalCalculations';
import { centsToStr, formatDateShort, strToCents, todayISO } from '../utils/monetary';

interface FormLine {
  key: string;
  mov_fecha: string;
  mov_tercero: string;
  mov_concepto: string;
  codigo_cuenta: string;
  debito: string;
  credito: string;
}

interface LibroDiarioModuleProps {
  dataset: CompanyDataset;
  editingAsientoNum: number | null;
  onSetEditingAsientoNum: (num: number | null) => void;
  onUpdateDataset: (updater: (prev: CompanyDataset) => CompanyDataset, summary: string) => void;
  onNotify: (msg: string, type: 'success' | 'error') => void;
}

function makeEmptyLine(fecha: string): FormLine {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mov_fecha: fecha,
    mov_tercero: '',
    mov_concepto: '',
    codigo_cuenta: '',
    debito: '0.00',
    credito: '0.00',
  };
}

/**
 * LIBRO DIARIO (PARTIDA DOBLE)
 * Preservado íntegramente según la lógica, estructura de columnas, validación
 * de centavos enteros (Cero Float) e historial de estados del archivo original Equinox-Books.
 */
export const LibroDiarioModule: React.FC<LibroDiarioModuleProps> = ({
  dataset,
  editingAsientoNum,
  onSetEditingAsientoNum,
  onUpdateDataset,
  onNotify,
}) => {
  const [asFecha, setAsFecha] = useState<string>(todayISO());
  const [lines, setLines] = useState<FormLine[]>(() => [
    makeEmptyLine(todayISO()),
    makeEmptyLine(todayISO()),
  ]);
  const [selectedAsientoDropdown, setSelectedAsientoDropdown] = useState<string>('');
  const [pendingConfirm, setPendingConfirm] = useState<{
    type: 'ANULAR' | 'ELIMINAR';
    asientoNum: number;
  } | null>(null);

  const sortedCatalog = dataset.catalogo
    .slice()
    .sort((a, b) => a.tipo_indice - b.tipo_indice);

  const siguienteAsiento = (): number => {
    let max = 0;
    for (const m of dataset.diario) {
      if (m.asiento_num > max) max = m.asiento_num;
    }
    return max + 1;
  };

  // Sync external edit requests (e.g., from Libro Mayor or Account Modal)
  useEffect(() => {
    if (editingAsientoNum !== null) {
      const movs = dataset.diario.filter(
        (m) => m.asiento_num === editingAsientoNum && m.estado === 'ACTIVO'
      );
      if (movs.length > 0) {
        setAsFecha(movs[0].fecha);
        setLines(
          movs.map((m) => ({
            key: `edit-${m.id}-${Math.random().toString(36).slice(2, 6)}`,
            mov_fecha: m.mov_fecha || m.fecha,
            mov_tercero: m.mov_tercero || m.tercero || '',
            mov_concepto: m.mov_concepto || m.concepto || '',
            codigo_cuenta: m.codigo_cuenta,
            debito: centsToStr(m.debito_centavos),
            credito: centsToStr(m.credito_centavos),
          }))
        );
      }
    }
  }, [editingAsientoNum, dataset.diario]);

  const liveTotals = lines.reduce(
    (acc, l) => {
      acc.deb += strToCents(l.debito);
      acc.cred += strToCents(l.credito);
      return acc;
    },
    { deb: 0, cred: 0 }
  );

  const handleAddLine = () => {
    setLines((prev) => [...prev, makeEmptyLine(asFecha)]);
  };

  const handleRemoveLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const handleLineChange = (key: string, field: keyof FormLine, value: string) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  };

  const cancelarEdicion = () => {
    onSetEditingAsientoNum(null);
    const today = todayISO();
    setAsFecha(today);
    setLines([makeEmptyLine(today), makeEmptyLine(today)]);
  };

  const cargarEdicion = (num: number) => {
    const movs = dataset.diario.filter((m) => m.asiento_num === num && m.estado === 'ACTIVO');
    if (!movs.length) {
      onNotify(`El asiento #${num} no está activo y no puede editarse.`, 'error');
      return;
    }
    onSetEditingAsientoNum(num);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    onNotify(`Modificando asiento #${num}.`, 'success');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!asFecha) {
      onNotify('Indique la fecha del asiento.', 'error');
      return;
    }

    const validation = validateJournalEntryLines(
      lines.map((l) => ({
        codigo_cuenta: l.codigo_cuenta,
        debitoStr: l.debito,
        creditoStr: l.credito,
        mov_fecha: l.mov_fecha || asFecha,
        mov_tercero: l.mov_tercero.trim(),
        mov_concepto: l.mov_concepto.trim(),
      })),
      dataset.catalogo
    );

    if (!validation.ok) {
      onNotify(validation.error || 'Asiento inválido según reglas de partida doble.', 'error');
      return;
    }

    const validLines = validation.validatedLines.map((l) => ({
      codigo: l.codigo_cuenta,
      debito_centavos: l.debito_centavos,
      credito_centavos: l.credito_centavos,
      mov_fecha: l.mov_fecha || asFecha,
      mov_tercero: (l.mov_tercero || '').trim(),
      mov_concepto: (l.mov_concepto || '').trim(),
    }));

    const tc =
      dataset.exchangeRates && dataset.exchangeRates[asFecha]
        ? dataset.exchangeRates[asFecha]
        : null;
    const concepto =
      (validLines.find((l) => l.mov_concepto && l.mov_concepto.trim()) || {}).mov_concepto ||
      'Asiento contable';
    const terceroCab =
      validLines[0] && validLines[0].mov_tercero ? validLines[0].mov_tercero : '';

    if (editingAsientoNum !== null) {
      const origNum = editingAsientoNum;
      const orig = dataset.diario.filter(
        (m) => m.asiento_num === origNum && m.estado === 'ACTIVO'
      );
      if (!orig.length) {
        onNotify(`El asiento #${origNum} ya no existe. Modificación cancelada.`, 'error');
        cancelarEdicion();
        return;
      }
      const selloMod = new Date().toISOString();
      onUpdateDataset((prev) => {
        let nextId = prev.nextId;
        const updatedDiario: AsientoLinea[] = prev.diario.map((m) =>
          m.asiento_num === origNum && m.estado === 'ACTIVO'
            ? { ...m, estado: 'MODIFICADO', modificado_en: selloMod }
            : m
        );
        for (const l of validLines) {
          updatedDiario.push({
            id: nextId++,
            asiento_num: origNum,
            fecha: asFecha,
            concepto,
            tercero: terceroCab,
            codigo_cuenta: l.codigo,
            debito_centavos: l.debito_centavos,
            credito_centavos: l.credito_centavos,
            estado: 'ACTIVO',
            exchange_rate_bs: tc,
            mov_fecha: l.mov_fecha,
            mov_tercero: l.mov_tercero,
            mov_concepto: l.mov_concepto,
          });
        }
        return { ...prev, diario: updatedDiario, nextId };
      }, `Modificación de Asiento #${origNum} en Libro Diario`);

      cancelarEdicion();
      onNotify(`Asiento #${origNum} modificado con éxito.`, 'success');
      return;
    }

    const num = siguienteAsiento();
    onUpdateDataset((prev) => {
      let nextId = prev.nextId;
      const added: AsientoLinea[] = validLines.map((l) => ({
        id: nextId++,
        asiento_num: num,
        fecha: asFecha,
        concepto,
        tercero: terceroCab,
        codigo_cuenta: l.codigo,
        debito_centavos: l.debito_centavos,
        credito_centavos: l.credito_centavos,
        estado: 'ACTIVO',
        exchange_rate_bs: tc,
        mov_fecha: l.mov_fecha,
        mov_tercero: l.mov_tercero,
        mov_concepto: l.mov_concepto,
      }));
      return { ...prev, diario: [...prev.diario, ...added], nextId };
    }, `Registro de Asiento #${num} en Libro Diario`);

    const today = todayISO();
    setAsFecha(today);
    setLines([makeEmptyLine(today), makeEmptyLine(today)]);
    onNotify(`Asiento Contable #${num} registrado con éxito.`, 'success');
  };

  const executeAnular = (num: number) => {
    const activos = dataset.diario.filter((m) => m.asiento_num === num && m.estado === 'ACTIVO');
    if (!activos.length) {
      onNotify(`El asiento #${num} no existe o ya no está activo.`, 'error');
      return;
    }
    const selloAnul = new Date().toISOString();
    onUpdateDataset(
      (prev) => ({
        ...prev,
        diario: prev.diario.map((m) =>
          m.asiento_num === num && m.estado === 'ACTIVO'
            ? { ...m, estado: 'ANULADO', anulado_en: selloAnul }
            : m
        ),
      }),
      `Anulación de Asiento #${num} en Libro Diario`
    );
    if (editingAsientoNum === num) cancelarEdicion();
    setPendingConfirm(null);
    onNotify(`Asiento #${num} anulado.`, 'success');
  };

  const executeEliminar = (num: number) => {
    onUpdateDataset(
      (prev) => ({
        ...prev,
        diario: prev.diario.filter((m) => m.asiento_num !== num),
      }),
      `Eliminación de Asiento #${num} en Libro Diario`
    );
    if (editingAsientoNum === num) cancelarEdicion();
    setPendingConfirm(null);
    onNotify(`Asiento #${num} eliminado definitivamente.`, 'success');
  };

  const movs = dataset.diario
    .slice()
    .sort((a, b) => b.asiento_num - a.asiento_num || a.id - b.id);
  const asientosActivosLista = dataset.diario.filter((m) => m.estado === 'ACTIVO');
  const asientosUnicos = Array.from(
    new Map(asientosActivosLista.map((m) => [m.asiento_num, m])).values()
  );
  const asientosConActivo = new Set(asientosActivosLista.map((m) => m.asiento_num));

  const vistosAsientos = new Set<number>();
  const vistosActivos = new Set<number>();

  const cuentaByCodigo = (cod: string) => dataset.catalogo.find((c) => c.codigo === cod);
  const integrityAudit = useMemo(() => auditJournalIntegrity(dataset), [dataset]);

  const handleExportDiarioCsv = () => {
    if (movs.length === 0) {
      onNotify('No hay movimientos en el Libro Diario para exportar.', 'error');
      return;
    }
    const header = [
      'Asiento',
      'Fecha',
      'Concepto',
      'Tercero',
      'Código',
      'Cuenta',
      'Débito',
      'Crédito',
      'Estado',
    ];
    const rows = movs.map((m) => {
      const c = cuentaByCodigo(m.codigo_cuenta);
      return [
        `#${m.asiento_num}`,
        formatDateShort(m.fecha),
        m.mov_concepto || m.concepto || '',
        m.tercero || m.mov_tercero || '',
        m.codigo_cuenta,
        c ? c.nombre : '—',
        centsToStr(m.debito_centavos),
        centsToStr(m.credito_centavos),
        m.estado,
      ]
        .map(escapeCsvCell)
        .join(',');
    });
    const csv = '\uFEFF' + [header.map(escapeCsvCell).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Libro_Diario_${todayISO()}.csv`;
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
            Gestión de Libro Diario (Partida Doble)
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Registro inmutable de transacciones. El sistema valida automáticamente el equilibrio Débito
            = Crédito con precisión de centavos absoluta.
          </p>
        </div>
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            integrityAudit.isHealthy
              ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
              : 'border-rose-500/50 bg-rose-950/30 text-rose-300'
          }`}
        >
          {integrityAudit.isHealthy ? (
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-rose-400" />
          )}
          <span>
            {integrityAudit.isHealthy
              ? `Auditoría Partida Doble OK · ${integrityAudit.balancedAsientosCount} asiento(s) cuadrado(s)`
              : `Auditoría: ${integrityAudit.issues.length} incidencia(s) detectada(s)`}
          </span>
        </div>
      </div>

      {!integrityAudit.isHealthy && integrityAudit.issues.length > 0 && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-950/25 p-4 text-xs text-rose-200">
          <div className="font-semibold text-rose-300">
            Alertas de Integridad Contable (Partida Doble y Ecuación Patrimonial):
          </div>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            {integrityAudit.issues.slice(0, 6).map((iss, idx) => (
              <li key={idx}>{iss.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Formulario Nuevo Asiento / Modificación */}
      <div className="rounded-lg border border-[#233352] bg-[#0d1527] p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#233352] pb-3">
          <h3 className="text-base font-semibold text-[#c5a059]">
            Nuevo Asiento Contable{' '}
            <span className="font-mono-tabular text-sky-400">
              {editingAsientoNum !== null
                ? `MODIFICANDO #${editingAsientoNum}`
                : `#${siguienteAsiento()}`}
            </span>
          </h3>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Fecha</label>
              <input
                type="date"
                value={asFecha}
                onChange={(e) => setAsFecha(e.target.value)}
                required
                className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-sm text-slate-100 focus:border-[#c5a059] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-slate-200">
              Movimientos Contables (Mínimo 2 Líneas)
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#233352] bg-[#0a0f1d] text-xs font-semibold text-[#c5a059]">
                    <th className="px-2.5 py-2.5">Fecha</th>
                    <th className="px-2.5 py-2.5">RIF</th>
                    <th className="px-2.5 py-2.5">Concepto</th>
                    <th className="w-[30%] px-2.5 py-2.5">Cuenta Contable</th>
                    <th className="px-2.5 py-2.5">Débito</th>
                    <th className="px-2.5 py-2.5">Crédito</th>
                    <th className="px-2.5 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.key} className="border-b border-[#233352]/60">
                      <td className="p-2">
                        <input
                          type="date"
                          value={line.mov_fecha}
                          onChange={(e) => handleLineChange(line.key, 'mov_fecha', e.target.value)}
                          className="w-full rounded-md border border-[#233352] bg-[#0a0f1d] px-2.5 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={line.mov_tercero}
                          onChange={(e) =>
                            handleLineChange(line.key, 'mov_tercero', e.target.value)
                          }
                          placeholder="Ej: J-12345678-0"
                          className="w-full rounded-md border border-[#233352] bg-[#0a0f1d] px-2.5 py-2 font-mono-tabular text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          value={line.mov_concepto}
                          onChange={(e) =>
                            handleLineChange(line.key, 'mov_concepto', e.target.value)
                          }
                          placeholder="Concepto línea"
                          className="w-full rounded-md border border-[#233352] bg-[#0a0f1d] px-2.5 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                        />
                      </td>
                      <td className="p-2">
                        <select
                          value={line.codigo_cuenta}
                          onChange={(e) =>
                            handleLineChange(line.key, 'codigo_cuenta', e.target.value)
                          }
                          required
                          className="w-full rounded-md border border-[#233352] bg-[#0a0f1d] px-2.5 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                        >
                          <option value="">-- Seleccionar Cuenta --</option>
                          {sortedCatalog.map((c) => (
                            <option key={c.codigo} value={c.codigo}>
                              {c.codigo} - {c.nombre} ({c.tipo_cuenta})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={line.debito}
                          onChange={(e) => handleLineChange(line.key, 'debito', e.target.value)}
                          className="w-full rounded-md border border-[#233352] bg-[#0a0f1d] px-2.5 py-2 text-right font-mono-tabular text-xs text-emerald-400 focus:border-[#c5a059] focus:outline-none"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={line.credito}
                          onChange={(e) => handleLineChange(line.key, 'credito', e.target.value)}
                          className="w-full rounded-md border border-[#233352] bg-[#0a0f1d] px-2.5 py-2 text-right font-mono-tabular text-xs text-rose-400 focus:border-[#c5a059] focus:outline-none"
                        />
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(line.key)}
                          className="rounded bg-rose-600 px-2.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-rose-700"
                          title="Eliminar línea"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleAddLine}
              className="whitespace-nowrap rounded-md border border-[#233352] bg-[#16223b] px-4 py-2 text-xs font-semibold text-slate-100 transition-colors hover:bg-[#1e2e4f]"
            >
              + Agregar Línea
            </button>
            <button
              type="submit"
              className="whitespace-nowrap rounded-md bg-[#c5a059] px-5 py-2 text-xs font-bold text-[#0a0f1d] transition-colors hover:bg-[#e5c178]"
            >
              {editingAsientoNum !== null ? 'Guardar Modificación' : 'Registrar Asiento Contable'}
            </button>
            {editingAsientoNum !== null && (
              <button
                type="button"
                onClick={cancelarEdicion}
                className="whitespace-nowrap rounded-md border border-[#233352] bg-[#16223b] px-4 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-[#1e2e4f]"
              >
                ✕ Cancelar Modificación
              </button>
            )}
            <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
              <span>
                Total Débito:{' '}
                <strong className="font-mono-tabular text-emerald-400">
                  {centsToStr(liveTotals.deb)}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Total Crédito:{' '}
                <strong className="font-mono-tabular text-rose-400">
                  {centsToStr(liveTotals.cred)}
                </strong>
              </span>
            </div>
          </div>
        </form>
      </div>

      {/* Confirmación inline de Anulación / Eliminación */}
      {pendingConfirm && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-rose-500/40 bg-rose-950/30 px-5 py-3 text-sm">
          <span className="text-slate-100">
            {pendingConfirm.type === 'ANULAR'
              ? `¿ANULAR el asiento #${pendingConfirm.asientoNum}?`
              : `¿ELIMINAR DEFINITIVAMENTE el asiento #${pendingConfirm.asientoNum}?`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                pendingConfirm.type === 'ANULAR'
                  ? executeAnular(pendingConfirm.asientoNum)
                  : executeEliminar(pendingConfirm.asientoNum)
              }
              className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => setPendingConfirm(null)}
              className="rounded-md border border-[#233352] bg-[#16223b] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-[#1e2e4f]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Asientos Registrados */}
      <div className="rounded-lg border border-[#233352] bg-[#0d1527] p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#233352] pb-3">
          <h3 className="text-base font-semibold text-[#c5a059]">
            Asientos Registrados
          </h3>
          <button
            type="button"
            onClick={handleExportDiarioCsv}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#233352] bg-[#16223b] px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-[#1e2e4f]"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar Libro Diario CSV
          </button>
        </div>

        <div className="my-4 flex flex-wrap items-center gap-3">
          <select
            value={selectedAsientoDropdown}
            onChange={(e) => setSelectedAsientoDropdown(e.target.value)}
            className="max-w-md flex-1 rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
          >
            <option value="">-- Seleccionar asiento a modificar --</option>
            {asientosUnicos.map((m) => (
              <option key={m.asiento_num} value={m.asiento_num}>
                #{m.asiento_num} · {m.fecha} · {m.mov_concepto || m.concepto || ''} —{' '}
                {m.tercero || ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              if (!selectedAsientoDropdown) {
                onNotify('Seleccione un asiento del listado.', 'error');
                return;
              }
              cargarEdicion(parseInt(selectedAsientoDropdown, 10));
            }}
            className="whitespace-nowrap rounded-md border border-[#233352] bg-[#16223b] px-3 py-2 text-xs font-semibold text-slate-100 transition-colors hover:bg-[#1e2e4f]"
          >
            ✎ Modificar asiento seleccionado
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#233352] bg-[#0a0f1d] text-xs font-semibold text-[#c5a059]">
                <th className="px-3 py-2.5">Asiento</th>
                <th className="px-3 py-2.5">Fecha</th>
                <th className="px-3 py-2.5">Concepto</th>
                <th className="px-3 py-2.5">Tercero</th>
                <th className="px-3 py-2.5">Código</th>
                <th className="px-3 py-2.5">Cuenta</th>
                <th className="px-3 py-2.5 text-right">Débito</th>
                <th className="px-3 py-2.5 text-right">Crédito</th>
                <th className="px-3 py-2.5">Estado</th>
                <th className="px-3 py-2.5">Acción</th>
              </tr>
            </thead>
            <tbody>
              {movs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-xs text-slate-400">
                    Sin movimientos registrados.
                  </td>
                </tr>
              ) : (
                movs.map((m) => {
                  const esPrimera = !vistosAsientos.has(m.asiento_num);
                  vistosAsientos.add(m.asiento_num);
                  const esPrimeraActiva =
                    m.estado === 'ACTIVO' && !vistosActivos.has(m.asiento_num);
                  if (m.estado === 'ACTIVO') vistosActivos.add(m.asiento_num);
                  const c = cuentaByCodigo(m.codigo_cuenta);

                  return (
                    <tr
                      key={m.id}
                      className="border-b border-[#233352]/60 transition-colors hover:bg-[#16223b]"
                    >
                      <td className="px-3 py-2 font-mono-tabular text-xs font-bold text-slate-100">
                        #{m.asiento_num}
                      </td>
                      <td className="px-3 py-2 font-mono-tabular text-xs text-slate-300">
                        {formatDateShort(m.fecha)}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-200">
                        {m.mov_concepto || m.concepto || ''}
                      </td>
                      <td className="px-3 py-2 font-mono-tabular text-xs text-slate-300">
                        {m.tercero || m.mov_tercero || ''}
                      </td>
                      <td className="px-3 py-2 font-mono-tabular text-xs text-sky-400">
                        {m.codigo_cuenta}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-200">{c ? c.nombre : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs text-emerald-400">
                        {centsToStr(m.debito_centavos)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs text-rose-400">
                        {centsToStr(m.credito_centavos)}
                      </td>
                      <td className="px-3 py-2 text-xs font-bold">
                        {m.estado === 'ACTIVO' ? (
                          <span className="text-emerald-400">ACTIVO</span>
                        ) : (
                          <span className="text-rose-400">{m.estado || 'REVERSADO'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {esPrimeraActiva ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => cargarEdicion(m.asiento_num)}
                              className="rounded bg-[#233352] px-2 py-1 text-xs font-medium text-slate-100 hover:bg-[#2f456e]"
                            >
                              Modificar
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPendingConfirm({ type: 'ANULAR', asientoNum: m.asiento_num })
                              }
                              className="rounded bg-[#233352] px-2 py-1 text-xs font-medium text-amber-300 hover:bg-[#2f456e]"
                            >
                              Anular
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPendingConfirm({ type: 'ELIMINAR', asientoNum: m.asiento_num })
                              }
                              className="rounded bg-rose-600 px-2 py-1 text-xs font-medium text-white hover:bg-rose-700"
                            >
                              Eliminar
                            </button>
                          </div>
                        ) : esPrimera && !asientosConActivo.has(m.asiento_num) ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPendingConfirm({ type: 'ELIMINAR', asientoNum: m.asiento_num })
                            }
                            className="rounded bg-rose-600 px-2 py-1 text-xs font-medium text-white hover:bg-rose-700"
                          >
                            Eliminar
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
