import {
  collection,
  deleteDoc,
  doc,
  type DocumentData,
  type QueryDocumentSnapshot,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  CompanyDataset,
  CompanyProfile,
  CrmEmpresaTemplate,
  NivelPrivacidadCRM,
  TamanoEmpresaCRM,
} from '../types/accounting';
import { isSuperAdminEmail, resolveUserRole, type UserProfileRecord } from '../utils/rbac';
import { createEmptyCompanyDataset, normalizeCompanyDataset } from '../utils/venezuelaCatalog';

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Timestamp)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function clampString(val: string | undefined, maxLen: number): string {
  return (val || '').trim().slice(0, maxLen);
}

function normalizeRifForRules(rif: string): string {
  const clean = rif.trim().toUpperCase();
  if (/^[JVEGP]-[0-9]{8}-[0-9]$/.test(clean)) return clean;
  return 'J-00000000-0';
}

function tsToIso(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function parseCompanyProfile(
  companyDoc: QueryDocumentSnapshot<DocumentData>,
  fallbackUid: string
): CompanyProfile {
  const raw = companyDoc.data();
  const ownerUid = String(raw.ownerUid || fallbackUid);
  return {
    id: String(raw.id || companyDoc.id),
    ownerUid,
    googleAuthUid: String(raw.googleAuthUid || ownerUid),
    googleAuthEmail: String(raw.googleAuthEmail || ''),
    googleVerified: Boolean(raw.googleVerified),
    googleAuthenticatedAt: raw.googleAuthenticatedAt
      ? String(raw.googleAuthenticatedAt)
      : undefined,
    razonSocial: String(raw.razonSocial || ''),
    rif: String(raw.rif || ''),
    tipoContribuyente: (raw.tipoContribuyente as CompanyProfile['tipoContribuyente']) || 'Ordinario',
    actividadEconomica: String(raw.actividadEconomica || ''),
    domicilioFiscal: String(raw.domicilioFiscal || ''),
    telefono: String(raw.telefono || ''),
    monedaFuncional: (raw.monedaFuncional as CompanyProfile['monedaFuncional']) || 'VES',
    alicuotaIvaGeneral: Number(raw.alicuotaIvaGeneral ?? 16),
    alicuotaIvaReducida: Number(raw.alicuotaIvaReducida ?? 8),
    agenteRetencionIva: ([0, 75, 100].includes(Number(raw.agenteRetencionIva))
      ? Number(raw.agenteRetencionIva)
      : 0) as 0 | 75 | 100,
    agenteRetencionIslr: Boolean(raw.agenteRetencionIslr),
    sujetoIgtf: Boolean(raw.sujetoIgtf),
    unidadTributariaBs: Number(raw.unidadTributariaBs ?? 9),
    contadorNombre: String(raw.contadorNombre || ''),
    cpcNumero: String(raw.cpcNumero || ''),
    periodoFiscalInicio: String(raw.periodoFiscalInicio || '2026-01-01'),
    createdAt: tsToIso(raw.createdAt),
    updatedAt: tsToIso(raw.updatedAt),
  };
}

function parseLedgerData(ld: DocumentData): CompanyDataset {
  return normalizeCompanyDataset({
    ...(ld as Partial<CompanyDataset>),
    updatedAt: tsToIso(ld.updatedAt),
  });
}

export async function upsertUserProfile(
  user: User,
  activeCompanyId?: string,
  options?: { primaryCompanyId?: string; crmCompleted?: boolean }
): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const role = resolveUserRole(user.email, user.emailVerified);
  try {
    const snap = await getDoc(ref);
    const displayName = clampString(
      user.displayName || user.email?.split('@')[0] || 'Usuario',
      140
    );
    const email = clampString(user.email || '', 200);
    const photoURL = user.photoURL ? clampString(user.photoURL, 500) : undefined;
    const activeId = activeCompanyId ? clampString(activeCompanyId, 128) : undefined;
    const primaryId = options?.primaryCompanyId
      ? clampString(options.primaryCompanyId, 128)
      : undefined;

    if (!snap.exists()) {
      const payload: Record<string, unknown> = {
        uid: user.uid,
        email,
        displayName,
        role,
        crmCompleted: Boolean(options?.crmCompleted ?? false),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (photoURL) payload.photoURL = photoURL;
      if (activeId) payload.activeCompanyId = activeId;
      if (primaryId) payload.primaryCompanyId = primaryId;
      await setDoc(ref, payload);
    } else {
      const updatePayload: Record<string, unknown> = {
        displayName,
        role,
        updatedAt: serverTimestamp(),
      };
      if (photoURL) updatePayload.photoURL = photoURL;
      if (activeId) updatePayload.activeCompanyId = activeId;
      if (primaryId) updatePayload.primaryCompanyId = primaryId;
      if (options?.crmCompleted !== undefined) {
        updatePayload.crmCompleted = options.crmCompleted;
      }
      await updateDoc(ref, updatePayload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

function parseCrmProfileData(raw: DocumentData, fallbackUid: string): CrmEmpresaTemplate {
  const validTamanos: TamanoEmpresaCRM[] = [
    'Micro',
    'Pequeña',
    'Mediana',
    'Gran Empresa',
    'Firma Contable',
  ];
  const validPrivacidad: NivelPrivacidadCRM[] = ['ESTRICTO_AISLADO', 'AUDITORIA_CORPORATIVA'];

  return {
    ownerUid: String(raw.ownerUid || fallbackUid),
    ownerEmail: String(raw.ownerEmail || ''),
    linkedCompanyId: String(raw.linkedCompanyId || ''),
    razonSocial: String(raw.razonSocial || ''),
    nombreComercial: raw.nombreComercial ? String(raw.nombreComercial) : '',
    rif: String(raw.rif || 'J-00000000-0'),
    sectorIndustria: raw.sectorIndustria ? String(raw.sectorIndustria) : '',
    tamanoEmpresa: validTamanos.includes(raw.tamanoEmpresa as TamanoEmpresaCRM)
      ? (raw.tamanoEmpresa as TamanoEmpresaCRM)
      : 'Mediana',
    representanteNombre: String(raw.representanteNombre || ''),
    representanteCargo: raw.representanteCargo ? String(raw.representanteCargo) : '',
    telefonoCorporativo: raw.telefonoCorporativo ? String(raw.telefonoCorporativo) : '',
    whatsappCorporativo: raw.whatsappCorporativo ? String(raw.whatsappCorporativo) : '',
    domicilioFiscal: raw.domicilioFiscal ? String(raw.domicilioFiscal) : '',
    ciudadEstado: raw.ciudadEstado ? String(raw.ciudadEstado) : '',
    sitioWeb: raw.sitioWeb ? String(raw.sitioWeb) : '',
    tipoContribuyente:
      raw.tipoContribuyente === 'Especial' || raw.tipoContribuyente === 'Formal'
        ? raw.tipoContribuyente
        : 'Ordinario',
    monedaFuncional: raw.monedaFuncional === 'USD' ? 'USD' : 'VES',
    contadorResponsable: raw.contadorResponsable ? String(raw.contadorResponsable) : '',
    cpcNumero: raw.cpcNumero ? String(raw.cpcNumero) : '',
    nivelPrivacidad: validPrivacidad.includes(raw.nivelPrivacidad as NivelPrivacidadCRM)
      ? (raw.nivelPrivacidad as NivelPrivacidadCRM)
      : 'ESTRICTO_AISLADO',
    autenticacionGoogleObligatoria: raw.autenticacionGoogleObligatoria !== false,
    bloquearExportacionExterna: Boolean(raw.bloquearExportacionExterna),
    notasCrm: raw.notasCrm ? String(raw.notasCrm) : '',
    completed: Boolean(raw.completed),
    createdAt: tsToIso(raw.createdAt),
    updatedAt: tsToIso(raw.updatedAt),
  };
}

export async function fetchCrmProfile(uid: string): Promise<CrmEmpresaTemplate | null> {
  const path = `crm_profiles/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'crm_profiles', uid));
    if (!snap.exists()) return null;
    return parseCrmProfileData(snap.data(), uid);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveCrmProfileToFirestore(
  user: User,
  crm: CrmEmpresaTemplate
): Promise<void> {
  const path = `crm_profiles/${user.uid}`;
  const ref = doc(db, 'crm_profiles', user.uid);
  try {
    const snap = await getDoc(ref);
    const mutableFields: Record<string, unknown> = {
      linkedCompanyId: clampString(crm.linkedCompanyId, 128),
      razonSocial: clampString(crm.razonSocial, 180) || 'Empresa Corporativa',
      nombreComercial: clampString(crm.nombreComercial, 180),
      rif: normalizeRifForRules(crm.rif),
      sectorIndustria: clampString(crm.sectorIndustria, 140),
      tamanoEmpresa: crm.tamanoEmpresa,
      representanteNombre: clampString(crm.representanteNombre, 140) || 'Representante Legal',
      representanteCargo: clampString(crm.representanteCargo, 100),
      telefonoCorporativo: clampString(crm.telefonoCorporativo, 40),
      whatsappCorporativo: clampString(crm.whatsappCorporativo, 40),
      domicilioFiscal: clampString(crm.domicilioFiscal, 300),
      ciudadEstado: clampString(crm.ciudadEstado, 120),
      sitioWeb: clampString(crm.sitioWeb, 200),
      tipoContribuyente: crm.tipoContribuyente,
      monedaFuncional: crm.monedaFuncional,
      contadorResponsable: clampString(crm.contadorResponsable, 140),
      cpcNumero: clampString(crm.cpcNumero, 40),
      nivelPrivacidad: crm.nivelPrivacidad,
      autenticacionGoogleObligatoria: true,
      bloquearExportacionExterna: Boolean(crm.bloquearExportacionExterna),
      notasCrm: clampString(crm.notasCrm, 600),
      completed: Boolean(crm.completed),
      updatedAt: serverTimestamp(),
    };

    if (!snap.exists()) {
      await setDoc(ref, {
        ownerUid: user.uid,
        ownerEmail: clampString(user.email || crm.ownerEmail, 200),
        ...mutableFields,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, mutableFields);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchAllCrmProfilesForSuperAdmin(user: User): Promise<CrmEmpresaTemplate[]> {
  if (!user.emailVerified || !isSuperAdminEmail(user.email)) {
    throw new Error('Acceso denegado: solo el Super Admin puede auditar plantillas CRM.');
  }
  const path = 'crm_profiles';
  try {
    const snap = await getDocs(collection(db, path));
    const list = snap.docs.map((d) => parseCrmProfileData(d.data(), d.id));
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchUserCompaniesAndLedgers(uid: string): Promise<{
  companies: CompanyProfile[];
  companyData: Record<string, CompanyDataset>;
}> {
  const companiesPath = 'companies';
  try {
    const q = query(collection(db, companiesPath), where('ownerUid', '==', uid));
    const snap = await getDocs(q);
    const ledgerEntries = await Promise.all(
      snap.docs.map(async (companyDoc) => {
        const profile = parseCompanyProfile(companyDoc, uid);
        const ledgerPath = `companies/${profile.id}/ledgers/main`;
        try {
          const ledgerSnap = await getDoc(doc(db, 'companies', profile.id, 'ledgers', 'main'));
          const dataset = ledgerSnap.exists()
            ? parseLedgerData(ledgerSnap.data())
            : createEmptyCompanyDataset();
          return { profile, dataset };
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, ledgerPath);
        }
      })
    );

    const companies: CompanyProfile[] = [];
    const companyData: Record<string, CompanyDataset> = {};
    for (const entry of ledgerEntries) {
      companies.push(entry.profile);
      companyData[entry.profile.id] = entry.dataset;
    }

    companies.sort((a, b) => a.razonSocial.localeCompare(b.razonSocial));
    return { companies, companyData };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, companiesPath);
  }
}

export async function fetchAllUsersForSuperAdmin(user: User): Promise<UserProfileRecord[]> {
  if (!user.emailVerified || !isSuperAdminEmail(user.email)) {
    throw new Error('Acceso denegado: solo el Super Usuario Administrador puede listar cuentas.');
  }
  const path = 'users';
  try {
    const snap = await getDocs(collection(db, path));
    const users: UserProfileRecord[] = snap.docs.map((d) => {
      const raw = d.data();
      const email = String(raw.email || '');
      const enforcedRole = isSuperAdminEmail(email) ? 'superadmin' : 'user';
      return {
        uid: String(raw.uid || d.id),
        email,
        displayName: String(raw.displayName || email || 'Usuario'),
        photoURL: raw.photoURL ? String(raw.photoURL) : undefined,
        activeCompanyId: raw.activeCompanyId ? String(raw.activeCompanyId) : undefined,
        primaryCompanyId: raw.primaryCompanyId ? String(raw.primaryCompanyId) : undefined,
        crmCompleted: Boolean(raw.crmCompleted),
        role: enforcedRole,
        createdAt: tsToIso(raw.createdAt),
        updatedAt: tsToIso(raw.updatedAt),
      };
    });
    users.sort((a, b) => {
      if (a.role !== b.role) return a.role === 'superadmin' ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    return users;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchAllCompaniesForSuperAdmin(user: User): Promise<{
  companies: CompanyProfile[];
  companyData: Record<string, CompanyDataset>;
}> {
  if (!user.emailVerified || !isSuperAdminEmail(user.email)) {
    throw new Error('Acceso denegado: solo el Super Usuario Administrador puede auditar empresas.');
  }
  const path = 'companies';
  try {
    const snap = await getDocs(collection(db, path));
    const ledgerEntries = await Promise.all(
      snap.docs.map(async (companyDoc) => {
        const profile = parseCompanyProfile(companyDoc, user.uid);
        const ledgerPath = `companies/${profile.id}/ledgers/main`;
        try {
          const ledgerSnap = await getDoc(doc(db, 'companies', profile.id, 'ledgers', 'main'));
          const dataset = ledgerSnap.exists()
            ? parseLedgerData(ledgerSnap.data())
            : createEmptyCompanyDataset();
          return { profile, dataset };
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, ledgerPath);
        }
      })
    );

    const companies: CompanyProfile[] = [];
    const companyData: Record<string, CompanyDataset> = {};
    for (const entry of ledgerEntries) {
      companies.push(entry.profile);
      companyData[entry.profile.id] = entry.dataset;
    }

    companies.sort((a, b) => a.razonSocial.localeCompare(b.razonSocial));
    return { companies, companyData };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveCompanyToFirestore(
  user: User,
  company: CompanyProfile,
  dataset?: CompanyDataset
): Promise<void> {
  const companyPath = `companies/${company.id}`;
  const companyRef = doc(db, 'companies', company.id);

  let effectiveOwnerUid = user.uid;

  try {
    const existingSnap = await getDoc(companyRef);
    const existingData = existingSnap.exists() ? existingSnap.data() : null;
    effectiveOwnerUid = existingData?.ownerUid ? String(existingData.ownerUid) : user.uid;

    const googleAuthUid = existingData?.googleAuthUid
      ? String(existingData.googleAuthUid)
      : clampString(user.uid, 128);
    const googleEmail = existingSnap.exists()
      ? clampString(
          company.googleAuthEmail || (existingData?.googleAuthEmail as string) || user.email || '',
          200
        )
      : clampString(user.email || company.googleAuthEmail || '', 200);

    const mutableFields: Record<string, unknown> = {
      googleAuthUid,
      googleAuthEmail: googleEmail,
      googleVerified: true,
      googleAuthenticatedAt: clampString(
        company.googleAuthenticatedAt || new Date().toISOString(),
        64
      ),
      razonSocial: clampString(company.razonSocial, 180) || 'Entidad Sin Nombre',
      rif: normalizeRifForRules(company.rif),
      tipoContribuyente: company.tipoContribuyente,
      actividadEconomica: clampString(company.actividadEconomica, 220),
      domicilioFiscal: clampString(company.domicilioFiscal, 300),
      telefono: clampString(company.telefono, 40),
      monedaFuncional: company.monedaFuncional,
      alicuotaIvaGeneral: Number(company.alicuotaIvaGeneral ?? 16),
      alicuotaIvaReducida: Number(company.alicuotaIvaReducida ?? 8),
      agenteRetencionIva: ([0, 75, 100].includes(Number(company.agenteRetencionIva))
        ? Number(company.agenteRetencionIva)
        : 0) as 0 | 75 | 100,
      agenteRetencionIslr: Boolean(company.agenteRetencionIslr),
      sujetoIgtf: Boolean(company.sujetoIgtf),
      unidadTributariaBs: Number(company.unidadTributariaBs ?? 9),
      contadorNombre: clampString(company.contadorNombre, 140),
      cpcNumero: clampString(company.cpcNumero, 40),
      periodoFiscalInicio: clampString(company.periodoFiscalInicio, 20),
      updatedAt: serverTimestamp(),
    };

    if (!existingSnap.exists()) {
      await setDoc(companyRef, {
        id: clampString(company.id, 128),
        ownerUid: user.uid,
        ...mutableFields,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(companyRef, mutableFields);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, companyPath);
  }

  if (dataset) {
    await saveLedgerToFirestore(effectiveOwnerUid, company.id, dataset);
  }
}

export async function saveLedgerToFirestore(
  ownerUid: string,
  companyId: string,
  dataset: CompanyDataset
): Promise<void> {
  const ledgerPath = `companies/${companyId}/ledgers/main`;
  const ledgerRef = doc(db, 'companies', companyId, 'ledgers', 'main');

  try {
    const snap = await getDoc(ledgerRef);
    const mutableLedger = stripUndefinedDeep({
      catalogo: (dataset.catalogo || []).slice(0, 1000),
      diario: (dataset.diario || []).slice(0, 5000),
      nextId: Math.max(1, Number(dataset.nextId || 1)),
      exchangeRates: dataset.exchangeRates || {},
      cierres: (dataset.cierres || []).slice(0, 500),
      inventario: dataset.inventario || { productos: [], movimientos: [], movSeq: 0 },
      documentosFiscales: (dataset.documentosFiscales || []).slice(0, 3000),
      retencionesIslr: (dataset.retencionesIslr || []).slice(0, 3000),
      excedenteIvaAnteriorCentavos: Number(dataset.excedenteIvaAnteriorCentavos || 0),
      conciliacionBancaria: dataset.conciliacionBancaria || {
        movimientosBanco: [],
        conciliacionesPorPeriodo: {},
      },
    });

    if (!snap.exists()) {
      await setDoc(ledgerRef, {
        ownerUid,
        companyId,
        ...mutableLedger,
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ledgerRef, {
        ...mutableLedger,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, ledgerPath);
  }
}

export async function deleteCompanyFromFirestore(companyId: string): Promise<void> {
  const ledgerPath = `companies/${companyId}/ledgers/main`;
  const companyPath = `companies/${companyId}`;
  try {
    await deleteDoc(doc(db, 'companies', companyId, 'ledgers', 'main'));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, ledgerPath);
  }
  try {
    await deleteDoc(doc(db, 'companies', companyId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, companyPath);
  }
}
