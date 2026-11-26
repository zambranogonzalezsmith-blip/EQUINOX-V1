import React, { useMemo, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Landmark, Link2, Sparkles, Upload } from 'lucide-react';
import { CompanyDataset, CompanyProfile, MovimientoEstadoCuentaBanco } from '../types/accounting';
import {
  autoMatchBankMovements,
  buildBankAdjustmentJournalLines,
  computeBankReconciliationSummary,
  generateBankReconciliationCsv,
  parseBankStatementCsv,
} from '../utils/bankReconciliation';
import { centsToStr, strToCents, todayISO } from '../utils/monetary';

interface ConciliacionBancariaModuleProps {
  company: CompanyProfile;
  dataset: CompanyDataset;
  onUpdateDataset: (updater: (prev: CompanyDataset) => CompanyDataset, summary: string) => void;
  onNotify: (msg: string, type: 'success' | 'error') => void;
}

export const ConciliacionBancariaModule: React.FC<ConciliacionBancariaModuleProps> = ({
  company,
  dataset,
  onUpdateDataset,
  onNotify,
}) => {
  const bankAccounts = useMemo(() => {
    const filtered = dataset.catalogo.filter(
      (c) => c.tipo_cuenta === 'Activo' && (c.codigo.startsWith('1102') || c.codigo.startsWith('1103') || c.nombre.toLowerCase().includes('banco'))
    );
    return filtered.length > 0 ? filtered : dataset.catalogo.filter((c) => c.tipo_cuenta === 'Activo').slice(0, 5);
  }, [dataset.catalogo]);

  const contraAccounts = useMemo(
    () =>
      dataset.catalogo.filter(
        (c) => c.tipo_cuenta === 'Gasto' || c.tipo_cuenta === 'Ingreso' || c.tipo_cuenta === 'Costo' || c.codigo === '1104' || c.codigo === '2101'
      ),
    [dataset.catalogo]
  );

  const [periodo, setPeriodo] = useState<string>(todayISO().slice(0, 7));
  const [cuentaContable, setCuentaContable] = useState<string>(bankAccounts[0]?.codigo || '1102');
  const [saldoBancoInput, setSaldoBancoInput] = useState<string>('0.00');
  const [csvText, setCsvText] = useState<string>('');
  const [manualFecha, setManualFecha] = useState<string>(todayISO());
  const [manualRef, setManualRef] = useState<string>('');
  const [manualDesc, setManualDesc] = useState<string>('');
  const [manualDebito, setManualDebito] = useState<string>('0.00');
  const [manualCredito, setManualCredito] = useState<string>('0.00');
  const [contraCuenta, setContraCuenta] = useState<string>('5103');

  const concState = dataset.conciliacionBancaria || {
    movimientosBanco: [],
    conciliacionesPorPeriodo: {},
  };

  const periodKey = `${cuentaContable}_${periodo}`;
  const savedPeriodRecord = concState.conciliacionesPorPeriodo[periodKey];
  const effectiveBancoBalanceCentavos =
    saldoBancoInput.trim() !== '0.00' && saldoBancoInput.trim() !== ''
      ? strToCents(saldoBancoInput)
      : savedPeriodRecord?.saldoEstadoCuentaBancoCentavos || 0;

  const periodBankMovs = useMemo(
    () =>
      (concState.movimientosBanco || [])
        .filter((m) => m.cuentaContable === cuentaContable && m.fecha.startsWith(periodo))
        .sort((a, b) => a.fecha.localeCompare(b.fecha)),
    [concState.movimientosBanco, cuentaContable, periodo]
  );

  const summary = useMemo(
    () =>
      computeBankReconciliationSummary({
        bankMovs: concState.movimientosBanco || [],
        diario: dataset.diario || [],
        cuentaContable,
        periodo,
        saldoEstadoCuentaBancoCentavos: effectiveBancoBalanceCentavos,
      }),
    [concState.movimientosBanco, cuentaContable, dataset.diario, effectiveBancoBalanceCentavos, periodo]
  );

  const handleImportCsv = () => {
    const { movements, errors } = parseBankStatementCsv(csvText, cuentaContable);
    if (movements.length === 0) {
      onNotify(errors[0] || 'No se detectaron movimientos válidos en el CSV bancario.', 'error');
      return;
    }

    onUpdateDataset((prev) => {
      const current = prev.conciliacionBancaria || {
        movimientosBanco: [],
        conciliacionesPorPeriodo: {},
      };
      return {
        ...prev,
        conciliacionBancaria: {
          ...current,
          movimientosBanco: [...current.movimientosBanco, ...movements],
        },
      };
    }, `Importación CSV Banco ${cuentaContable} (${movements.length} mov.)`);

    setCsvText('');
    onNotify(
      `${movements.length} movimiento(s) bancario(s) importado(s)${errors.length > 0 ? ` (${errors.length} fila(s) omitida(s))` : ''}.`,
      'success'
    );
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCsvText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleAddManualBankMov = (e: React.FormEvent) => {
    e.preventDefault();
    const deb = strToCents(manualDebito);
    const cred = strToCents(manualCredito);
    if ((deb <= 0 && cred <= 0) || (deb > 0 && cred > 0)) {
      onNotify('Ingrese Débito (cargo banco) o Crédito (abono banco), no ambos.', 'error');
      return;
    }
    const mov: MovimientoEstadoCuentaBanco = {
      id: `bnk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fecha: manualFecha,
      referencia: manualRef.trim() || `MAN-${Date.now().toString().slice(-4)}`,
      descripcion: manualDesc.trim() || 'Movimiento Estado de Cuenta',
      cuentaContable,
      debitoCentavos: deb,
      creditoCentavos: cred,
    };

    onUpdateDataset((prev) => {
      const current = prev.conciliacionBancaria || {
        movimientosBanco: [],
        conciliacionesPorPeriodo: {},
      };
      return {
        ...prev,
        conciliacionBancaria: {
          ...current,
          movimientosBanco: [...current.movimientosBanco, mov],
        },
      };
    }, `Registro movimiento bancario ${mov.referencia}`);

    setManualRef('');
    setManualDesc('');
    setManualDebito('0.00');
    setManualCredito('0.00');
    onNotify('Movimiento bancario agregado al extracto.', 'success');
  };

  const handleAutoMatch = () => {
    const updated = autoMatchBankMovements(
      concState.movimientosBanco || [],
      dataset.diario || [],
      cuentaContable,
      periodo
    );
    const newlyMatched = updated.filter(
      (u, idx) => u.conciliadoConAsientoId && !concState.movimientosBanco[idx]?.conciliadoConAsientoId
    ).length;

    onUpdateDataset((prev) => {
      const current = prev.conciliacionBancaria || {
        movimientosBanco: [],
        conciliacionesPorPeriodo: {},
      };
      return {
        ...prev,
        conciliacionBancaria: {
          ...current,
          movimientosBanco: updated,
        },
      };
    }, `Emparejamiento automático conciliación ${cuentaContable} (${periodo})`);

    onNotify(
      newlyMatched > 0
        ? `Conciliación automática: ${newlyMatched} partida(s) emparejada(s) con el Libro Diario.`
        : 'No se encontraron nuevas coincidencias exactas para emparejar automáticamente.',
      newlyMatched > 0 ? 'success' : 'error'
    );
  };

  const handleToggleMatch = (bankMovId: string, asientoLineId?: number) => {
    onUpdateDataset((prev) => {
      const current = prev.conciliacionBancaria || {
        movimientosBanco: [],
        conciliacionesPorPeriodo: {},
      };
      return {
        ...prev,
        conciliacionBancaria: {
          ...current,
          movimientosBanco: current.movimientosBanco.map((m) =>
            m.id === bankMovId
              ? {
                  ...m,
                  conciliadoConAsientoId: asientoLineId,
                  tipoPartida: asientoLineId ? 'CONCILIADA' : 'NO_REGISTRADA_LIBROS',
                }
              : m
          ),
        },
      };
    }, 'Actualización manual de partida bancaria');
  };

  const handleGenerateAdjustmentEntry = (bm: MovimientoEstadoCuentaBanco) => {
    const maxAsiento = dataset.diario.reduce((m, l) => Math.max(m, l.asiento_num), 0);
    const nextAsiento = maxAsiento + 1;

    onUpdateDataset((prev) => {
      const current = prev.conciliacionBancaria || {
        movimientosBanco: [],
        conciliacionesPorPeriodo: {},
      };
      const lines = buildBankAdjustmentJournalLines({
        bankMovement: bm,
        contraCuentaCodigo: contraCuenta,
        nextAsientoNum: nextAsiento,
        firstLineId: prev.nextId,
      });
      const bankLineId = lines.find((l) => l.codigo_cuenta === bm.cuentaContable)?.id;

      return {
        ...prev,
        diario: [...prev.diario, ...lines],
        nextId: prev.nextId + lines.length,
        conciliacionBancaria: {
          ...current,
          movimientosBanco: current.movimientosBanco.map((m) =>
            m.id === bm.id
              ? {
                  ...m,
                  conciliadoConAsientoId: bankLineId,
                  tipoPartida: 'CONCILIADA',
                }
              : m
          ),
        },
      };
    }, `Asiento #${nextAsiento} ajuste bancario ${bm.referencia}`);

    onNotify(`Asiento contable #${nextAsiento} registrado y emparejado automáticamente.`, 'success');
  };

  const handleSavePeriodStatus = () => {
    onUpdateDataset((prev) => {
      const current = prev.conciliacionBancaria || {
        movimientosBanco: [],
        conciliacionesPorPeriodo: {},
      };
      return {
        ...prev,
        conciliacionBancaria: {
          ...current,
          conciliacionesPorPeriodo: {
            ...current.conciliacionesPorPeriodo,
            [periodKey]: {
              id: periodKey,
              periodo,
              cuentaContable,
              saldoEstadoCuentaBancoCentavos: effectiveBancoBalanceCentavos,
              saldoLibrosCentavos: summary.saldoLibrosInicialYCierreCentavos,
              diferenciaCentavos: summary.diferenciaCentavos,
              conciliada: summary.conciliado,
              fechaConciliacion: new Date().toISOString(),
            },
          },
        },
      };
    }, `Cierre conciliación bancaria ${cuentaContable} (${periodo})`);
    onNotify('Acta de Conciliación Bancaria guardada en la nube/libros.', 'success');
  };

  const handleExportCsv = () => {
    const csv = generateBankReconciliationCsv(summary, company.razonSocial);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Conciliacion_Bancaria_${cuentaContable}_${periodo}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-[#e5c178]">
            <Landmark className="h-6 w-6" />
            Conciliación Bancaria y Extractos
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Importación CSV de estados de cuenta, emparejamiento contra Libro Diario, detección de
            partidas en tránsito y generación automática de asientos de ajuste.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAutoMatch}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#c5a059] px-3.5 py-2 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Emparejar Automáticamente
          </button>
          <button
            type="button"
            onClick={handleSavePeriodStatus}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2a3b5c] bg-[#16223b] px-3.5 py-2 text-xs font-semibold text-emerald-300 hover:bg-[#1e2e4f]"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Guardar Acta Conciliación
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2a3b5c] bg-[#16223b] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-[#1e2e4f]"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Parámetros y Resumen Matemático */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-5">
          <h3 className="border-b border-[#2a3b5c] pb-2 text-sm font-semibold text-[#c5a059]">
            Parámetros de Conciliación
          </h3>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-400">Cuenta Bancaria Contable</label>
            <select
              value={cuentaContable}
              onChange={(e) => setCuentaContable(e.target.value)}
              className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
            >
              {bankAccounts.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.codigo} - {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-400">Período (Mes / Año)</label>
            <input
              type="month"
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
              className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-400">
              Saldo Final según Estado de Cuenta Bancario
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={saldoBancoInput}
              onChange={(e) => setSaldoBancoInput(e.target.value)}
              placeholder="0.00"
              className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-right font-mono-tabular text-xs text-slate-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-slate-400">
              Contrapartida para Asientos de Ajuste Automático
            </label>
            <select
              value={contraCuenta}
              onChange={(e) => setContraCuenta(e.target.value)}
              className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
            >
              {contraAccounts.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.codigo} - {c.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-5 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-[#2a3b5c] pb-2">
            <h3 className="text-sm font-semibold text-[#c5a059]">
              Cuadro de Conciliación Matemática ({periodo})
            </h3>
            <span
              className={`rounded px-2.5 py-0.5 text-xs font-bold ${
                summary.conciliado
                  ? 'bg-emerald-950/60 text-emerald-300'
                  : 'bg-amber-950/60 text-amber-300'
              }`}
            >
              {summary.conciliado
                ? 'CONCILIADA (DIFERENCIA 0.00)'
                : `DIFERENCIA: ${centsToStr(summary.diferenciaCentavos)}`}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="space-y-2 rounded border border-[#233352] bg-[#0a0f1d] p-4 text-xs">
              <div className="font-bold text-[#e5c178]">Según Estado de Cuenta Bancario</div>
              <div className="flex justify-between">
                <span className="text-slate-400">Saldo Final Extracto Banco:</span>
                <span className="font-mono-tabular">
                  {centsToStr(summary.saldoEstadoCuentaBancoCentavos)}
                </span>
              </div>
              <div className="flex justify-between text-emerald-400">
                <span>(+) Depósitos en Tránsito:</span>
                <span className="font-mono-tabular">
                  {centsToStr(summary.depositosEnTransitoCentavos)}
                </span>
              </div>
              <div className="flex justify-between text-rose-400">
                <span>(-) Cheques / Transferencias en Tránsito:</span>
                <span className="font-mono-tabular">
                  {centsToStr(summary.chequesEnTransitoCentavos)}
                </span>
              </div>
              <div className="flex justify-between border-t border-[#233352] pt-2 font-bold text-slate-100">
                <span>Saldo Bancario Conciliado:</span>
                <span className="font-mono-tabular text-[#e5c178]">
                  {centsToStr(summary.saldoBancoConciliadoCentavos)}
                </span>
              </div>
            </div>

            <div className="space-y-2 rounded border border-[#233352] bg-[#0a0f1d] p-4 text-xs">
              <div className="font-bold text-[#e5c178]">Según Libros Contables ({cuentaContable})</div>
              <div className="flex justify-between">
                <span className="text-slate-400">Saldo Mayor al Cierre {periodo}:</span>
                <span className="font-mono-tabular">
                  {centsToStr(summary.saldoLibrosInicialYCierreCentavos)}
                </span>
              </div>
              <div className="flex justify-between text-emerald-400">
                <span>(+) Notas de Crédito Banco no reg.:</span>
                <span className="font-mono-tabular">
                  {centsToStr(summary.notasCreditoBancoNoRegCentavos)}
                </span>
              </div>
              <div className="flex justify-between text-rose-400">
                <span>(-) Comisiones / ND Banco no reg.:</span>
                <span className="font-mono-tabular">
                  {centsToStr(summary.notasDebitoBancoNoRegCentavos)}
                </span>
              </div>
              <div className="flex justify-between border-t border-[#233352] pt-2 font-bold text-slate-100">
                <span>Saldo en Libros Ajustado:</span>
                <span className="font-mono-tabular text-[#e5c178]">
                  {centsToStr(summary.saldoLibrosAjustadoCentavos)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Carga CSV y Registro Manual */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2a3b5c] pb-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#c5a059]">
              <FileSpreadsheet className="h-4 w-4" />
              Importar Extracto Bancario CSV
            </h3>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-[#233352] bg-[#16223b] px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-[#1e2e4f]">
              <Upload className="h-3.5 w-3.5" />
              Cargar Archivo .CSV
              <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Formato: <code className="text-sky-300">fecha,referencia,descripcion,debito,credito</code>
          </p>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={4}
            placeholder={'fecha,referencia,descripcion,debito,credito\n2026-11-05,TRF-001,Comision Mantenimiento,25.00,0.00\n2026-11-06,DEP-882,Pago Cliente,0.00,1500.00'}
            className="mt-2 w-full rounded-md border border-[#233352] bg-[#0a0f1d] p-2.5 font-mono-tabular text-xs text-slate-100"
          />
          <button
            type="button"
            onClick={handleImportCsv}
            className="mt-3 rounded-md bg-[#c5a059] px-4 py-2 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
          >
            Procesar CSV Bancario
          </button>
        </div>

        <form onSubmit={handleAddManualBankMov} className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-5">
          <h3 className="border-b border-[#2a3b5c] pb-2 text-sm font-semibold text-[#c5a059]">
            Agregar Movimiento del Extracto Manualmente
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              type="date"
              value={manualFecha}
              onChange={(e) => setManualFecha(e.target.value)}
              required
              className="rounded border border-[#233352] bg-[#0a0f1d] px-2.5 py-2 text-xs text-slate-100"
            />
            <input
              type="text"
              value={manualRef}
              onChange={(e) => setManualRef(e.target.value)}
              placeholder="Referencia bancaria"
              className="rounded border border-[#233352] bg-[#0a0f1d] px-2.5 py-2 text-xs text-slate-100"
            />
            <input
              type="text"
              value={manualDesc}
              onChange={(e) => setManualDesc(e.target.value)}
              placeholder="Descripción (ej: Comisión, Depósito)"
              className="rounded border border-[#233352] bg-[#0a0f1d] px-2.5 py-2 text-xs text-slate-100 sm:col-span-2"
            />
            <input
              type="text"
              inputMode="decimal"
              value={manualDebito}
              onChange={(e) => setManualDebito(e.target.value)}
              placeholder="Débito / Cargo Banco"
              className="rounded border border-[#233352] bg-[#0a0f1d] px-2.5 py-2 text-right font-mono-tabular text-xs text-rose-400"
            />
            <input
              type="text"
              inputMode="decimal"
              value={manualCredito}
              onChange={(e) => setManualCredito(e.target.value)}
              placeholder="Crédito / Abono Banco"
              className="rounded border border-[#233352] bg-[#0a0f1d] px-2.5 py-2 text-right font-mono-tabular text-xs text-emerald-400"
            />
          </div>
          <button
            type="submit"
            className="mt-3 rounded-md bg-[#16223b] px-4 py-2 text-xs font-semibold text-slate-100 border border-[#233352] hover:bg-[#1e2e4f]"
          >
            + Agregar al Extracto
          </button>
        </form>
      </div>

      {/* Tabla Extracto Bancario vs Mayor Contable */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-5">
          <h3 className="border-b border-[#2a3b5c] pb-2 text-sm font-semibold text-[#c5a059]">
            Extracto Bancario Importado ({periodBankMovs.length})
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#233352] bg-[#0a0f1d] text-[#c5a059]">
                  <th className="px-2.5 py-2">Fecha</th>
                  <th className="px-2.5 py-2">Ref / Desc</th>
                  <th className="px-2.5 py-2 text-right">Cargo</th>
                  <th className="px-2.5 py-2 text-right">Abono</th>
                  <th className="px-2.5 py-2">Estado / Acción</th>
                </tr>
              </thead>
              <tbody>
                {periodBankMovs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                      No hay movimientos bancarios cargados para {cuentaContable} en {periodo}.
                    </td>
                  </tr>
                ) : (
                  periodBankMovs.map((bm) => (
                    <tr key={bm.id} className="border-b border-[#233352]/60">
                      <td className="px-2.5 py-2 font-mono-tabular">{bm.fecha}</td>
                      <td className="px-2.5 py-2">
                        <div className="font-semibold text-slate-100">{bm.referencia}</div>
                        <div className="text-slate-400">{bm.descripcion}</div>
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono-tabular text-rose-400">
                        {centsToStr(bm.debitoCentavos)}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono-tabular text-emerald-400">
                        {centsToStr(bm.creditoCentavos)}
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        {bm.conciliadoConAsientoId ? (
                          <button
                            type="button"
                            onClick={() => handleToggleMatch(bm.id, undefined)}
                            className="inline-flex items-center gap-1 rounded bg-emerald-950/60 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-900/60"
                          >
                            <Link2 className="h-3 w-3" />
                            Conciliado (Soltar)
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleGenerateAdjustmentEntry(bm)}
                            className="rounded bg-[#233352] px-2 py-1 text-[11px] font-semibold text-[#e5c178] hover:bg-[#2f456e]"
                          >
                            Generar Asiento Ajuste
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-5">
          <h3 className="border-b border-[#2a3b5c] pb-2 text-sm font-semibold text-[#c5a059]">
            Movimientos en Libro Mayor · {cuentaContable} ({summary.bookMovements.length})
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#233352] bg-[#0a0f1d] text-[#c5a059]">
                  <th className="px-2.5 py-2">Fecha</th>
                  <th className="px-2.5 py-2">Asiento / Concepto</th>
                  <th className="px-2.5 py-2 text-right">Débito</th>
                  <th className="px-2.5 py-2 text-right">Crédito</th>
                  <th className="px-2.5 py-2">Estatus</th>
                </tr>
              </thead>
              <tbody>
                {summary.bookMovements.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                      Sin movimientos contables en {cuentaContable} durante {periodo}.
                    </td>
                  </tr>
                ) : (
                  summary.bookMovements.map((bk) => (
                    <tr key={bk.asientoLineId} className="border-b border-[#233352]/60">
                      <td className="px-2.5 py-2 font-mono-tabular">{bk.fecha}</td>
                      <td className="px-2.5 py-2">
                        <span className="font-mono-tabular font-bold text-sky-400">
                          #{bk.asientoNum}
                        </span>{' '}
                        <span className="text-slate-200">{bk.concepto}</span>
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono-tabular text-emerald-400">
                        {centsToStr(bk.debitoCentavos)}
                      </td>
                      <td className="px-2.5 py-2 text-right font-mono-tabular text-rose-400">
                        {centsToStr(bk.creditoCentavos)}
                      </td>
                      <td className="px-2.5 py-2">
                        {bk.matchedBankId ? (
                          <span className="text-emerald-400 font-semibold">Conciliado</span>
                        ) : (
                          <span className="text-amber-300">En Tránsito</span>
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
    </div>
  );
};
