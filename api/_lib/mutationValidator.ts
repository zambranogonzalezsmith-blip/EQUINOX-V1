import type {
  CompanyDataset,
  CompanyProfile,
  PendingSyncMutation,
} from '../../src/types/accounting.js';
import type { VerifiedFirebaseCaller } from './firebaseAuth.js';

export const ALLOWED_MUTATION_ACTIONS = new Set([
  'DATASET_UPDATE',
  'COMPANY_CREATE',
  'COMPANY_UPDATE',
  'COMPANY_DELETE',
] as const);

export type AllowedMutationAction =
  | 'DATASET_UPDATE'
  | 'COMPANY_CREATE'
  | 'COMPANY_UPDATE'
  | 'COMPANY_DELETE';

export interface RejectedMutationInfo {
  id: string;
  companyId: string;
  actionType: string;
  status: 400 | 403 | 404;
  error: string;
}

export type MutationValidationResult =
  | {
      allowed: true;
      actionType: AllowedMutationAction;
      sanitizedCompany?: CompanyProfile;
      sanitizedDataset?: CompanyDataset;
      deleteCompanyId?: string;
    }
  | {
      allowed: false;
      status: 400 | 403 | 404;
      error: string;
    };

const VALID_ID_RE = /^[a-zA-Z0-9_-]{2,128}$/;
const VALID_RIF_RE = /^[JVEGP]-[0-9]{8}-[0-9]$/;

export function isValidEntityId(id: unknown): id is string {
  return typeof id === 'string' && VALID_ID_RE.test(id);
}

export function isCallerAuthorizedForCompany(
  caller: VerifiedFirebaseCaller,
  company: Pick<CompanyProfile, 'ownerUid'>
): boolean {
  if (caller.isSuperAdmin) return true;
  return Boolean(company.ownerUid && company.ownerUid === caller.uid);
}

function normalizeRif(rawRif: unknown): string {
  const clean = String(rawRif || '').trim().toUpperCase();
  if (VALID_RIF_RE.test(clean)) return clean;
  return 'J-00000000-0';
}

function sanitizeCompanyProfile(
  incoming: CompanyProfile,
  existingCompany: CompanyProfile | null,
  caller: VerifiedFirebaseCaller
): CompanyProfile {
  const now = new Date().toISOString();
  const isNew = !existingCompany;
  const ownerUid = isNew ? caller.uid : existingCompany.ownerUid || caller.uid;
  const googleAuthUid = isNew
    ? caller.uid
    : existingCompany.googleAuthUid || ownerUid;
  const googleAuthEmail = isNew
    ? caller.email
    : String(incoming.googleAuthEmail || existingCompany.googleAuthEmail || caller.email).slice(
        0,
        200
      );

  return {
    id: isNew ? incoming.id : existingCompany.id,
    ownerUid,
    googleAuthUid,
    googleAuthEmail,
    googleVerified: true,
    googleAuthenticatedAt: String(incoming.googleAuthenticatedAt || now).slice(0, 64),
    razonSocial: String(incoming.razonSocial || '').trim().slice(0, 180) || 'Entidad Corporativa',
    rif: normalizeRif(incoming.rif),
    tipoContribuyente:
      incoming.tipoContribuyente === 'Especial' || incoming.tipoContribuyente === 'Formal'
        ? incoming.tipoContribuyente
        : 'Ordinario',
    actividadEconomica: String(incoming.actividadEconomica || '').trim().slice(0, 220),
    domicilioFiscal: String(incoming.domicilioFiscal || '').trim().slice(0, 300),
    telefono: String(incoming.telefono || '').trim().slice(0, 40),
    monedaFuncional: incoming.monedaFuncional === 'USD' ? 'USD' : 'VES',
    alicuotaIvaGeneral: Number(incoming.alicuotaIvaGeneral ?? 16),
    alicuotaIvaReducida: Number(incoming.alicuotaIvaReducida ?? 8),
    agenteRetencionIva: ([0, 75, 100].includes(Number(incoming.agenteRetencionIva))
      ? Number(incoming.agenteRetencionIva)
      : 0) as 0 | 75 | 100,
    agenteRetencionIslr: Boolean(incoming.agenteRetencionIslr),
    sujetoIgtf: Boolean(incoming.sujetoIgtf),
    unidadTributariaBs: Number(incoming.unidadTributariaBs ?? 9),
    contadorNombre: String(incoming.contadorNombre || '').trim().slice(0, 140),
    cpcNumero: String(incoming.cpcNumero || '').trim().slice(0, 40),
    periodoFiscalInicio: String(incoming.periodoFiscalInicio || '2026-01-01').slice(0, 20),
    createdAt: isNew ? now : existingCompany.createdAt,
    updatedAt: String(incoming.updatedAt || now),
  };
}

