import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  Building2,
  Crown,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  fetchAllCompaniesForSuperAdmin,
  fetchAllCrmProfilesForSuperAdmin,
  fetchAllUsersForSuperAdmin,
} from '../services/firestoreSync';
import { CompanyDataset, CompanyProfile, CrmEmpresaTemplate } from '../types/accounting';
import { isSuperAdminEmail, SUPER_ADMIN_EMAIL, type UserProfileRecord } from '../utils/rbac';

interface SuperAdminModuleProps {
  googleUser: User | null;
  isOnline: boolean;
  onAuditCompanyInWorkspace: (company: CompanyProfile, dataset: CompanyDataset) => void;
  onNotify: (msg: string, type: 'success' | 'error') => void;
}

export const SuperAdminModule: React.FC<SuperAdminModuleProps> = ({
  googleUser,
  isOnline,
  onAuditCompanyInWorkspace,
  onNotify,
}) => {
  const [users, setUsers] = useState<UserProfileRecord[]>([]);
  const [crmByUid, setCrmByUid] = useState<Record<string, CrmEmpresaTemplate>>({});
  const [companies, setCompanies] = useState<CompanyProfile[]>([]);
  const [companyData, setCompanyData] = useState<Record<string, CompanyDataset>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const authorized = Boolean(
    googleUser && googleUser.emailVerified && isSuperAdminEmail(googleUser.email)
  );

  const loadGlobalGovernance = useCallback(async () => {
    if (!googleUser || !authorized) return;
    if (!isOnline) {
      setErrorMsg('Se requiere conexión a internet para consultar el directorio global en Firestore.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const [allUsers, allCompaniesRes, allCrms] = await Promise.all([
        fetchAllUsersForSuperAdmin(googleUser),
        fetchAllCompaniesForSuperAdmin(googleUser),
        fetchAllCrmProfilesForSuperAdmin(googleUser),
      ]);
      const crmMap: Record<string, CrmEmpresaTemplate> = {};
      for (const item of allCrms) {
        crmMap[item.ownerUid] = item;
      }
      setUsers(allUsers);
      setCrmByUid(crmMap);
      setCompanies(allCompaniesRes.companies);
      setCompanyData(allCompaniesRes.companyData);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'No se pudo cargar el directorio administrativo de Firestore.';
      setErrorMsg(msg);
      onNotify('Error al consultar consola Super Admin en Firestore.', 'error');
    } finally {
      setLoading(false);
    }
  }, [authorized, googleUser, isOnline, onNotify]);

  useEffect(() => {
    if (authorized && isOnline) {
      void loadGlobalGovernance();
    }
  }, [authorized, isOnline, loadGlobalGovernance]);

  const metrics = useMemo(() => {
    let totalEntries = 0;
    let totalDocs = 0;
    let verifiedCompanies = 0;

    for (const c of companies) {
      if (c.googleVerified) verifiedCompanies++;
      const ds = companyData[c.id];
      if (ds) {
        const activeNums = new Set(
          (ds.diario || []).filter((m) => m.estado === 'ACTIVO').map((m) => m.asiento_num)
        );
        totalEntries += activeNums.size;
        totalDocs += (ds.documentosFiscales || []).length;
      }
    }

    const standardUsersCount = users.filter((u) => u.role === 'user').length;
    return {
      totalUsers: users.length,
      standardUsersCount,
      totalCompanies: companies.length,
      verifiedCompanies,
      totalEntries,
      totalDocs,
    };
  }, [companies, companyData, users]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q)
    );
  }, [search, users]);

  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) =>
        c.razonSocial.toLowerCase().includes(q) ||
        c.rif.toLowerCase().includes(q) ||
        (c.googleAuthEmail || '').toLowerCase().includes(q)
    );
  }, [companies, search]);

  if (!authorized) {
    return (
      <div className="rounded-lg border border-rose-500/40 bg-rose-950/20 p-8 text-center">
        <Crown className="mx-auto mb-3 h-8 w-8 text-rose-400" />
        <h2 className="font-display text-xl font-bold text-rose-300">
          Acceso Exclusivo de Super Usuario Administrador
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-slate-300">
          Este panel está reservado estrictamente para la cuenta verificada{' '}
          <strong className="font-mono-tabular text-[#e5c178]">{SUPER_ADMIN_EMAIL}</strong>. Todas
          las demás cuentas operan con perfil de usuario estándar aislado.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded border border-[#c5a059]/60 bg-[#c5a059]/10 px-2.5 py-1 text-[11px] font-bold tracking-wider text-[#e5c178] uppercase">
            <Crown className="h-3.5 w-3.5" />
            Super Usuario &amp; Administrador Global
          </div>
          <h2 className="mt-2 font-display text-2xl font-bold text-[#e5c178]">
            Gobierno del Sistema Multi-Empresa Equinox-Books
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Supervisión global exclusiva para{' '}
            <strong className="font-mono-tabular text-emerald-400">{SUPER_ADMIN_EMAIL}</strong>.
            Todas las demás cuentas registradas operan estrictamente como usuarios estándar aislados
            a sus propias entidades.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadGlobalGovernance()}
          disabled={loading || !isOnline}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-[#c5a059] px-4 py-2 text-xs font-bold text-[#0a0f1d] transition-colors hover:bg-[#e5c178] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Sincronizando Firestore...' : 'Actualizar Panel Global'}
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-4 text-xs text-amber-200">
          {errorMsg}
        </div>
      )}

      {/* KPIs Globales */}
      <div className="grid grid-cols-2 gap-4 rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-5 lg:grid-cols-4">
        <div>
          <span className="text-xs text-slate-400">Cuentas Totales / Usuarios</span>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-[#f1f5f9]">
            {metrics.totalUsers}{' '}
            <span className="text-xs font-normal text-slate-400">
              ({metrics.standardUsersCount} estándar)
            </span>
          </p>
        </div>
        <div>
          <span className="text-xs text-slate-400">Empresas en Plataforma</span>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-emerald-400">
            {metrics.totalCompanies}
          </p>
        </div>
        <div>
          <span className="text-xs text-slate-400">Asientos Activos Globales</span>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-[#e5c178]">
            {metrics.totalEntries}
          </p>
        </div>
        <div>
          <span className="text-xs text-slate-400">Comprobantes Fiscales SENIAT</span>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-sky-400">
            {metrics.totalDocs}
          </p>
        </div>
      </div>

      {/* Buscador global */}
      <div className="flex items-center gap-3 rounded-lg border border-[#2a3b5c] bg-[#0d1527] px-4 py-2.5">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filtrar usuarios por correo/UID o empresas por Razón Social / RIF..."
          className="w-full bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
      </div>

      {/* Directorio de Usuarios y Roles */}
      <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
        <div className="flex items-center justify-between border-b border-[#2a3b5c] pb-3">
          <h3 className="inline-flex items-center gap-2 text-base font-semibold text-[#c5a059]">
            <Users className="h-4 w-4" />
            Directorio de Usuarios y Control de Roles ({filteredUsers.length})
          </h3>
          <span className="text-[11px] text-slate-400">
            Único Super Admin: {SUPER_ADMIN_EMAIL}
          </span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#233352] bg-[#0a0f1d] font-semibold text-[#c5a059]">
                <th className="px-3 py-2.5">Usuario</th>
                <th className="px-3 py-2.5">Correo Google</th>
                <th className="px-3 py-2.5">Rol en el Sistema</th>
                <th className="px-3 py-2.5">Plantilla CRM / Privacidad</th>
                <th className="px-3 py-2.5">Última Actividad</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    {loading
                      ? 'Cargando usuarios...'
                      : 'Sin usuarios registrados que coincidan con el filtro.'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isAdminRow = u.role === 'superadmin';
                  const crm = crmByUid[u.uid];
                  return (
                    <tr
                      key={u.uid}
                      className="border-b border-[#233352]/60 transition-colors hover:bg-[#16223b]"
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-slate-100">{u.displayName}</div>
                        <div className="font-mono-tabular text-[10px] text-slate-400">{u.uid}</div>
                      </td>
                      <td className="px-3 py-2.5 font-mono-tabular text-sky-300">{u.email}</td>
                      <td className="px-3 py-2.5">
                        {isAdminRow ? (
                          <span className="inline-flex items-center gap-1 rounded border border-[#c5a059] bg-[#c5a059]/15 px-2 py-0.5 font-bold text-[#e5c178]">
                            <Crown className="h-3 w-3" />
                            SUPER USUARIO · ADMIN
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded border border-[#2a3b5c] bg-[#0a0f1d] px-2 py-0.5 font-semibold text-slate-300">
                            <UserCheck className="h-3 w-3 text-emerald-400" />
                            USUARIO
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-300">
                        {crm ? (
                          <div>
                            <div className="font-semibold text-emerald-300">
                              {crm.razonSocial} ({crm.rif})
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {crm.nivelPrivacidad === 'ESTRICTO_AISLADO'
                                ? 'Privacidad: Estricto Aislado'
                                : 'Privacidad: Auditoría Corporativa'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-amber-300">CRM Pendiente</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono-tabular text-slate-400">
                        {new Date(u.updatedAt).toLocaleString('es-VE')}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Auditoría Multi-Empresa Global */}
      <div className="rounded-lg border border-[#2a3b5c] bg-[#0d1527] p-6">
        <div className="flex items-center justify-between border-b border-[#2a3b5c] pb-3">
          <h3 className="inline-flex items-center gap-2 text-base font-semibold text-[#c5a059]">
            <Building2 className="h-4 w-4" />
            Auditoría Global de Empresas Registradas ({filteredCompanies.length})
          </h3>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#233352] bg-[#0a0f1d] font-semibold text-[#c5a059]">
                <th className="px-3 py-2.5">Razón Social / RIF</th>
                <th className="px-3 py-2.5">Propietario Google</th>
                <th className="px-3 py-2.5">Régimen / Moneda</th>
                <th className="px-3 py-2.5 text-right">Asientos</th>
                <th className="px-3 py-2.5 text-right">Docs. IVA</th>
                <th className="px-3 py-2.5 text-right">Auditoría</th>
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    {loading
                      ? 'Cargando entidades...'
                      : 'Sin empresas registradas que coincidan con el filtro.'}
                  </td>
                </tr>
              ) : (
                filteredCompanies.map((c) => {
                  const ds = companyData[c.id];
                  const activeAsientos = ds
                    ? new Set(
                        ds.diario.filter((m) => m.estado === 'ACTIVO').map((m) => m.asiento_num)
                      ).size
                    : 0;
                  const docsCount = ds ? (ds.documentosFiscales || []).length : 0;

                  return (
                    <tr
                      key={c.id}
                      className="border-b border-[#233352]/60 transition-colors hover:bg-[#16223b]"
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-bold text-slate-100">{c.razonSocial}</div>
                        <div className="font-mono-tabular text-[11px] text-slate-400">
                          {c.rif} &middot; ID: {c.id}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="inline-flex items-center gap-1 font-mono-tabular text-emerald-400">
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                          {c.googleAuthEmail || 'No vinculado'}
                        </div>
                        <div className="font-mono-tabular text-[10px] text-slate-500">
                          UID: {c.ownerUid || 'N/A'}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-300">
                        {c.tipoContribuyente} &middot; {c.monedaFuncional}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-tabular font-semibold text-[#e5c178]">
                        {activeAsientos}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-tabular text-sky-400">
                        {docsCount}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {ds && (
                          <button
                            type="button"
                            onClick={() => onAuditCompanyInWorkspace(c, ds)}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded bg-[#233352] px-3 py-1.5 font-semibold text-[#e5c178] transition-colors hover:bg-[#2f456e]"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Abrir Libros
                          </button>
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
