import { createVerify } from 'node:crypto';
import fs from 'node:fs';
import { SUPER_ADMIN_EMAIL } from '../../src/utils/rbac.js';

export interface VerifiedFirebaseCaller {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  isSuperAdmin: boolean;
  idToken: string;
}

interface CertCache {
  certs: Record<string, string>;
  expiresAtMs: number;
}

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedProjectId: string | null = null;
let certCache: CertCache | null = null;

export function resolveFirebaseProjectId(): string {
  if (cachedProjectId) return cachedProjectId;
  if (process.env.FIREBASE_PROJECT_ID) {
    cachedProjectId = process.env.FIREBASE_PROJECT_ID.trim();
    return cachedProjectId;
  }
  try {
    const configUrl = new URL('../../firebase-applet-config.json', import.meta.url);
    const raw = fs.readFileSync(configUrl, 'utf-8');
    const parsed = JSON.parse(raw) as { projectId?: string };
    if (parsed.projectId) {
      cachedProjectId = parsed.projectId.trim();
      return cachedProjectId;
    }
  } catch {
    // Fallback below
  }
  throw new Error('Firebase projectId no está configurado en firebase-applet-config.json.');
}

export function resolveFirestoreDatabaseId(): string {
  if (process.env.FIRESTORE_DATABASE_ID) {
    return process.env.FIRESTORE_DATABASE_ID.trim() || '(default)';
  }
  try {
    const configUrl = new URL('../../firebase-applet-config.json', import.meta.url);
    const raw = fs.readFileSync(configUrl, 'utf-8');
    const parsed = JSON.parse(raw) as { firestoreDatabaseId?: string };
    return parsed.firestoreDatabaseId?.trim() || '(default)';
  } catch {
    return '(default)';
  }
}

export function extractBearerToken(
  authorizationHeader?: string | string[]
): string | null {
  const raw = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;
  if (!raw || typeof raw !== 'string') return null;
  const match = raw.match(/^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/);
  return match ? match[1] : null;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const mod = padded.length % 4;
  const normalized = mod === 0 ? padded : padded + '='.repeat(4 - mod);
  const text = Buffer.from(normalized, 'base64').toString('utf8');
  return JSON.parse(text) as T;
}

function decodeBase64UrlBuffer(segment: string): Buffer {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const mod = padded.length % 4;
  const normalized = mod === 0 ? padded : padded + '='.repeat(4 - mod);
  return Buffer.from(normalized, 'base64');
}

async function fetchGooglePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  if (!forceRefresh && certCache && Date.now() < certCache.expiresAtMs) {
    return certCache.certs;
  }

  const res = await fetch(GOOGLE_CERTS_URL, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`No se pudieron obtener certificados públicos de Firebase (${res.status}).`);
  }
  const certs = (await res.json()) as Record<string, string>;
  const ccHeader = res.headers.get('cache-control') || '';
  const maxAgeMatch = ccHeader.match(/max-age=(\d+)/i);
  const ttlMs = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) * 1000 : 300_000;

  certCache = {
    certs,
    expiresAtMs: Date.now() + ttlMs,
  };
  return certs;
}

export function verifyFirebaseJwtWithCertificates(
  token: string,
  certs: Record<string, string>,
  projectId: string,
  nowEpochSec = Math.floor(Date.now() / 1000)
): VerifiedFirebaseCaller {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Token Firebase JWT malformado.');
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; kid?: string };
  let payload: {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  try {
    header = decodeBase64UrlJson(headerB64);
    payload = decodeBase64UrlJson(payloadB64);
  } catch {
    throw new Error('No se pudo decodificar el token Firebase.');
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new Error('Algoritmo o identificador de clave inválido en token Firebase.');
  }

  const cert = certs[header.kid];
  if (!cert) {
    throw new Error('CERT_KID_NOT_FOUND');
  }

  const signature = decodeBase64UrlBuffer(signatureB64);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  if (!verifier.verify(cert, signature)) {
    throw new Error('Firma criptográfica del token Firebase inválida.');
  }

  if (payload.aud !== projectId) {
    throw new Error('Audiencia (aud) del token Firebase no corresponde al proyecto.');
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Emisor (iss) del token Firebase inválido.');
  }
  if (typeof payload.sub !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.sub)) {
    throw new Error('Sujeto (uid) del token Firebase inválido.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowEpochSec) {
    throw new Error('La sesión Firebase ha expirado. Inicia sesión nuevamente con Google.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowEpochSec + 300) {
    throw new Error('Marca de emisión (iat) del token Firebase inválida.');
  }
  if (typeof payload.auth_time === 'number' && payload.auth_time > nowEpochSec + 300) {
    throw new Error('Marca de autenticación (auth_time) inválida.');
  }
  if (payload.email_verified !== true || typeof payload.email !== 'string' || payload.email.length < 3) {
    throw new Error('Se requiere una cuenta de Google con correo verificado.');
  }

  const normalizedEmail = payload.email.trim().toLowerCase();
  return {
    uid: payload.sub,
    email: normalizedEmail,
    emailVerified: true,
    displayName: typeof payload.name === 'string' ? payload.name : undefined,
    isSuperAdmin: normalizedEmail === SUPER_ADMIN_EMAIL,
    idToken: token,
  };
}

export async function authenticateFirebaseRequest(
  authorizationHeader?: string | string[]
): Promise<VerifiedFirebaseCaller> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    throw new Error('Autenticación requerida: falta el encabezado Authorization Bearer.');
  }

  const projectId = resolveFirebaseProjectId();
  let certs = await fetchGooglePublicCerts(false);

  try {
    return verifyFirebaseJwtWithCertificates(token, certs, projectId);
  } catch (err) {
    if (err instanceof Error && err.message === 'CERT_KID_NOT_FOUND') {
      certs = await fetchGooglePublicCerts(true);
      return verifyFirebaseJwtWithCertificates(token, certs, projectId);
    }
    throw err;
  }
}
