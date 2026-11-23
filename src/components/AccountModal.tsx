import React, { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { AsientoLinea, CuentaNIC } from '../types/accounting';
import { centsToStr } from '../utils/monetary';

interface AccountModalProps {
  codigo: string | null;
  catalogo: CuentaNIC[];
  diario: AsientoLinea[];
  onClose: () => void;
  onEditAsiento: (asientoNum: number) => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  codigo,
  catalogo,
  diario,
  onClose,
  onEditAsiento,
}) => {
  useEffect(() => {
    if (!codigo) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [codigo, onClose]);

  const cuenta = useMemo(
    () => (codigo ? catalogo.find((c) => c.codigo === codigo) : undefined),
    [catalogo, codigo]
  );

  const movimientos = useMemo(() => {
    if (!codigo) return [];
    return diario
      .filter((m) => m.codigo_cuenta === codigo)
      .sort((a, b) => a.asiento_num - b.asiento_num || a.id - b.id);
  }, [codigo, diario]);

  if (!codigo) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative max-h-[85vh] w-full max-w-4xl overflow-auto rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 cursor-pointer rounded-md p-2 text-slate-400 transition-colors hover:bg-[#16223b] hover:text-slate-100"
          aria-label="Cerrar detalle de cuenta"
        >
          <X className="h-5 w-5" />
        </button>

        <h3 className="font-display text-xl font-semibold text-[#e5c178]">
          Movimientos · {cuenta ? `${cuenta.codigo} - ${cuenta.nombre}` : `Cuenta ${codigo}`}
        </h3>
        {cuenta && (
          <p className="mt-1 text-xs text-slate-400">
            Tipo: {cuenta.tipo_cuenta} · Naturaleza: {cuenta.naturaleza} · Sección:{' '}
            {cuenta.seccion_destino}
          </p>
        )}

        <div className="mt-5 overflow-x-auto">
          {movimientos.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              No hay movimientos para esta cuenta.
            </p>
          ) : (
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#2a3b5c] bg-[#0a0f1d] text-xs font-semibold text-[#c5a059]">
                  <th className="px-3 py-2.5">Fecha</th>
                  <th className="px-3 py-2.5">Asiento</th>
                  <th className="px-3 py-2.5">Tercero</th>
                  <th className="px-3 py-2.5">Concepto</th>
                  <th className="px-3 py-2.5 text-right">Débito</th>
                  <th className="px-3 py-2.5 text-right">Crédito</th>
                  <th className="px-3 py-2.5">Estado</th>
                </tr>
              </thead>
              <tbody>
                {movimientos.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-[#2a3b5c]/60 transition-colors hover:bg-[#16223b]"
                  >
                    <td className="px-3 py-2 font-mono-tabular text-xs text-slate-300">
                      {m.mov_fecha || m.fecha}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          onEditAsiento(m.asiento_num);
                          onClose();
                        }}
                        className="cursor-pointer font-mono-tabular text-xs font-semibold text-[#e5c178] underline-offset-2 hover:underline"
                      >
                        #{m.asiento_num}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-mono-tabular text-xs text-slate-300">
                      {m.mov_tercero || m.tercero || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-200">
                      {m.mov_concepto || m.concepto || ''}
                    </td>
                    <td className="px-3 py-2 text-right font-mono-tabular text-xs text-emerald-400">
                      {centsToStr(m.debito_centavos)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono-tabular text-xs text-rose-400">
                      {centsToStr(m.credito_centavos)}
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold text-slate-300">{m.estado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
