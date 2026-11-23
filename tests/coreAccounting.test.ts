import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  centsToStr,
  isValidVenezuelanRIF,
  nicConvertAmountToBs,
  strToCents,
} from '../src/utils/monetary.js';
import { compactOutboxQueue } from '../src/utils/offlineSync.js';
import { isSuperAdminEmail, resolveUserRole, SUPER_ADMIN_EMAIL } from '../src/utils/rbac.js';
import { createEmptyCompanyDataset } from '../src/utils/venezuelaCatalog.js';

describe('Aritmética Cero-Float, RIF SENIAT, Outbox y RBAC', () => {
  it('convierte importes monetarios sin errores de coma flotante', () => {
    assert.equal(strToCents('1250,45'), 125045);
    assert.equal(strToCents('0.19'), 19);
    assert.equal(centsToStr(125045), '1,250.45');
    assert.equal(nicConvertAmountToBs(10000, 46.85), 468500);
  });

  it('valida formato RIF venezolano SENIAT', () => {
    assert.equal(isValidVenezuelanRIF('J-30112233-4'), true);
    assert.equal(isValidVenezuelanRIF('v-12345678-0'), true);
    assert.equal(isValidVenezuelanRIF('12345'), false);
  });

  it('compacta cola outbox preservando solo el snapshot más reciente por empresa', () => {
    const ds1 = { ...createEmptyCompanyDataset(), nextId: 2 };
    const ds2 = { ...createEmptyCompanyDataset(), nextId: 3 };
    const compacted = compactOutboxQueue([
      {
        id: 'm1',
        timestamp: '2026-10-01T10:00:00.000Z',
        companyId: 'c1',
        companyName: 'C1',
        actionType: 'DATASET_UPDATE',
        summary: 'Paso 1',
        datasetSnapshot: ds1,
      },
      {
        id: 'm2',
        timestamp: '2026-10-01T10:01:00.000Z',
        companyId: 'c1',
        companyName: 'C1',
        actionType: 'DATASET_UPDATE',
        summary: 'Paso 2',
        datasetSnapshot: ds2,
      },
    ]);
    assert.equal(compacted[0].datasetSnapshot, undefined);
    assert.equal(compacted[1].datasetSnapshot?.nextId, 3);
  });

  it('asigna rol superadmin exclusivamente al correo autorizado verificado', () => {
    assert.equal(isSuperAdminEmail(SUPER_ADMIN_EMAIL.toUpperCase()), true);
    assert.equal(resolveUserRole(SUPER_ADMIN_EMAIL, true), 'superadmin');
    assert.equal(resolveUserRole(SUPER_ADMIN_EMAIL, false), 'user');
    assert.equal(resolveUserRole('otro@gmail.com', true), 'user');
  });
});