function sanitizeDataset(incoming: CompanyDataset): CompanyDataset | null {
  if (!incoming || typeof incoming !== 'object') return null;
  if (!Array.isArray(incoming.catalogo) || !Array.isArray(incoming.diario)) {
    return null;
  }
  return {
    catalogo: incoming.catalogo.slice(0, 1000),
    diario: incoming.diario.slice(0, 5000),
    nextId: Math.max(1, Number(incoming.nextId || 1)),
    exchangeRates:
      incoming.exchangeRates && typeof incoming.exchangeRates === 'object'
        ? incoming.exchangeRates
        : {},
    cierres: Array.isArray(incoming.cierres) ? incoming.cierres.slice(0, 500) : [],
    inventario:
      incoming.inventario &&
      typeof incoming.inventario === 'object' &&
      Array.isArray(incoming.inventario.productos) &&
      Array.isArray(incoming.inventario.movimientos)
        ? {
            productos: incoming.inventario.productos.slice(0, 2000),
            movimientos: incoming.inventario.movimientos.slice(0, 5000),
            movSeq: Math.max(0, Number(incoming.inventario.movSeq || 0)),
          }
        : { productos: [], movimientos: [], movSeq: 0 },
    documentosFiscales: Array.isArray(incoming.documentosFiscales)
      ? incoming.documentosFiscales.slice(0, 3000)
      : [],
    retencionesIslr: Array.isArray(incoming.retencionesIslr)
      ? incoming.retencionesIslr.slice(0, 3000)
      : [],
    excedenteIvaAnteriorCentavos: Number(incoming.excedenteIvaAnteriorCentavos || 0),
    conciliacionBancaria:
      incoming.conciliacionBancaria &&
      typeof incoming.conciliacionBancaria === 'object'
        ? {
            movimientosBanco: Array.isArray(incoming.conciliacionBancaria.movimientosBanco)
              ? incoming.conciliacionBancaria.movimientosBanco.slice(0, 4000)
              : [],
            conciliacionesPorPeriodo:
              incoming.conciliacionBancaria.conciliacionesPorPeriodo &&
              typeof incoming.conciliacionBancaria.conciliacionesPorPeriodo === 'object'
                ? incoming.conciliacionBancaria.conciliacionesPorPeriodo
                : {},
          }
        : { movimientosBanco: [], conciliacionesPorPeriodo: {} },
    updatedAt: String(incoming.updatedAt || new Date().toISOString()),
  };
}

