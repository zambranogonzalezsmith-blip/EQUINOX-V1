import type { User } from 'firebase/auth';
import {
  CompanyDataset,
  CompanyProfile,
  CrmEmpresaTemplate,
} from '../types/accounting';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const APP_PROPERTY_TAG = 'equinox-books';
const BACKUP_SCHEMA_VERSION = '1.1.0';

export class DriveAuthExpiredError extends Error {
  constructor(message = 'La autorización de Google Drive expiró. Conecta Google Drive nuevamente.') {
    super(message);
    this.name = 'DriveAuthExpiredError';
  }
}

export interface BooksDataSummary {
  asientosActivos: number;
  lineasDiario: number;
  cuentasCatalogo: number;
  productosInventario: number;
  movimientosInventario: number;
  documentosFiscales: number;
  retencionesIslr: number;
  cierresContables: number;
  tasasBcvCount: number;
}

export interface DriveBackupFileItem {
  id: string;
  name: string;
  createdTime: string;
  modifiedTime: string;
  sizeBytes: number;
  webViewLink?: string;
  description?: string;
  ownerEmail: string;
  backupScope: 'COMPANY_BOOKS' | 'FULL_ACCOUNT';
  companyId?: string;
  companyName?: string;
  companyRif?: string;
  companiesCount: number;
  asientosCount: number;
  checksumSha256?: string;
  note?: string;
}

export interface AccountDriveBackupPayload {
  kind?: 'account-backup';
  schemaVersion: string;
  platform: 'Equinox-Books';
  exportedAt: string;
  ownerUid: string;
  ownerEmail: string;
  ownerDisplayName: string;
  note?: string;
  checksumSha256: string;
  stats: {
    companiesCount: number;
    asientosCount: number;
    documentosFiscalesCount: number;
    productosCount: number;
    crmCompleted: boolean;
  };
  crmProfile: CrmEmpresaTemplate | null;
  activeCompanyId: string;
  companies: CompanyProfile[];
  companyData: Record<string, CompanyDataset>;
}

export interface CompanyBooksDriveBackupPayload {
  kind: 'company-books-backup';
  schemaVersion: string;
  platform: 'Equinox-Books';
  exportedAt: string;
  ownerUid: string;
  ownerEmail: string;
  ownerDisplayName: string;
  clientEmail: string;
  note?: string;
  checksumSha256: string;
  booksSummary: BooksDataSummary;
  company: CompanyProfile;
  dataset: CompanyDataset;
}

export type DriveBackupPayload = AccountDriveBackupPayload | CompanyBooksDriveBackupPayload;

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function getUserBackupFolderName(email: string): string {
  return `Equinox-Books Backups (${email.trim().toLowerCase()})`;
}

export function getCompanyBackupSubfolderName(company: CompanyProfile): string {
  const cleanName = (company.razonSocial || 'Empresa')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .trim()
    .slice(0, 60);
  const cleanRif = (company.rif || company.id).trim().toUpperCase();
  return `${cleanName} (${cleanRif})`;
}

