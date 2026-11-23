import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyFirestoreError,
  EquinoxFirestoreError,
  OperationType,
} from '../src/utils/firestoreErrors.js';

describe('classifyFirestoreError', () => {
  it('clasifica permission-denied con estado 403 y retryable=false', () => {
    const res = classifyFirestoreError({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions.',
    });
    assert.equal(res.category, 'PERMISSION_DENIED');
    assert.equal(res.httpStatus, 403);
    assert.equal(res.retryable, false);

    const prefixed = classifyFirestoreError({
      code: 'firestore/permission-denied',
      message: 'Denied by rules',
    });
    assert.equal(prefixed.category, 'PERMISSION_DENIED');
  });

  it('clasifica unauthenticated con estado 401', () => {
    const res = classifyFirestoreError({
      code: 'unauthenticated',
      message: 'Invalid auth token',
    });
    assert.equal(res.category, 'UNAUTHENTICATED');
    assert.equal(res.httpStatus, 401);
    assert.equal(res.retryable, false);
  });

  it('clasifica unavailable / client is offline como NETWORK_OFFLINE (retryable=true)', () => {
    const offlineMsg = classifyFirestoreError(
      new Error('Failed to get document because the client is offline.')
    );
    assert.equal(offlineMsg.category, 'NETWORK_OFFLINE');
    assert.equal(offlineMsg.retryable, true);
    assert.equal(offlineMsg.httpStatus, 503);

    const unavailableCode = classifyFirestoreError({
      code: 'unavailable',
      message: 'Service unavailable',
    });
    assert.equal(unavailableCode.category, 'NETWORK_OFFLINE');
    assert.equal(unavailableCode.retryable, true);
  });

  it('clasifica resource-exhausted, not-found, already-exists e invalid-argument correctamente', () => {
    assert.equal(
      classifyFirestoreError({ code: 'resource-exhausted', message: 'Quota exceeded' }).category,
      'QUOTA_EXCEEDED'
    );
    assert.equal(
      classifyFirestoreError({ code: 'not-found', message: 'Doc missing' }).category,
      'NOT_FOUND'
    );
    assert.equal(
      classifyFirestoreError({ code: 'already-exists', message: 'Already exists' }).category,
      'CONFLICT'
    );
    assert.equal(
      classifyFirestoreError({ code: 'failed-precondition', message: 'Index missing' }).category,
      'INVALID_ARGUMENT'
    );
  });

  it('preserva clasificación de EquinoxFirestoreError y JSON FirestoreErrorInfo', () => {
    const classified = classifyFirestoreError({ code: 'permission-denied', message: 'Denied' });
    const errInfo = {
      error: classified.message,
      category: classified.category,
      code: classified.code,
      retryable: classified.retryable,
      operationType: OperationType.WRITE,
      path: 'companies/c1',
      authInfo: { userId: 'u1' },
    };
    const eqxErr = new EquinoxFirestoreError(JSON.stringify(errInfo), errInfo, classified);
    assert.equal(classifyFirestoreError(eqxErr).category, 'PERMISSION_DENIED');

    const reparsed = classifyFirestoreError(new Error(JSON.stringify(errInfo)));
    assert.equal(reparsed.category, 'PERMISSION_DENIED');
    assert.equal(reparsed.httpStatus, 403);
  });
});
