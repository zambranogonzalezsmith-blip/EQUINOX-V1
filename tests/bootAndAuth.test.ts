import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CuentaNIC } from '../src/types/accounting.js';
import { formatFirebaseAuthError } from '../src/utils/authErrorMessages.js';
import {
  CUENTAS_NIC_VENEZUELA,
  DEFAULT_COMPANIES,
  normalizeCompanyDataset,
} from '../src/utils/venezuelaCatalog.js';

describe('formatFirebaseAuthError (mensajes accionables de inicio de sesión)', () => {
  it('incluye el dominio exacto para auth/unauthorized-domain', () => {
    const msg = formatFirebaseAuthError(
      { code: 'auth/unauthorized-domain', message: 'Firebase: Error (auth/unauthorized-domain).' },
      'usuario.github.io'
    );
    assert.match(msg, /usuario\.github\.io/);
    assert.match(msg, /Authorized domains/i);
  });

  it('traduce errores comunes de popup, red y entorno en español claro', () => {
    assert.match(
      formatFirebaseAuthError({ code: 'auth/popup-blocked' }),
      /ventana emergente/i
    );
    assert.match(
      formatFirebaseAuthError({ code: 'auth/popup-closed-by-user' }),
      /Cerraste la ventana/i
    );
    assert.match(
      formatFirebaseAuthError({ code: 'auth/network-request-failed' }),
      /Modo Offline/i
    );
    assert.match(
      formatFirebaseAuthError(new Error('Fallo personalizado')),
      /Fallo personalizado/
    );
  });
});

describe('normalizeCompanyDataset y catálogo NIC/VEN-NIF', () => {
  it('reconstruye estructura NIC completa para datasets vacíos o legados preservando updatedAt', () => {
    const legacyAccount: CuentaNIC = {
      codigo: '1101',
      nombre: 'Caja Principal Personalizada',
      tipo_cuenta: 'Activo',
      naturaleza: 'Débito',
      ubicacion_estado: 'Balance General',
      indicador_libro: 'Ninguno',
      seccion_destino: 'Activo Corriente',
      tipo_indice: 1,
    };

    const normalized = normalizeCompanyDataset({
      catalogo: [legacyAccount],
      nextId: 0,
      updatedAt: '2026-05-10T12:00:00.000Z',
    });

    assert.equal(normalized.updatedAt, '2026-05-10T12:00:00.000Z');
    assert.equal(normalized.nextId, 1);
    assert.equal(normalized.catalogo[0].nombre, 'Caja Principal Personalizada');
    assert.equal(normalized.catalogo[0].clasificacion_nic, 'Corriente');
    assert.equal(normalized.catalogo[0].partida_monetaria, true);
    assert.equal(normalized.catalogo[0].norma_nic, 'NIC 1 / NIC 7');
    assert.ok(Array.isArray(normalized.conciliacionBancaria?.movimientosBanco));
    assert.ok(Array.isArray(normalized.inventario.productos));
    assert.ok(Array.isArray(normalized.documentosFiscales));
    assert.ok(Array.isArray(normalized.retencionesIslr));
  });

  it('carga las 27 cuentas NIC/VEN-NIF y periodo fiscal ISO cuando el dataset está vacío', () => {
    const normalized = normalizeCompanyDataset(null);
    assert.equal(normalized.catalogo.length, CUENTAS_NIC_VENEZUELA.length);
    for (const comp of DEFAULT_COMPANIES) {
      assert.match(comp.periodoFiscalInicio, /^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
