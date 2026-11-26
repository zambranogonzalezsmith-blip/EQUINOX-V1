import type { CompanyDataset, CompanyProfile } from '../types/accounting.js';
import { isValidVenezuelanRIF } from './monetary.js';
import { isSuperAdminEmail } from './rbac.js';
import { createEmptyCompanyDataset } from './venezuelaCatalog.js';

export interface BackupVerificationResult {
  valid: boolean;
  checksumValid: boolean;
  reason?: string;
  companies: CompanyProfile[];
  companyData: Record<string, CompanyDataset>;
  activeCompanyId?: string;
}

export async function computePayloadSha256Hex(value: unknown): Promise<string> {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function sanitizeRestoredCompanyProfile(
  raw: CompanyProfile,
  callerUid: string,
  callerEmail: string
): CompanyProfile {
  const now = new Date().toISOString();
  const cleanId = String(raw.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-');
  const rif = isValidVenezuelanRIF(raw.rif || '')
    ? String(raw.rif).trim().toUpperCase()
    : 'J-00000000-0';

  return {
    ...raw,
    id: cleanId.length >= 2 ? cleanId.slice(0, 128) : `emp-${Date.now()}`,
    razonSocial: String(raw.razonSocial || 'Entidad Restaurada').trim().slice(0, 180),
    rif,
    ownerUid: callerUid,
    googleAuthUid: callerUid,
    googleAuthEmail: callerEmail,
    googleVerified: true,
    googleAuthenticatedAt: raw.googleAuthenticatedAt || now,
    updatedAt: now,
    createdAt: raw.createdAt || now,
  };
}

export function sanitizeRestoredDataset(raw: CompanyDataset | undefined): CompanyDataset {
  const base = createEmptyCompanyDataset();
  if (!raw || typeof raw !== 'object') return base;
  return {
    catalogo: Array.isArray(raw.catalogo) && raw.catalogo.length > 0 ? raw.catalogo : base.catalogo,
    diario: Array.isArray(raw.diario) ? raw.diario : [],
    nextId: Math.max(1, Number(raw.nextId || 1)),
    exchangeRates:
      raw.exchangeRates && typeof raw.exchangeRates === 'object' ? raw.exchangeRates : {},
    cierres: Array.isArray(raw.cierres) ? raw.cierres : [],
    inventario:
      raw.inventario &&
      typeof raw.inventario === 'object' &&
      Array.isArray(raw.inventario.productos) &&
      Array.isArray(raw.inventario.movimientos)
        ? {
            productos: raw.inventario.productos,
            movimientos: raw.inventario.movimientos,
            movSeq: Math.max(0, Number(raw.inventario.movSeq || 0)),
          }
        : base.inventario,
    documentosFiscales: Array.isArray(raw.documentosFiscales) ? raw.documentosFiscales : [],
    retencionesIslr: Array.isArray(raw.retencionesIslr) ? raw.retencionesIslr : [],
    excedenteIvaAnteriorCentavos: Number(raw.excedenteIvaAnteriorCentavos || 0),
    conciliacionBancaria:
      raw.conciliacionBancaria &&
      typeof raw.conciliacionBancaria === 'object' &&
      Array.isArray(raw.conciliacionBancaria.movimientosBanco)
        ? {
            movimientosBanco: raw.conciliacionBancaria.movimientosBanco,
            conciliacionesPorPeriodo:
              raw.conciliacionBancaria.conciliacionesPorPeriodo &&
              typeof raw.conciliacionBancaria.conciliacionesPorPeriodo === 'object'
                ? raw.conciliacionBancaria.conciliacionesPorPeriodo
                : {},
          }
        : base.conciliacionBancaria,
    updatedAt: new Date().toISOString(),
  };
}

export async function validateDriveRestorePayload(params: {
  payload: Record<string, unknown>;
  callerUid: string;
  callerEmail: string;
  callerEmailVerified?: boolean;
  requireValidChecksum?: boolean;
}): Promise<BackupVerificationResult> {
  const {
    payload,
    callerUid,
    callerEmail,
    callerEmailVerified = true,
    requireValidChecksum = true,
  } = params;

  if (!payload || typeof payload !== 'object' || payload.platform !== 'Equinox-Books') {
    return {
      valid: false,
      checksumValid: false,
      reason: 'El archivo no pertenece al formato oficial de Equinox-Books.',
      companies: [],
      companyData: {},
    };
  }

  const normalizedCallerEmail = callerEmail.trim().toLowerCase();
  const payloadOwnerEmail = String(payload.ownerEmail || '').trim().toLowerCase();
  const isSuperAdmin = isSuperAdminEmail(normalizedCallerEmail) && callerEmailVerified;

  if (payloadOwnerEmail && normalizedCallerEmail && payloadOwnerEmail !== normalizedCallerEmail && !isSuperAdmin) {
    return {
      valid: false,
      checksumValid: false,
      reason: `Aislamiento por cuenta: este respaldo pertenece a ${String(payload.ownerEmail)}. Inicia sesión con ese correo para restaurar.`,
      companies: [],
      companyData: {},
    };
  }

  const providedChecksum = String(payload.checksumSha256 || '').trim();
  let checksumValid = false;

  if (providedChecksum) {
    if (payload.kind === 'company-books-backup') {
      const expected = await computePayloadSha256Hex({
        kind: 'company-books-backup',
        ownerUid: payload.ownerUid,
        ownerEmail: payload.ownerEmail,
        clientEmail: payload.clientEmail,
        company: payload.company,
        dataset: payload.dataset,
      });
      checksumValid = expected === providedChecksum;
    } else {
      const expected = await computePayloadSha256Hex({
        ownerUid: payload.ownerUid,
        ownerEmail: payload.ownerEmail,
        crmProfile: payload.crmProfile,
        activeCompanyId: payload.activeCompanyId,
        companies: payload.companies,
        companyData: payload.companyData,
      });
      checksumValid = expected === providedChecksum;
    }
  }

  if (requireValidChecksum && !checksumValid) {
    return {
      valid: false,
      checksumValid: false,
      reason: 'Verificación de integridad fallida: la firma SHA-256 del respaldo no coincide o el archivo fue alterado.',
      companies: [],
      companyData: {},
    };
  }

  if (payload.kind === 'company-books-backup') {
    const rawComp = payload.company as CompanyProfile | undefined;
    const rawDs = payload.dataset as CompanyDataset | undefined;
    if (!rawComp || !rawComp.id || !rawDs || !Array.isArray(rawDs.catalogo) || !Array.isArray(rawDs.diario)) {
      return {
        valid: false,
        checksumValid,
        reason: 'Estructura de libros de empresa incompleta en el archivo de respaldo.',
        companies: [],
        companyData: {},
      };
    }
    const cleanCompany = sanitizeRestoredCompanyProfile(rawComp, callerUid, normalizedCallerEmail);
    const cleanDataset = sanitizeRestoredDataset(rawDs);
    return {
      valid: true,
      checksumValid,
      companies: [cleanCompany],
      companyData: { [cleanCompany.id]: cleanDataset },
      activeCompanyId: cleanCompany.id,
    };
  }

  const rawCompanies = Array.isArray(payload.companies)
    ? (payload.companies as CompanyProfile[])
    : [];
  const rawCompanyData =
    payload.companyData && typeof payload.companyData === 'object'
      ? (payload.companyData as Record<string, CompanyDataset>)
      : {};

  if (rawCompanies.length === 0) {
    return {
      valid: false,
      checksumValid,
      reason: 'El respaldo de cuenta no contiene empresas válidas para restaurar.',
      companies: [],
      companyData: {},
    };
  }

  const companies: CompanyProfile[] = [];
  const companyData: Record<string, CompanyDataset> = {};

  for (const rc of rawCompanies) {
    if (!rc || !rc.id) continue;
    const cleanCompany = sanitizeRestoredCompanyProfile(rc, callerUid, normalizedCallerEmail);
    companies.push(cleanCompany);
    companyData[cleanCompany.id] = sanitizeRestoredDataset(rawCompanyData[rc.id]);
  }

  const requestedActive = String(payload.activeCompanyId || '');
  const activeCompanyId = companies.some((c) => c.id === requestedActive)
    ? requestedActive
    : companies[0]?.id;

  return {
    valid: companies.length > 0,
    checksumValid,
    companies,
    companyData,
    activeCompanyId,
  };
}