function sanitizeForFilename(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function countActiveAsientos(dataset?: CompanyDataset): number {
  if (!dataset?.diario) return 0;
  const nums = new Set<number>();
  for (const m of dataset.diario) {
    if (m.estado === 'ACTIVO') nums.add(m.asiento_num);
  }
  return nums.size;
}

export function computeBooksSummary(dataset?: CompanyDataset): BooksDataSummary {
  if (!dataset) {
    return {
      asientosActivos: 0,
      lineasDiario: 0,
      cuentasCatalogo: 0,
      productosInventario: 0,
      movimientosInventario: 0,
      documentosFiscales: 0,
      retencionesIslr: 0,
      cierresContables: 0,
      tasasBcvCount: 0,
    };
  }

  return {
    asientosActivos: countActiveAsientos(dataset),
    lineasDiario: (dataset.diario || []).length,
    cuentasCatalogo: (dataset.catalogo || []).length,
    productosInventario: (dataset.inventario?.productos || []).length,
    movimientosInventario: (dataset.inventario?.movimientos || []).length,
    documentosFiscales: (dataset.documentosFiscales || []).length,
    retencionesIslr: (dataset.retencionesIslr || []).length,
    cierresContables: (dataset.cierres || []).filter((c) => c.estado !== 'ELIMINADO').length,
    tasasBcvCount: Object.keys(dataset.exchangeRates || {}).length,
  };
}

export function filterOwnedAccountData(
  user: User,
  companies: CompanyProfile[],
  companyData: Record<string, CompanyDataset>,
  activeCompanyId: string
): {
  ownedCompanies: CompanyProfile[];
  ownedCompanyData: Record<string, CompanyDataset>;
  effectiveActiveCompanyId: string;
  totalAsientos: number;
  totalDocsFiscales: number;
  totalProductos: number;
} {
  const normalizedEmail = (user.email || '').trim().toLowerCase();
  const ownedCompanies = companies.filter((c) => {
    if (c.ownerUid) return c.ownerUid === user.uid;
    if (c.googleAuthEmail) return c.googleAuthEmail.trim().toLowerCase() === normalizedEmail;
    return true;
  });

  const ownedCompanyData: Record<string, CompanyDataset> = {};
  let totalAsientos = 0;
  let totalDocsFiscales = 0;
  let totalProductos = 0;

  for (const comp of ownedCompanies) {
    const ds = companyData[comp.id];
    if (ds) {
      ownedCompanyData[comp.id] = ds;
      totalAsientos += countActiveAsientos(ds);
      totalDocsFiscales += (ds.documentosFiscales || []).length;
      totalProductos += (ds.inventario?.productos || []).length;
    }
  }

  const effectiveActiveCompanyId = ownedCompanies.some((c) => c.id === activeCompanyId)
    ? activeCompanyId
    : ownedCompanies[0]?.id || '';

  return {
    ownedCompanies,
    ownedCompanyData,
    effectiveActiveCompanyId,
    totalAsientos,
    totalDocsFiscales,
    totalProductos,
  };
}

async function computeSha256Hex(value: unknown): Promise<string> {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyBackupPayloadChecksum(
  payload: DriveBackupPayload
): Promise<boolean> {
  if (!payload.checksumSha256) return false;

  if (payload.kind === 'company-books-backup') {
    const computed = await computeSha256Hex({
      kind: 'company-books-backup',
      ownerUid: payload.ownerUid,
      ownerEmail: payload.ownerEmail,
      clientEmail: payload.clientEmail,
      company: payload.company,
      dataset: payload.dataset,
    });
    return computed === payload.checksumSha256;
  }

  const computed = await computeSha256Hex({
    ownerUid: payload.ownerUid,
    ownerEmail: payload.ownerEmail,
    crmProfile: payload.crmProfile,
    activeCompanyId: payload.activeCompanyId,
    companies: payload.companies,
    companyData: payload.companyData,
  });
  return computed === payload.checksumSha256;
}

async function driveFetch(
  url: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    throw new DriveAuthExpiredError(
      'Tu sesión temporal de Google Drive expiró. Vuelve a conectar Google Drive.'
    );
  }

  if (!res.ok) {
    let errorDetail = `Error HTTP ${res.status} en Google Drive`;
    try {
      const errJson = (await res.json()) as {
        error?: { message?: string; errors?: Array<{ reason?: string }> };
      };
      const reason = errJson?.error?.errors?.[0]?.reason;
      if (
        res.status === 403 &&
        (reason === 'insufficientPermissions' || reason === 'authError')
      ) {
        throw new DriveAuthExpiredError(
          'Faltan permisos aprobados para Google Drive. Reconecta tu cuenta otorgando acceso.'
        );
      }
      if (errJson?.error?.message) {
        errorDetail = errJson.error.message;
      }
    } catch (e) {
      if (e instanceof DriveAuthExpiredError) throw e;
    }
    throw new Error(errorDetail);
  }

  return res;
}

async function findUserBackupFolder(
  accessToken: string,
  userEmail: string
): Promise<{ id: string; name: string } | null> {
  const normalizedEmail = userEmail.trim().toLowerCase();
  const folderName = getUserBackupFolderName(normalizedEmail);
  const query = [
    `mimeType = 'application/vnd.google-apps.folder'`,
    `trashed = false`,
    `appProperties has { key='app' and value='${APP_PROPERTY_TAG}' }`,
    `appProperties has { key='kind' and value='backup-folder' }`,
    `appProperties has { key='ownerEmail' and value='${escapeDriveQueryValue(normalizedEmail)}' }`,
  ].join(' and ');

  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name,appProperties)',
    spaces: 'drive',
    pageSize: '10',
  });

  const res = await driveFetch(`${DRIVE_API_BASE}/files?${params.toString()}`, accessToken);
  const data = (await res.json()) as { files?: Array<{ id: string; name: string }> };
  if (data.files && data.files.length > 0) {
    return { id: data.files[0].id, name: data.files[0].name || folderName };
  }

  const fallbackQuery = [
    `mimeType = 'application/vnd.google-apps.folder'`,
    `trashed = false`,
    `name = '${escapeDriveQueryValue(folderName)}'`,
  ].join(' and ');
  const fallbackParams = new URLSearchParams({
    q: fallbackQuery,
    fields: 'files(id,name)',
    spaces: 'drive',
    pageSize: '5',
  });
  const fallbackRes = await driveFetch(
    `${DRIVE_API_BASE}/files?${fallbackParams.toString()}`,
    accessToken
  );
  const fallbackData = (await fallbackRes.json()) as {
    files?: Array<{ id: string; name: string }>;
  };
  if (fallbackData.files && fallbackData.files.length > 0) {
    return { id: fallbackData.files[0].id, name: fallbackData.files[0].name || folderName };
  }

  return null;
}

