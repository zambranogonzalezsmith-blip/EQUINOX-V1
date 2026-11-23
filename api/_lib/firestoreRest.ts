import type { CompanyDataset, CompanyProfile } from '../../src/types/accounting.js';
import { createEmptyCompanyDataset } from '../../src/utils/venezuelaCatalog.js';
import {
  resolveFirebaseProjectId,
  resolveFirestoreDatabaseId,
  type VerifiedFirebaseCaller,
} from './firebaseAuth.js';

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

interface FirestoreDocument {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
}

export interface FirestoreWorkspaceAdapter {
  listCompaniesForCaller(
    caller: VerifiedFirebaseCaller,
    scope: 'own' | 'all'
  ): Promise<CompanyProfile[]>;
  getCompany(companyId: string): Promise<CompanyProfile | null>;
  upsertCompany(
    company: CompanyProfile,
    isNew: boolean
  ): Promise<void>;
  getLedger(companyId: string): Promise<CompanyDataset | null>;
  upsertLedger(
    ownerUid: string,
    companyId: string,
    dataset: CompanyDataset,
    isNew: boolean
  ): Promise<void>;
  deleteCompanyAndLedger(companyId: string): Promise<void>;
  getUserActiveCompanyId(uid: string): Promise<string | null>;
  setUserActiveCompanyId(uid: string, activeCompanyId: string): Promise<void>;
  getProcessedMutationIds(uid: string): Promise<string[]>;
  saveProcessedMutationIds(uid: string, ids: string[]): Promise<void>;
}

export function toFirestoreValue(val: unknown): FirestoreValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val) && Number.isSafeInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: Number.isFinite(val) ? val : 0 };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.filter((item) => item !== undefined).map((item) => toFirestoreValue(item)),
      },
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function fromFirestoreValue(val: FirestoreValue | undefined): unknown {
  if (!val) return null;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('stringValue' in val) return val.stringValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map((item) => fromFirestoreValue(item));
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = fromFirestoreValue(v);
    }
    return out;
  }
  return null;
}

function docToPlainObject(docObj: FirestoreDocument): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(docObj.fields || {})) {
    out[k] = fromFirestoreValue(v);
  }
  return out;
}

function plainObjectToFields(data: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return fields;
}

