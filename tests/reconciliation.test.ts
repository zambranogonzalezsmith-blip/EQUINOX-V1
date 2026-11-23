import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  CompanyDataset,
  CompanyProfile,
  PendingSyncMutation,
  WorkspaceState,
} from '../src/types/accounting.js';
import { reconcileWorkspaceState } from '../src/utils/reconcileWorkspace.js';
import { createEmptyCompanyDataset } from '../src/utils/venezuelaCatalog.js';

function makeCompany(id: string, razonSocial: string, updatedAt: string): CompanyProfile {
  return {
    id,
    ownerUid: 'uid-alice',
    googleAuthUid: 'uid-alice',
    googleAuthEmail: 'alice@empresa.com',
    googleVerified: true,
    razonSocial,
    rif: 'J-12345678-9',
    tipoContribuyente: 'Ordinario',
    actividadEconomica: 'Comercio',
    domicilioFiscal: 'Caracas',
    telefono: '0212-1112233',
    monedaFuncional: 'VES',
    alicuotaIvaGeneral: 16,
    alicuotaIvaReducida: 8,
    agenteRetencionIva: 0,
    agenteRetencionIslr: false,
    sujetoIgtf: false,
    unidadTributariaBs: 9,
    contadorNombre: 'Lic. Pérez',
    cpcNumero: 'CPC-99',
    periodoFiscalInicio: '2026-01-01',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

describe('reconcileWorkspaceState (res.workspace -> estado React)', () => {
  it('actualiza empresas y datasets con la versión más reciente del servidor', () => {
    const oldDs: CompanyDataset = {
      ...createEmptyCompanyDataset(),
      nextId: 2,
      updatedAt: '2026-10-01T10:00:00.000Z',
    };
    const newDs: CompanyDataset = {
      ...createEmptyCompanyDataset(),
      nextId: 15,
      updatedAt: '2026-10-02T12:00:00.000Z',
    };

    const localWs: WorkspaceState = {
      companies: [makeCompany('c1', 'Nombre Viejo C.A.', '2026-10-01T10:00:00.000Z')],
      activeCompanyId: 'c1',
      companyData: { c1: oldDs },
      lastServerSync: null,
    };

    const serverWs: WorkspaceState = {
      companies: [
        makeCompany('c1', 'Nombre Autorizado C.A.', '2026-10-02T12:00:00.000Z'),
        makeCompany('c2', 'Segunda Entidad C.A.', '2026-10-02T12:00:00.000Z'),
      ],
      activeCompanyId: 'c1',
      companyData: {
        c1: newDs,
        c2: createEmptyCompanyDataset(),
      },
      lastServerSync: '2026-10-02T12:00:05.000Z',
    };

    const merged = reconcileWorkspaceState(localWs, serverWs, [], '2026-10-02T12:00:05.000Z');
    assert.equal(merged.companies.length, 2);
    assert.equal(merged.companies[0].razonSocial, 'Nombre Autorizado C.A.');
    assert.equal(merged.companyData.c1.nextId, 15);
    assert.equal(merged.lastServerSync, '2026-10-02T12:00:05.000Z');
  });

  it('preserva cambios locales pendientes en outbox y oculta eliminaciones pendientes', () => {
    const localDs: CompanyDataset = {
      ...createEmptyCompanyDataset(),
      nextId: 99,
      updatedAt: '2026-10-01T08:00:00.000Z',
    };

    const localWs: WorkspaceState = {
      companies: [
        makeCompany('c1', 'Editada Localmente C.A.', '2026-10-01T08:00:00.000Z'),
        makeCompany('c3-local', 'Nueva Sin Subir C.A.', '2026-10-03T09:00:00.000Z'),
      ],
      activeCompanyId: 'c2',
      companyData: {
        c1: localDs,
        'c3-local': createEmptyCompanyDataset(),
      },
      lastServerSync: null,
    };

    const serverWs: WorkspaceState = {
      companies: [
        makeCompany('c1', 'Vieja En Servidor C.A.', '2026-10-02T12:00:00.000Z'),
        makeCompany('c2', 'Eliminada Pendiente C.A.', '2026-10-02T12:00:00.000Z'),
      ],
      activeCompanyId: 'c2',
      companyData: {
        c1: { ...createEmptyCompanyDataset(), nextId: 5, updatedAt: '2026-10-02T12:00:00.000Z' },
        c2: createEmptyCompanyDataset(),
      },
      lastServerSync: '2026-10-02T12:00:00.000Z',
    };

    const pendingOutbox: PendingSyncMutation[] = [
      {
        id: 'm1',
        timestamp: '2026-10-03T09:00:00.000Z',
        companyId: 'c1',
        companyName: 'Editada Localmente C.A.',
        actionType: 'DATASET_UPDATE',
        summary: 'Asiento offline',
        datasetSnapshot: localDs,
      },
      {
        id: 'm2',
        timestamp: '2026-10-03T09:01:00.000Z',
        companyId: 'c2',
        companyName: 'Eliminada Pendiente C.A.',
        actionType: 'COMPANY_DELETE',
        summary: 'Eliminar c2',
        deletedCompanyId: 'c2',
      },
      {
        id: 'm3',
        timestamp: '2026-10-03T09:02:00.000Z',
        companyId: 'c3-local',
        companyName: 'Nueva Sin Subir C.A.',
        actionType: 'COMPANY_CREATE',
        summary: 'Crear c3-local',
      },
    ];

    const merged = reconcileWorkspaceState(localWs, serverWs, pendingOutbox);
    assert.deepEqual(
      merged.companies.map((c) => c.id),
      ['c1', 'c3-local']
    );
    assert.equal(merged.companyData.c1.nextId, 99);
    // c2 ya no está disponible -> activeCompanyId hace fallback seguro a c1
    assert.equal(merged.activeCompanyId, 'c1');
  });
});
