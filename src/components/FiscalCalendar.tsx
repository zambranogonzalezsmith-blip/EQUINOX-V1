import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { CompanyProfile } from '../types/accounting';
import { todayISO } from '../utils/monetary';

export interface FiscalDeadlineItem {
  id: string;
  obligacion: string;
  categoria: 'IVA' | 'RET_IVA' | 'ISLR' | 'IGTF' | 'OTRO';
  fechaLimite: string;
  frecuencia: 'Quincenal' | 'Mensual' | 'Anual';
  aplica: boolean;
  detalle: string;
  norma: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface FiscalCalendarPayload {
  ok: true;
  rifTerminal: string;
  tipoContribuyente: string;
  periodo: string;
  providenciaReferencia: string;
  resumenNormativo: string;
  deadlines: FiscalDeadlineItem[];
  sources: GroundingSource[];
  searchQueries: string[];
  fetchedAt: string;
  fromCache?: boolean;
}

interface FiscalCalendarProps {
  company: CompanyProfile;
  periodo: string;
  compact?: boolean;
  onOpenFullCalendar?: () => void;
  onNotify?: (msg: string, type: 'success' | 'error') => void;
}

const STORAGE_PREFIX = 'equinox_seniat_cal_v1';
const WEEK_DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const RIF_DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function getRifTerminal(rif: string): string {
  const m = rif.match(/(\d)$/);
  return m ? m[1] : '0';
}

function buildCacheKey(company: CompanyProfile, periodo: string): string {
  return [
    STORAGE_PREFIX,
    getRifTerminal(company.rif),
    company.tipoContribuyente,
    company.agenteRetencionIva,
    company.agenteRetencionIslr ? 1 : 0,
    company.sujetoIgtf ? 1 : 0,
    periodo,
  ].join(':');
}

function readCachedCalendar(key: string): FiscalCalendarPayload | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FiscalCalendarPayload;
    if (parsed && parsed.ok && Array.isArray(parsed.deadlines)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCachedCalendar(key: string, data: FiscalCalendarPayload): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // ignore storage quota limits
  }
}

function diffDaysFromToday(isoDate: string, todayIso: string): number {
  const [ty, tm, td] = todayIso.split('-').map(Number);
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!ty || !tm || !td || !y || !m || !d) return 999;
  const utcToday = Date.UTC(ty, tm - 1, td);
  const utcTarget = Date.UTC(y, m - 1, d);
  return Math.round((utcTarget - utcToday) / (1000 * 60 * 60 * 24));
}

function getUrgencyBadge(daysLeft: number, aplica: boolean) {
  if (!aplica) {
    return {
      label: 'No Aplica',
      cls: 'border-[#2a3b5c] bg-[#0a0f1d] text-slate-400',
      priority: 4,
    };
  }
  if (daysLeft < 0) {
    return {
      label: `Venció hace ${Math.abs(daysLeft)}d`,
      cls: 'border-rose-500/50 bg-rose-950/40 text-rose-300',
      priority: 1,
    };
  }
  if (daysLeft === 0) {
    return {
      label: 'Vence Hoy',
      cls: 'border-amber-400 bg-amber-500/20 text-amber-200',
      priority: 0,
    };
  }
  if (daysLeft <= 7) {
    return {
      label: `Próximo · ${daysLeft}d`,
      cls: 'border-amber-500/60 bg-amber-950/40 text-amber-300',
      priority: 0,
    };
  }
  return {
    label: `En ${daysLeft}d`,
    cls: 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300',
    priority: 2,
  };
}