function parseCompanyRecord(raw: Record<string, unknown>, docId: string): CompanyProfile {
  return {
    id: String(raw.id || docId),
    ownerUid: raw.ownerUid ? String(raw.ownerUid) : undefined,
    googleAuthUid: raw.googleAuthUid ? String(raw.googleAuthUid) : undefined,
    googleAuthEmail: raw.googleAuthEmail ? String(raw.googleAuthEmail) : '',
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
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

function parseLedgerRecord(raw: Record<string, unknown>): CompanyDataset {
  const empty = createEmptyCompanyDataset();
  return {
    catalogo: Array.isArray(raw.catalogo)
      ? (raw.catalogo as CompanyDataset['catalogo'])
      : empty.catalogo,
    diario: Array.isArray(raw.diario) ? (raw.diario as CompanyDataset['diario']) : [],
    nextId: Math.max(1, Number(raw.nextId || 1)),
    exchangeRates:
      raw.exchangeRates && typeof raw.exchangeRates === 'object'
        ? (raw.exchangeRates as Record<string, number>)
        : {},
    cierres: Array.isArray(raw.cierres) ? (raw.cierres as CompanyDataset['cierres']) : [],
    inventario:
      raw.inventario && typeof raw.inventario === 'object'
        ? (raw.inventario as CompanyDataset['inventario'])
        : { productos: [], movimientos: [], movSeq: 0 },
    documentosFiscales: Array.isArray(raw.documentosFiscales)
      ? (raw.documentosFiscales as CompanyDataset['documentosFiscales'])
      : [],
    retencionesIslr: Array.isArray(raw.retencionesIslr)
      ? (raw.retencionesIslr as CompanyDataset['retencionesIslr'])
      : [],
    excedenteIvaAnteriorCentavos: Number(raw.excedenteIvaAnteriorCentavos || 0),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

export class FirestoreRestError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = 'FIRESTORE_ERROR') {
    super(message);
    this.name = 'FirestoreRestError';
    this.status = status;
    this.code = code;
  }
}

export function createFirestoreRestAdapter(idToken: string): FirestoreWorkspaceAdapter {
  const projectId = resolveFirebaseProjectId();
  const databaseId = resolveFirestoreDatabaseId();
  const docBasePath = `projects/${projectId}/databases/${databaseId}/documents`;
  const apiBase = `https://firestore.googleapis.com/v1/${docBasePath}`;

  async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      let msg = `Error Firestore REST (${res.status})`;
      let code = 'FIRESTORE_ERROR';
      try {
        const errJson = (await res.json()) as {
          error?: { message?: string; status?: string };
        };
        if (errJson?.error?.message) msg = errJson.error.message;
        if (errJson?.error?.status) code = errJson.error.status;
      } catch {
        // ignore JSON parse failure
      }
      throw new FirestoreRestError(msg, res.status, code);
    }
    return (await res.json()) as T;
  }

  async function getDocRaw(docPath: string): Promise<FirestoreDocument | null> {
    const res = await fetch(`${apiBase}/${docPath}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      let msg = `Error leyendo ${docPath} (${res.status})`;
      let code = 'FIRESTORE_ERROR';
      try {
        const errJson = (await res.json()) as { error?: { message?: string; status?: string } };
        if (errJson?.error?.message) msg = errJson.error.message;
        if (errJson?.error?.status) code = errJson.error.status;
      } catch {
        // ignore
      }
      throw new FirestoreRestError(msg, res.status, code);
    }
    return (await res.json()) as FirestoreDocument;
  }

  async function commitWriteWithServerTimestamp(
    docPath: string,
    data: Record<string, unknown>,
    timestampFields: string[],
    updateMaskFieldPaths?: string[]
  ): Promise<void> {
    const fullName = `${docBasePath}/${docPath}`;
    const writeObj: Record<string, unknown> = {
      update: {
        name: fullName,
        fields: plainObjectToFields(data),
      },
      updateTransforms: timestampFields.map((fieldPath) => ({
        fieldPath,
        setToServerValue: 'REQUEST_TIME',
      })),
    };
    if (updateMaskFieldPaths && updateMaskFieldPaths.length > 0) {
      writeObj.updateMask = { fieldPaths: updateMaskFieldPaths };
    }

    await requestJson(`${apiBase}:commit`, {
      method: 'POST',
      body: JSON.stringify({ writes: [writeObj] }),
    });
  }

  return {
    async listCompaniesForCaller(caller, scope) {
      const structuredQuery: Record<string, unknown> = {
        from: [{ collectionId: 'companies' }],
      };
      if (!(caller.isSuperAdmin && scope === 'all')) {
        structuredQuery.where = {
          fieldFilter: {
            field: { fieldPath: 'ownerUid' },
            op: 'EQUAL',
            value: { stringValue: caller.uid },
          },
        };
      }

      const rows = await requestJson<Array<{ document?: FirestoreDocument }>>(
        `${apiBase}:runQuery`,
        {
          method: 'POST',
          body: JSON.stringify({ structuredQuery }),
        }
      );

      const companies: CompanyProfile[] = [];
      for (const row of rows) {
        if (!row.document?.name) continue;
        const docId = row.document.name.split('/').pop() || '';
        companies.push(parseCompanyRecord(docToPlainObject(row.document), docId));
      }
      companies.sort((a, b) => a.razonSocial.localeCompare(b.razonSocial));
      return companies;
    },

    async getCompany(companyId) {
      const docObj = await getDocRaw(`companies/${companyId}`);
      if (!docObj) return null;
      return parseCompanyRecord(docToPlainObject(docObj), companyId);
    },

    async upsertCompany(company, isNew) {
      const commonFields: Record<string, unknown> = {
        googleAuthUid: company.googleAuthUid || company.ownerUid || '',
        googleAuthEmail: company.googleAuthEmail || '',
        googleVerified: Boolean(company.googleVerified),
        googleAuthenticatedAt: company.googleAuthenticatedAt || new Date().toISOString(),
        razonSocial: company.razonSocial,
        rif: company.rif,
        tipoContribuyente: company.tipoContribuyente,
        actividadEconomica: company.actividadEconomica || '',
        domicilioFiscal: company.domicilioFiscal || '',
        telefono: company.telefono || '',
        monedaFuncional: company.monedaFuncional,
        alicuotaIvaGeneral: Number(company.alicuotaIvaGeneral ?? 16),
        alicuotaIvaReducida: Number(company.alicuotaIvaReducida ?? 8),
        agenteRetencionIva: Number(company.agenteRetencionIva ?? 0),
        agenteRetencionIslr: Boolean(company.agenteRetencionIslr),
        sujetoIgtf: Boolean(company.sujetoIgtf),
        unidadTributariaBs: Number(company.unidadTributariaBs ?? 9),
        contadorNombre: company.contadorNombre || '',
        cpcNumero: company.cpcNumero || '',
        periodoFiscalInicio: company.periodoFiscalInicio || '2026-01-01',
      };

      if (isNew) {
        await commitWriteWithServerTimestamp(
          `companies/${company.id}`,
          {
            id: company.id,
            ownerUid: company.ownerUid || '',
            ...commonFields,
          },
          ['createdAt', 'updatedAt']
        );
      } else {
        await commitWriteWithServerTimestamp(
          `companies/${company.id}`,
          commonFields,
          ['updatedAt'],
          [...Object.keys(commonFields), 'updatedAt']
        );
      }
    },

    async getLedger(companyId) {
      const docObj = await getDocRaw(`companies/${companyId}/ledgers/main`);
      if (!docObj) return null;
      return parseLedgerRecord(docToPlainObject(docObj));
    },

    async upsertLedger(ownerUid, companyId, dataset, isNew) {
      const mutableLedger: Record<string, unknown> = {
        catalogo: (dataset.catalogo || []).slice(0, 1000),
        diario: (dataset.diario || []).slice(0, 5000),
        nextId: Math.max(1, Number(dataset.nextId || 1)),
        exchangeRates: dataset.exchangeRates || {},
        cierres: (dataset.cierres || []).slice(0, 500),
        inventario: dataset.inventario || { productos: [], movimientos: [], movSeq: 0 },
        documentosFiscales: (dataset.documentosFiscales || []).slice(0, 3000),
        retencionesIslr: (dataset.retencionesIslr || []).slice(0, 3000),
        excedenteIvaAnteriorCentavos: Number(dataset.excedenteIvaAnteriorCentavos || 0),
      };

      if (isNew) {
        await commitWriteWithServerTimestamp(
          `companies/${companyId}/ledgers/main`,
          {
            ownerUid,
            companyId,
            ...mutableLedger,
          },
          ['updatedAt']
        );
      } else {
        await commitWriteWithServerTimestamp(
          `companies/${companyId}/ledgers/main`,
          mutableLedger,
          ['updatedAt'],
          [...Object.keys(mutableLedger), 'updatedAt']
        );
      }
    },

    async deleteCompanyAndLedger(companyId) {
      const delLedger = await fetch(`${apiBase}/companies/${companyId}/ledgers/main`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!delLedger.ok && delLedger.status !== 404) {
        throw new FirestoreRestError('No autorizado para eliminar libro contable.', delLedger.status);
      }
      const delComp = await fetch(`${apiBase}/companies/${companyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!delComp.ok && delComp.status !== 404) {
        throw new FirestoreRestError('No autorizado para eliminar empresa.', delComp.status);
      }
    },

    async getUserActiveCompanyId(uid) {
      try {
        const docObj = await getDocRaw(`users/${uid}`);
        if (!docObj) return null;
        const plain = docToPlainObject(docObj);
        return typeof plain.activeCompanyId === 'string' ? plain.activeCompanyId : null;
      } catch {
        return null;
      }
    },

    async setUserActiveCompanyId(uid, activeCompanyId) {
      try {
        const docObj = await getDocRaw(`users/${uid}`);
        if (!docObj) return;
        await commitWriteWithServerTimestamp(
          `users/${uid}`,
          { activeCompanyId },
          ['updatedAt'],
          ['activeCompanyId', 'updatedAt']
        );
      } catch {
        // Non-fatal preference update
      }
    },

    async getProcessedMutationIds(uid) {
      try {
        const docObj = await getDocRaw(`users/${uid}/sync_state/outbox`);
        if (!docObj) return [];
        const plain = docToPlainObject(docObj);
        return Array.isArray(plain.processedMutationIds)
          ? plain.processedMutationIds.filter((id): id is string => typeof id === 'string')
          : [];
      } catch {
        return [];
      }
    },

    async saveProcessedMutationIds(uid, ids) {
      try {
        const clipped = ids.slice(-500);
        await commitWriteWithServerTimestamp(
          `users/${uid}/sync_state/outbox`,
          {
            ownerUid: uid,
            processedMutationIds: clipped,
          },
          ['updatedAt']
        );
      } catch {
        // Fallback: idempotency still guarded by updatedAt timestamps on Firestore docs
      }
    },
  };
}
