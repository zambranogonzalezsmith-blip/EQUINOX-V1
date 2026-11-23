import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  extractBearerToken,
  verifyFirebaseJwtWithCertificates,
  type VerifiedFirebaseCaller,
} from '../api/_lib/firebaseAuth.js';
import type { FirestoreWorkspaceAdapter } from '../api/_lib/firestoreRest.js';
import { validateAndAuthorizeMutation } from '../api/_lib/mutationValidator.js';
import {
  handleAuthorizedSyncPost,
  handleAuthorizedWorkspaceGet,
} from '../api/_lib/workspaceService.js';
import type {
  CompanyDataset,
  CompanyProfile,
  PendingSyncMutation,
} from '../src/types/accounting.js';
import { SUPER_ADMIN_EMAIL } from '../src/utils/rbac.js';
import { createEmptyCompanyDataset } from '../src/utils/venezuelaCatalog.js';

const TEST_PROJECT_ID = 'equinox-test-project';

function toBase64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createSignedJwt(
  privateKeyPem: string,
  kid: string,
  payloadOverrides: Record<string, unknown>,
  headerOverrides: Record<string, unknown> = {}
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    kid,
    typ: 'JWT',
    ...headerOverrides,
  };
  const payload = {
    aud: TEST_PROJECT_ID,
    iss: `https://securetoken.google.com/${TEST_PROJECT_ID}`,
    sub: 'user_alice_123',
    iat: nowSec - 30,
    auth_time: nowSec - 30,
    exp: nowSec + 3600,
    email: 'alice@empresa.com',
    email_verified: true,
    name: 'Alice Contador',
    ...payloadOverrides,
  };
  const headerSeg = toBase64Url(JSON.stringify(header));
  const payloadSeg = toBase64Url(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${headerSeg}.${payloadSeg}`);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${headerSeg}.${payloadSeg}.${toBase64Url(signature)}`;
}

function makeCompany(id: string, ownerUid: string, razonSocial = 'Empresa Demo C.A.'): CompanyProfile {
  const now = '2026-10-01T12:00:00.000Z';
  return {
    id,
    ownerUid,
    googleAuthUid: ownerUid,
    googleAuthEmail: `${ownerUid}@empresa.com`,
    googleVerified: true,
    razonSocial,
    rif: 'J-12345678-9',
    tipoContribuyente: 'Ordinario',
    actividadEconomica: 'Servicios Contables',
    domicilioFiscal: 'Caracas, Venezuela',
    telefono: '0212-5550101',
    monedaFuncional: 'VES',
    alicuotaIvaGeneral: 16,
    alicuotaIvaReducida: 8,
    agenteRetencionIva: 0,
    agenteRetencionIslr: true,
    sujetoIgtf: false,
    unidadTributariaBs: 9,
    contadorNombre: 'Lic. Smith',
    cpcNumero: 'CPC-12345',
    periodoFiscalInicio: '2026-01-01',
    createdAt: now,
    updatedAt: now,
  };
}

function createInMemoryFirestoreAdapter(seed?: {
  companies?: CompanyProfile[];
  ledgers?: Record<string, CompanyDataset>;
  activeCompanyByUid?: Record<string, string>;
}): FirestoreWorkspaceAdapter {
  const companies = new Map<string, CompanyProfile>((seed?.companies || []).map((c) => [c.id, c]));
  const ledgers = new Map<string, CompanyDataset>(Object.entries(seed?.ledgers || {}));
  const activeByUid = new Map<string, string>(Object.entries(seed?.activeCompanyByUid || {}));
  const processedByUid = new Map<string, string[]>();

  return {
    async listCompaniesForCaller(caller, scope) {
      const all = Array.from(companies.values());
      if (caller.isSuperAdmin && scope === 'all') {
        return all;
      }
      return all.filter((c) => c.ownerUid === caller.uid);
    },
    async getCompany(companyId) {
      return companies.get(companyId) || null;
    },
    async upsertCompany(company) {
      companies.set(company.id, company);
    },
    async getLedger(companyId) {
      return ledgers.get(companyId) || null;
    },
    async upsertLedger(_ownerUid, companyId, dataset) {
      ledgers.set(companyId, dataset);
    },
    async deleteCompanyAndLedger(companyId) {
      companies.delete(companyId);
      ledgers.delete(companyId);
    },
    async getUserActiveCompanyId(uid) {
      return activeByUid.get(uid) || null;
    },
    async setUserActiveCompanyId(uid, activeCompanyId) {
      activeByUid.set(uid, activeCompanyId);
    },
    async getProcessedMutationIds(uid) {
      return [...(processedByUid.get(uid) || [])];
    },
    async saveProcessedMutationIds(uid, ids) {
      processedByUid.set(uid, [...ids]);
    },
  };
}