export const FiscalCalendar: React.FC<FiscalCalendarProps> = ({
  company,
  periodo,
  compact = false,
  onOpenFullCalendar,
  onNotify,
}) => {
  const rifTerminal = getRifTerminal(company.rif);
  const cacheKey = useMemo(() => buildCacheKey(company, periodo), [company, periodo]);

  const [calendarData, setCalendarData] = useState<FiscalCalendarPayload | null>(() =>
    readCachedCalendar(cacheKey)
  );
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [onlyApplicable, setOnlyApplicable] = useState<boolean>(true);

  const today = todayISO();

  const fetchSeniatCalendar = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await fetch('/api/fiscal-calendar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rif: company.rif,
            rifTerminal,
            tipoContribuyente: company.tipoContribuyente,
            agenteRetencionIva: company.agenteRetencionIva,
            agenteRetencionIslr: company.agenteRetencionIslr,
            sujetoIgtf: company.sujetoIgtf,
            periodo,
            forceRefresh,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          const msg = data?.error || 'No se pudo consultar el calendario SENIAT.';
          setErrorMsg(msg);
          if (forceRefresh && onNotify) {
            onNotify(msg, 'error');
          }
          return;
        }
        const typed = data as FiscalCalendarPayload;
        setCalendarData(typed);
        writeCachedCalendar(cacheKey, typed);
        if (forceRefresh && onNotify) {
          onNotify(
            `Calendario SENIAT (Terminal RIF ${rifTerminal}) actualizado mediante Google Search.`,
            'success'
          );
        }
      } catch {
        const msg =
          'Sin conexión con el servidor para consultar Google Search. Mostrando respaldo local si está disponible.';
        setErrorMsg(msg);
      } finally {
        setLoading(false);
      }
    },
    [
      cacheKey,
      company.agenteRetencionIslr,
      company.agenteRetencionIva,
      company.rif,
      company.sujetoIgtf,
      company.tipoContribuyente,
      onNotify,
      periodo,
      rifTerminal,
    ]
  );

  // Sync local cache when entity or period changes, and auto-fetch via Google Search if uncached
  useEffect(() => {
    const cached = readCachedCalendar(cacheKey);
    setCalendarData(cached);
    setSelectedDate(null);
    setErrorMsg(null);
    if (!cached && (typeof navigator === 'undefined' || navigator.onLine)) {
      void fetchSeniatCalendar(false);
    }
  }, [cacheKey, fetchSeniatCalendar]);

  const enrichedDeadlines = useMemo(() => {
    const raw = calendarData?.deadlines || [];
    return raw.map((d) => {
      const daysLeft = diffDaysFromToday(d.fechaLimite, today);
      const urgency = getUrgencyBadge(daysLeft, d.aplica);
      return { ...d, daysLeft, urgency };
    });
  }, [calendarData?.deadlines, today]);

  const visibleDeadlines = useMemo(() => {
    return enrichedDeadlines.filter((d) => {
      if (onlyApplicable && !d.aplica) return false;
      if (selectedDate && d.fechaLimite !== selectedDate) return false;
      return true;
    });
  }, [enrichedDeadlines, onlyApplicable, selectedDate]);

  const upcomingHighlighted = useMemo(() => {
    return enrichedDeadlines
      .filter((d) => d.aplica && d.daysLeft >= 0)
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 3);
  }, [enrichedDeadlines]);

  // Month grid cells for `periodo` (YYYY-MM)
  const monthGrid = useMemo(() => {
    const [yStr, mStr] = periodo.split('-');
    const year = Number(yStr) || new Date().getFullYear();
    const month = Number(mStr) || new Date().getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    // Convert JS Sunday=0..Saturday=6 into Monday=0..Sunday=6
    const firstDayJs = new Date(year, month - 1, 1).getDay();
    const leadingBlanks = (firstDayJs + 6) % 7;

    const deadlinesByDate = new Map<string, typeof enrichedDeadlines>();
    for (const item of enrichedDeadlines) {
      if (!item.fechaLimite.startsWith(periodo)) continue;
      if (onlyApplicable && !item.aplica) continue;
      const list = deadlinesByDate.get(item.fechaLimite) || [];
      list.push(item);
      deadlinesByDate.set(item.fechaLimite, list);
    }

    const cells: Array<{
      day: number | null;
      iso: string | null;
      items: typeof enrichedDeadlines;
    }> = [];

    for (let i = 0; i < leadingBlanks; i++) {
      cells.push({ day: null, iso: null, items: [] });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({
        day: d,
        iso,
        items: deadlinesByDate.get(iso) || [],
      });
    }
    return { cells, monthLabel: `${String(month).padStart(2, '0')}/${year}` };
  }, [enrichedDeadlines, onlyApplicable, periodo]);

  // Compact executive banner mode for top of ImpuestosVenezuelaModule
  if (compact) {
    const nextItem = upcomingHighlighted[0];
    return (
      <div className="rounded-lg border border-[#c5a059]/40 bg-[#0d1527] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#c5a059] bg-[#c5a059]/15 font-mono-tabular text-sm font-bold text-[#e5c178]">
              {rifTerminal}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#e5c178]">
                <CalendarDays className="h-3.5 w-3.5" />
                <span>
                  Calendario Fiscal SENIAT · RIF {company.rif} (Terminal {rifTerminal} ·{' '}
                  {company.tipoContribuyente})
                </span>
              </div>
              {loading ? (
                <p className="mt-0.5 text-xs text-slate-400">
                  Consultando fechas SENIAT vigentes con Google Search...
                </p>
              ) : nextItem ? (
                <p className="mt-0.5 text-xs text-slate-300">
                  Próximo vencimiento:{' '}
                  <strong className="text-[#f1f5f9]">{nextItem.obligacion}</strong> · Fecha límite{' '}
                  <span className="font-mono-tabular font-bold text-amber-300">
                    {nextItem.fechaLimite}
                  </span>{' '}
                  <span className="text-amber-300">({nextItem.urgency.label})</span>
                </p>
              ) : errorMsg ? (
                <p className="mt-0.5 text-xs text-amber-300">{errorMsg}</p>
              ) : (
                <p className="mt-0.5 text-xs text-slate-400">
                  Consulta en vivo las fechas límite de declaración y pago SENIAT para el terminal{' '}
                  {rifTerminal}.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => void fetchSeniatCalendar(true)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#2a3b5c] bg-[#16223b] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-[#c5a059]/60 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Consultando...' : 'Actualizar Google Search'}
            </button>
            {onOpenFullCalendar && (
              <button
                type="button"
                onClick={onOpenFullCalendar}
                className="cursor-pointer rounded-md bg-[#c5a059] px-3 py-1.5 text-xs font-bold text-[#0a0f1d] hover:bg-[#e5c178]"
              >
                Ver Calendario Completo
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
      {/* Cabecera del Calendario Fiscal */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#2a3b5c] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-[#c5a059]" />
            <h3 className="text-base font-bold text-[#e5c178]">
              Calendario Fiscal SENIAT en Tiempo Real (Google Search Grounding)
            </h3>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Vencimientos tributarios vigentes para <strong className="text-slate-200">{company.razonSocial}</strong>{' '}
            · RIF <span className="font-mono-tabular text-[#e5c178]">{company.rif}</span> ·{' '}
            Contribuyente <strong className="text-slate-200">{company.tipoContribuyente}</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#2a3b5c] bg-[#0a0f1d] px-3 py-1.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={onlyApplicable}
              onChange={(e) => setOnlyApplicable(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#c5a059]"
            />
            Solo obligaciones aplicables
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() => void fetchSeniatCalendar(true)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#c5a059] px-4 py-2 text-xs font-bold text-[#0a0f1d] transition-colors hover:bg-[#e5c178] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {loading ? 'Consultando Google Search...' : 'Consultar SENIAT (Google Search)'}
          </button>
        </div>
      </div>

      {/* Selector visual de Terminal de RIF (0-9) */}
      <div className="rounded-lg border border-[#2a3b5c] bg-[#0a0f1d] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs font-semibold text-slate-300">
              Dígito Terminal del RIF para Calendario SENIAT
            </span>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Las fechas quincenales de IVA, Retenciones de IVA, Anticipo ISLR e IGTF se determinan
              por el último dígito del RIF ({company.rif}).
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RIF_DIGITS.map((digit) => {
              const active = digit === rifTerminal;
              return (
                <span
                  key={digit}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-md border font-mono-tabular text-xs font-bold ${
                    active
                      ? 'border-[#c5a059] bg-[#c5a059] text-[#0a0f1d] shadow-md'
                      : 'border-[#2a3b5c] bg-[#0d1527] text-slate-500'
                  }`}
                >
                  {digit}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2.5 rounded-md border border-rose-500/50 bg-rose-950/30 p-4 text-xs text-rose-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <div>
            <p className="font-semibold">No se pudo completar la consulta en vivo</p>
            <p className="mt-1 text-rose-300/90">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Tarjetas de Próximos Vencimientos Destacados */}
      {upcomingHighlighted.length > 0 && (
        <div>
          <h4 className="mb-2.5 text-xs font-bold tracking-wider text-[#e5c178] uppercase">
            Próximos Vencimientos Destacados (Terminal {rifTerminal})
          </h4>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {upcomingHighlighted.map((item) => {
              const isUrgent = item.daysLeft <= 7;
              return (
                <div
                  key={item.id}
                  className={`rounded-lg border p-4 ${
                    isUrgent
                      ? 'border-amber-500/70 bg-amber-950/20'
                      : 'border-[#2a3b5c] bg-[#0a0f1d]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono-tabular text-[11px] font-bold text-sky-400">
                      {item.categoria} · {item.frecuencia}
                    </span>
                    <span
                      className={`rounded border px-2 py-0.5 font-mono-tabular text-[11px] font-bold ${item.urgency.cls}`}
                    >
                      {item.urgency.label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-bold text-slate-100">{item.obligacion}</p>
                  <p className="mt-1 font-mono-tabular text-xs font-semibold text-[#e5c178]">
                    Fecha Límite: {item.fechaLimite}
                  </p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                    {item.detalle}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Vista Dual: Matriz Mensual + Detalle de Vencimientos */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Mini Calendario Mensual */}
        <div className="rounded-lg border border-[#2a3b5c] bg-[#0a0f1d] p-4 lg:col-span-5">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-bold tracking-wide text-[#c5a059] uppercase">
              Mapa de Vencimientos · {monthGrid.monthLabel}
            </h4>
            {selectedDate && (
              <button
                type="button"
                onClick={() => setSelectedDate(null)}
                className="cursor-pointer text-[11px] font-semibold text-sky-400 hover:underline"
              >
                Ver todo el mes
              </button>
            )}
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-400">
            {WEEK_DAYS.map((wd) => (
              <div key={wd} className="py-1">
                {wd}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {monthGrid.cells.map((cell, idx) => {
              if (!cell.day || !cell.iso) {
                return <div key={`blank-${idx}`} className="h-10 rounded bg-transparent" />;
              }
              const isToday = cell.iso === today;
              const isSelected = cell.iso === selectedDate;
              const hasDeadline = cell.items.length > 0;
              const hasUrgent = cell.items.some((i) => i.aplica && i.daysLeft >= 0 && i.daysLeft <= 7);
              const hasPast = cell.items.some((i) => i.aplica && i.daysLeft < 0);

              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() =>
                    setSelectedDate((prev) => (prev === cell.iso ? null : cell.iso))
                  }
                  className={`flex h-10 cursor-pointer flex-col items-center justify-center rounded border text-xs transition-colors ${
                    isSelected
                      ? 'border-[#e5c178] bg-[#c5a059] font-bold text-[#0a0f1d]'
                      : hasUrgent
                        ? 'border-amber-400/80 bg-amber-950/40 font-bold text-amber-200 hover:bg-amber-900/50'
                        : hasDeadline
                          ? hasPast
                            ? 'border-rose-500/50 bg-rose-950/30 font-semibold text-rose-300'
                            : 'border-emerald-500/50 bg-emerald-950/30 font-semibold text-emerald-300'
                          : isToday
                            ? 'border-sky-400/70 bg-sky-950/30 text-sky-200'
                            : 'border-[#2a3b5c]/60 bg-[#0d1527] text-slate-300 hover:border-[#c5a059]/40'
                  }`}
                  title={
                    hasDeadline
                      ? cell.items.map((i) => `${i.obligacion} (${i.fechaLimite})`).join(' | ')
                      : cell.iso
                  }
                >
                  <span className="font-mono-tabular leading-none">{cell.day}</span>
                  {hasDeadline && (
                    <span
                      className={`mt-1 h-1.5 w-1.5 rounded-full ${
                        isSelected
                          ? 'bg-[#0a0f1d]'
                          : hasUrgent
                            ? 'bg-amber-400'
                            : hasPast
                              ? 'bg-rose-400'
                              : 'bg-emerald-400'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-3 border-t border-[#2a3b5c]/70 pt-3 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> Próximo (&le; 7 días)
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> En agenda
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-rose-400" /> Vencido
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-sky-400" /> Hoy
            </span>
          </div>
        </div>

        {/* Lista Detallada de Obligaciones */}
        <div className="rounded-lg border border-[#2a3b5c] bg-[#0a0f1d] p-4 lg:col-span-7">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold tracking-wide text-[#c5a059] uppercase">
              Cronograma de Obligaciones Tributarias ({visibleDeadlines.length})
            </h4>
            {calendarData?.providenciaReferencia && (
              <span className="font-mono-tabular text-[11px] text-slate-400">
                {calendarData.providenciaReferencia}
              </span>
            )}
          </div>

          {loading && !calendarData ? (
            <div className="flex flex-col items-center justify-center py-12 text-xs text-slate-400">
              <RefreshCw className="mb-2 h-5 w-5 animate-spin text-[#c5a059]" />
              Consultando calendario oficial SENIAT mediante Google Search...
            </div>
          ) : visibleDeadlines.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              {selectedDate
                ? `Sin obligaciones registradas específicamente para el ${selectedDate}.`
                : 'Presione "Consultar SENIAT (Google Search)" para obtener las fechas límite vigentes.'}
            </div>
          ) : (
            <div className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
              {visibleDeadlines.map((item) => {
                const isUrgent = item.aplica && item.daysLeft >= 0 && item.daysLeft <= 7;
                return (
                  <div
                    key={item.id}
                    className={`rounded-md border p-3 text-xs ${
                      isUrgent
                        ? 'border-amber-500/60 bg-amber-950/20'
                        : 'border-[#2a3b5c] bg-[#0d1527]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {isUrgent ? (
                          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                        ) : item.aplica ? (
                          <Clock className="h-4 w-4 shrink-0 text-emerald-400" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-slate-500" />
                        )}
                        <span className="font-bold text-slate-100">{item.obligacion}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono-tabular font-semibold text-[#e5c178]">
                          {item.fechaLimite}
                        </span>
                        <span
                          className={`rounded border px-2 py-0.5 font-mono-tabular text-[10px] font-bold ${item.urgency.cls}`}
                        >
                          {item.urgency.label}
                        </span>
                      </div>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-300">
                      {item.detalle}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                      <span>Norma: {item.norma}</span>
                      <span className="font-mono-tabular">
                        {item.categoria} &middot; {item.frecuencia}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Resumen Normativo y Fuentes Verificadas de Google Search */}
      {calendarData && (
        <div className="space-y-3 rounded-lg border border-[#2a3b5c] bg-[#0a0f1d] p-4 text-xs">
          {calendarData.resumenNormativo && (
            <p className="leading-relaxed text-slate-300">
              <strong className="text-[#e5c178]">Criterio SENIAT (Google Search):</strong>{' '}
              {calendarData.resumenNormativo}
            </p>
          )}

          {calendarData.sources.length > 0 && (
            <div className="border-t border-[#2a3b5c]/70 pt-3">
              <p className="mb-2 text-[11px] font-semibold text-slate-400 uppercase">
                Fuentes Verificadas en Google Search ({calendarData.sources.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {calendarData.sources.map((src) => (
                  <a
                    key={src.uri}
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-[#2a3b5c] bg-[#0d1527] px-2.5 py-1 text-[11px] text-sky-300 transition-colors hover:border-[#c5a059]/60 hover:text-[#e5c178]"
                  >
                    <span className="max-w-[260px] truncate">{src.title}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#2a3b5c]/60 pt-2 text-[10px] text-slate-500">
            <span>
              Última verificación Google Search:{' '}
              {new Date(calendarData.fetchedAt).toLocaleString('es-VE')}
            </span>
            {calendarData.searchQueries.length > 0 && (
              <span className="truncate">
                Búsquedas: {calendarData.searchQueries.slice(0, 2).join(' · ')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