export async function ensureUserBackupFolder(
  accessToken: string,
  userEmail: string,
  userUid: string
): Promise<{ id: string; name: string }> {
  const existing = await findUserBackupFolder(accessToken, userEmail);
  if (existing) return existing;

  const normalizedEmail = userEmail.trim().toLowerCase();
  const folderName = getUserBackupFolderName(normalizedEmail);

  const res = await driveFetch(`${DRIVE_API_BASE}/files?fields=id,name`, accessToken, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      description: `Carpeta privada de copias de seguridad de Equinox-Books para ${normalizedEmail}`,
      appProperties: {
        app: APP_PROPERTY_TAG,
        kind: 'backup-folder',
        ownerUid: userUid,
        ownerEmail: normalizedEmail,
      },
    }),
  });

  const created = (await res.json()) as { id: string; name: string };
  return { id: created.id, name: created.name || folderName };
}

async function ensureCompanySubfolder(
  accessToken: string,
  parentFolderId: string,
  userEmail: string,
  userUid: string,
  company: CompanyProfile
): Promise<{ id: string; name: string }> {
  const normalizedEmail = userEmail.trim().toLowerCase();
  const subfolderName = getCompanyBackupSubfolderName(company);
  const query = [
    `mimeType = 'application/vnd.google-apps.folder'`,
    `trashed = false`,
    `'${escapeDriveQueryValue(parentFolderId)}' in parents`,
    `appProperties has { key='app' and value='${APP_PROPERTY_TAG}' }`,
    `appProperties has { key='companyId' and value='${escapeDriveQueryValue(company.id)}' }`,
  ].join(' and ');

  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name)',
    spaces: 'drive',
    pageSize: '5',
  });
  const searchRes = await driveFetch(`${DRIVE_API_BASE}/files?${params.toString()}`, accessToken);
  const searchData = (await searchRes.json()) as {
    files?: Array<{ id: string; name: string }>;
  };
  if (searchData.files && searchData.files.length > 0) {
    return {
      id: searchData.files[0].id,
      name: searchData.files[0].name || subfolderName,
    };
  }

  const createRes = await driveFetch(`${DRIVE_API_BASE}/files?fields=id,name`, accessToken, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: subfolderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
      description: `Libros contables y fiscales de ${company.razonSocial} (${company.rif}) respaldados en ${normalizedEmail}`,
      appProperties: {
        app: APP_PROPERTY_TAG,
        kind: 'company-backup-folder',
        ownerUid: userUid,
        ownerEmail: normalizedEmail,
        companyId: company.id,
        companyRif: company.rif,
      },
    }),
  });

  const created = (await createRes.json()) as { id: string; name: string };
  return { id: created.id, name: created.name || subfolderName };
}