describe('Firebase JWT Auth & Bearer Extraction', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const certs = { 'kid-primary': publicKey };

  it('extrae correctamente Bearer tokens válidos y rechaza encabezados inválidos', () => {
    assert.equal(extractBearerToken('Bearer aaa.bbb.ccc'), 'aaa.bbb.ccc');
    assert.equal(extractBearerToken('Bearer invalid'), null);
    assert.equal(extractBearerToken(undefined), null);
    assert.equal(extractBearerToken('Basic abcdef'), null);
  });

  it('verifica un token Firebase RS256 válido y detecta rol estándar vs Super Admin', () => {
    const userJwt = createSignedJwt(privateKey, 'kid-primary', {
      sub: 'uid-alice',
      email: 'alice@empresa.com',
    });
    const caller = verifyFirebaseJwtWithCertificates(userJwt, certs, TEST_PROJECT_ID);
    assert.equal(caller.uid, 'uid-alice');
    assert.equal(caller.email, 'alice@empresa.com');
    assert.equal(caller.isSuperAdmin, false);

    const adminJwt = createSignedJwt(privateKey, 'kid-primary', {
      sub: 'uid-super',
      email: SUPER_ADMIN_EMAIL.toUpperCase(),
    });
    const superCaller = verifyFirebaseJwtWithCertificates(adminJwt, certs, TEST_PROJECT_ID);
    assert.equal(superCaller.isSuperAdmin, true);
  });

  it('rechaza tokens expirados, correos no verificados, audiencia errónea y firmas alteradas', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expired = createSignedJwt(privateKey, 'kid-primary', { exp: nowSec - 10 });
    assert.throws(() => verifyFirebaseJwtWithCertificates(expired, certs, TEST_PROJECT_ID, nowSec));

    const unverified = createSignedJwt(privateKey, 'kid-primary', { email_verified: false });
    assert.throws(() =>
      verifyFirebaseJwtWithCertificates(unverified, certs, TEST_PROJECT_ID, nowSec)
    );

    const wrongAud = createSignedJwt(privateKey, 'kid-primary', { aud: 'other-project' });
    assert.throws(() =>
      verifyFirebaseJwtWithCertificates(wrongAud, certs, TEST_PROJECT_ID, nowSec)
    );

    const valid = createSignedJwt(privateKey, 'kid-primary', {});
    const parts = valid.split('.');
    const tampered = `${parts[0]}.${toBase64Url(JSON.stringify({ sub: 'hacker' }))}.${parts[2]}`;
    assert.throws(() =>
      verifyFirebaseJwtWithCertificates(tampered, certs, TEST_PROJECT_ID, nowSec)
    );
  });
});

