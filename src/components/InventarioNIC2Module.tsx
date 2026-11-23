import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { CompanyDataset, MovimientoInventario } from '../types/accounting';
import { centsToStr, strToCents, todayISO } from '../utils/monetary';

interface InventarioNIC2ModuleProps {
  dataset: CompanyDataset;
  onUpdateDataset: (updater: (prev: CompanyDataset) => CompanyDataset, summary: string) => void;
  onNotify: (msg: string, type: 'success' | 'error') => void;
}

interface StockSummary {
  entradas: number;
  salidas: number;
  stock: number;
  costoPromCents: number;
  valorCents: number;
}

const EMPTY_STOCK: StockSummary = {
  entradas: 0,
  salidas: 0,
  stock: 0,
  costoPromCents: 0,
  valorCents: 0,
};

export const InventarioNIC2Module: React.FC<InventarioNIC2ModuleProps> = ({
  dataset,
  onUpdateDataset,
  onNotify,
}) => {
  const [pCodigo, setPCodigo] = useState('');
  const [pNombre, setPNombre] = useState('');
  const [pUnidad, setPUnidad] = useState('');
  const [pStockMin, setPStockMin] = useState('0');
  const [pVnr, setPVnr] = useState('0.00');

  const [mFecha, setMFecha] = useState(todayISO());
  const [mProducto, setMProducto] = useState('');
  const [mTipo, setMTipo] = useState<'ENTRADA' | 'SALIDA' | 'AJUSTE'>('ENTRADA');
  const [mConcepto, setMConcepto] = useState('');
  const [mCantidad, setMCantidad] = useState('');
  const [mCosto, setMCosto] = useState('');

  const [kardexCodigo, setKardexCodigo] = useState<string | null>(null);

  const { statsByProduct, movsByProduct } = useMemo(() => {
    const accum = new Map<string, { entradas: number; salidas: number; valorEntradas: number }>();
    const groupedMovs = new Map<string, MovimientoInventario[]>();

    for (const m of dataset.inventario.movimientos) {
      let bucket = groupedMovs.get(m.producto);
      if (!bucket) {
        bucket = [];
        groupedMovs.set(m.producto, bucket);
      }
      bucket.push(m);

      let st = accum.get(m.producto);
      if (!st) {
        st = { entradas: 0, salidas: 0, valorEntradas: 0 };
        accum.set(m.producto, st);
      }
      const q = Number(m.cantidad) || 0;
      const c = strToCents(m.costo_unitario);
      if (m.tipo === 'ENTRADA' || m.tipo === 'AJUSTE') {
        st.entradas += q;
        st.valorEntradas += Math.round(q * c);
      } else if (m.tipo === 'SALIDA') {
        st.salidas += q;
      }
    }

    const stats = new Map<string, StockSummary>();
    for (const [cod, st] of accum.entries()) {
      const stock = st.entradas - st.salidas;
      const costoPromCents = st.entradas > 0 ? Math.round(st.valorEntradas / st.entradas) : 0;
      stats.set(cod, {
        entradas: st.entradas,
        salidas: st.salidas,
        stock,
        costoPromCents,
        valorCents: Math.round(stock * costoPromCents),
      });
    }

    return { statsByProduct: stats, movsByProduct: groupedMovs };
  }, [dataset.inventario.movimientos]);

  const handleAddProducto = (e: React.FormEvent) => {
    e.preventDefault();
    const cod = pCodigo.trim();
    const nom = pNombre.trim();
    const uni = pUnidad.trim();
    const min = parseFloat(pStockMin) || 0;
    const vnrCents = strToCents(pVnr);

    if (!cod || !nom || !uni) {
      onNotify('Complete código, descripción y unidad de medida.', 'error');
      return;
    }
    if (dataset.inventario.productos.some((p) => p.codigo === cod)) {
      onNotify(`El código ${cod} ya existe en el inventario.`, 'error');
      return;
    }

    onUpdateDataset(
      (prev) => ({
        ...prev,
        inventario: {
          ...prev.inventario,
          productos: [
            ...prev.inventario.productos,
            {
              codigo: cod,
              nombre: nom,
              unidad: uni,
              stock_minimo: min,
              vnr_centavos: vnrCents > 0 ? vnrCents : undefined,
            },
          ],
        },
      }),
      `Nuevo producto NIC 2: ${cod} - ${nom}`
    );

    setPCodigo('');
    setPNombre('');
    setPUnidad('');
    setPStockMin('0');
    setPVnr('0.00');
    onNotify(`Producto ${cod} agregado al Libro de Inventario.`, 'success');
  };

  const handleAddMovimiento = (e: React.FormEvent) => {
    e.preventDefault();
    const q = parseFloat(mCantidad);
    if (!mFecha || !mProducto || !mConcepto.trim()) {
      onNotify('Complete los campos obligatorios del movimiento.', 'error');
      return;
    }
    if (!(q > 0)) {
      onNotify('Cantidad inválida.', 'error');
      return;
    }
    if (strToCents(mCosto) <= 0) {
      onNotify('Costo unitario inválido.', 'error');
      return;
    }
    const ex = statsByProduct.get(mProducto) || EMPTY_STOCK;
    if (mTipo === 'SALIDA' && q > ex.stock) {
      onNotify(`Stock insuficiente: disponible ${ex.stock}.`, 'error');
      return;
    }

    onUpdateDataset(
      (prev) => {
        const nextSeq = (prev.inventario.movSeq || 0) + 1;
        return {
          ...prev,
          inventario: {
            ...prev.inventario,
            movSeq: nextSeq,
            movimientos: [
              ...prev.inventario.movimientos,
              {
                id: nextSeq,
                fecha: mFecha,
                producto: mProducto,
                tipo: mTipo,
                concepto: mConcepto.trim(),
                cantidad: q,
                costo_unitario: mCosto.trim(),
              },
            ],
          },
        };
      },
      `Movimiento inventario ${mTipo} (${mProducto})`
    );

    setMConcepto('');
    setMCantidad('');
    setMCosto('');
    onNotify('Movimiento de inventario registrado (NIC 2).', 'success');
  };

  const handleDeleteProducto = (codigo: string) => {
    if (dataset.inventario.movimientos.some((m) => m.producto === codigo)) {
      onNotify('No se puede eliminar: el producto tiene movimientos en Kardex.', 'error');
      return;
    }
    onUpdateDataset(
      (prev) => ({
        ...prev,
        inventario: {
          ...prev.inventario,
          productos: prev.inventario.productos.filter((p) => p.codigo !== codigo),
        },
      }),
      `Eliminación de producto ${codigo}`
    );
    onNotify(`Producto ${codigo} eliminado.`, 'success');
  };

  const handleDeleteMovimiento = (id: number) => {
    onUpdateDataset(
      (prev) => ({
        ...prev,
        inventario: {
          ...prev.inventario,
          movimientos: prev.inventario.movimientos.filter((m) => m.id !== id),
        },
      }),
      `Eliminación de movimiento de inventario #${id}`
    );
    onNotify('Movimiento eliminado.', 'success');
  };

  const { existencias, totalValorCents } = useMemo(() => {
    let total = 0;
    const rows = dataset.inventario.productos.map((p) => {
      const ex = statsByProduct.get(p.codigo) || EMPTY_STOCK;
      const vnr = p.vnr_centavos || 0;
      const deterioroNIC2 =
        vnr > 0 && ex.costoPromCents > vnr ? Math.round((ex.costoPromCents - vnr) * ex.stock) : 0;
      total += ex.valorCents - deterioroNIC2;
      return { ...p, ...ex, deterioroNIC2 };
    });
    return { existencias: rows, totalValorCents: total };
  }, [dataset.inventario.productos, statsByProduct]);

  const hintEx = mProducto ? statsByProduct.get(mProducto) || EMPTY_STOCK : null;
  const kardexProd = useMemo(
    () =>
      kardexCodigo
        ? dataset.inventario.productos.find((p) => p.codigo === kardexCodigo) ?? null
        : null,
    [dataset.inventario.productos, kardexCodigo]
  );
  const kardexMovs = useMemo(() => {
    if (!kardexCodigo) return [];
    const list = movsByProduct.get(kardexCodigo) || [];
    return list
      .slice()
      .sort((a, b) => (a.fecha === b.fecha ? a.id - b.id : a.fecha < b.fecha ? -1 : 1));
  }, [kardexCodigo, movsByProduct]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold text-[#e5c178]">
          Libro de Inventario (NIC 2 · Art. 35 Código de Comercio Venezuela)
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Control de existencias por Costo Promedio Ponderado, Kardex por producto, alertas de stock
          mínimo y prueba de Valor Neto Realizable (NIC 2).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Nuevo Producto */}
        <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
          <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
            Agregar Producto al Inventario
          </h3>
          <form onSubmit={handleAddProducto} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400">Código Producto</label>
                <input
                  type="text"
                  value={pCodigo}
                  onChange={(e) => setPCodigo(e.target.value)}
                  placeholder="PRD-001"
                  required
                  className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400">Unidad de Medida</label>
                <input
                  type="text"
                  value={pUnidad}
                  onChange={(e) => setPUnidad(e.target.value)}
                  placeholder="UND / KG / LT"
                  required
                  className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
                />
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-xs font-semibold text-slate-400">
                  Nombre / Descripción
                </label>
                <input
                  type="text"
                  value={pNombre}
                  onChange={(e) => setPNombre(e.target.value)}
                  placeholder="Descripción del artículo"
                  required
                  className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400">Stock Mínimo</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={pStockMin}
                  onChange={(e) => setPStockMin(e.target.value)}
                  className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400">
                  VNR Estimado (NIC 2, opcional)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={pVnr}
                  onChange={(e) => setPVnr(e.target.value)}
                  className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-right font-mono-tabular text-xs text-slate-100"
                />
              </div>
            </div>
            <button
              type="submit"
              className="rounded-md bg-[#c5a059] px-5 py-2 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
            >
              Guardar Producto
            </button>
          </form>
        </div>

        {/* Registrar Movimiento */}
        <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
          <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
            Registrar Movimiento de Inventario
          </h3>
          <form onSubmit={handleAddMovimiento} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400">Fecha</label>
                <input
                  type="date"
                  value={mFecha}
                  onChange={(e) => setMFecha(e.target.value)}
                  required
                  className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400">Tipo Movimiento</label>
                <select
                  value={mTipo}
                  onChange={(e) => setMTipo(e.target.value as 'ENTRADA' | 'SALIDA' | 'AJUSTE')}
                  className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
                >
                  <option value="ENTRADA">Entrada (Compra / Producción)</option>
                  <option value="SALIDA">Salida (Venta / Consumo)</option>
                  <option value="AJUSTE">Ajuste por Diferencia (+)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-xs font-semibold text-slate-400">Producto</label>
                <select
                  value={mProducto}
                  onChange={(e) => setMProducto(e.target.value)}
                  required
                  className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
                >
                  <option value="">-- Seleccionar Producto --</option>
                  {dataset.inventario.productos.map((p) => (
                    <option key={p.codigo} value={p.codigo}>
                      {p.codigo} - {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label className="text-xs font-semibold text-slate-400">
                  Concepto / Referencia
                </label>
                <input
                  type="text"
                  value={mConcepto}
                  onChange={(e) => setMConcepto(e.target.value)}
                  placeholder="Ej: Compra Factura N° 045"
                  required
                  className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400">Cantidad</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={mCantidad}
                  onChange={(e) => setMCantidad(e.target.value)}
                  required
                  className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-400">Costo Unitario</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={mCosto}
                  onChange={(e) => setMCosto(e.target.value)}
                  placeholder="2.50"
                  required
                  className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-right font-mono-tabular text-xs text-slate-100"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="submit"
                className="rounded-md bg-[#c5a059] px-5 py-2 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
              >
                Registrar Movimiento
              </button>
              {hintEx && (
                <span className="text-xs text-slate-400">
                  Stock: <strong className="text-slate-200">{hintEx.stock}</strong> · Costo Prom.:{' '}
                  <strong className="font-mono-tabular text-[#e5c178]">
                    {centsToStr(hintEx.costoPromCents)}
                  </strong>
                </span>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Balance de Inventario Valorado */}
      <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
        <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
          Balance de Inventario Valorado (Menor entre Costo y VNR · NIC 2)
        </h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#233352] bg-[#0a0f1d] text-xs font-semibold text-[#c5a059]">
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Unidad</th>
                <th className="px-3 py-2 text-right">Entradas</th>
                <th className="px-3 py-2 text-right">Salidas</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2 text-right">Costo Prom.</th>
                <th className="px-3 py-2 text-right">Valor Neto NIC 2</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {existencias.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-xs text-slate-400">
                    Sin productos registrados en el Libro de Inventario.
                  </td>
                </tr>
              ) : (
                existencias.map((p) => {
                  const bajo = p.stock <= (p.stock_minimo || 0);
                  return (
                    <tr key={p.codigo} className="border-b border-[#233352]/60 hover:bg-[#16223b]">
                      <td className="px-3 py-2 font-mono-tabular text-xs text-sky-400">
                        {p.codigo}
                      </td>
                      <td className="px-3 py-2 text-xs font-medium text-slate-100">{p.nombre}</td>
                      <td className="px-3 py-2 text-xs text-slate-400">{p.unidad}</td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs">
                        {p.entradas}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs">
                        {p.salidas}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs font-bold">
                        {p.stock}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs">
                        {centsToStr(p.costoPromCents)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono-tabular text-xs font-bold text-emerald-400">
                        {centsToStr(p.valorCents - p.deterioroNIC2)}
                      </td>
                      <td className="px-3 py-2 text-xs font-semibold">
                        {bajo ? (
                          <span className="text-rose-400">BAJO STOCK</span>
                        ) : (
                          <span className="text-emerald-400">NOMINAL</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setKardexCodigo(p.codigo)}
                            className="rounded bg-[#233352] px-2 py-1 text-xs text-slate-100 hover:bg-[#2f456e]"
                          >
                            Kardex
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteProducto(p.codigo)}
                            className="rounded bg-rose-600 px-2 py-1 text-xs text-white hover:bg-rose-700"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#c5a059] bg-[#0a0f1d] text-xs font-bold">
                <td colSpan={7} className="px-3 py-3 text-right text-slate-200">
                  VALOR TOTAL DEL INVENTARIO (NIC 2):
                </td>
                <td colSpan={3} className="px-3 py-3 font-mono-tabular text-emerald-400">
                  {centsToStr(totalValorCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Modal Kardex */}
      {kardexCodigo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="relative max-h-[85vh] w-full max-w-4xl overflow-auto rounded-lg border border-[#233352] bg-[#111a2e] p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setKardexCodigo(null)}
              className="absolute right-4 top-4 rounded p-1.5 text-slate-400 hover:bg-[#16223b] hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="font-display text-xl font-bold text-[#e5c178]">
              Kardex · {kardexCodigo} - {kardexProd?.nombre}
            </h3>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#233352] bg-[#0a0f1d] text-[#c5a059]">
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Concepto</th>
                    <th className="px-3 py-2 text-right">Entrada</th>
                    <th className="px-3 py-2 text-right">Salida</th>
                    <th className="px-3 py-2 text-right">Costo Unit.</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                    <th className="px-3 py-2 text-right">Saldo Cant.</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let saldo = 0;
                    return kardexMovs.map((m) => {
                      const q = Number(m.cantidad) || 0;
                      saldo += m.tipo === 'SALIDA' ? -q : q;
                      const valor = Math.round(q * strToCents(m.costo_unitario));
                      return (
                        <tr key={m.id} className="border-b border-[#233352]/60">
                          <td className="px-3 py-2 font-mono-tabular">{m.fecha}</td>
                          <td className="px-3 py-2 font-semibold">{m.tipo}</td>
                          <td className="px-3 py-2">{m.concepto}</td>
                          <td className="px-3 py-2 text-right font-mono-tabular text-emerald-400">
                            {m.tipo !== 'SALIDA' ? q : ''}
                          </td>
                          <td className="px-3 py-2 text-right font-mono-tabular text-rose-400">
                            {m.tipo === 'SALIDA' ? q : ''}
                          </td>
                          <td className="px-3 py-2 text-right font-mono-tabular">
                            {centsToStr(strToCents(m.costo_unitario))}
                          </td>
                          <td className="px-3 py-2 text-right font-mono-tabular">
                            {centsToStr(valor)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono-tabular font-bold">
                            {saldo}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteMovimiento(m.id)}
                              className="text-rose-400 hover:underline"
                            >
                              Eliminar
                            </button>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