async function uploadMultipartJsonFile(
  accessToken: string,
  metadata: Record<string, unknown>,
  payload: unknown
): Promise<{
  id: string;
  name: string;
  createdTime?: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  description?: string;
  appProperties?: Record<string, string>;
}> {
  const boundary = `eqx_drive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(payload, null, 2)}\r\n` +
    `--${boundary}--`;

  const fields =
    'id,name,createdTime,modifiedTime,size,webViewLink,description,appProperties';
  const res = await driveFetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=${encodeURIComponent(fields)}`,
    accessToken,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  return (await res.json()) as {
    id: string;
    name: string;
    createdTime?: string;
    modifiedTime?: string;
    size?: string;
    webViewLink?: string;
    description?: string;
    appProperties?: Record<string, string>;
  };
}

export async function uploadCompanyBooksBackupToDrive(
  accessToken: string,
  user: User,
  input: {
    company: CompanyProfile;
    dataset: CompanyDataset;
    note?: string;
  }
): Promise<DriveBackupFileItem> {
  const userEmail = (user.email || '').trim().toLowerCase();
  if (!userEmail) {
    throw new Error('La cuenta de Google no tiene un correo electrónico válido.');
  }

  if (input.company.ownerUid && input.company.ownerUid !== user.uid) {
    throw new Error(
      `Aislamiento por cliente: esta empresa pertenece a ${input.company.googleAuthEmail || 'otra cuenta'}. Cambia al correo del cliente para guardar la copia en su Drive.`
    );
  }

  const clientEmail = (input.company.googleAuthEmail || userEmail).trim().toLowerCase();
  if (clientEmail && clientEmail !== userEmail) {
    throw new Error(
      `Esta empresa está vinculada al correo ${clientEmail}. Inicia sesión con ${clientEmail} para guardar los libros en su Drive personal.`
    );
  }

  const rootFolder = await ensureUserBackupFolder(accessToken, userEmail, user.uid);
  const companyFolder = await ensureCompanySubfolder(
    accessToken,
    rootFolder.id,
    userEmail,
    user.uid,
    input.company
  );

  const exportedAt = new Date().toISOString();
  const cleanNote = (input.note || '').trim().slice(0, 120);
  const booksSummary = computeBooksSummary(input.dataset);
  const checksumSha256 = await computeSha256Hex({
    kind: 'company-books-backup',
    ownerUid: user.uid,
    ownerEmail: userEmail,
    clientEmail: userEmail,
    company: input.company,
    dataset: input.dataset,
  });

  const payload: CompanyBooksDriveBackupPayload = {
    kind: 'company-books-backup',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    platform: 'Equinox-Books',
    exportedAt,
    ownerUid: user.uid,
    ownerEmail: userEmail,
    ownerDisplayName: user.displayName || userEmail,
    clientEmail: userEmail,
    ...(cleanNote ? { note: cleanNote } : {}),
    checksumSha256,
    booksSummary,
    company: input.company,
    dataset: input.dataset,
  };

  const timestampSlug = exportedAt.replace(/[:.]/g, '-').slice(0, 19);
  const companySlug = sanitizeForFilename(input.company.rif || input.company.razonSocial);
  const fileName = `equinox-libros-${companySlug}-${timestampSlug}.json`;

  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    parents: [companyFolder.id],
    description: cleanNote
      ? `Libros de ${input.company.razonSocial} (${input.company.rif}) · ${userEmail} — ${cleanNote}`
      : `Libros completos de ${input.company.razonSocial} (${input.company.rif}) · ${booksSummary.asientosActivos} asiento(s), ${booksSummary.documentosFiscales} doc(s) fiscal(es)`,
    appProperties: {
      app: APP_PROPERTY_TAG,
      kind: 'company-books-backup',
      ownerUid: user.uid,
      ownerEmail: userEmail,
      companyId: input.company.id,
      companyName: input.company.razonSocial.slice(0, 100),
      companyRif: input.company.rif.slice(0, 32),
      companiesCount: '1',
      asientosCount: String(booksSummary.asientosActivos),
      checksumSha256: checksumSha256.slice(0, 64),
      note: cleanNote.slice(0, 100),
    },
  };

  const file = await uploadMultipartJsonFile(accessToken, metadata, payload);

  return {
    id: file.id,
    name: file.name,
    createdTime: file.createdTime || exportedAt,
    modifiedTime: file.modifiedTime || exportedAt,
    sizeBytes: Number(file.size || 0),
    webViewLink: file.webViewLink,
    description: file.description,
    ownerEmail: userEmail,
    backupScope: 'COMPANY_BOOKS',
    companyId: input.company.id,
    companyName: input.company.razonSocial,
    companyRif: input.company.rif,
    companiesCount: 1,
    asientosCount: booksSummary.asientosActivos,
    checksumSha256: file.appProperties?.checksumSha256 || checksumSha256.slice(0, 64),
    note: file.appProperties?.note || cleanNote || undefined,
  };
}

export async function uploadAccountBackupToDrive(
  accessToken: string,
  user: User,
  input: {
    crmProfile: CrmEmpresaTemplate | null;
    companies: CompanyProfile[];
    companyData: Record<string, CompanyDataset>;
    activeCompanyId: string;
    note?: string;
  }
): Promise<DriveBackupFileItem> {
  const userEmail = (user.email || '').trim().toLowerCase();
  if (!userEmail) {
    throw new Error('La cuenta de Google no tiene un correo electrónico válido.');
  }

  const folder = await ensureUserBackupFolder(accessToken, userEmail, user.uid);
  const filtered = filterOwnedAccountData(
    user,
    input.companies,
    input.companyData,
    input.activeCompanyId
  );

  const exportedAt = new Date().toISOString();
  const cleanNote = (input.note || '').trim().slice(0, 120);
  const checksumSha256 = await computeSha256Hex({
    ownerUid: user.uid,
    ownerEmail: userEmail,
    crmProfile: input.crmProfile,
    activeCompanyId: filtered.effectiveActiveCompanyId,
    companies: filtered.ownedCompanies,
    companyData: filtered.ownedCompanyData,
  });

  const payload: AccountDriveBackupPayload = {
    kind: 'account-backup',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    platform: 'Equinox-Books',
    exportedAt,
    ownerUid: user.uid,
    ownerEmail: userEmail,
    ownerDisplayName: user.displayName || userEmail,
    ...(cleanNote ? { note: cleanNote } : {}),
    checksumSha256,
    stats: {
      companiesCount: filtered.ownedCompanies.length,
      asientosCount: filtered.totalAsientos,
      documentosFiscalesCount: filtered.totalDocsFiscales,
      productosCount: filtered.totalProductos,
      crmCompleted: Boolean(input.crmProfile?.completed),
    },
    crmProfile: input.crmProfile,
    activeCompanyId: filtered.effectiveActiveCompanyId,
    companies: filtered.ownedCompanies,
    companyData: filtered.ownedCompanyData,
  };

  const timestampSlug = exportedAt.replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `equinox-cuenta-${sanitizeForFilename(userEmail)}-${timestampSlug}.json`;

  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    parents: [folder.id],
    description: cleanNote
      ? `Respaldo completo Equinox-Books (${userEmail}) — ${cleanNote}`
      : `Respaldo completo Equinox-Books (${userEmail}) — ${filtered.ownedCompanies.length} empresa(s), ${filtered.totalAsientos} asiento(s)`,
    appProperties: {
      app: APP_PROPERTY_TAG,
      kind: 'account-backup',
      ownerUid: user.uid,
      ownerEmail: userEmail,
      companiesCount: String(filtered.ownedCompanies.length),
      asientosCount: String(filtered.totalAsientos),
      checksumSha256: checksumSha256.slice(0, 64),
      note: cleanNote.slice(0, 100),
    },
  };

  const file = await uploadMultipartJsonFile(accessToken, metadata, payload);

  return {
    id: file.id,
    name: file.name,
    createdTime: file.createdTime || exportedAt,
    modifiedTime: file.modifiedTime || exportedAt,
    sizeBytes: Number(file.size || 0),
    webViewLink: file.webViewLink,
    description: file.description,
    ownerEmail: userEmail,
    backupScope: 'FULL_ACCOUNT',
    companiesCount: Number(file.appProperties?.companiesCount ?? filtered.ownedCompanies.length),
    asientosCount: Number(file.appProperties?.asientosCount ?? filtered.totalAsientos),
    checksumSha256: file.appProperties?.checksumSha256 || checksumSha256.slice(0, 64),
    note: file.appProperties?.note || cleanNote || undefined,
  };
}

export async function listAccountBackupsFromDrive(
  accessToken: string,
  userEmail: string
): Promise<{
  folderId: string | null;
  folderName: string;
  files: DriveBackupFileItem[];
}> {
  const normalizedEmail = userEmail.trim().toLowerCase();
  const folder = await findUserBackupFolder(accessToken, normalizedEmail);

  const query = [
    `mimeType = 'application/json'`,
    `trashed = false`,
    `appProperties has { key='app' and value='${APP_PROPERTY_TAG}' }`,
    `appProperties has { key='ownerEmail' and value='${escapeDriveQueryValue(normalizedEmail)}' }`,
  ].join(' and ');

  const params = new URLSearchParams({
    q: query,
    orderBy: 'createdTime desc',
    pageSize: '60',
    fields: 'files(id,name,createdTime,modifiedTime,size,webViewLink,description,appProperties)',
    spaces: 'drive',
  });

  const res = await driveFetch(`${DRIVE_API_BASE}/files?${params.toString()}`, accessToken);
  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      createdTime?: string;
      modifiedTime?: string;
      size?: string;
      webViewLink?: string;
      description?: string;
      appProperties?: Record<string, string>;
    }>;
  };

  const files: DriveBackupFileItem[] = (data.files || [])
    .filter((f) => {
      const fileOwner = f.appProperties?.ownerEmail?.toLowerCase();
      return !fileOwner || fileOwner === normalizedEmail;
    })
    .map((f) => {
      const isCompanyScope = f.appProperties?.kind === 'company-books-backup';
      return {
        id: f.id,
        name: f.name,
        createdTime: f.createdTime || new Date().toISOString(),
        modifiedTime: f.modifiedTime || f.createdTime || new Date().toISOString(),
        sizeBytes: Number(f.size || 0),
        webViewLink: f.webViewLink,
        description: f.description,
        ownerEmail: f.appProperties?.ownerEmail || normalizedEmail,
        backupScope: isCompanyScope ? 'COMPANY_BOOKS' : 'FULL_ACCOUNT',
        companyId: f.appProperties?.companyId || undefined,
        companyName: f.appProperties?.companyName || undefined,
        companyRif: f.appProperties?.companyRif || undefined,
        companiesCount: Number(f.appProperties?.companiesCount || (isCompanyScope ? 1 : 0)),
        asientosCount: Number(f.appProperties?.asientosCount || 0),
        checksumSha256: f.appProperties?.checksumSha256,
        note: f.appProperties?.note || undefined,
      };
    });

  return {
    folderId: folder?.id || null,
    folderName: folder?.name || getUserBackupFolderName(normalizedEmail),
    files,
  };
}

export async function downloadAccountBackupFromDrive(
  accessToken: string,
  fileId: string,
  currentUser: User
): Promise<{
  payload: DriveBackupPayload;
  checksumValid: boolean;
}> {
  const res = await driveFetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
    accessToken
  );

  const parsed = (await res.json()) as Partial<DriveBackupPayload>;
  if (parsed.platform !== 'Equinox-Books') {
    throw new Error(
      'El archivo seleccionado no corresponde a una copia de seguridad válida de Equinox-Books.'
    );
  }

  const currentEmail = (currentUser.email || '').trim().toLowerCase();
  const backupEmail = (parsed.ownerEmail || '').trim().toLowerCase();
  if (backupEmail && currentEmail && backupEmail !== currentEmail) {
    throw new Error(
      `Aislamiento por correo: esta copia pertenece al cliente ${parsed.ownerEmail}. Inicia sesión con esa cuenta Google para restaurarla.`
    );
  }

  if (parsed.kind === 'company-books-backup') {
    const companyPayload = parsed as Partial<CompanyBooksDriveBackupPayload>;
    if (!companyPayload.company || !companyPayload.dataset) {
      throw new Error('La copia de libros de empresa está incompleta o dañada.');
    }
    const payload = companyPayload as CompanyBooksDriveBackupPayload;
    const checksumValid = await verifyBackupPayloadChecksum(payload);
    return { payload, checksumValid };
  }

  const accountPayload = parsed as Partial<AccountDriveBackupPayload>;
  if (
    !Array.isArray(accountPayload.companies) ||
    !accountPayload.companyData ||
    typeof accountPayload.companyData !== 'object'
  ) {
    throw new Error(
      'El archivo seleccionado no contiene datos válidos de cuenta de Equinox-Books.'
    );
  }

  const payload = accountPayload as AccountDriveBackupPayload;
  const checksumValid = await verifyBackupPayloadChecksum(payload);
  return { payload, checksumValid };
}

export async function deleteAccountBackupFromDrive(
  accessToken: string,
  fileId: string
): Promise<void> {
  await driveFetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`, accessToken, {
    method: 'DELETE',
  });
}