describe('Autorización en /api/workspace y /api/sync con Firestore Adapter', () => {
  const alice: VerifiedFirebaseCaller = {
    uid: 'uid-alice',
    email: 'alice@empresa.com',
    emailVerified: true,
    isSuperAdmin: false,
    idToken: 'tok-alice',
  };
  const bob: VerifiedFirebaseCaller = {
    uid: 'uid-bob',
    email: 'bob@otra.com',
    emailVerified: true,
    isSuperAdmin: false,
    idToken: 'tok-bob',
  };
  const superAdmin: VerifiedFirebaseCaller = {
    uid: 'uid-admin',
    email: SUPER_ADMIN_EMAIL,
    emailVerified: true,
    isSuperAdmin: true,
    idToken: 'tok-admin',
  };

  it('aisla las empresas por usuario en /api/workspace y bloquea ?scope=all a usuarios estándar', async () => {
    const adapter = createInMemoryFirestoreAdapter({
      companies: [
        makeCompany('comp-alice', 'uid-alice', 'Alfa C.A.'),
        makeCompany('comp-bob', 'uid-bob', 'Beta C.A.'),
      ],
      ledgers: {
        'comp-alice': createEmptyCompanyDataset(),
        'comp-bob': createEmptyCompanyDataset(),
      },
    });

    const aliceRes = await handleAuthorizedWorkspaceGet(alice, adapter);
    assert.equal(aliceRes.status, 200);
    if ('companies' in aliceRes.body) {
      assert.deepEqual(
        aliceRes.body.companies.map((c) => c.id),
        ['comp-alice']
      );
    }

    const forbiddenScope = await handleAuthorizedWorkspaceGet(alice, adapter, 'all');
    assert.equal(forbiddenScope.status, 403);

    const adminScope = await handleAuthorizedWorkspaceGet(superAdmin, adapter, 'all');
    assert.equal(adminScope.status, 200);
    if ('companies' in adminScope.body) {
      assert.equal(adminScope.body.companies.length, 2);
    }
  });

  it('bloquea mutaciones cruzadas entre usuarios, acciones no permitidas y spoof de ownerUid', async () => {
    const bobCompany = makeCompany('comp-bob', 'uid-bob', 'Beta C.A.');
    const aliceCompany = makeCompany('comp-alice', 'uid-alice', 'Alfa C.A.');
    const adapter = createInMemoryFirestoreAdapter({
      companies: [aliceCompany, bobCompany],
      ledgers: {
        'comp-alice': createEmptyCompanyDataset(),
        'comp-bob': createEmptyCompanyDataset(),
      },
    });

    const dsUpdateOther = validateAndAuthorizeMutation(
      {
        id: 'mut-cross-1',
        timestamp: '2026-10-02T00:00:00.000Z',
        companyId: 'comp-bob',
        companyName: 'Beta C.A.',
        actionType: 'DATASET_UPDATE',
        summary: 'Intento no autorizado',
        datasetSnapshot: createEmptyCompanyDataset(),
      },
      alice,
      bobCompany
    );
    assert.equal(dsUpdateOther.allowed, false);
    if (!dsUpdateOther.allowed) assert.equal(dsUpdateOther.status, 403);

    const unknownAction = validateAndAuthorizeMutation(
      {
        id: 'mut-unknown-1',
        timestamp: '2026-10-02T00:00:00.000Z',
        companyId: 'comp-alice',
        companyName: 'Alfa C.A.',
        actionType: 'DROP_ALL_TABLES' as PendingSyncMutation['actionType'],
        summary: 'Acción inválida',
      },
      alice,
      aliceCompany
    );
    assert.equal(unknownAction.allowed, false);
    if (!unknownAction.allowed) assert.equal(unknownAction.status, 400);

    const spoofCreate = validateAndAuthorizeMutation(
      {
        id: 'mut-spoof-1',
        timestamp: '2026-10-02T00:00:00.000Z',
        companyId: 'comp-new-1',
        companyName: 'Spoof C.A.',
        actionType: 'COMPANY_CREATE',
        summary: 'Spoof',
        companySnapshot: makeCompany('comp-new-1', 'uid-bob', 'Spoof C.A.'),
      },
      alice,
      null
    );
    assert.equal(spoofCreate.allowed, false);
    if (!spoofCreate.allowed) assert.equal(spoofCreate.status, 403);

    // Probar batch mixto en handleAuthorizedSyncPost: 1 válida de Alice + 1 cruzada contra Bob
    const syncRes = await handleAuthorizedSyncPost(alice, adapter, {
      activeCompanyId: 'comp-alice',
      mutations: [
        {
          id: 'mut-alice-create',
          timestamp: '2026-10-02T10:00:00.000Z',
          companyId: 'comp-alice-2',
          companyName: 'Alfa Dos C.A.',
          actionType: 'COMPANY_CREATE',
          summary: 'Crear empresa propia',
          companySnapshot: {
            ...makeCompany('comp-alice-2', 'uid-alice', 'Alfa Dos C.A.'),
            updatedAt: '2026-10-02T10:00:00.000Z',
          },
          datasetSnapshot: {
            ...createEmptyCompanyDataset(),
            updatedAt: '2026-10-02T10:00:00.000Z',
          },
        },
        {
          id: 'mut-bob-delete-attempt',
          timestamp: '2026-10-02T10:00:01.000Z',
          companyId: 'comp-bob',
          companyName: 'Beta C.A.',
          actionType: 'COMPANY_DELETE',
          summary: 'Eliminar empresa de otro usuario',
          deletedCompanyId: 'comp-bob',
        },
      ],
    });

    assert.equal(syncRes.status, 200);
    assert.equal(syncRes.body.ok, true);
    assert.equal(syncRes.body.syncedCount, 1);
    assert.equal(syncRes.body.rejectedMutations.length, 1);
    assert.equal(syncRes.body.rejectedMutations[0].status, 403);
    assert.ok(syncRes.body.workspace);
    assert.ok(syncRes.body.workspace.companies.some((c) => c.id === 'comp-alice-2'));
    assert.ok(await adapter.getCompany('comp-bob')); // Empresa de Bob permanece intacta

    // Idempotencia: reenviar el mismo mutation id no vuelve a sincronizar ni duplicar
    const replayRes = await handleAuthorizedSyncPost(alice, adapter, {
      activeCompanyId: 'comp-alice-2',
      mutations: [
        {
          id: 'mut-alice-create',
          timestamp: '2026-10-02T10:00:00.000Z',
          companyId: 'comp-alice-2',
          companyName: 'Alfa Dos C.A.',
          actionType: 'COMPANY_CREATE',
          summary: 'Replay',
          companySnapshot: makeCompany('comp-alice-2', 'uid-alice', 'Alfa Dos C.A.'),
        },
      ],
    });
    assert.equal(replayRes.status, 200);
    assert.equal(replayRes.body.syncedCount, 0);

    // Si TODAS las mutaciones del batch son no autorizadas, devuelve 403 sin aplicar cambios
    const onlyUnauthorized = await handleAuthorizedSyncPost(bob, adapter, {
      mutations: [
        {
          id: 'mut-bob-steal-alice',
          timestamp: '2026-10-02T11:00:00.000Z',
          companyId: 'comp-alice',
          companyName: 'Alfa C.A.',
          actionType: 'COMPANY_DELETE',
          summary: 'Borrar Alfa',
          deletedCompanyId: 'comp-alice',
        },
      ],
    });
    assert.equal(onlyUnauthorized.status, 403);
    assert.equal(onlyUnauthorized.body.ok, false);
    assert.ok(await adapter.getCompany('comp-alice'));
  });
});
