import React, { useMemo, useState } from 'react';
import {
  CompanyDataset,
  CuentaNIC,
  IndicadorLibro,
  NaturalezaCuenta,
  TipoCuenta,
  UbicacionEstado,
} from '../types/accounting';

interface CatalogoNICModuleProps {
  dataset: CompanyDataset;
  onUpdateDataset: (updater: (prev: CompanyDataset) => CompanyDataset, summary: string) => void;
  onNotify: (msg: string, type: 'success' | 'error') => void;
}

export const CatalogoNICModule: React.FC<CatalogoNICModuleProps> = ({
  dataset,
  onUpdateDataset,
  onNotify,
}) => {
  const nextIndexValue = useMemo(() => {
    if (!dataset.catalogo.length) return 1;
    return dataset.catalogo.reduce((max, c) => Math.max(max, Number(c.tipo_indice || 0)), 0) + 1;
  }, [dataset.catalogo]);

  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [tipoCuenta, setTipoCuenta] = useState<TipoCuenta>('Activo');
  const [naturaleza, setNaturaleza] = useState<NaturalezaCuenta>('Débito');
  const [ubicacion, setUbicacion] = useState<UbicacionEstado>('Balance General');
  const [indicadorLibro, setIndicadorLibro] = useState<IndicadorLibro>('Ninguno');
  const [seccionDestino, setSeccionDestino] = useState('Activo Corriente');
  const [normaNic, setNormaNic] = useState('NIC 1');
  const [partidaMonetaria, setPartidaMonetaria] = useState<boolean>(true);
  const [indice, setIndice] = useState<string>(() => String(nextIndexValue));
  const [search, setSearch] = useState('');
  const [filterTipo, setFilterTipo] = useState<string>('TODOS');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cod = codigo.trim();
    const nom = nombre.trim();
    const sec = seccionDestino.trim();
    const idxNum = parseInt(indice, 10);

    if (!cod || !nom || !sec || isNaN(idxNum)) {
      onNotify('Complete todos los campos requeridos del plan de cuentas NIC.', 'error');
      return;
    }
    if (dataset.catalogo.some((c) => c.codigo === cod)) {
      onNotify(`Error: el código ${cod} ya existe en el catálogo de esta empresa.`, 'error');
      return;
    }
    if (dataset.catalogo.some((c) => c.tipo_indice === idxNum)) {
      onNotify(`Error: el índice secuencial ${idxNum} ya está en uso.`, 'error');
      return;
    }

    const clasificacion: CuentaNIC['clasificacion_nic'] =
      ubicacion === 'Estado de Resultados'
        ? 'Resultados'
        : tipoCuenta === 'Patrimonio'
          ? 'Patrimonio'
          : /no corriente/i.test(sec)
            ? 'No Corriente'
            : 'Corriente';

    const nuevaCuenta: CuentaNIC = {
      codigo: cod,
      nombre: nom,
      tipo_cuenta: tipoCuenta,
      naturaleza,
      ubicacion_estado: ubicacion,
      indicador_libro: indicadorLibro,
      seccion_destino: sec,
      tipo_indice: idxNum,
      clasificacion_nic: clasificacion,
      partida_monetaria: partidaMonetaria,
      norma_nic: normaNic.trim() || 'NIC 1',
    };

    onUpdateDataset(
      (prev) => ({
        ...prev,
        catalogo: [...prev.catalogo, nuevaCuenta],
      }),
      `Nueva cuenta NIC ${cod} - ${nom}`
    );

    setCodigo('');
    setNombre('');
    setIndice(String(idxNum + 1));
    onNotify(`Cuenta ${cod} agregada al catálogo NIC / VEN-NIF.`, 'success');
  };

  const sortedCatalog = useMemo(
    () => dataset.catalogo.slice().sort((a, b) => a.tipo_indice - b.tipo_indice),
    [dataset.catalogo]
  );

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortedCatalog.filter((c) => {
      if (filterTipo !== 'TODOS' && c.tipo_cuenta !== filterTipo) return false;
      if (!q) return true;
      return (
        c.codigo.toLowerCase().includes(q) ||
        c.nombre.toLowerCase().includes(q) ||
        c.seccion_destino.toLowerCase().includes(q) ||
        (c.norma_nic || '').toLowerCase().includes(q)
      );
    });
  }, [filterTipo, search, sortedCatalog]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold text-[#e5c178]">
          Plan de Cuentas Corporativo (NIC / VEN-NIF Venezuela)
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Catálogo jerárquico con atributos fiscales SENIAT, clasificación Corriente/No Corriente
          (NIC 1) e identificación de partidas monetarias (NIC 21 / NIC 29).
        </p>
      </div>

      {/* Formulario Nueva Cuenta */}
      <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
        <h3 className="border-b border-[#2a3b5c] pb-3 text-base font-semibold text-[#c5a059]">
          Agregar Nueva Cuenta Contable NIC
        </h3>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Código Cuenta</label>
              <input
                type="text"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Ej: 1109"
                required
                className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-xs font-semibold text-slate-400">Nombre de la Cuenta</label>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Banco Banesco Cuenta Corriente"
                required
                className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Tipo de Cuenta</label>
              <select
                value={tipoCuenta}
                onChange={(e) => {
                  const val = e.target.value as TipoCuenta;
                  setTipoCuenta(val);
                  if (val === 'Activo' || val === 'Costo' || val === 'Gasto' || val === 'Egreso') {
                    setNaturaleza('Débito');
                  } else {
                    setNaturaleza('Crédito');
                  }
                  if (val === 'Ingreso' || val === 'Costo' || val === 'Gasto' || val === 'Egreso') {
                    setUbicacion('Estado de Resultados');
                    setSeccionDestino(
                      val === 'Ingreso'
                        ? 'Ingresos Operacionales'
                        : val === 'Costo'
                          ? 'Costos Operacionales'
                          : 'Gastos Operacionales'
                    );
                  } else {
                    setUbicacion('Balance General');
                    setSeccionDestino(
                      val === 'Activo'
                        ? 'Activo Corriente'
                        : val === 'Pasivo'
                          ? 'Pasivo Corriente'
                          : 'Patrimonio Neto'
                    );
                  }
                }}
                className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              >
                <option value="Activo">Activo</option>
                <option value="Pasivo">Pasivo</option>
                <option value="Patrimonio">Patrimonio</option>
                <option value="Ingreso">Ingreso</option>
                <option value="Costo">Costo</option>
                <option value="Gasto">Gasto</option>
                <option value="Egreso">Egreso</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Naturaleza</label>
              <select
                value={naturaleza}
                onChange={(e) => setNaturaleza(e.target.value as NaturalezaCuenta)}
                className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              >
                <option value="Débito">Débito</option>
                <option value="Crédito">Crédito</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Estado Financiero</label>
              <select
                value={ubicacion}
                onChange={(e) => setUbicacion(e.target.value as UbicacionEstado)}
                className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              >
                <option value="Balance General">Balance General</option>
                <option value="Estado de Resultados">Estado de Resultados</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                Indicador Libro Fiscal
              </label>
              <select
                value={indicadorLibro}
                onChange={(e) => setIndicadorLibro(e.target.value as IndicadorLibro)}
                className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              >
                <option value="Ninguno">Ninguno</option>
                <option value="Libro de Compras">Libro de Compras</option>
                <option value="Libro de Ventas">Libro de Ventas</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Sección Destino</label>
              <input
                type="text"
                value={seccionDestino}
                onChange={(e) => setSeccionDestino(e.target.value)}
                placeholder="Ej: Activo Corriente"
                required
                className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">Norma NIC / NIIF</label>
              <input
                type="text"
                value={normaNic}
                onChange={(e) => setNormaNic(e.target.value)}
                placeholder="Ej: NIC 16 / NIIF 9"
                className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                Naturaleza NIC 21 / NIC 29
              </label>
              <select
                value={partidaMonetaria ? 'MONETARIA' : 'NO_MONETARIA'}
                onChange={(e) => setPartidaMonetaria(e.target.value === 'MONETARIA')}
                className="rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
              >
                <option value="MONETARIA">Partida Monetaria (Tasa Cierre BCV)</option>
                <option value="NO_MONETARIA">Partida No Monetaria (Costo Histórico)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-400">
                Índice Secuencial (Único)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={indice}
                  onChange={(e) => setIndice(e.target.value)}
                  required
                  className="w-full rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 font-mono-tabular text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setIndice(String(nextIndexValue))}
                  className="whitespace-nowrap rounded-md border border-[#2a3b5c] bg-[#16223b] px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-[#1e2e4f]"
                >
                  Generar
                </button>
              </div>
            </div>
          </div>

          <div className="pt-1">
            <button
              type="submit"
              className="rounded-md bg-[#c5a059] px-5 py-2 text-xs font-bold text-[#0a0f1d] transition-colors hover:bg-[#e5c178]"
            >
              Guardar Cuenta NIC
            </button>
          </div>
        </form>
      </div>

      {/* Tabla del Plan de Cuentas */}
      <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código, denominación, sección o norma NIC..."
            className="max-w-md flex-1 rounded-md border border-[#233352] bg-[#0a0f1d] px-3 py-2 text-xs text-slate-100 focus:border-[#c5a059] focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-[#233352] bg-[#0a0f1d] p-1">
            {['TODOS', 'Activo', 'Pasivo', 'Patrimonio', 'Ingreso', 'Costo', 'Gasto'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilterTipo(t)}
                className={`whitespace-nowrap rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                  filterTipo === t
                    ? 'bg-[#c5a059] text-[#0a0f1d]'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#233352] bg-[#0a0f1d] text-xs font-semibold text-[#c5a059]">
                <th className="px-3 py-2.5">Índice</th>
                <th className="px-3 py-2.5">Código</th>
                <th className="px-3 py-2.5">Denominación</th>
                <th className="px-3 py-2.5">Tipo</th>
                <th className="px-3 py-2.5">Naturaleza</th>
                <th className="px-3 py-2.5">Estado Financiero</th>
                <th className="px-3 py-2.5">Libro Auxiliar</th>
                <th className="px-3 py-2.5">Sección Destino</th>
                <th className="px-3 py-2.5">Norma / NIC 21</th>
              </tr>
            </thead>
            <tbody>
              {filteredCatalog.map((c) => (
                <tr
                  key={c.codigo}
                  className="border-b border-[#233352]/60 transition-colors hover:bg-[#16223b]"
                >
                  <td className="px-3 py-2 font-mono-tabular text-xs font-bold text-slate-300">
                    {c.tipo_indice}
                  </td>
                  <td className="px-3 py-2 font-mono-tabular text-xs text-sky-400">{c.codigo}</td>
                  <td className="px-3 py-2 text-xs font-medium text-slate-100">{c.nombre}</td>
                  <td className="px-3 py-2 text-xs text-slate-300">{c.tipo_cuenta}</td>
                  <td className="px-3 py-2 text-xs font-semibold">
                    <span
                      className={
                        c.naturaleza === 'Débito' ? 'text-emerald-400' : 'text-rose-400'
                      }
                    >
                      {c.naturaleza}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-300">{c.ubicacion_estado}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{c.indicador_libro}</td>
                  <td className="px-3 py-2 text-xs text-slate-300">{c.seccion_destino}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {c.norma_nic || 'NIC 1'} ·{' '}
                    {c.partida_monetaria === false ? 'No Monetaria' : 'Monetaria'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