export function validateAndAuthorizeMutation(
  mut: PendingSyncMutation,
  caller: VerifiedFirebaseCaller,
  existingCompany: CompanyProfile | null
): MutationValidationResult {
  if (!mut || !isValidEntityId(mut.id)) {
    return { allowed: false, status: 400, error: 'Identificador de mutación inválido.' };
  }
  if (!isValidEntityId(mut.companyId)) {
    return { allowed: false, status: 400, error: 'Identificador de empresa inválido.' };
  }
  if (!ALLOWED_MUTATION_ACTIONS.has(mut.actionType as AllowedMutationAction)) {
    return {
      allowed: false,
      status: 400,
      error: `Tipo de mutación no permitido (${String(mut.actionType)}).`,
    };
  }

  const actionType = mut.actionType as AllowedMutationAction;

  if (actionType === 'COMPANY_DELETE') {
    if (mut.deletedCompanyId !== mut.companyId) {
      return {
        allowed: false,
        status: 400,
        error: 'deletedCompanyId debe coincidir con companyId.',
      };
    }
    if (mut.companySnapshot || mut.datasetSnapshot) {
      return {
        allowed: false,
        status: 400,
        error: 'Una mutación de eliminación no puede incluir snapshots.',
      };
    }
    if (existingCompany && !isCallerAuthorizedForCompany(caller, existingCompany)) {
      return {
        allowed: false,
        status: 403,
        error: `No autorizado: solo el propietario o Super Admin puede eliminar ${existingCompany.razonSocial}.`,
      };
    }
    return {
      allowed: true,
      actionType,
      deleteCompanyId: mut.companyId,
    };
  }

  if (actionType === 'COMPANY_CREATE') {
    if (mut.deletedCompanyId) {
      return { allowed: false, status: 400, error: 'Mutación inconsistente.' };
    }
    if (!mut.companySnapshot || mut.companySnapshot.id !== mut.companyId) {
      return {
        allowed: false,
        status: 400,
        error: 'COMPANY_CREATE requiere companySnapshot coincidente con companyId.',
      };
    }
    if (existingCompany && !isCallerAuthorizedForCompany(caller, existingCompany)) {
      return {
        allowed: false,
        status: 403,
        error: 'No autorizado: el ID de empresa ya pertenece a otra cuenta Google.',
      };
    }
    if (mut.companySnapshot.ownerUid && mut.companySnapshot.ownerUid !== caller.uid && !caller.isSuperAdmin) {
      return {
        allowed: false,
        status: 403,
        error: 'No autorizado: no puedes crear empresas a nombre de otro usuario.',
      };
    }
    const sanitizedCompany = sanitizeCompanyProfile(
      mut.companySnapshot,
      existingCompany,
      caller
    );
    const sanitizedDataset = mut.datasetSnapshot
      ? sanitizeDataset(mut.datasetSnapshot) || undefined
      : undefined;
    return {
      allowed: true,
      actionType,
      sanitizedCompany,
      sanitizedDataset,
    };
  }

  if (actionType === 'COMPANY_UPDATE') {
    if (mut.deletedCompanyId) {
      return { allowed: false, status: 400, error: 'Mutación inconsistente.' };
    }
    if (!existingCompany) {
      return {
        allowed: false,
        status: 404,
        error: 'Empresa destino no encontrada en la nube.',
      };
    }
    if (!isCallerAuthorizedForCompany(caller, existingCompany)) {
      return {
        allowed: false,
        status: 403,
        error: `Acceso denegado: la empresa ${existingCompany.razonSocial} pertenece a otro titular.`,
      };
    }
    if (!mut.companySnapshot || mut.companySnapshot.id !== mut.companyId) {
      return {
        allowed: false,
        status: 400,
        error: 'COMPANY_UPDATE requiere companySnapshot coincidente.',
      };
    }
    if (
      mut.companySnapshot.ownerUid &&
      existingCompany.ownerUid &&
      mut.companySnapshot.ownerUid !== existingCompany.ownerUid &&
      !caller.isSuperAdmin
    ) {
      return {
        allowed: false,
        status: 403,
        error: 'No está permitido transferir la propiedad (ownerUid) de la empresa.',
      };
    }
    return {
      allowed: true,
      actionType,
      sanitizedCompany: sanitizeCompanyProfile(mut.companySnapshot, existingCompany, caller),
    };
  }

  // DATASET_UPDATE
  if (mut.deletedCompanyId || mut.companySnapshot) {
    return {
      allowed: false,
      status: 400,
      error: 'DATASET_UPDATE solo permite modificar datasetSnapshot.',
    };
  }
  if (!existingCompany) {
    return {
      allowed: false,
      status: 404,
      error: 'Empresa destino no encontrada para actualizar sus libros.',
    };
  }
  if (!isCallerAuthorizedForCompany(caller, existingCompany)) {
    return {
      allowed: false,
      status: 403,
      error: `Acceso denegado: no puedes modificar libros de ${existingCompany.razonSocial}.`,
    };
  }
  const cleanDs = mut.datasetSnapshot ? sanitizeDataset(mut.datasetSnapshot) : null;
  if (!cleanDs) {
    return {
      allowed: false,
      status: 400,
      error: 'datasetSnapshot inválido o incompleto.',
    };
  }
  return {
    allowed: true,
    actionType,
    sanitizedDataset: cleanDs,
  };
}
